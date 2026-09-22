import { Hono } from 'hono'

import { createDb } from './db'

import { brandsRoute } from './routes/brands'
import { productsRoute } from './routes/products'
import { suppliersRoute } from './routes/suppliers'
import { miaomiaozheRoute } from './routes/miaomiaozhe'
import { listingsRoute } from './routes/listings'
import { monitorsRoute } from './routes/monitors'

import {
    checkMonitor,
} from './services/monitor'

import {
    enqueueEnabledMonitors,
    type PriceCheckMessage,
} from './services/monitor-scheduler'

const app = new Hono<{
    Bindings: CloudflareBindings
}>()

app.get(
    '/api/health',

    (c) => {
        return c.json({
            success: true,
            message:
                'price-monitor api is running',
        })
    },
)

app.route(
    '/api/brands',
    brandsRoute,
)

app.route(
    '/api/suppliers',
    suppliersRoute,
)

app.route(
    '/api/products',
    productsRoute,
)

app.route(
    '/api/providers/miaomiaozhe',
    miaomiaozheRoute,
)

app.route(
    '/api/listings',
    listingsRoute,
)

app.route(
    '/api/monitors',
    monitorsRoute,
)

export default {
    //
    // 普通 HTTP 请求
    //
    fetch: app.fetch,

    //
    // Cloudflare Cron
    //
    async scheduled(
        controller: ScheduledController,
        env: CloudflareBindings,
        _ctx: ExecutionContext,
    ) {
        const db =
            createDb(env.DB)

        const count =
            await enqueueEnabledMonitors(
                db,
                env.PRICE_CHECK_QUEUE,
            )

        console.log(
            `[cron] ${controller.cron} queued ${count} monitors`,
        )
    },

    //
    // Queue 消费者
    //
    async queue(
        batch:
        MessageBatch<PriceCheckMessage>,

        env:
        CloudflareBindings,

        _ctx:
        ExecutionContext,
    ) {
        const db =
            createDb(env.DB)

        //
        // 故意顺序执行。
        //
        // checkMonitor 内部：
        //
        // official fetch
        // +
        // own fetch
        //
        // 已经是 Promise.all。
        //
        // 不要再让 10 个 Monitor
        // 同时爆发请求喵喵折。
        //
        for (
            const message
            of batch.messages
            ) {
            try {
                const result =
                    await checkMonitor(
                        db,
                        env.MIAOMIAO_TOKEN,
                        message.body.monitorId,
                    )

                console.log(
                    `[queue] monitor=${message.body.monitorId} status=${result.status}`,
                )

                //
                // checkMonitor 即使第三方接口失败，
                // 也会记录 fetch_error。
                //
                // 所以这条任务已经完成。
                //
                message.ack()
            } catch (error) {
                console.error(
                    `[queue] monitor=${message.body.monitorId} failed`,
                    error,
                )

                //
                // 这里代表程序级异常，
                // 例如 DB 数据异常等。
                //
                // 60 秒后重试。
                //
                message.retry({
                    delaySeconds: 60,
                })
            }
        }
    },
} satisfies ExportedHandler<
    CloudflareBindings,
    PriceCheckMessage
>