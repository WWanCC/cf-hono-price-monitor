/**
 * 价格监控 HTTP 接口。
 *
 * Monitor 在数据库里同时承担“SKU 映射”和“价格监控”两个阶段：
 * - 新建 SKU 映射：只保存官方 SKU -> 自店 SKU，规则暂时为空并保持停用；
 * - 应用价格规则：给已勾选映射批量写入 ruleExpression，并可同时启用。
 *
 * 这样前端可以先把全部 SKU 对应关系整理好，再在价格监控列表中统一勾选、
 * 选择常用规则并应用，符合实际运营流程。
 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { monitors } from '../db/schema'
import { parsePositiveIntParam } from '../lib/http'
import {
  applyRuleToMonitorsBatch,
  createMonitorMappingsBatch,
  createMonitorsBatch,
  MAX_BATCH_MONITORS,
  MonitorValidationError,
  validateRuleExpression,
} from '../services/monitor-management'
import {
  checkMonitor,
  isSkuContextActive,
  listSkuContexts,
} from '../services/monitor'
import { enqueueEnabledMonitors } from '../services/monitor-scheduler'

const pairSchema = z.object({
  referenceSkuId: z.number().int().positive(),
  targetSkuId: z.number().int().positive(),
})

/** 兼容旧调用：创建一条已经带规则的 Monitor。 */
const createSchema = pairSchema.extend({
  ruleExpression: z.string().trim().min(1).default('own >= official'),
})

/** 兼容旧调用：批量创建已经带规则的 Monitor。 */
const batchCreateSchema = z.object({
  pairs: z.array(pairSchema).min(1).max(MAX_BATCH_MONITORS),
  ruleExpression: z.string().trim().min(1).default('own >= official'),
  enabled: z.boolean().optional().default(true),
})

/** v1.5.1 页面使用：只建立 SKU 映射，不要求此时选择规则。 */
const mappingBatchCreateSchema = z.object({
  pairs: z.array(pairSchema).min(1).max(MAX_BATCH_MONITORS),
})

/** 在列表勾选多条映射后，统一应用一条规则。 */
const batchRuleSchema = z.object({
  monitorIds: z.array(z.number().int().positive()).min(1).max(MAX_BATCH_MONITORS),
  ruleExpression: z.string().trim().min(1),
  enableAfterApply: z.boolean().optional().default(true),
})

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  ruleExpression: z.string().trim().min(1).optional(),
})

export const monitorsRoute = new Hono<{ Bindings: CloudflareBindings }>()

/** 列出 Monitor，并把两侧 SKU 的展示信息一次性拼到响应中。 */
monitorsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB)

  const [monitorRows, contexts] = await Promise.all([
    db.select().from(monitors).orderBy(monitors.id),
    listSkuContexts(db),
  ])

  const contextMap = new Map(contexts.map((context) => [context.skuId, context]))

  const data = monitorRows.map((monitor) => {
    const reference = contextMap.get(monitor.referenceSkuId)
    const target = contextMap.get(monitor.targetSkuId)

    const toViewModel = (context: typeof reference) =>
      context
        ? {
            id: context.skuId,
            externalSkuId: context.externalSkuId,
            name: context.skuName,
            shopName: context.shopName,
            listingTitle: context.listingTitle,
            url: context.skuUrl,
            enabled: isSkuContextActive(context),
          }
        : null

    return {
      ...monitor,
      referenceSku: toViewModel(reference),
      targetSku: toViewModel(target),
    }
  })

  return c.json({ success: true, data })
})

/** 单条创建仍保留，方便 API 调用者直接创建“已配置规则”的 Monitor。 */
monitorsRoute.post(
  '/',
  zValidator('json', createSchema),
  async (c) => {
    const body = c.req.valid('json')

    try {
      const result = await createMonitorsBatch(
        createDb(c.env.DB),
        [
          {
            referenceSkuId: body.referenceSkuId,
            targetSkuId: body.targetSkuId,
          },
        ],
        body.ruleExpression,
      )

      if (result.created === 0) {
        return c.json(
          { success: false, message: '这两个 SKU 已经建立监控' },
          409,
        )
      }

      return c.json({ success: true, data: result.monitors[0] }, 201)
    } catch (error) {
      if (error instanceof MonitorValidationError) {
        return c.json({ success: false, message: error.message }, 400)
      }
      throw error
    }
  },
)

/**
 * 兼容旧版的批量 Monitor 创建接口。
 * 新版管理端不再在新增映射时选择规则，但外部 API 调用仍可继续使用此端点。
 */
