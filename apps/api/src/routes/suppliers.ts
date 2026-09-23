/**
 * 上游厂家资源接口。厂家可以被多个商品引用，删除策略由商品外键的 set null 控制。
 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from '../db'
import { suppliers } from '../db/schema'

const createSupplierSchema = z.object({
  name: z.string().trim().min(1, '厂家名称不能为空'),
  shopName: z.string().trim().nullable().optional(),
  shopUrl: z.string().trim().nullable().optional(),
  note: z.string().trim().nullable().optional(),
})

const updateSupplierSchema = createSupplierSchema.partial().extend({
  enabled: z.boolean().optional(),
})

export const suppliersRoute = new Hono<{ Bindings: CloudflareBindings }>()

suppliersRoute.get('/', async (c) => {
  const db = createDb(c.env.DB)
  const data = await db.select().from(suppliers).orderBy(suppliers.id)
  return c.json({ success: true, data })
})

suppliersRoute.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ success: false, message: '无效的厂家 ID' }, 400)
  }

  const db = createDb(c.env.DB)
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1)

  if (!supplier) {
    return c.json({ success: false, message: '厂家不存在' }, 404)
  }

  return c.json({ success: true, data: supplier })
})

suppliersRoute.post('/', zValidator('json', createSupplierSchema), async (c) => {
  const body = c.req.valid('json')
  const db = createDb(c.env.DB)

  const [supplier] = await db
    .insert(suppliers)
    .values({
      name: body.name,
      shopName: body.shopName || null,
      shopUrl: body.shopUrl || null,
      note: body.note || null,
    })
    .returning()

  return c.json({ success: true, data: supplier }, 201)
})

suppliersRoute.patch('/:id', zValidator('json', updateSupplierSchema), async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ success: false, message: '无效的厂家 ID' }, 400)
  }

  const body = c.req.valid('json')
  const db = createDb(c.env.DB)

  const [supplier] = await db
    .update(suppliers)
    .set(body)
    .where(eq(suppliers.id, id))
    .returning()

  if (!supplier) {
    return c.json({ success: false, message: '厂家不存在' }, 404)
  }

  return c.json({ success: true, data: supplier })
})
