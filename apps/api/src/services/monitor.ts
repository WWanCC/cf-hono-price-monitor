/**
 * 价格监控核心服务。
 *
 * 一个 Monitor 连接官方 SKU（reference）和自店 SKU（target），先读取两侧价格，
 * 再执行规则并保存状态。检测失败也会落库为 fetch_error，方便页面显示和后续排查。
 */
import { eq } from 'drizzle-orm'

import type { Db } from '../db'
import {
  listingSkus,
  listings,
  monitors,
  notifications,
} from '../db/schema'
import { getCurrentPrice } from './miaomiaozhe'
import { evaluateRule } from './rule-expression'
import { getMiaomiaoToken } from './settings'

// 外部平台支持固定模板；未知平台则尽量在原 URL 上替换 skuId，失败时保留原链接。
export function buildSkuUrl(
  platform: string,
  externalItemId: string,
  externalSkuId: string,
  fallbackUrl: string,
) {
  const normalizedPlatform = platform.toLowerCase()

  if (normalizedPlatform === 'tmall') {
    return `https://detail.tmall.com/item.htm?id=${encodeURIComponent(externalItemId)}&skuId=${encodeURIComponent(externalSkuId)}`
  }

  if (normalizedPlatform === 'taobao') {
    return `https://item.taobao.com/item.htm?id=${encodeURIComponent(externalItemId)}&skuId=${encodeURIComponent(externalSkuId)}`
  }

  try {
    const url = new URL(fallbackUrl)

    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase() === 'skuid') {
        url.searchParams.delete(key)
      }
    }

    url.searchParams.set('skuId', externalSkuId)
    return url.toString()
  } catch {
    return fallbackUrl
  }
}

export async function getSkuContext(
  db: Db,
  skuId: number,
) {
  const [result] = await db
    .select({
      skuId: listingSkus.id,
      externalSkuId: listingSkus.externalSkuId,
      skuName: listingSkus.name,
      providerRef: listingSkus.providerRef,
      listingId: listings.id,
      listingTitle: listings.title,
      listingUrl: listings.url,
      listingPlatform: listings.platform,
      listingExternalItemId: listings.externalItemId,
      shopName: listings.shopName,
      role: listings.role,
      productId: listings.productId,
    })
    .from(listingSkus)
    .innerJoin(
      listings,
      eq(listingSkus.listingId, listings.id),
    )
    .where(eq(listingSkus.id, skuId))
    .limit(1)

  if (!result) return null

  return {
    ...result,
    skuUrl: buildSkuUrl(
      result.listingPlatform,
      result.listingExternalItemId,
      result.externalSkuId,
      result.listingUrl,
    ),
  }
}

export async function listSkuContexts(
  db: Db,
) {
  const rows = await db
    .select({
      skuId: listingSkus.id,
      externalSkuId: listingSkus.externalSkuId,
      skuName: listingSkus.name,
      providerRef: listingSkus.providerRef,
      listingId: listings.id,
      listingTitle: listings.title,
      listingUrl: listings.url,
      listingPlatform: listings.platform,
      listingExternalItemId: listings.externalItemId,
      shopName: listings.shopName,
      role: listings.role,
      productId: listings.productId,
    })
    .from(listingSkus)
    .innerJoin(
      listings,
      eq(listingSkus.listingId, listings.id),
    )

  return rows.map((row) => ({
    ...row,
    skuUrl: buildSkuUrl(
      row.listingPlatform,
      row.listingExternalItemId,
      row.externalSkuId,
      row.listingUrl,
    ),
  }))
}

// 这个函数既返回检测结果，也负责把结果写回数据库，因此 Queue 和手动检测可以复用同一逻辑。
export async function checkMonitor(
  db: Db,
  fallbackToken: string | undefined,
  monitorId: number,
) {
  const [monitor] = await db
    .select()
    .from(monitors)
    .where(eq(monitors.id, monitorId))
    .limit(1)

  if (!monitor) {
    throw new Error('监控不存在')
  }

  const reference = await getSkuContext(db, monitor.referenceSkuId)
  const target = await getSkuContext(db, monitor.targetSkuId)

  if (!reference || !target) {
    throw new Error('监控关联的 SKU 不存在')
  }

  const now = new Date()

  try {
    if (!reference.providerRef) {
      throw new Error('官方 SKU 缺少 providerRef')
    }

    if (!target.providerRef) {
      throw new Error('自店 SKU 缺少 providerRef')
    }

    const token = await getMiaomiaoToken(db, fallbackToken)

    const [officialPrice, ownPrice] = await Promise.all([
      getCurrentPrice(token, reference.providerRef),
      getCurrentPrice(token, target.providerRef),
    ])

    const passed = evaluateRule(
      monitor.ruleExpression,
      {
        official: officialPrice,
        own: ownPrice,
      },
    )

    const status = passed ? 'normal' : 'violation'

    await db
      .update(monitors)
      .set({
        lastStatus: status,
        lastCheckedAt: now,
        lastError: null,
      })
      .where(eq(monitors.id, monitorId))

    // 只在状态从非 violation 进入 violation 时通知，避免 Cron 每次重复提醒。
    if (
      status === 'violation' &&
      monitor.lastStatus !== 'violation'
    ) {
      try {
        const title = `价格违规 · Monitor #${monitorId}`
        const content = [
          `官方 SKU：${reference.skuName}`,
          `官方价格：¥${officialPrice.toFixed(2)}`,
          `自店 SKU：${target.skuName}`,
          `自店价格：¥${ownPrice.toFixed(2)}`,
          `规则：${monitor.ruleExpression}`,
        ].join('；')

        await db.insert(notifications).values({
          monitorId,
          type: 'violation',
          title,
          content,
        })
      } catch (error) {
        console.error('[notification] create failed', error)
      }
    }

    return {
      monitorId,
      status,
      official: {
        skuId: reference.skuId,
        externalSkuId: reference.externalSkuId,
        name: reference.skuName,
        price: officialPrice,
        url: reference.skuUrl,
      },
      own: {
        skuId: target.skuId,
        externalSkuId: target.externalSkuId,
        name: target.skuName,
        price: ownPrice,
        url: target.skuUrl,
      },
      ruleExpression: monitor.ruleExpression,
      checkedAt: now,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : '监控检测失败'

    await db
      .update(monitors)
      .set({
        lastStatus: 'fetch_error',
        lastCheckedAt: now,
        lastError: message,
      })
      .where(eq(monitors.id, monitorId))

    return {
      monitorId,
      status: 'fetch_error' as const,
      error: message,
      checkedAt: now,
    }
  }
}
