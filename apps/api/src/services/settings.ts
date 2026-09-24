import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { appSettings } from '../db/schema'

export const MIAOMIAO_TOKEN_KEY = 'miaomiaozhe_token'

export async function getSetting(db: Db, key: string) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1)
  return row?.value ?? null
}

export async function setSetting(db: Db, key: string, value: string) {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedAt: new Date() },
  })
}

export function normalizeBearerToken(token: string) {
  return token.trim().replace(/^Bearer\s+/i, '')
}

export async function getMiaomiaoToken(db: Db, fallbackToken?: string) {
  const saved = await getSetting(db, MIAOMIAO_TOKEN_KEY)
  const token = normalizeBearerToken(saved || fallbackToken || '')
  if (!token) throw new Error('喵喵折 Token 未配置，请在系统设置中填写')
  return token
}

export function maskToken(token: string) {
  if (!token) return ''
  if (token.length <= 8) return '••••••••'
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`
}
