/**
 * Monitor 创建、SKU 映射和批量规则管理服务。
 *
 * 这里把“HTTP 接口”与“监控业务规则”分开：
 * - routes/monitors.ts 只负责解析请求和返回 HTTP 状态；
 * - 本文件负责验证 SKU 角色、逻辑商品归属、规则表达式以及批量写入。
 *
 * v1.5.1 进一步区分了两个概念：
 * 1. SKU 映射：只建立 官方 SKU -> 自店 SKU 的关系，此时规则可以暂未配置；
 * 2. 价格监控：映射被应用规则并启用后，才真正参与 Cron / Queue 检测。
 *
 * 数据库仍复用 monitors 表，不新增 migration：
 * - 未配置规则的映射使用空字符串 ruleExpression；
 * - 未配置规则的映射必须保持 enabled=false；
 * - 批量应用规则后，可选择是否同时启用。
 */
import { inArray } from 'drizzle-orm'

import type { Db } from '../db'
import { monitors } from '../db/schema'
import { isSkuContextActive, listSkuContexts } from './monitor'
import { evaluateRule } from './rule-expression'

/** 单个官方 SKU 与自店 SKU 的配对关系。 */
export type MonitorPairInput = {
  referenceSkuId: number
  targetSkuId: number
}

/**
 * 单次批处理上限。
 *
 * 前端支持“全部组合”，如果两侧各选择大量 SKU，组合数量会快速膨胀。
 * 服务端再做一次硬限制，避免绕过前端提交超大请求。
 */
export const MAX_BATCH_MONITORS = 100

/**
 * D1 单条 SQL 最多允许有限数量的 bound parameters。
 * 创建 Monitor 时每行至少绑定 3 个值，因此创建操作按 30 行分块。
 */
const D1_INSERT_CHUNK_SIZE = 30

/**
 * 批量更新规则时，每条 UPDATE 会绑定：
 * - ruleExpression 1 个参数；
 * - 可选 enabled 1 个参数；
 * - WHERE id IN (...) 若干参数。
 *
 * 这里保守地把 ID 分成每批 80 个，给 SQL 预留余量。
 */
const D1_UPDATE_ID_CHUNK_SIZE = 80

/** 业务校验失败使用专门错误类型，路由层统一转换为 HTTP 400。 */
export class MonitorValidationError extends Error {}

/**
 * 验证价格规则语法。
 * 这里不读取真实价格，只用安全示例值验证表达式是否能得到 boolean 结果。
 */
export function validateRuleExpression(ruleExpression: string) {
  try {
    evaluateRule(ruleExpression, { official: 100, own: 100 })
  } catch (error) {
    throw new MonitorValidationError(
      error instanceof Error ? error.message : '规则表达式无效',
    )
  }
}

/**
 * 对 SKU 配对做一次完整业务校验。
 *
 * 返回值是去重后的 pairs，后续创建监控和创建映射都复用它。
 */
async function validateAndNormalizePairs(
  db: Db,
  pairs: MonitorPairInput[],
) {
  if (pairs.length === 0) {
    throw new MonitorValidationError('至少需要选择一组 SKU')
  }

  if (pairs.length > MAX_BATCH_MONITORS) {
    throw new MonitorValidationError(
      `单次最多处理 ${MAX_BATCH_MONITORS} 条 SKU 映射`,
    )
  }

  // 请求中可能因为 UI 重复选择或外部 API 调用带来重复配对，先按 pair 去重。
  const uniquePairs = Array.from(
    new Map(
      pairs.map((pair) => [
        `${pair.referenceSkuId}:${pair.targetSkuId}`,
        pair,
      ]),
    ).values(),
  )

  // 一次性读取 SKU 上下文，避免每个 pair 分别查询造成 N+1。
  const contexts = await listSkuContexts(db)
  const contextMap = new Map(contexts.map((context) => [context.skuId, context]))

  for (const pair of uniquePairs) {
    const reference = contextMap.get(pair.referenceSkuId)
    const target = contextMap.get(pair.targetSkuId)

    if (!reference) {
      throw new MonitorValidationError(
        `官方 SKU #${pair.referenceSkuId} 不存在`,
      )
    }

    if (!target) {
      throw new MonitorValidationError(
        `自店 SKU #${pair.targetSkuId} 不存在`,
      )
    }

    if (reference.role !== 'official') {
      throw new MonitorValidationError(
        `SKU #${pair.referenceSkuId} 不是官方 SKU`,
      )
    }

    if (target.role !== 'own') {
      throw new MonitorValidationError(
        `SKU #${pair.targetSkuId} 不是自店 SKU`,
      )
    }

    if (reference.productId !== target.productId) {
      throw new MonitorValidationError(
        `SKU #${pair.referenceSkuId} 与 #${pair.targetSkuId} 不属于同一个逻辑商品`,
      )
    }

    if (!isSkuContextActive(reference) || !isSkuContextActive(target)) {
      throw new MonitorValidationError(
        `SKU #${pair.referenceSkuId} / #${pair.targetSkuId} 所属商品、Listing 或 SKU 已停用`,
      )
    }
  }

  return uniquePairs
}

