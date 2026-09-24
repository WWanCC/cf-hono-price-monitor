/**
 * 自动价格检测计划。
 *
 * 设计目标：
 * 1. Cloudflare Cron 固定每分钟唤醒一次 Worker；
 * 2. 真正的检测时间由 D1 中的 app_settings 决定；
 * 3. 修改计划后立即生效，不需要重新部署 Worker；
 * 4. 升级到 v1.6.0 后如果用户还没有保存过计划，继续沿用旧版
 *    09:00 / 15:00 / 21:00（Asia/Shanghai）行为。
 *
 * 这里故意复用 app_settings，而不是新增 schedule 表。当前计划只有一份全局配置，
 * 单独建表会增加 migration 和维护成本，却没有带来实际收益。
 */
import type { Db } from '../db'
import { getSetting, setSetting } from './settings'

export const PRICE_CHECK_SCHEDULE_KEY = 'price_check_schedule'
export const PRICE_CHECK_SCHEDULE_LAST_RUN_KEY = 'price_check_schedule_last_run'

export type PriceCheckSchedule = {
  enabled: boolean
  timezone: string
  times: string[]
}

export type PriceCheckScheduleLastRun = {
  /** Cron 对应的 UTC 分钟，例如 2026-09-24T13:00:00.000Z。 */
  scheduledAt: string
  /** Worker 真正完成 Queue 投递的时间。 */
  triggeredAt: string
  /** 本次实际投递的 Monitor 数量。 */
  enqueued: number
}

export type PriceCheckScheduleView = PriceCheckSchedule & {
  lastRun: PriceCheckScheduleLastRun | null
  lastRunLocal: string | null
  nextRunLocal: string | null
}

/**
 * 与 v1.5.1 之前的固定 Cron 保持一致。
 * 旧版 Cron 是 UTC 01/07/13 点，也就是中国标准时间 09/15/21 点。
 */
