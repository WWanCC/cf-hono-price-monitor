/**
 * 价格监控接口。
 *
 * 创建 Monitor 前必须确认两侧 SKU 属于同一逻辑商品，且角色分别为 official/own；
 * 接口还会先用示例价格验证规则语法，避免把无法执行的表达式写进数据库。
 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from '../db'
import { monitors } from '../db/schema'
import { checkMonitor, getSkuContext, listSkuContexts } from '../services/monitor'
import { enqueueEnabledMonitors } from '../services/monitor-scheduler'
import { evaluateRule } from '../services/rule-expression'

const createMonitorSchema = z.object({
  referenceSkuId: z.number().int().positive(),
  targetSkuId: z.number().int().positive(),
  ruleExpression: z.string().trim().min(1).default('own >= official'),
})

const updateMonitorSchema = z.object({
  enabled: z.boolean().optional(),
  ruleExpression: z.string().trim().min(1).optional(),
})

export const monitorsRoute = new Hono<{ Bindings: CloudflareBindings }>()

monitorsRoute.post('/', zValidator('json', createMonitorSchema), async (c) => {
  const body = c.req.valid('json')
  const db = createDb(c.env.DB)

  // 并行查询两侧 SKU；随后校验角色和 productId，避免跨商品建立无意义的监控。
  const [reference, target] = await Promise.all([
    getSkuContext(db, body.referenceSkuId),
    getSkuContext(db, body.targetSkuId),
  ])

  if (!reference) return c.json({ success: false, message: '官方 SKU 不存在' }, 400)
  if (!target) return c.json({ success: false, message: '自店 SKU 不存在' }, 400)
  if (reference.role !== 'official') {
    return c.json({ success: false, message: 'referenceSkuId 必须属于 official Listing' }, 400)
  }
  if (target.role !== 'own') {
    return c.json({ success: false, message: 'targetSkuId 必须属于 own Listing' }, 400)
  }
  if (reference.productId !== target.productId) {
    return c.json({ success: false, message: '官方 SKU 和自店 SKU 必须属于同一个商品' }, 400)
  }

  // 用示例价格只验证语法和类型，真正检测时再传入喵喵折返回的价格。
  try {
    evaluateRule(body.ruleExpression, { official: 100, own: 100 })
  } catch (error) {
    return c.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '规则表达式无效',
      },
      400,
    )
  }

  try {
    const [monitor] = await db
      .insert(monitors)
      .values({
        referenceSkuId: body.referenceSkuId,
        targetSkuId: body.targetSkuId,
        ruleExpression: body.ruleExpression,
      })
      .returning()

    return c.json({ success: true, data: monitor }, 201)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return c.json({ success: false, message: '这两个 SKU 已经建立监控' }, 409)
    }
    throw error
  }
})

monitorsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB)

  const [rows, skuContexts] = await Promise.all([
    db.select().from(monitors).orderBy(monitors.id),
    listSkuContexts(db),
  ])

  const skuMap = new Map(
    skuContexts.map((item) => [item.skuId, item]),
  )

  const data = rows.map((monitor) => {
    const reference = skuMap.get(monitor.referenceSkuId)
    const target = skuMap.get(monitor.targetSkuId)

    return {
      ...monitor,
      referenceSku: reference
        ? {
            id: reference.skuId,
            externalSkuId: reference.externalSkuId,
            name: reference.skuName,
            shopName: reference.shopName,
            listingTitle: reference.listingTitle,
            url: reference.skuUrl,
          }
        : null,
      targetSku: target
        ? {
            id: target.skuId,
            externalSkuId: target.externalSkuId,
            name: target.skuName,
            shopName: target.shopName,
            listingTitle: target.listingTitle,
            url: target.skuUrl,
          }
        : null,
    }
  })

  return c.json({ success: true, data })
})

monitorsRoute.post('/check-all', async (c) => {
  const db = createDb(c.env.DB)
  const count = await enqueueEnabledMonitors(db, c.env.PRICE_CHECK_QUEUE)
  return c.json({ success: true, data: { enqueued: count } })
})

monitorsRoute.patch('/:id', zValidator('json', updateMonitorSchema), async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ success: false, message: '无效的 Monitor ID' }, 400)
  }

  const body = c.req.valid('json')
  if (body.ruleExpression) {
    try {
      evaluateRule(body.ruleExpression, { official: 100, own: 100 })
    } catch (error) {
      return c.json(
        {
          success: false,
          message: error instanceof Error ? error.message : '规则表达式无效',
        },
        400,
      )
    }
  }

  const db = createDb(c.env.DB)
  const [monitor] = await db
    .update(monitors)
    .set(body)
    .where(eq(monitors.id, id))
    .returning()

  if (!monitor) return c.json({ success: false, message: '监控不存在' }, 404)
  return c.json({ success: true, data: monitor })
})

monitorsRoute.post('/:id/check', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ success: false, message: '无效的 Monitor ID' }, 400)
  }

  const db = createDb(c.env.DB)
  const result = await checkMonitor(
    db,
    (c.env as CloudflareBindings & { MIAOMIAO_TOKEN?: string }).MIAOMIAO_TOKEN,
    id,
  )
  return c.json({ success: true, data: result })
})