/**
 * 内部通用批量 INSERT。
 *
 * onConflictDoNothing() 用来跳过已经存在的“官方 SKU + 自店 SKU”配对，
 * 这样批量操作不会因为一条重复记录导致整个请求失败。
 */
async function insertPairs(
  db: Db,
  values: Array<{
    referenceSkuId: number
    targetSkuId: number
    ruleExpression: string
    enabled: boolean
  }>,
) {
  const createdRows: (typeof monitors.$inferSelect)[] = []

  for (let offset = 0; offset < values.length; offset += D1_INSERT_CHUNK_SIZE) {
    const chunk = values.slice(offset, offset + D1_INSERT_CHUNK_SIZE)
    const inserted = await db
      .insert(monitors)
      .values(chunk)
      .onConflictDoNothing()
      .returning()

    createdRows.push(...inserted)
  }

  return createdRows
}

/**
 * 创建“已经配置规则”的 Monitor。
 *
 * 这个函数继续保留给 API 调用者和兼容旧前端：创建时就指定规则，默认直接启用。
 */
export async function createMonitorsBatch(
  db: Db,
  pairs: MonitorPairInput[],
  ruleExpression: string,
  enabled = true,
) {
  validateRuleExpression(ruleExpression)
  const uniquePairs = await validateAndNormalizePairs(db, pairs)

  const createdRows = await insertPairs(
    db,
    uniquePairs.map((pair) => ({
      referenceSkuId: pair.referenceSkuId,
      targetSkuId: pair.targetSkuId,
      ruleExpression,
      enabled,
    })),
  )

  return {
    requested: pairs.length,
    uniqueRequested: uniquePairs.length,
    created: createdRows.length,
    skippedExisting: uniquePairs.length - createdRows.length,
    skippedDuplicateInRequest: pairs.length - uniquePairs.length,
    monitors: createdRows,
  }
}

/**
 * 只创建 SKU 映射，不立即应用价格规则。
 *
 * 这是 v1.5.1 管理端“先完成所有 SKU 映射，再统一勾选应用规则”的基础：
 * - ruleExpression 写空字符串，页面显示为“未配置”；
 * - enabled 固定为 false，确保 Cron 不会提前执行错误规则。
 */
export async function createMonitorMappingsBatch(
  db: Db,
  pairs: MonitorPairInput[],
) {
  const uniquePairs = await validateAndNormalizePairs(db, pairs)

  const createdRows = await insertPairs(
    db,
    uniquePairs.map((pair) => ({
      referenceSkuId: pair.referenceSkuId,
      targetSkuId: pair.targetSkuId,
      ruleExpression: '',
      enabled: false,
    })),
  )

  return {
    requested: pairs.length,
    uniqueRequested: uniquePairs.length,
    created: createdRows.length,
    skippedExisting: uniquePairs.length - createdRows.length,
    skippedDuplicateInRequest: pairs.length - uniquePairs.length,
    monitors: createdRows,
  }
}

/**
 * 给已经存在的多条 SKU 映射统一应用一条规则。
 *
 * 用法对应页面上的：
 * 1. 在价格监控表格勾选多行；
 * 2. 从“常用规则”下拉框选择规则；
 * 3. 点击“应用到已选”。
 *
 * enableAfterApply=true 时会在更新规则的同时启用这些 Monitor，避免用户还要逐条开开关。
 */
export async function applyRuleToMonitorsBatch(
  db: Db,
  monitorIds: number[],
  ruleExpression: string,
  enableAfterApply: boolean,
) {
  if (monitorIds.length === 0) {
    throw new MonitorValidationError('请至少勾选一条 SKU 映射')
  }

  if (monitorIds.length > MAX_BATCH_MONITORS) {
    throw new MonitorValidationError(
      `单次最多处理 ${MAX_BATCH_MONITORS} 条监控`,
    )
  }

  validateRuleExpression(ruleExpression)

  // ID 去重后再写库，避免重复 ID 让返回数量产生歧义。
  const uniqueIds = Array.from(new Set(monitorIds))
  const updatedRows: (typeof monitors.$inferSelect)[] = []

  for (
    let offset = 0;
    offset < uniqueIds.length;
    offset += D1_UPDATE_ID_CHUNK_SIZE
  ) {
    const chunk = uniqueIds.slice(offset, offset + D1_UPDATE_ID_CHUNK_SIZE)
    const updated = await db
      .update(monitors)
      .set({
        ruleExpression,
        ...(enableAfterApply ? { enabled: true } : {}),
      })
      .where(inArray(monitors.id, chunk))
      .returning()

    updatedRows.push(...updated)
  }

  return {
    requested: monitorIds.length,
    uniqueRequested: uniqueIds.length,
    updated: updatedRows.length,
    missing: uniqueIds.length - updatedRows.length,
    enabledAfterApply: enableAfterApply,
    monitors: updatedRows,
  }
}
