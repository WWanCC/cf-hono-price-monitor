/**
 * Listing 和 SKU 接口。
 *
 * Listing 是一个平台商品，SKU 是该商品下的真实规格；导入操作会调用喵喵折，
 * 然后按平台商品唯一键更新 Listing，并按 listingId + externalSkuId upsert SKU。
 */
import { zValidator } from '@hono/zod-validator'
import { and, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from '../db'
import { listings, listingSkus, products } from '../db/schema'
import { resolveOffer } from '../services/miaomiaozhe'
import { getMiaomiaoToken } from '../services/settings'

const importListingSchema = z.object({
  productId: z.number().int().positive(),
  role: z.enum(['official', 'own']),
  content: z.string().trim().min(1),
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
  const listingId = Number(c.req.param('id'))
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return c.json({ success: false, message: '无效的 Listing ID' }, 400)
  }

  const db = createDb(c.env.DB)
  const [listing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId)).limit(1)
  if (!listing) return c.json({ success: false, message: 'Listing 不存在' }, 404)

  const data = await db
    .select()
    .from(listingSkus)
    .where(eq(listingSkus.listingId, listingId))
    .orderBy(listingSkus.id)

  return c.json({ success: true, data })
})

listingsRoute.post('/import', zValidator('json', importListingSchema), async (c) => {
  const { productId, role, content } = c.req.valid('json')
  const db = createDb(c.env.DB)

  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1)
  if (!product) return c.json({ success: false, message: '商品不存在' }, 400)

  let resolved
  try {
    const token = await getMiaomiaoToken(
      db,
      (c.env as CloudflareBindings & { MIAOMIAO_TOKEN?: string }).MIAOMIAO_TOKEN,
    )
    resolved = await resolveOffer(token, content)
  } catch (error) {
    return c.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '商品解析失败',
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

  // 下面的分支保证同一个平台商品不会重复创建 Listing；重复导入会更新已有记录。
  let listingId: number

  if (existing) {
    if (existing.productId !== productId) {
      return c.json({ success: false, message: '这个淘宝商品已经关联到其他商品' }, 409)
    }
    if (existing.role !== role) {
      return c.json({ success: false, message: '这个商品已存在，但 official / own 类型不同' }, 409)
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

  // SKU 数量可能较多，按批次 upsert；唯一键使重复导入具有幂等效果。
  if (resolved.skus.length > 0) {
    const CHUNK_SIZE = 15
    const skuValues = resolved.skus.map((sku) => ({
      listingId,
      externalSkuId: sku.externalSkuId,
      name: sku.name,
      providerRef: sku.providerRef,
      enabled: sku.enabled,
    }))

    for (let i = 0; i < skuValues.length; i += CHUNK_SIZE) {
      const chunk = skuValues.slice(i, i + CHUNK_SIZE)
      await db
        .insert(listingSkus)
        .values(chunk)
        .onConflictDoUpdate({
          target: [listingSkus.listingId, listingSkus.externalSkuId],
          set: {
            name: sql.raw(`excluded.${listingSkus.name.name}`),
            providerRef: sql.raw(`excluded.${listingSkus.providerRef.name}`),
            enabled: sql.raw(`excluded.${listingSkus.enabled.name}`),
          },
        })
    }
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
})
