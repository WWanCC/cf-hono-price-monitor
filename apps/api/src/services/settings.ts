/**
 * 应用设置服务。
 *
 * 设置以 key/value 形式保存，当前主要用于喵喵折 Token。读取时优先使用 D1 中
 * 的值，环境变量只作为兼容 fallback；返回给浏览器前只能返回掩码。
 */
import { eq } from 'drizzle-orm'

import type { Db } from '../db'
import { appSettings } from '../db/schema'

export const MIAOMIAO_TOKEN_KEY = 'miaomiaozhe_token'

export async function getSetting(
  db: Db,
  key: string,
) {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1)

  return row?.value ?? null
}

export async function setSetting(
  db: Db,
  key: string,
  value: string,
) {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value,
        updatedAt: new Date(),
      },
    })
}

export function normalizeBearerToken(token: string) {
  return token.trim().replace(/^Bearer\s+/i, '')
}

export async function getMiaomiaoToken(
  db: Db,
  fallbackToken?: string,
) {
  // 管理端保存的值优先；fallback 只兼容旧部署中的环境变量配置。
  const saved = await getSetting(db, MIAOMIAO_TOKEN_KEY)

  const token = normalizeBearerToken(
    saved || fallbackToken || '',
  )

  if (!token) {
    throw new Error('喵喵折 Token 未配置，请在系统设置中填写')
  }

  return token
}

// 完整 Token 永远不返回前端，避免设置页接口成为敏感信息泄露点。
export function maskToken(token: string) {
  if (!token) return ''
  if (token.length <= 8) return '••••••••'
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`
}
