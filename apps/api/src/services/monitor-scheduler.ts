/**
 * 监控任务调度服务。
 *
 * Cron 或前端“检测全部”只负责把启用的 Monitor ID 投递到 Queue；真正的网络请求
 * 由 Queue consumer 执行，从而避免定时入口被大量第三方请求阻塞。
 */
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { monitors } from '../db/schema'

export type PriceCheckMessage = { monitorId: number }

export async function enqueueEnabledMonitors(
  db: Db,
  queue: Queue<PriceCheckMessage>,
) {
  const monitorRows = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(eq(monitors.enabled, true))
    .orderBy(monitors.id)

  if (monitorRows.length === 0) return 0

  // Queue sendBatch 有单批大小限制；分块也能避免一次请求携带过大的消息体。
  const CHUNK_SIZE = 100

  for (let i = 0; i < monitorRows.length; i += CHUNK_SIZE) {
    const chunk = monitorRows.slice(i, i + CHUNK_SIZE)
    await queue.sendBatch(
      chunk.map((monitor) => ({ body: { monitorId: monitor.id } })),
    )
  }

  return monitorRows.length
}
