/**
 * 管理员认证服务。
 *
 * 本文件只负责密码派生、管理员初始化和 Session 数据库记录；
 * Cookie 的读写由 routes/auth.ts 负责，便于以后单独测试认证算法。
 */
import { and, eq, gt, lt } from 'drizzle-orm'

import type { Db } from '../db'
import { adminSessions, adminUsers } from '../db/schema'

const encoder = new TextEncoder()
const SESSION_DAYS = 7

/**
 * Cloudflare Workers Web Crypto 当前运行时对 PBKDF2 的 iteration 上限为 100000。
 * 之前使用 150000 会在线上初始化管理员时直接报错，因此这里固定为 100000。
 */
const PBKDF2_ITERATIONS = 100_000

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

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

/**
 * PBKDF2-SHA256 派生密码哈希。
 * 随机 salt 保证相同密码不会得到相同的数据库记录。
 */
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

/**
 * 使用恒定长度的逐字节比较，而不是直接 `actual === expected`。
 * 这不能替代完整的认证防护，但可以避免最直接的提前退出比较。
 */
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
  for (let index = 0; index < actual.length; index++) {
    mismatch |=
      actual.charCodeAt(index) ^ passwordHash.charCodeAt(index)
  }

  return mismatch === 0
}

/**
 * 首次部署的懒初始化：只有 admin_users 为空时才读取 Worker Secret 创建账号。
 * 已经初始化后，再修改 Secret 不会自动覆盖数据库中的管理员密码。
 */
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

  await db.insert(adminUsers).values({
    username,
    ...(await createPasswordRecord(password)),
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

/**
 * 浏览器得到随机 Session Token；数据库只保存其 SHA-256。
 * 即使数据库内容泄露，也不能直接把 session_hash 当作 Cookie 使用。
 */
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

  return { token, expiresAt }
}

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

/** 由 Cron 定期清理过期 Session，避免表无限增长。 */
export async function cleanupExpiredSessions(db: Db) {
  await db
    .delete(adminSessions)
    .where(lt(adminSessions.expiresAt, new Date()))
}