monitorsRoute.post(
  '/batch',
  zValidator('json', batchCreateSchema),
  async (c) => {
    const body = c.req.valid('json')

    try {
      const data = await createMonitorsBatch(
        createDb(c.env.DB),
        body.pairs,
        body.ruleExpression,
        body.enabled,
      )

      return c.json({ success: true, data }, 201)
    } catch (error) {
      if (error instanceof MonitorValidationError) {
        return c.json({ success: false, message: error.message }, 400)
      }
      throw error
    }
  },
)

/**
 * 只创建 SKU 映射。
 * 新建记录默认 ruleExpression='' 且 enabled=false，避免还没选规则就被 Cron 检测。
 */
monitorsRoute.post(
  '/mappings/batch',
  zValidator('json', mappingBatchCreateSchema),
  async (c) => {
    const body = c.req.valid('json')

    try {
      const data = await createMonitorMappingsBatch(
        createDb(c.env.DB),
        body.pairs,
      )

      return c.json({ success: true, data }, 201)
    } catch (error) {
      if (error instanceof MonitorValidationError) {
        return c.json({ success: false, message: error.message }, 400)
      }
      throw error
    }
  },
)

/**
 * 在价格监控列表勾选多行后统一应用规则。
 * enableAfterApply=true 时，规则写入成功后会同步启用这些 Monitor。
 */
monitorsRoute.patch(
  '/batch-rule',
  zValidator('json', batchRuleSchema),
  async (c) => {
    const body = c.req.valid('json')

    try {
      const data = await applyRuleToMonitorsBatch(
        createDb(c.env.DB),
        body.monitorIds,
        body.ruleExpression,
        body.enableAfterApply,
      )

      return c.json({ success: true, data })
    } catch (error) {
      if (error instanceof MonitorValidationError) {
        return c.json({ success: false, message: error.message }, 400)
      }
      throw error
    }
  },
)

/** “检测全部”只入队，不在当前 HTTP 请求中逐条访问第三方接口。 */
monitorsRoute.post('/check-all', async (c) => {
  const enqueued = await enqueueEnabledMonitors(
    createDb(c.env.DB),
    c.env.PRICE_CHECK_QUEUE,
  )

  return c.json({ success: true, data: { enqueued } })
})

/** 修改单条 Monitor 的规则表达式或启用状态。 */
monitorsRoute.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id = parsePositiveIntParam(c)
    if (!id) {
      return c.json({ success: false, message: '无效的 Monitor ID' }, 400)
    }

    const body = c.req.valid('json')
    const db = createDb(c.env.DB)

    if (body.ruleExpression) {
      try {
        validateRuleExpression(body.ruleExpression)
      } catch (error) {
        if (error instanceof MonitorValidationError) {
          return c.json({ success: false, message: error.message }, 400)
        }
        throw error
      }
    }

    /*
     * 未配置规则的 SKU 映射不能直接开启。
     * 这层后端保护避免用户绕过前端 el-switch，直接请求 PATCH enabled=true。
     */
    if (body.enabled === true && !body.ruleExpression) {
      const [current] = await db
        .select({ ruleExpression: monitors.ruleExpression })
        .from(monitors)
        .where(eq(monitors.id, id))
        .limit(1)

      if (!current) {
        return c.json({ success: false, message: '监控不存在' }, 404)
      }

      if (!current.ruleExpression.trim()) {
        return c.json(
          { success: false, message: '请先为该 SKU 映射应用价格规则' },
          400,
        )
      }
    }

    const [updated] = await db
      .update(monitors)
      .set(body)
      .where(eq(monitors.id, id))
      .returning()

    return updated
      ? c.json({ success: true, data: updated })
      : c.json({ success: false, message: '监控不存在' }, 404)
  },
)

/** 删除 Monitor；历史站内信的 monitorId 会按外键规则置空。 */
monitorsRoute.delete('/:id', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的 Monitor ID' }, 400)
  }

  const [deleted] = await createDb(c.env.DB)
    .delete(monitors)
    .where(eq(monitors.id, id))
    .returning({ id: monitors.id })

  return deleted
    ? c.json({ success: true, data: true })
    : c.json({ success: false, message: '监控不存在' }, 404)
})

/** 手动立即检测单条 Monitor。未配置规则的映射不允许执行检测。 */
monitorsRoute.post('/:id/check', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的 Monitor ID' }, 400)
  }

  const db = createDb(c.env.DB)
  const [current] = await db
    .select({ ruleExpression: monitors.ruleExpression })
    .from(monitors)
    .where(eq(monitors.id, id))
    .limit(1)

  if (!current) {
    return c.json({ success: false, message: '监控不存在' }, 404)
  }

  if (!current.ruleExpression.trim()) {
    return c.json(
      { success: false, message: '该 SKU 映射尚未配置价格规则' },
      400,
    )
  }

  const data = await checkMonitor(
    db,
    c.env.MIAOMIAO_TOKEN,
    id,
  )

  return c.json({ success: true, data })
})
