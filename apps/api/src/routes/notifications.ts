/**
 * 站内信接口。通知由监控服务在“进入违规状态”时创建，页面这里只负责查询和已读操作。
 */
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { createDb } from '../db'
import { notifications } from '../db/schema'

export const notificationsRoute = new Hono<{
  Bindings: CloudflareBindings
}>()

notificationsRoute.get('/', async (c) => {
  // 列表限制 100 条，避免通知增长后一次响应过大；未读数量单独查询。
  const db = createDb(c.env.DB)
  const data = await db
    .select()
    .from(notifications)
    .orderBy(sql`${notifications.id} desc`)
    .limit(100)

  return c.json({ success: true, data })
})

notificationsRoute.get('/unread-count', async (c) => {
  const db = createDb(c.env.DB)
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(eq(notifications.read, false))

  return c.json({
    success: true,
    data: {
      count: Number(row?.count ?? 0),
    },
  })
})

notificationsRoute.patch('/:id/read', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { success: false, message: '无效的站内信 ID' },
      400,
    )
  }

  const db = createDb(c.env.DB)
  const [updated] = await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning()

  if (!updated) {
    return c.json(
      { success: false, message: '站内信不存在' },
      404,
    )
  }

  return c.json({ success: true, data: updated })
})

notificationsRoute.post('/read-all', async (c) => {
  const db = createDb(c.env.DB)
  await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.read, false))

  return c.json({ success: true, data: true })
})
