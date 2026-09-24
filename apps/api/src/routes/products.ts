/**
 * 逻辑商品接口。
 *
 * Product 把 Brand、Supplier 与后续的 Listing/SKU/Monitor 串起来。
 * 删除 Product 会按照数据库外键级联清理 Listing -> SKU -> Monitor。
 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { brands, products, suppliers } from '../db/schema'
import { parsePositiveIntParam } from '../lib/http'

const createSchema = z.object({
  brandId: z.number().int().positive(),
  supplierId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1, '商品名称不能为空'),
  supplierProductUrl: z.string().trim().nullable().optional(),
  note: z.string().trim().nullable().optional(),
})

const updateSchema = createSchema.partial().extend({
  enabled: z.boolean().optional(),
})

export const productsRoute = new Hono<{ Bindings: CloudflareBindings }>()

const selectFields = {
  id: products.id,
  name: products.name,
  brandId: products.brandId,
  brandName: brands.name,
  supplierId: products.supplierId,
  supplierName: suppliers.name,
  supplierProductUrl: products.supplierProductUrl,
  note: products.note,
  enabled: products.enabled,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
}

/** 在写 Product 前主动检查外键，给前端返回可读的业务错误。 */
async function validateReferences(
  db: ReturnType<typeof createDb>,
  body: {
    brandId?: number
    supplierId?: number | null
  },
) {
  if (body.brandId !== undefined) {
    const [brand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.id, body.brandId))
      .limit(1)

    if (!brand) return '品牌不存在'
  }

  if (body.supplierId) {
    const [supplier] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, body.supplierId))
      .limit(1)

    if (!supplier) return '厂家不存在'
  }

  return null
}

productsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB)

  const data = await db
    .select(selectFields)
    .from(products)
    .innerJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .orderBy(products.id)

  return c.json({ success: true, data })
})

productsRoute.post(
  '/',
  zValidator('json', createSchema),
  async (c) => {
    const body = c.req.valid('json')
    const db = createDb(c.env.DB)
    const referenceError = await validateReferences(db, body)

    if (referenceError) {
      return c.json(
        { success: false, message: referenceError },
        400,
      )
    }

    const [product] = await db
      .insert(products)
      .values({
        brandId: body.brandId,
        supplierId: body.supplierId ?? null,
        name: body.name,
        supplierProductUrl: body.supplierProductUrl || null,
        note: body.note || null,
      })
      .returning()

    return c.json({ success: true, data: product }, 201)
  },
)

productsRoute.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id = parsePositiveIntParam(c)
    if (!id) {
      return c.json({ success: false, message: '无效的商品 ID' }, 400)
    }

    const body = c.req.valid('json')
    const db = createDb(c.env.DB)
    const referenceError = await validateReferences(db, body)

    if (referenceError) {
      return c.json(
        { success: false, message: referenceError },
        400,
      )
    }

    const [product] = await db
      .update(products)
      .set(body)
      .where(eq(products.id, id))
      .returning()

    return product
      ? c.json({ success: true, data: product })
      : c.json({ success: false, message: '商品不存在' }, 404)
  },
)

productsRoute.delete('/:id', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的商品 ID' }, 400)
  }

  const [deleted] = await createDb(c.env.DB)
    .delete(products)
    .where(eq(products.id, id))
    .returning({ id: products.id })

  return deleted
    ? c.json({ success: true, data: true })
    : c.json({ success: false, message: '商品不存在' }, 404)
})
