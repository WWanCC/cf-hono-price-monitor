/** 上游厂家接口。删除 Supplier 时，引用它的 Product.supplierId 会自动 set null。 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { suppliers } from '../db/schema'
import { parsePositiveIntParam } from '../lib/http'

const createSchema = z.object({
  name: z.string().trim().min(1, '厂家名称不能为空'),
  shopName: z.string().trim().nullable().optional(),
  shopUrl: z.string().trim().nullable().optional(),
  note: z.string().trim().nullable().optional(),
})

const updateSchema = createSchema.partial().extend({
  enabled: z.boolean().optional(),
})

export const suppliersRoute = new Hono<{ Bindings: CloudflareBindings }>()

suppliersRoute.get('/', async (c) => {
  const data = await createDb(c.env.DB)
    .select()
    .from(suppliers)
    .orderBy(suppliers.id)

  return c.json({ success: true, data })
})

suppliersRoute.post(
  '/',
  zValidator('json', createSchema),
  async (c) => {
    const body = c.req.valid('json')

    const [supplier] = await createDb(c.env.DB)
      .insert(suppliers)
      .values({
        name: body.name,
        shopName: body.shopName || null,
        shopUrl: body.shopUrl || null,
        note: body.note || null,
      })
      .returning()

    return c.json({ success: true, data: supplier }, 201)
  },
)

suppliersRoute.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id = parsePositiveIntParam(c)
    if (!id) {
      return c.json({ success: false, message: '无效的厂家 ID' }, 400)
    }

    const [supplier] = await createDb(c.env.DB)
      .update(suppliers)
      .set(c.req.valid('json'))
      .where(eq(suppliers.id, id))
      .returning()

    return supplier
      ? c.json({ success: true, data: supplier })
      : c.json({ success: false, message: '厂家不存在' }, 404)
  },
)

suppliersRoute.delete('/:id', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的厂家 ID' }, 400)
  }

  const [deleted] = await createDb(c.env.DB)
    .delete(suppliers)
    .where(eq(suppliers.id, id))
    .returning({ id: suppliers.id })

  return deleted
    ? c.json({ success: true, data: true })
    : c.json({ success: false, message: '厂家不存在' }, 404)
})
