/**
 * Cloudflare Worker 入口。
 *
 * 同一个 Worker 同时承担三类事件：
 * 1. fetch：Hono HTTP API；
 * 2. scheduled：Cron 定时投递 Monitor 到 Queue；
 * 3. queue：消费价格检测任务。
 */
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'

import { createDb } from './db'
import { authRoute } from './routes/auth'
import { brandsRoute } from './routes/brands'
import { listingsRoute } from './routes/listings'
import { monitorsRoute } from './routes/monitors'
import { notificationsRoute } from './routes/notifications'
import { productsRoute } from './routes/products'
import { rulePresetsRoute } from './routes/rule-presets'
import { settingsRoute } from './routes/settings'
import { suppliersRoute } from './routes/suppliers'
import {
  cleanupExpiredSessions,
  getAdminFromSession,
} from './services/auth'
import { checkMonitor } from './services/monitor'
import {
  dispatchScheduledPriceChecks,
  type PriceCheckMessage,
} from './services/monitor-scheduler'

const app = new Hono<{ Bindings: CloudflareBindings }>()

/**
 * 每个请求分配 requestId，并输出结构化访问日志。
 * 日志中不记录 Cookie、密码或第三方 Token。
 */
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()

  c.header('x-request-id', requestId)

  try {
    await next()
  } finally {
    console.log(
      JSON.stringify({
        event: 'request',
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
      }),
    )
  }
})

/** 未捕获异常统一转换为稳定的 JSON，避免把内部堆栈直接暴露给浏览器。 */
app.onError((error, c) => {
  const requestId = c.res.headers.get('x-request-id') || 'unknown'

  console.error(
    JSON.stringify({
      event: 'unhandled_error',
      requestId,
      message: error.message,
      stack: error.stack,
    }),
  )

  return c.json(
    {
      success: false,
      message: '服务器内部错误，请稍后重试',
      requestId,
    },
    500,
  )
})

app.notFound((c) =>
  c.json({ success: false, message: '接口不存在' }, 404),
)

app.get('/api/health', (c) =>
  c.json({
    success: true,
    message: 'price-monitor api is running',
    version: '1.6.1',
  }),
)

/**
 * 除登录和健康检查外，所有 /api/* 都要求有效 Session。
 * 用户身份只从 HttpOnly Cookie + D1 Session 获取，不接受前端传 userId。
 */
app.use('/api/*', async (c, next) => {
  if (
    c.req.path === '/api/health' ||
    c.req.path === '/api/auth/login'
  ) {
    await next()
    return
  }

  const token = getCookie(c, 'pm_session')
  if (!token) {
    return c.json({ success: false, message: '未登录' }, 401)
  }

  const user = await getAdminFromSession(createDb(c.env.DB), token)
  if (!user) {
    return c.json(
      { success: false, message: '登录已过期，请重新登录' },
      401,
    )
  }

  await next()
})

// 路由只在这里集中注册，新增业务模块时便于查找入口。
app.route('/api/auth', authRoute)
app.route('/api/brands', brandsRoute)
app.route('/api/suppliers', suppliersRoute)
app.route('/api/products', productsRoute)
app.route('/api/listings', listingsRoute)
app.route('/api/monitors', monitorsRoute)
app.route('/api/rule-presets', rulePresetsRoute)
app.route('/api/notifications', notificationsRoute)
app.route('/api/settings', settingsRoute)

export default {
  fetch: app.fetch,

  /**
   * Cloudflare Cron 每分钟唤醒一次，但真正的价格检测时间由 D1 设置决定。
   * 未命中计划时只做一次轻量设置读取，不会请求喵喵折，也不会扫描 Monitor。
   */
  async scheduled(
    controller: ScheduledController,
    env: CloudflareBindings,
    _ctx: ExecutionContext,
  ) {
    /**
     * 先记录 Cron tick。
     *
     * 这条日志很重要：即使当前分钟没有命中 GUI 配置的检测时间，也可以明确区分
     * “Cloudflare Cron 没调用 Worker”与“Cron 已调用，但业务计划没有命中”。
     */
    console.log(
      JSON.stringify({
        event: 'cron_tick',
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
        scheduledTimeIso: new Date(controller.scheduledTime).toISOString(),
      }),
    )

    // D1 binding 必须先转换成 Drizzle Database，再传入 service 层。
    // 不能把整个 env 对象当成 db，否则 getSetting() 内部调用 db.select() 会报错。
    const db = createDb(env.DB)
    const scheduledAt = new Date(controller.scheduledTime)

    /**
     * Session 是 7 天有效期，没有必要每分钟清理。
     * 固定每天 UTC 00:05 清一次即可，避免无意义的高频 DELETE。
     */
    if (
      scheduledAt.getUTCHours() === 0 &&
      scheduledAt.getUTCMinutes() === 5
    ) {
      await cleanupExpiredSessions(db)
    }

    const result = await dispatchScheduledPriceChecks(
      db,
      env.PRICE_CHECK_QUEUE,
      scheduledAt,
    )

    /**
     * 无论是否命中都输出调度结果。
     * 调试自动检测时主要看 matched / localTime / enqueued：
     * - matched=false：Cron 正常，但当前分钟不在计划中；
     * - matched=true, enqueued>0：已把 Monitor 投递到 Queue；
     * - skippedDuplicate=true：同一 Cron 分钟已经投递过，幂等保护生效。
     */
    console.log(
      JSON.stringify({
        event: 'cron_result',
        cron: controller.cron,
        scheduledAt: scheduledAt.toISOString(),
        localTime: result.localTime,
        timezone: result.timezone,
        matched: result.matched,
        skippedDuplicate: result.skippedDuplicate,
        enqueued: result.enqueued,
      }),
    )
  },

  /** Queue consumer 串行处理当前 batch；失败消息由 Cloudflare Queue 重试。 */
  async queue(
    batch: MessageBatch<PriceCheckMessage>,
    env: CloudflareBindings,
    _ctx: ExecutionContext,
  ) {
    const db = createDb(env.DB)

    for (const message of batch.messages) {
      try {
        const result = await checkMonitor(
          db,
          env.MIAOMIAO_TOKEN,
          message.body.monitorId,
        )

        console.log(
          JSON.stringify({
            event: 'queue_check',
            monitorId: message.body.monitorId,
            status: result.status,
          }),
        )
        message.ack()
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'queue_failed',
            monitorId: message.body.monitorId,
            error: String(error),
          }),
        )
        message.retry({ delaySeconds: 60 })
      }
    }
  },
} satisfies ExportedHandler<CloudflareBindings, PriceCheckMessage>
