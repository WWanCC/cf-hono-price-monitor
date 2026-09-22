import { eq } from 'drizzle-orm'

import type { Db } from '../db'

import {
    listingSkus,
    listings,
    monitors,
} from '../db/schema'

import {
    getCurrentPrice,
} from './miaomiaozhe'

import {
    evaluateRule,
} from './rule-expression'

export async function getSkuContext(
    db: Db,
    skuId: number,
) {
    const [result] = await db
        .select({
            skuId:
            listingSkus.id,

            externalSkuId:
            listingSkus.externalSkuId,

            skuName:
            listingSkus.name,

            providerRef:
            listingSkus.providerRef,

            listingId:
            listings.id,

            listingTitle:
            listings.title,

            role:
            listings.role,

            productId:
            listings.productId,
        })
        .from(listingSkus)
        .innerJoin(
            listings,
            eq(
                listingSkus.listingId,
                listings.id,
            ),
        )
        .where(
            eq(
                listingSkus.id,
                skuId,
            ),
        )
        .limit(1)

    return result ?? null
}

export async function checkMonitor(
    db: Db,
    token: string,
    monitorId: number,
) {
    const [monitor] = await db
        .select()
        .from(monitors)
        .where(
            eq(
                monitors.id,
                monitorId,
            ),
        )
        .limit(1)

    if (!monitor) {
        throw new Error(
            '监控不存在',
        )
    }

    const reference =
        await getSkuContext(
            db,
            monitor.referenceSkuId,
        )

    const target =
        await getSkuContext(
            db,
            monitor.targetSkuId,
        )

    if (
        !reference ||
        !target
    ) {
        throw new Error(
            '监控关联的 SKU 不存在',
        )
    }

    const now = new Date()

    try {
        if (!reference.providerRef) {
            throw new Error(
                '官方 SKU 缺少 providerRef',
            )
        }

        if (!target.providerRef) {
            throw new Error(
                '自店 SKU 缺少 providerRef',
            )
        }

        const [
            officialPrice,
            ownPrice,
        ] = await Promise.all([
            getCurrentPrice(
                token,
                reference.providerRef,
            ),

            getCurrentPrice(
                token,
                target.providerRef,
            ),
        ])

        const passed =
            evaluateRule(
                monitor.ruleExpression,
                {
                    official:
                    officialPrice,

                    own:
                    ownPrice,
                },
            )

        const status =
            passed
                ? 'normal'
                : 'violation'

        await db
            .update(monitors)
            .set({
                lastStatus: status,
                lastCheckedAt: now,
                lastError: null,
            })
            .where(
                eq(
                    monitors.id,
                    monitorId,
                ),
            )

        return {
            monitorId,

            status,

            official: {
                skuId:
                reference.skuId,

                name:
                reference.skuName,

                price:
                officialPrice,
            },

            own: {
                skuId:
                target.skuId,

                name:
                target.skuName,

                price:
                ownPrice,
            },

            ruleExpression:
            monitor.ruleExpression,

            checkedAt:
            now,
        }
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : '监控检测失败'

        await db
            .update(monitors)
            .set({
                lastStatus:
                    'fetch_error',

                lastCheckedAt:
                now,

                lastError:
                message,
            })
            .where(
                eq(
                    monitors.id,
                    monitorId,
                ),
            )

        return {
            monitorId,

            status:
                'fetch_error' as const,

            error:
            message,

            checkedAt:
            now,
        }
    }
}