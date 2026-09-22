import { zValidator } from '@hono/zod-validator'
import { eq, and, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import {
    listings,
    listingSkus,
    products,
} from '../db/schema'
import { resolveOffer } from '../services/miaomiaozhe'

const importListingSchema = z.object({
    productId: z.number().int().positive(),

    role: z.enum([
        'official',
        'own',
    ]),

    content: z
        .string()
        .trim()
        .min(1),
})

export const listingsRoute = new Hono<{
    Bindings: CloudflareBindings
}>()

listingsRoute.post(
    '/import',

    zValidator(
        'json',
        importListingSchema,
    ),

    async (c) => {
        const {
            productId,
            role,
            content,
        } = c.req.valid('json')

        const db = createDb(c.env.DB)

        // 1. 商品必须存在
        const [product] = await db
            .select({
                id: products.id,
            })
            .from(products)
            .where(
                eq(products.id, productId),
            )
            .limit(1)

        if (!product) {
            return c.json(
                {
                    success: false,
                    message: '商品不存在',
                },
                400,
            )
        }

        // 2. 调喵喵折解析
        let resolved

        try {
            resolved = await resolveOffer(
                c.env.MIAOMIAO_TOKEN,
                content,
            )
        } catch (error) {
            return c.json(
                {
                    success: false,

                    message:
                        error instanceof Error
                            ? error.message
                            : '商品解析失败',
                },
                502,
            )
        }

        // 3. 查询这个平台商品是否已经导入过
        const [existing] = await db
            .select()
            .from(listings)
            .where(
                and(
                    eq(
                        listings.platform,
                        resolved.platform,
                    ),
                    eq(
                        listings.externalItemId,
                        resolved.externalItemId,
                    ),
                ),
            )
            .limit(1)

        let listingId: number

        if (existing) {
            // 已经属于其他逻辑商品，不自动抢过去
            if (
                existing.productId !==
                productId
            ) {
                return c.json(
                    {
                        success: false,
                        message:
                            '这个淘宝商品已经关联到其他商品',
                    },
                    409,
                )
            }

            // role 也不要悄悄修改
            if (
                existing.role !== role
            ) {
                return c.json(
                    {
                        success: false,
                        message:
                            '这个商品已存在，但 official / own 类型不同',
                    },
                    409,
                )
            }

            const [updated] = await db
                .update(listings)
                .set({
                    title:
                    resolved.title,
                    shopName:
                    resolved.shopName,
                    url: content,
                    providerRef:
                    resolved.providerRef,
                    priceProvider:
                        'miaomiaozhe',
                    enabled: true,
                })
                .where(
                    eq(
                        listings.id,
                        existing.id,
                    ),
                )
                .returning()

            listingId = updated.id
        } else {
            const [created] = await db
                .insert(listings)
                .values({
                    productId,

                    role,

                    platform:
                    resolved.platform,

                    externalItemId:
                    resolved.externalItemId,

                    title:
                    resolved.title,

                    shopName:
                    resolved.shopName,

                    url: content,

                    priceProvider:
                        'miaomiaozhe',

                    providerRef:
                    resolved.providerRef,
                })
                .returning()

            listingId = created.id
        }

        // 4. SKU 批量 upsert
        if (resolved.skus.length > 0) {
            const CHUNK_SIZE = 15

            const skuValues = resolved.skus.map((sku) => ({
                listingId,

                externalSkuId:
                sku.externalSkuId,

                name:
                sku.name,

                providerRef:
                sku.providerRef,

                enabled:
                sku.enabled,
            }))

            for (
                let i = 0;
                i < skuValues.length;
                i += CHUNK_SIZE
            ) {
                const chunk = skuValues.slice(
                    i,
                    i + CHUNK_SIZE,
                )

                await db
                    .insert(listingSkus)
                    .values(chunk)
                    .onConflictDoUpdate({
                        target: [
                            listingSkus.listingId,
                            listingSkus.externalSkuId,
                        ],

                        set: {
                            name: sql.raw(
                                `excluded.${listingSkus.name.name}`,
                            ),

                            providerRef: sql.raw(
                                `excluded.${listingSkus.providerRef.name}`,
                            ),

                            enabled: sql.raw(
                                `excluded.${listingSkus.enabled.name}`,
                            ),
                        },
                    })
            }
        }

        // 5. 返回刚导入的完整 SKU
        const skus = await db
            .select()
            .from(listingSkus)
            .where(
                eq(
                    listingSkus.listingId,
                    listingId,
                ),
            )
            .orderBy(
                listingSkus.id,
            )

        return c.json(
            {
                success: true,

                data: {
                    listingId,

                    platform:
                    resolved.platform,

                    externalItemId:
                    resolved.externalItemId,

                    title:
                    resolved.title,

                    shopName:
                    resolved.shopName,

                    currentPrice:
                    resolved.currentPrice,

                    skuCount:
                    skus.length,

                    skus,
                },
            },
            existing
                ? 200
                : 201,
        )
    },
)