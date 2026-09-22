import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import {
    brands,
    products,
    suppliers,
} from '../db/schema'

const createProductSchema = z.object({
    brandId: z.number().int().positive(),
    supplierId: z.number().int().positive().nullable().optional(),

    name: z.string().trim().min(1, '商品名称不能为空'),

    supplierProductUrl: z
        .string()
        .trim()
        .nullable()
        .optional(),

    note: z.string().trim().nullable().optional(),
})

const updateProductSchema = createProductSchema.partial().extend({
    enabled: z.boolean().optional(),
})

export const productsRoute = new Hono<{
    Bindings: CloudflareBindings
}>()

productsRoute.get('/', async (c) => {
    const db = createDb(c.env.DB)

    const data = await db
        .select({
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
        })
        .from(products)
        .innerJoin(
            brands,
            eq(products.brandId, brands.id),
        )
        .leftJoin(
            suppliers,
            eq(products.supplierId, suppliers.id),
        )
        .orderBy(products.id)

    return c.json({
        success: true,
        data,
    })
})

productsRoute.get('/:id', async (c) => {
    const id = Number(c.req.param('id'))

    if (!Number.isInteger(id) || id <= 0) {
        return c.json(
            {
                success: false,
                message: '无效的商品 ID',
            },
            400,
        )
    }

    const db = createDb(c.env.DB)

    const [product] = await db
        .select({
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
        })
        .from(products)
        .innerJoin(
            brands,
            eq(products.brandId, brands.id),
        )
        .leftJoin(
            suppliers,
            eq(products.supplierId, suppliers.id),
        )
        .where(eq(products.id, id))
        .limit(1)

    if (!product) {
        return c.json(
            {
                success: false,
                message: '商品不存在',
            },
            404,
        )
    }

    return c.json({
        success: true,
        data: product,
    })
})

productsRoute.post(
    '/',
    zValidator('json', createProductSchema),
    async (c) => {
        const body = c.req.valid('json')
        const db = createDb(c.env.DB)

        const [brand] = await db
            .select({ id: brands.id })
            .from(brands)
            .where(eq(brands.id, body.brandId))
            .limit(1)

        if (!brand) {
            return c.json(
                {
                    success: false,
                    message: '品牌不存在',
                },
                400,
            )
        }

        if (body.supplierId) {
            const [supplier] = await db
                .select({ id: suppliers.id })
                .from(suppliers)
                .where(eq(suppliers.id, body.supplierId))
                .limit(1)

            if (!supplier) {
                return c.json(
                    {
                        success: false,
                        message: '厂家不存在',
                    },
                    400,
                )
            }
        }

        const [product] = await db
            .insert(products)
            .values({
                brandId: body.brandId,
                supplierId: body.supplierId ?? null,

                name: body.name,

                supplierProductUrl:
                    body.supplierProductUrl || null,

                note: body.note || null,
            })
            .returning()

        return c.json(
            {
                success: true,
                data: product,
            },
            201,
        )
    },
)

productsRoute.patch(
    '/:id',
    zValidator('json', updateProductSchema),
    async (c) => {
        const id = Number(c.req.param('id'))

        if (!Number.isInteger(id) || id <= 0) {
            return c.json(
                {
                    success: false,
                    message: '无效的商品 ID',
                },
                400,
            )
        }

        const body = c.req.valid('json')
        const db = createDb(c.env.DB)

        const [product] = await db
            .update(products)
            .set(body)
            .where(eq(products.id, id))
            .returning()

        if (!product) {
            return c.json(
                {
                    success: false,
                    message: '商品不存在',
                },
                404,
            )
        }

        return c.json({
            success: true,
            data: product,
        })
    },
)