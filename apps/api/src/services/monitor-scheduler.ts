import { eq } from 'drizzle-orm'

import type { Db } from '../db'

import {
    monitors,
} from '../db/schema'

export type PriceCheckMessage = {
    monitorId: number
}

export async function enqueueEnabledMonitors(
    db: Db,
    queue: Queue<PriceCheckMessage>,
) {
    const monitorRows = await db
        .select({
            id: monitors.id,
        })
        .from(monitors)
        .where(
            eq(monitors.enabled, true),
        )
        .orderBy(monitors.id)

    if (monitorRows.length === 0) {
        return 0
    }

    //
    // Cloudflare sendBatch
    // 一次最多 100 条消息
    //
    const CHUNK_SIZE = 100

    for (
        let i = 0;
        i < monitorRows.length;
        i += CHUNK_SIZE
    ) {
        const chunk =
            monitorRows.slice(
                i,
                i + CHUNK_SIZE,
            )

        await queue.sendBatch(
            chunk.map((monitor) => ({
                body: {
                    monitorId:
                    monitor.id,
                },
            })),
        )
    }

    return monitorRows.length
}