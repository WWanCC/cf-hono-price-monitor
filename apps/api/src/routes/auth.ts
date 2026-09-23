/**
 * 管理员登录、登出、当前用户和账号修改接口。
 *
 * 登录时如果数据库还没有管理员，会从 Worker Secret/.dev.vars 初始化首个账号；
 * 后续请求依赖 HttpOnly Cookie 中的 Session Token。
 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { adminUsers } from '../db/schema'
import {
  createAdminSession,
  createPasswordRecord,
  deleteAdminSession,
  ensureInitialAdmin,
  getAdminByUsername,
  getAdminFromSession,
  verifyPassword,
} from '../services/auth'

const COOKIE_NAME = 'pm_session'

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
})

const updateAccountSchema = z.object({
  currentPassword: z.string().min(1),
  username: z.string().trim().min(1).optional(),
  newPassword: z.string().min(8).optional(),
})

export const authRoute = new Hono<{
  Bindings: CloudflareBindings
}>()

// 从 Cookie 解析当前管理员；路由层不信任前端传来的用户 ID。
async function currentAdmin(c: any) {
  const token = getCookie(c, COOKIE_NAME)
  if (!token) return null
  return getAdminFromSession(createDb(c.env.DB), token)
}

authRoute.post(
  '/login',
  zValidator('json', loginSchema),
  async (c) => {
    const db = createDb(c.env.DB)
    const env = c.env as CloudflareBindings & {
      ADMIN_USERNAME?: string
      ADMIN_PASSWORD?: string
    }

    // 延迟初始化让首次部署不需要额外的 seed 命令，但管理员配置错误时会明确返回 503。
    try {
      await ensureInitialAdmin(db, env)
    } catch (error) {
      return c.json(
        {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : '管理员初始化失败',
        },
        503,
      )
    }

    const { username, password } = c.req.valid('json')
    const user = await getAdminByUsername(db, username)

    if (
      !user ||
      !(await verifyPassword(
        password,
        user.passwordHash,
        user.passwordSalt,
      ))
    ) {
      return c.json(
        {
          success: false,
          message: '账号或密码错误',
        },
        401,
      )
    }

    const session = await createAdminSession(db, user.id)
    const secure = new URL(c.req.url).protocol === 'https:'

    setCookie(c, COOKIE_NAME, session.token, {
      httpOnly: true,
      secure,
      sameSite: 'Strict',
      path: '/',
      expires: session.expiresAt,
    })

    return c.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
      },
    })
  },
)

authRoute.get('/me', async (c) => {
  const user = await currentAdmin(c)

  if (!user) {
    return c.json(
      {
        success: false,
        message: '未登录',
      },
      401,
    )
  }

  return c.json({
    success: true,
    data: {
      id: user.id,
      username: user.username,
    },
  })
})

authRoute.post('/logout', async (c) => {
  const token = getCookie(c, COOKIE_NAME)
  if (token) {
    await deleteAdminSession(createDb(c.env.DB), token)
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' })

  return c.json({
    success: true,
    data: true,
  })
})

authRoute.patch(
  '/account',
  zValidator('json', updateAccountSchema),
  async (c) => {
    const db = createDb(c.env.DB)
    const user = await currentAdmin(c)

    if (!user) {
      return c.json(
        {
          success: false,
          message: '未登录',
        },
        401,
      )
    }

    const [fullUser] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, user.id))
      .limit(1)

    const body = c.req.valid('json')

    if (
      !fullUser ||
      !(await verifyPassword(
        body.currentPassword,
        fullUser.passwordHash,
        fullUser.passwordSalt,
      ))
    ) {
      return c.json(
        {
          success: false,
          message: '当前密码错误',
        },
        400,
      )
    }

    const patch: {
      username?: string
      passwordHash?: string
      passwordSalt?: string
      updatedAt: Date
    } = {
      updatedAt: new Date(),
    }

    if (body.username) patch.username = body.username

    if (body.newPassword) {
      const passwordRecord = await createPasswordRecord(body.newPassword)
      patch.passwordHash = passwordRecord.passwordHash
      patch.passwordSalt = passwordRecord.passwordSalt
    }

    try {
      const [updated] = await db
        .update(adminUsers)
        .set(patch)
        .where(eq(adminUsers.id, user.id))
        .returning({
          id: adminUsers.id,
          username: adminUsers.username,
        })

      return c.json({
        success: true,
        data: updated,
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        return c.json(
          {
            success: false,
            message: '该登录账号已存在',
          },
          409,
        )
      }
      throw error
    }
  },
)
