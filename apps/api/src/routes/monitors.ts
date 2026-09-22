import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'

import {
    monitors,
} from '../db/schema'

import {
    checkMonitor,
    getSkuContext,
} from '../services/monitor'

import {
    evaluateRule,
} from '../services/rule-expression'

const createMonitorSchema = z.object({
    referenceSkuId:
        z.number().int().positive(),

    targetSkuId:
        z.number().int().positive(),

    ruleExpression:
        z.string()
            .trim()
            .min(1)
            .default(
                'own >= official',
            ),
})

export const monitorsRoute =
    new Hono<{
        Bindings:
            CloudflareBindings
    }>()

//
// 创建监控
//

monitorsRoute.post(
    '/',

    zValidator(
        'json',
        createMonitorSchema,
    ),

    async (c) => {
        const body =
            c.req.valid('json')

        const db =
            createDb(c.env.DB)

        const reference =
            await getSkuContext(
                db,
                body.referenceSkuId,
            )

        const target =
            await getSkuContext(
                db,
                body.targetSkuId,
            )

        if (!reference) {
            return c.json(
                {
                    success: false,
                    message:
                        '官方 SKU 不存在',
                },
                400,
            )
        }

        if (!target) {
            return c.json(
                {
                    success: false,
                    message:
                        '自店 SKU 不存在',
                },
                400,
            )
        }

        if (
            reference.role !==
            'official'
        ) {
            return c.json(
                {
                    success: false,
                    message:
                        'referenceSkuId 必须属于 official Listing',
                },
                400,
            )
        }

        if (
            target.role !==
            'own'
        ) {
            return c.json(
                {
                    success: false,
                    message:
                        'targetSkuId 必须属于 own Listing',
                },
                400,
            )
        }

        if (
            reference.productId !==
            target.productId
        ) {
            return c.json(
                {
                    success: false,
                    message:
                        '官方 SKU 和自店 SKU 必须属于同一个商品',
                },
                400,
            )
        }

        //
        // 创建前先验证表达式合法
        //
        try {
            evaluateRule(
                body.ruleExpression,
                {
                    official: 100,
                    own: 100,
                },
            )
        } catch (error) {
            return c.json(
                {
                    success: false,

                    message:
                        error instanceof Error
                            ? error.message
                            : '规则表达式无效',
                },
                400,
            )
        }

        try {
            const [monitor] =
                await db
                    .insert(monitors)
                    .values({
                        referenceSkuId:
                        body.referenceSkuId,

                        targetSkuId:
                        body.targetSkuId,

                        ruleExpression:
                        body.ruleExpression,
                    })
                    .returning()

            return c.json(
                {
                    success: true,
                    data: monitor,
                },
                201,
            )
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes(
                    'UNIQUE constraint failed',
                )
            ) {
                return c.json(
                    {
                        success: false,
                        message:
                            '这两个 SKU 已经建立监控',
                    },
                    409,
                )
            }

            throw error
        }
    },
)

//
// 查看监控列表
//

monitorsRoute.get(
    '/',

    async (c) => {
        const db =
            createDb(c.env.DB)

        const data = await db
            .select()
            .from(monitors)
            .orderBy(monitors.id)

        return c.json({
            success: true,
            data,
        })
    },
)

//
// 立即检测一条
//

monitorsRoute.post(
    '/:id/check',

    async (c) => {
        const id =
            Number(
                c.req.param('id'),
            )

        if (
            !Number.isInteger(id) ||
            id <= 0
        ) {
            return c.json(
                {
                    success: false,
                    message:
                        '无效的 Monitor ID',
                },
                400,
            )
        }

        const db =
            createDb(c.env.DB)

        const result =
            await checkMonitor(
                db,
                c.env.MIAOMIAO_TOKEN,
                id,
            )

        return c.json({
            success: true,
            data: result,
        })
    },
)