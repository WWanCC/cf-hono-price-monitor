/**
 * Listing 与 SKU 接口。
 *
 * Listing 对应淘宝/天猫的一个商品页面；SKU 是页面下的真实规格。
 * 导入会调用喵喵折解析链接，并以“平台 + 外部商品 ID”为唯一键执行幂等更新。
 */
import { zValidator } from '@hono/zod-validator'
import { and, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { listings, listingSkus, products } from '../db/schema'
import { parsePositiveIntParam } from '../lib/http'
import { resolveOffer } from '../services/miaomiaozhe'
import { getMiaomiaoToken } from '../services/settings'

const importSchema = z.object({
  productId: z.number().int().positive(),
  role: z.enum(['official', 'own']),
  content: z.string().trim().min(1),
})

const updateSchema = z.object({
  enabled: z.boolean().optional(),
})

const skuUpdateSchema = z.object({
  enabled: z.boolean(),
})

export const listingsRoute = new Hono<{ Bindings: CloudflareBindings }>()

listingsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB)
  const productIdRaw = c.req.query('productId')

  if (!productIdRaw) {
    const data = await db.select().from(listings).orderBy(listings.id)
    return c.json({ success: true, data })
  }

  const productId = Number(productIdRaw)
  if (!Number.isInteger(productId) || productId <= 0) {
    return c.json({ success: false, message: '无效的商品 ID' }, 400)
  }

  const data = await db
    .select()
    .from(listings)
    .where(eq(listings.productId, productId))
    .orderBy(listings.id)

  return c.json({ success: true, data })
})

listingsRoute.get('/:id/skus', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的 Listing ID' }, 400)
  }

  const data = await createDb(c.env.DB)
    .select()
    .from(listingSkus)
    .where(eq(listingSkus.listingId, id))
    .orderBy(listingSkus.id)

  return c.json({ success: true, data })
})

listingsRoute.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id = parsePositiveIntParam(c)
    if (!id) {
      return c.json({ success: false, message: '无效的 Listing ID' }, 400)
    }

    const [listing] = await createDb(c.env.DB)
      .update(listings)
      .set(c.req.valid('json'))
      .where(eq(listings.id, id))
      .returning()

    return listing
      ? c.json({ success: true, data: listing })
      : c.json({ success: false, message: 'Listing 不存在' }, 404)
  },
)

listingsRoute.delete('/:id', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的 Listing ID' }, 400)
  }

  const [deleted] = await createDb(c.env.DB)
    .delete(listings)
    .where(eq(listings.id, id))
    .returning({ id: listings.id })

  return deleted
    ? c.json({ success: true, data: true })
    : c.json({ success: false, message: 'Listing 不存在' }, 404)
})

listingsRoute.patch(
  '/skus/:id',
  zValidator('json', skuUpdateSchema),
  async (c) => {
    const id = parsePositiveIntParam(c)
    if (!id) {
      return c.json({ success: false, message: '无效的 SKU ID' }, 400)
    }

    const [sku] = await createDb(c.env.DB)
      .update(listingSkus)
      .set(c.req.valid('json'))
      .where(eq(listingSkus.id, id))
      .returning()

    return sku
      ? c.json({ success: true, data: sku })
      : c.json({ success: false, message: 'SKU 不存在' }, 404)
  },
)

listingsRoute.post(
  '/import',
  zValidator('json', importSchema),
  async (c) => {
    const { productId, role, content } = c.req.valid('json')
    const db = createDb(c.env.DB)

    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1)

    if (!product) {
      return c.json({ success: false, message: '商品不存在' }, 400)
    }

    let resolved
    try {
      const token = await getMiaomiaoToken(db, c.env.MIAOMIAO_TOKEN)
      resolved = await resolveOffer(token, content)
    } catch (error) {
      return c.json(
        {
          success: false,
          message:
            error instanceof Error ? error.message : '商品解析失败',
        },
        502,
      )
    }

    const [existing] = await db
      .select()
      .from(listings)
      .where(
        and(
          eq(listings.platform, resolved.platform),
          eq(listings.externalItemId, resolved.externalItemId),
        ),
      )
      .limit(1)

    let listingId: number

    if (existing) {
      if (existing.productId !== productId) {
        return c.json(
          {
            success: false,
            message: '这个淘宝商品已经关联到其他商品',
          },
          409,
        )
      }

      if (existing.role !== role) {
        return c.json(
          {
            success: false,
            message: '这个商品已存在，但 official / own 类型不同',
          },
          409,
        )
      }

      const [updated] = await db
        .update(listings)
        .set({
          title: resolved.title,
          shopName: resolved.shopName,
          url: content,
          providerRef: resolved.providerRef,
          priceProvider: 'miaomiaozhe',
          enabled: true,
        })
        .where(eq(listings.id, existing.id))
        .returning()

      listingId = updated.id
    } else {
      const [created] = await db
        .insert(listings)
        .values({
          productId,
          role,
          platform: resolved.platform,
          externalItemId: resolved.externalItemId,
          title: resolved.title,
          shopName: resolved.shopName,
          url: content,
          priceProvider: 'miaomiaozhe',
          providerRef: resolved.providerRef,
        })
        .returning()

      listingId = created.id
    }

    /**
     * 先停用该 Listing 下全部旧 SKU，再 upsert 当前返回的 SKU。
     * 这样第三方已经删除/下架的旧规格不会继续被当作“可选 SKU”。
     */
    await db
      .update(listingSkus)
      .set({ enabled: false })
      .where(eq(listingSkus.listingId, listingId))

    const skuValues = resolved.skus.map((sku) => ({
      listingId,
      externalSkuId: sku.externalSkuId,
      name: sku.name,
      providerRef: sku.providerRef,
      enabled: sku.enabled,
    }))

    // 分块写入，避免 SKU 很多时单条 SQL 变量数量过大。
    const CHUNK_SIZE = 15
    for (let index = 0; index < skuValues.length; index += CHUNK_SIZE) {
      const chunk = skuValues.slice(index, index + CHUNK_SIZE)

      await db
        .insert(listingSkus)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            listingSkus.listingId,
            listingSkus.externalSkuId,
          ],
          set: {
            name: sql.raw(`excluded.${listingSkus.name.name}`),
            providerRef: sql.raw(`excluded.${listingSkus.providerRef.name}`),
            enabled: sql.raw(`excluded.${listingSkus.enabled.name}`),
          },
        })
    }

    const skus = await db
      .select()
      .from(listingSkus)
      .where(eq(listingSkus.listingId, listingId))
      .orderBy(listingSkus.id)

    return c.json(
      {
        success: true,
        data: {
          listingId,
          platform: resolved.platform,
          externalItemId: resolved.externalItemId,
          title: resolved.title,
          shopName: resolved.shopName,
          currentPrice: resolved.currentPrice,
          skuCount: skus.length,
          skus,
        },
      },
      existing ? 200 : 201,
    )
  },
)
