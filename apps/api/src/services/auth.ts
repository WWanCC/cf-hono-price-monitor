/**
 * 管理员认证服务。
 *
 * 本文件只负责密码记录、管理员初始化和 Session 的创建/查询/删除；HTTP Cookie
 * 的读写仍由路由层负责，这样密码算法和登录流程可以独立测试。
 */
import { and, eq, gt } from 'drizzle-orm'

import type { Db } from '../db'
import { adminSessions, adminUsers } from '../db/schema'

const encoder = new TextEncoder()
const SESSION_DAYS = 7
const PBKDF2_ITERATIONS = 150_000

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlToBytes(value: string) {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(normalized)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(value),
  )

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// PBKDF2 的计算成本用于抵抗密码猜测；salt 保证相同密码不会产生相同结果。
async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    256,
  )

  return bytesToBase64Url(new Uint8Array(bits))
}

export async function createPasswordRecord(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const passwordHash = await derivePasswordHash(password, salt)

  return {
    passwordHash,
    passwordSalt: bytesToBase64Url(salt),
  }
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
  passwordSalt: string,
) {
  const actual = await derivePasswordHash(
    password,
    base64UrlToBytes(passwordSalt),
  )

  if (actual.length !== passwordHash.length) return false

  let mismatch = 0
  for (let i = 0; i < actual.length; i++) {
    mismatch |= actual.charCodeAt(i) ^ passwordHash.charCodeAt(i)
  }

  return mismatch === 0
}

export async function ensureInitialAdmin(
  db: Db,
  env: {
    ADMIN_USERNAME?: string
    ADMIN_PASSWORD?: string
  },
) {
  const [existing] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .limit(1)

  if (existing) return

  const username = env.ADMIN_USERNAME?.trim()
  const password = env.ADMIN_PASSWORD ?? ''

  if (!username || password.length < 8) {
    throw new Error(
      '尚未初始化管理员。请在 .dev.vars / Worker Secret 中配置 ADMIN_USERNAME 和至少 8 位的 ADMIN_PASSWORD',
    )
  }

  const passwordRecord = await createPasswordRecord(password)

  await db.insert(adminUsers).values({
    username,
    ...passwordRecord,
  })
}

export async function getAdminByUsername(
  db: Db,
  username: string,
) {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.username, username),
        eq(adminUsers.enabled, true),
      ),
    )
    .limit(1)

  return user ?? null
}

// Cookie 中的 Token 是随机值，数据库只保存它的 SHA-256，数据库泄露时不能直接冒充会话。
export async function createAdminSession(
  db: Db,
  adminUserId: number,
) {
  const token = bytesToBase64Url(
    crypto.getRandomValues(new Uint8Array(32)),
  )
  const sessionHash = await sha256Hex(token)
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  )

  await db.insert(adminSessions).values({
    sessionHash,
    adminUserId,
    expiresAt,
  })

  return {
    token,
    expiresAt,
  }
}

// 每次受保护请求都检查 Session 未过期且关联管理员仍处于 enabled 状态。
export async function getAdminFromSession(
  db: Db,
  token: string,
) {
  const sessionHash = await sha256Hex(token)

  const [result] = await db
    .select({
      id: adminUsers.id,
      username: adminUsers.username,
      enabled: adminUsers.enabled,
      sessionHash: adminSessions.sessionHash,
    })
    .from(adminSessions)
    .innerJoin(
      adminUsers,
      eq(adminSessions.adminUserId, adminUsers.id),
    )
    .where(
      and(
        eq(adminSessions.sessionHash, sessionHash),
        gt(adminSessions.expiresAt, new Date()),
        eq(adminUsers.enabled, true),
      ),
    )
    .limit(1)

  return result ?? null
}

export async function deleteAdminSession(
  db: Db,
  token: string,
) {
  const sessionHash = await sha256Hex(token)
  await db
    .delete(adminSessions)
    .where(eq(adminSessions.sessionHash, sessionHash))
}
