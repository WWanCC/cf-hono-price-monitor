/**
 * 喵喵折商品解析接口。路由负责鉴权后的输入校验和错误映射，具体第三方请求交给服务层。
 */
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { resolveOffer } from '../services/miaomiaozhe'
import { createDb } from '../db'
import { getMiaomiaoToken } from '../services/settings'

const resolveSchema = z.object({ content: z.string().trim().min(1) })

export const miaomiaozheRoute = new Hono<{ Bindings: CloudflareBindings }>()

miaomiaozheRoute.post('/resolve', zValidator('json', resolveSchema), async (c) => {
  const { content } = c.req.valid('json')
  try {
    const db = createDb(c.env.DB)
    const token = await getMiaomiaoToken(
      db,
      (c.env as CloudflareBindings & { MIAOMIAO_TOKEN?: string }).MIAOMIAO_TOKEN,
    )
    const data = await resolveOffer(token, content)
    return c.json({ success: true, data })
  } catch (error) {
    console.error(error)
    return c.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '喵喵折解析失败',
      },
      502,
    )
  }
})
