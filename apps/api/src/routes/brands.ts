import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDb } from '../db'
import { brands } from '../db/schema'

export const brandsRoute = new Hono<{
    Bindings: CloudflareBindings
}>()

// 查询全部品牌
brandsRoute.get('/', async (c) => {
    const db = createDb(c.env.DB)

    const data = await db
        .select()
        .from(brands)
        .orderBy(brands.id)

    return c.json({
        success: true,
        data,
    })
})

// 新增品牌
brandsRoute.post('/', async (c) => {
    const body = await c.req.json<{
        name?: string
        note?: string
    }>()

    const name = body.name?.trim()

    if (!name) {
        return c.json(
            {
                success: false,
                message: '品牌名称不能为空',
            },
            400,
        )
    }

    const db = createDb(c.env.DB)

    try {
        const [brand] = await db
            .insert(brands)
            .values({
                name,
                note: body.note?.trim() || null,
            })
            .returning()

        return c.json(
            {
                success: true,
                data: brand,
            },
            201,
        )
    } catch (error) {
        if (
            error instanceof Error &&
            error.message.includes('UNIQUE constraint failed')
        ) {
            return c.json(
                {
                    success: false,
                    message: '品牌名称已存在',
                },
                409,
            )
        }

        throw error
    }
})

// 查询单个品牌
brandsRoute.get('/:id', async (c) => {
    const id = Number(c.req.param('id'))

    if (!Number.isInteger(id) || id <= 0) {
        return c.json(
            {
                success: false,
                message: '无效的品牌 ID',
            },
            400,
        )
    }

    const db = createDb(c.env.DB)

    const [brand] = await db
        .select()
        .from(brands)
        .where(eq(brands.id, id))
        .limit(1)

    if (!brand) {
        return c.json(
            {
                success: false,
                message: '品牌不存在',
            },
            404,
        )
    }

    return c.json({
        success: true,
        data: brand,
    })
})