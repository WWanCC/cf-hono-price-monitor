/** 品牌主数据接口。Brand 被 Product 引用时采用 restrict 删除策略。 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { brands, products } from '../db/schema'
import { isUniqueError, parsePositiveIntParam } from '../lib/http'

const createSchema = z.object({
  name: z.string().trim().min(1, '品牌名称不能为空'),
  note: z.string().trim().nullable().optional(),
})

const updateSchema = createSchema.partial().extend({
  enabled: z.boolean().optional(),
})

export const brandsRoute = new Hono<{ Bindings: CloudflareBindings }>()

brandsRoute.get('/', async (c) => {
  const data = await createDb(c.env.DB)
    .select()
    .from(brands)
    .orderBy(brands.id)

  return c.json({ success: true, data })
})

brandsRoute.get('/:id', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的品牌 ID' }, 400)
  }

  const [brand] = await createDb(c.env.DB)
    .select()
    .from(brands)
    .where(eq(brands.id, id))
    .limit(1)

  return brand
    ? c.json({ success: true, data: brand })
    : c.json({ success: false, message: '品牌不存在' }, 404)
})

brandsRoute.post(
  '/',
  zValidator('json', createSchema),
  async (c) => {
    const body = c.req.valid('json')

    try {
      const [brand] = await createDb(c.env.DB)
        .insert(brands)
        .values({
          name: body.name,
          note: body.note || null,
        })
        .returning()

      return c.json({ success: true, data: brand }, 201)
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json(
          { success: false, message: '品牌名称已存在' },
          409,
        )
      }
      throw error
    }
  },
)

brandsRoute.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id = parsePositiveIntParam(c)
    if (!id) {
      return c.json({ success: false, message: '无效的品牌 ID' }, 400)
    }

    try {
      const [brand] = await createDb(c.env.DB)
        .update(brands)
        .set(c.req.valid('json'))
        .where(eq(brands.id, id))
        .returning()

      return brand
        ? c.json({ success: true, data: brand })
        : c.json({ success: false, message: '品牌不存在' }, 404)
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json(
          { success: false, message: '品牌名称已存在' },
          409,
        )
      }
      throw error
    }
  },
)

brandsRoute.delete('/:id', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的品牌 ID' }, 400)
  }

  const db = createDb(c.env.DB)

  // 显式检查可以返回更友好的错误，而不是直接把 SQLite 外键异常暴露给前端。
  const [childProduct] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.brandId, id))
    .limit(1)

  if (childProduct) {
    return c.json(
      {
        success: false,
        message: '该品牌下仍有商品，请先移动或删除这些商品',
      },
      409,
    )
  }

  const [deleted] = await db
    .delete(brands)
    .where(eq(brands.id, id))
    .returning({ id: brands.id })

  return deleted
    ? c.json({ success: true, data: true })
    : c.json({ success: false, message: '品牌不存在' }, 404)
})