export const DEFAULT_PRICE_CHECK_SCHEDULE: PriceCheckSchedule = {
  enabled: true,
  timezone: 'Asia/Shanghai',
  times: ['09:00', '15:00', '21:00'],
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/**
 * Worker 的 Intl 实现支持 IANA timezone。这里用真正构造 formatter 的方式校验，
 * 比维护一份不完整的时区白名单更稳妥。
 */
export function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function normalizeScheduleTimes(times: string[]) {
  return Array.from(
    new Set(times.map((time) => time.trim()).filter((time) => TIME_PATTERN.test(time))),
  ).sort()
}

/**
 * 保存前的统一规范化。
 * 路由层负责把明显错误返回给用户；本函数负责确保落库数据顺序稳定、没有重复时间。
 */
export function normalizePriceCheckSchedule(
  schedule: PriceCheckSchedule,
): PriceCheckSchedule {
  return {
    enabled: Boolean(schedule.enabled),
    timezone: schedule.timezone.trim(),
    times: normalizeScheduleTimes(schedule.times),
  }
}

/**
 * 读取 D1 中的计划。历史数据库没有该 key 时直接返回默认值，因此升级无需 migration。
 * 即使数据库里因为手工修改出现损坏 JSON，也会回退默认配置，避免 Cron 整体失效。
 */
export async function getPriceCheckSchedule(db: Db): Promise<PriceCheckSchedule> {
  const raw = await getSetting(db, PRICE_CHECK_SCHEDULE_KEY)
  if (!raw) return { ...DEFAULT_PRICE_CHECK_SCHEDULE, times: [...DEFAULT_PRICE_CHECK_SCHEDULE.times] }

  try {
    const parsed = JSON.parse(raw) as Partial<PriceCheckSchedule>
    const timezone = typeof parsed.timezone === 'string'
      ? parsed.timezone.trim()
      : DEFAULT_PRICE_CHECK_SCHEDULE.timezone
    let times = Array.isArray(parsed.times)
      ? normalizeScheduleTimes(
          parsed.times.filter(
            (value): value is string => typeof value === 'string',
          ),
        )
      : [...DEFAULT_PRICE_CHECK_SCHEDULE.times]
    const enabled = typeof parsed.enabled === 'boolean'
      ? parsed.enabled
      : DEFAULT_PRICE_CHECK_SCHEDULE.enabled

    if (!isValidTimeZone(timezone)) {
      throw new Error(`invalid timezone: ${timezone}`)
    }

    // 启用状态却没有任何时间通常意味着配置被手工破坏，自动回退旧版默认计划。
    if (enabled && times.length === 0) {
      times = [...DEFAULT_PRICE_CHECK_SCHEDULE.times]
    }

    return {
      enabled,
      timezone,
      times,
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'schedule_config_invalid',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    return { ...DEFAULT_PRICE_CHECK_SCHEDULE, times: [...DEFAULT_PRICE_CHECK_SCHEDULE.times] }
  }
}

export async function savePriceCheckSchedule(
  db: Db,
  schedule: PriceCheckSchedule,
) {
  const normalized = normalizePriceCheckSchedule(schedule)
  await setSetting(db, PRICE_CHECK_SCHEDULE_KEY, JSON.stringify(normalized))
  return normalized
}

export async function getPriceCheckScheduleLastRun(
  db: Db,
): Promise<PriceCheckScheduleLastRun | null> {
  const raw = await getSetting(db, PRICE_CHECK_SCHEDULE_LAST_RUN_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<PriceCheckScheduleLastRun>
    if (
      typeof parsed.scheduledAt !== 'string' ||
      typeof parsed.triggeredAt !== 'string' ||
      typeof parsed.enqueued !== 'number' ||
      !Number.isFinite(Date.parse(parsed.scheduledAt)) ||
      !Number.isFinite(Date.parse(parsed.triggeredAt))
    ) {
      return null
    }

    return {
      scheduledAt: parsed.scheduledAt,
      triggeredAt: parsed.triggeredAt,
      enqueued: parsed.enqueued,
    }
  } catch {
    return null
  }
}

export async function savePriceCheckScheduleLastRun(
  db: Db,
  value: PriceCheckScheduleLastRun,
) {
  await setSetting(db, PRICE_CHECK_SCHEDULE_LAST_RUN_KEY, JSON.stringify(value))
}

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** 把一个 UTC Date 投影到指定 IANA timezone，供 Cron 判断当前本地时间。 */
export function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const get = (type: 'year' | 'month' | 'day' | 'hour' | 'minute') => {
    const value = parts.find((part) => part.type === type)?.value
    if (!value) throw new Error(`无法读取时区时间字段：${type}`)
    return Number(value)
  }

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

export function formatHm(parts: Pick<ZonedParts, 'hour' | 'minute'>) {
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

export function formatYmdHm(parts: ZonedParts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${formatHm(parts)}`
}

/** 当前 Cron 分钟是否命中用户配置的某个本地时间。 */
export function matchesPriceCheckSchedule(
  schedule: PriceCheckSchedule,
  date: Date,
) {
  if (!schedule.enabled || schedule.times.length === 0) return false
  const local = getZonedParts(date, schedule.timezone)
  return schedule.times.includes(formatHm(local))
}

/**
 * 去掉秒和毫秒，得到“本次 Cron 分钟”的稳定键。
 * Cloudflare 通常每个 Cron 只触发一次，但这里仍做幂等保护，避免同一分钟重复投递。
 */
export function toUtcMinuteIso(date: Date) {
  const copy = new Date(date)
  copy.setUTCSeconds(0, 0)
  return copy.toISOString()
}

/** 把某个 UTC 时间按计划时区格式化，主要用于设置页显示“上次检测”。 */
export function formatInTimeZone(date: Date, timezone: string) {
  return formatYmdHm(getZonedParts(date, timezone))
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
) {
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

/**
 * 计算下一次“计划时区中的本地日期时间”。
 * 设置页只需要告诉运营人员“下一次是当地什么时候”，不需要把它反解成 UTC。
 */
export function getNextRunLocal(
  schedule: PriceCheckSchedule,
  now = new Date(),
) {
  if (!schedule.enabled || schedule.times.length === 0) return null

  const local = getZonedParts(now, schedule.timezone)
  const currentHm = formatHm(local)
  const todayNext = schedule.times.find((time) => time > currentHm)

  if (todayNext) {
    return `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')} ${todayNext}`
  }

  const tomorrow = addCalendarDays(local.year, local.month, local.day, 1)
  return `${String(tomorrow.year).padStart(4, '0')}-${String(tomorrow.month).padStart(2, '0')}-${String(tomorrow.day).padStart(2, '0')} ${schedule.times[0]}`
}

export async function getPriceCheckScheduleView(
  db: Db,
  now = new Date(),
): Promise<PriceCheckScheduleView> {
  const [schedule, lastRun] = await Promise.all([
    getPriceCheckSchedule(db),
    getPriceCheckScheduleLastRun(db),
  ])

  return {
    ...schedule,
    lastRun,
    lastRunLocal: lastRun
      ? formatInTimeZone(new Date(lastRun.scheduledAt), schedule.timezone)
      : null,
    nextRunLocal: getNextRunLocal(schedule, now),
  }
}
