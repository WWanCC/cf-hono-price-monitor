import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { resolveOffer } from '../services/miaomiaozhe'

const resolveSchema = z.object({
    content: z.string().trim().min(1),
})

export const miaomiaozheRoute =
    new Hono<{
        Bindings: CloudflareBindings
    }>()

miaomiaozheRoute.post(
    '/resolve',

    zValidator('json', resolveSchema),

    async (c) => {
        const { content } =
            c.req.valid('json')

        try {
            const data = await resolveOffer(
                c.env.MIAOMIAO_TOKEN,
                content,
            )

            return c.json({
                success: true,
                data,
            })
        } catch (error) {
            console.error(error)

            return c.json(
                {
                    success: false,

                    message:
                        error instanceof Error
                            ? error.message
                            : '喵喵折解析失败',
                },
                502,
            )
        }
    },
)