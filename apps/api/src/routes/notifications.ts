/** 站内信接口：列表、未读数、单条/全部已读和删除。 */
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { createDb } from '../db'
import { notifications } from '../db/schema'
import { parsePositiveIntParam } from '../lib/http'

export const notificationsRoute = new Hono<{
  Bindings: CloudflareBindings
}>()

notificationsRoute.get('/', async (c) => {
  const data = await createDb(c.env.DB)
    .select()
    .from(notifications)
    .orderBy(sql`${notifications.createdAt} desc`)

  return c.json({ success: true, data })
})

notificationsRoute.get('/unread-count', async (c) => {
  const rows = await createDb(c.env.DB)
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.read, false))

  return c.json({
    success: true,
    data: { count: rows.length },
  })
})

notificationsRoute.patch('/:id/read', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的通知 ID' }, 400)
  }

  const [notification] = await createDb(c.env.DB)
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning()

  return notification
    ? c.json({ success: true, data: notification })
    : c.json({ success: false, message: '通知不存在' }, 404)
})

notificationsRoute.post('/read-all', async (c) => {
  await createDb(c.env.DB)
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.read, false))

  return c.json({ success: true, data: true })
})

notificationsRoute.delete('/:id', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的通知 ID' }, 400)
  }

  const [deleted] = await createDb(c.env.DB)
    .delete(notifications)
    .where(eq(notifications.id, id))
    .returning({ id: notifications.id })

  return deleted
    ? c.json({ success: true, data: true })
    : c.json({ success: false, message: '通知不存在' }, 404)
})
