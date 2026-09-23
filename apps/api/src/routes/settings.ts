/**
 * 管理端设置接口。Token 查询只返回配置状态和掩码；保存前必须先用真实业务链路验证。
 */
import { zValidator } from '@hono/zod-validator'
import { isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { listings, listingSkus } from '../db/schema'
import {
  getOfferDetail,
  resolveOffer,
} from '../services/miaomiaozhe'
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

export const settingsRoute = new Hono<{
  Bindings: CloudflareBindings
}>()

settingsRoute.get('/miaomiaozhe', async (c) => {
  const db = createDb(c.env.DB)
  const saved = await getSetting(db, MIAOMIAO_TOKEN_KEY)
  const fallback = (c.env as CloudflareBindings & {
    MIAOMIAO_TOKEN?: string
  }).MIAOMIAO_TOKEN
  const token = normalizeBearerToken(saved || fallback || '')

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
    const token = normalizeBearerToken(c.req.valid('json').token)

    if (!token) {
      return c.json(
        {
          success: false,
          message: 'Token 不能为空',
        },
        400,
      )
    }

    // 保存前必须验证 Token。
    // 验证成功后才写入 D1，避免一次错误配置覆盖掉当前可用 Token。
    // 不再调用猜测出来的 /api/zero/me；只使用已经实际跑通的
    // parseClipboard + offer/detail 链路进行验证。
    try {
      const [sampleSku] = await db
        .select({
          providerRef: listingSkus.providerRef,
        })
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
            c.req.valid('json').validationUrl?.trim() ||
            sampleListing?.url?.trim() ||
            ''

          if (!validationUrl) {
            return c.json(
              {
                success: false,
                message:
                  '当前没有已导入商品可用于 Token 验证。首次配置请同时填写一个淘宝/天猫商品链接作为验证链接。',
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
          message:
            error instanceof Error
              ? `Token 验证失败：${error.message}`
              : 'Token 验证失败',
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
