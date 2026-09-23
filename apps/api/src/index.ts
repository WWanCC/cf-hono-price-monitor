/**
 * Worker 的总入口。
 *
 * 这里同时承载三类 Cloudflare 事件：普通 HTTP 请求走 fetch，定时任务走
 * scheduled，Queue 消费者走 queue。把它们放在同一个入口，部署时只需要维护一个 Worker。
 */
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'

import { createDb } from './db'

import { authRoute } from './routes/auth'
import { brandsRoute } from './routes/brands'
import { listingsRoute } from './routes/listings'
import { miaomiaozheRoute } from './routes/miaomiaozhe'
import { monitorsRoute } from './routes/monitors'
import { notificationsRoute } from './routes/notifications'
import { productsRoute } from './routes/products'
import { rulePresetsRoute } from './routes/rule-presets'
import { settingsRoute } from './routes/settings'
import { suppliersRoute } from './routes/suppliers'

import { getAdminFromSession } from './services/auth'
import { checkMonitor } from './services/monitor'
import {
  enqueueEnabledMonitors,
  type PriceCheckMessage,
} from './services/monitor-scheduler'

// Hono 的泛型把 Cloudflare 绑定注入到所有路由上下文中。
const app = new Hono<{
  Bindings: CloudflareBindings
}>()

app.get('/api/health', (c) => {
  return c.json({
    success: true,
    message: 'price-monitor api is running',
  })
})

// 登录接口公开；其余管理 API 统一要求登录。
// 中间件只检查 Session 是否有效，具体资源权限目前统一为“管理员可访问”。
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
    return c.json(
      { success: false, message: '未登录' },
      401,
    )
  }

  const user = await getAdminFromSession(
    createDb(c.env.DB),
    token,
  )

  if (!user) {
    return c.json(
      { success: false, message: '登录已过期，请重新登录' },
      401,
    )
  }

  await next()
})

app.route('/api/auth', authRoute)
app.route('/api/brands', brandsRoute)
app.route('/api/suppliers', suppliersRoute)
app.route('/api/products', productsRoute)
app.route('/api/rule-presets', rulePresetsRoute)
app.route('/api/providers/miaomiaozhe', miaomiaozheRoute)
app.route('/api/listings', listingsRoute)
app.route('/api/monitors', monitorsRoute)
app.route('/api/notifications', notificationsRoute)
app.route('/api/settings', settingsRoute)

export default {
  fetch: app.fetch,

  // Cron 只投递任务，不直接执行价格请求；这样一次定时触发不会被外部 API 延迟拖住。
  async scheduled(
    controller: ScheduledController,
    env: CloudflareBindings,
    _ctx: ExecutionContext,
  ) {
    const db = createDb(env.DB)
    const count = await enqueueEnabledMonitors(
      db,
      env.PRICE_CHECK_QUEUE,
    )

    console.log(
      `[cron] ${controller.cron} queued ${count} monitors`,
    )
  },

  // Queue consumer 逐条处理消息：成功 ack，异常 retry，交给 Cloudflare 按配置重试。
  async queue(
    batch: MessageBatch<PriceCheckMessage>,
    env: CloudflareBindings,
    _ctx: ExecutionContext,
  ) {
    const db = createDb(env.DB)
    const fallbackToken = (
      env as CloudflareBindings & {
        MIAOMIAO_TOKEN?: string
      }
    ).MIAOMIAO_TOKEN

    for (const message of batch.messages) {
      try {
        const result = await checkMonitor(
          db,
          fallbackToken,
          message.body.monitorId,
        )

        console.log(
          `[queue] monitor=${message.body.monitorId} status=${result.status}`,
        )
        message.ack()
      } catch (error) {
        console.error(
          `[queue] monitor=${message.body.monitorId} failed`,
          error,
        )
        message.retry({ delaySeconds: 60 })
      }
    }
  },
} satisfies ExportedHandler<
  CloudflareBindings,
  PriceCheckMessage
>
