/**
 * 应用设置接口。
 *
 * 当前包含两组全局设置：
 * 1. 喵喵折 Token；
 * 2. 自动价格检测计划。
 *
 * 两者都复用 app_settings KV 表。Token 的 GET 接口只返回掩码，完整值不会重新
 * 发给浏览器；检测计划属于非敏感配置，可以完整返回给管理端编辑。
 */
import { zValidator } from '@hono/zod-validator'
import { isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { listings, listingSkus } from '../db/schema'
import { getOfferDetail, resolveOffer } from '../services/miaomiaozhe'
import {
  getPriceCheckScheduleView,
  isValidTimeZone,
  savePriceCheckSchedule,
} from '../services/price-check-schedule'
import {
  getSetting,
  maskToken,
  MIAOMIAO_TOKEN_KEY,
  normalizeBearerToken,
  setSetting,
} from '../services/settings'

const tokenSchema = z.object({
  token: z.string().trim().min(1, 'Token 不能为空'),
  validationUrl: z.string().trim().optional(),
})

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/**
 * 每天最多允许 24 个检测时间。
 * 这不是 Cloudflare 的硬限制，而是产品层保护：价格监控没有必要被配置成高频爬取器。
 */
const priceCheckScheduleSchema = z
  .object({
    enabled: z.boolean(),
    timezone: z.string().trim().min(1).max(64),
    times: z
      .array(z.string().regex(timePattern, '时间必须是 HH:mm'))
      .max(24, '每天最多配置 24 个检测时间'),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.times.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['times'],
        message: '启用自动检测时至少需要配置一个时间',
      })
    }
  })

export const settingsRoute = new Hono<{
  Bindings: CloudflareBindings
}>()

// -----------------------------------------------------------------------------
// 喵喵折 Token
// -----------------------------------------------------------------------------
settingsRoute.get('/miaomiaozhe', async (c) => {
  const db = createDb(c.env.DB)
  const saved = await getSetting(db, MIAOMIAO_TOKEN_KEY)
  const token = normalizeBearerToken(
    saved || c.env.MIAOMIAO_TOKEN || '',
  )

  return c.json({
    success: true,
    data: {
      configured: Boolean(token),
      maskedToken: maskToken(token),
      source: saved ? 'database' : token ? 'environment' : 'none',
    },
  })
})

settingsRoute.put(
  '/miaomiaozhe',
  zValidator('json', tokenSchema),
  async (c) => {
    const db = createDb(c.env.DB)
    const body = c.req.valid('json')
    const token = normalizeBearerToken(body.token)

    /**
     * 验证优先级：
     * 1. 已导入 SKU 的 providerRef；
     * 2. Listing 的 providerRef；
     * 3. 用户提供的验证商品链接。
     *
     * 验证成功之后才覆盖 D1 中已有 Token，防止输错 Token 把当前可用配置破坏掉。
     */
    try {
      const [sampleSku] = await db
        .select({ providerRef: listingSkus.providerRef })
        .from(listingSkus)
        .where(isNotNull(listingSkus.providerRef))
        .limit(1)

      if (sampleSku?.providerRef) {
        await getOfferDetail(token, sampleSku.providerRef)
      } else {
        const [sampleListing] = await db
          .select({
            providerRef: listings.providerRef,
            url: listings.url,
          })
          .from(listings)
          .limit(1)

        if (sampleListing?.providerRef) {
          await getOfferDetail(token, sampleListing.providerRef)
        } else {
          const validationUrl =
            body.validationUrl?.trim() ||
            sampleListing?.url?.trim() ||
            ''

          if (!validationUrl) {
            return c.json(
              {
                success: false,
                message:
                  '首次配置请同时填写一个淘宝/天猫商品链接用于验证 Token',
              },
              400,
            )
          }

          await resolveOffer(token, validationUrl)
        }
      }
    } catch (error) {
      return c.json(
        {
          success: false,
          message: `Token 验证失败：${
            error instanceof Error ? error.message : '未知错误'
          }`,
        },
        400,
      )
    }

    await setSetting(db, MIAOMIAO_TOKEN_KEY, token)

    return c.json({
      success: true,
      data: {
        configured: true,
        maskedToken: maskToken(token),
        source: 'database',
        validated: true,
      },
    })
  },
)

// -----------------------------------------------------------------------------
// 自动价格检测计划
// -----------------------------------------------------------------------------
settingsRoute.get('/price-check-schedule', async (c) => {
  const db = createDb(c.env.DB)
  const view = await getPriceCheckScheduleView(db)

  return c.json({ success: true, data: view })
})

settingsRoute.put(
  '/price-check-schedule',
  zValidator('json', priceCheckScheduleSchema),
  async (c) => {
    const db = createDb(c.env.DB)
    const body = c.req.valid('json')

    /**
     * Zod 只校验字符串形状；IANA timezone 是否真实存在需要交给 Intl 验证。
     * 例如 Asia/Shanghai 合法，而 Asia/Shanghai123 会在这里被拒绝。
     */
    if (!isValidTimeZone(body.timezone)) {
      return c.json(
        {
          success: false,
          message: '无效的 IANA 时区，请使用例如 Asia/Shanghai',
        },
        400,
      )
    }

    await savePriceCheckSchedule(db, body)
    const view = await getPriceCheckScheduleView(db)

    return c.json({ success: true, data: view })
  },
)
