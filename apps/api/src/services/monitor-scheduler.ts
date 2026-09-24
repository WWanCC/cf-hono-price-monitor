/**
 * Monitor 定时调度。
 *
 * 本文件只负责“什么时候把哪些 Monitor 投递到 Queue”。真正抓价格和规则判断
 * 仍由 monitor.ts + Queue consumer 完成，避免 Cron 执行时间过长。
 */
import { eq } from 'drizzle-orm'

import type { Db } from '../db'
import { monitors } from '../db/schema'
import { getSkuContext, isSkuContextActive } from './monitor'
import {
  getPriceCheckSchedule,
  getPriceCheckScheduleLastRun,
  matchesPriceCheckSchedule,
  savePriceCheckScheduleLastRun,
  toUtcMinuteIso,
} from './price-check-schedule'

export type PriceCheckMessage = { monitorId: number }

export type ScheduledDispatchResult = {
  matched: boolean
  skippedDuplicate: boolean
  enqueued: number
  localTime: string | null
  timezone: string
}

/**
 * 把当前仍然有效的 Monitor 分批放入 Cloudflare Queue。
 *
 * 为什么还要重新检查 Product / Listing / SKU 是否启用：
 * Monitor 自己的 enabled=true 只表示“这条映射允许检测”；如果上层商品或 SKU
 * 被停用，继续抓价会违背管理端的停用语义。
 */
export async function enqueueEnabledMonitors(
  db: Db,
  queue: Queue<PriceCheckMessage>,
) {
  const rows = await db
    .select({
      id: monitors.id,
      referenceSkuId: monitors.referenceSkuId,
      targetSkuId: monitors.targetSkuId,
    })
    .from(monitors)
    .where(eq(monitors.enabled, true))
    .orderBy(monitors.id)

  const active: { id: number }[] = []

  for (const row of rows) {
    const [reference, target] = await Promise.all([
      getSkuContext(db, row.referenceSkuId),
      getSkuContext(db, row.targetSkuId),
    ])

    if (isSkuContextActive(reference) && isSkuContextActive(target)) {
      active.push({ id: row.id })
    }
  }

  if (!active.length) return 0

  // Cloudflare Queue sendBatch 单次最多发送有限数量消息，保守按 100 条分块。
  const CHUNK_SIZE = 100

  for (let i = 0; i < active.length; i += CHUNK_SIZE) {
    const chunk = active.slice(i, i + CHUNK_SIZE)
    await queue.sendBatch(
      chunk.map((monitor) => ({ body: { monitorId: monitor.id } })),
    )
  }

  return active.length
}

/**
 * 每分钟 Cron 调用一次本函数。
 *
 * 绝大多数分钟只会读取一次 app_settings 后立即返回；只有命中用户设置的时间，
 * 才真正查询启用 Monitor 并投递 Queue，因此不会变成“每分钟抓一次淘宝价格”。
 */
export async function dispatchScheduledPriceChecks(
  db: Db,
  queue: Queue<PriceCheckMessage>,
  scheduledAt: Date,
): Promise<ScheduledDispatchResult> {
  const schedule = await getPriceCheckSchedule(db)
  const localParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(scheduledAt)

  if (!matchesPriceCheckSchedule(schedule, scheduledAt)) {
    return {
      matched: false,
      skippedDuplicate: false,
      enqueued: 0,
      localTime: localParts,
      timezone: schedule.timezone,
    }
  }

  const scheduledMinute = toUtcMinuteIso(scheduledAt)
  const lastRun = await getPriceCheckScheduleLastRun(db)

  // 幂等保护：同一个 UTC Cron 分钟只允许投递一次。
  if (lastRun?.scheduledAt === scheduledMinute) {
    return {
      matched: true,
      skippedDuplicate: true,
      enqueued: 0,
      localTime: localParts,
      timezone: schedule.timezone,
    }
  }

  const enqueued = await enqueueEnabledMonitors(db, queue)

  await savePriceCheckScheduleLastRun(db, {
    scheduledAt: scheduledMinute,
    triggeredAt: new Date().toISOString(),
    enqueued,
  })

  return {
    matched: true,
    skippedDuplicate: false,
    enqueued,
    localTime: localParts,
    timezone: schedule.timezone,
  }
}
