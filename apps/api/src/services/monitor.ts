/**
 * 价格监控核心服务。
 *
 * 本文件负责“运行一次 Monitor 检测”，以及提供 Monitor 创建/列表所需的 SKU 上下文。
 * HTTP 路由不直接操作第三方价格接口，Queue consumer 与手动检测都复用 checkMonitor。
 */
import { eq } from 'drizzle-orm'

import type { Db } from '../db'
import {
  listingSkus,
  listings,
  monitors,
  notifications,
  products,
} from '../db/schema'
import { getCurrentPrice } from './miaomiaozhe'
import { evaluateRule } from './rule-expression'
import { getMiaomiaoToken } from './settings'

/**
 * 构造可直接打开到具体 SKU 的淘宝/天猫 URL。
 * 未知平台则尽量保留原链接，仅替换/补充 skuId 参数。
 */
export function buildSkuUrl(
  platform: string,
  externalItemId: string,
  externalSkuId: string,
  fallbackUrl: string,
) {
  const normalized = platform.toLowerCase()

  if (normalized === 'tmall') {
    return `https://detail.tmall.com/item.htm?id=${encodeURIComponent(externalItemId)}&skuId=${encodeURIComponent(externalSkuId)}`
  }

  if (normalized === 'taobao') {
    return `https://item.taobao.com/item.htm?id=${encodeURIComponent(externalItemId)}&skuId=${encodeURIComponent(externalSkuId)}`
  }

  try {
    const url = new URL(fallbackUrl)

    // 删除大小写不同的旧 skuId，避免 URL 同时出现多个 SKU 参数。
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

/**
 * 查询一个 SKU 以及它所属 Listing / Product 的状态。
 *
 * Monitor 是否可用不能只看 listing_skus.enabled：如果父级 Product 或 Listing 被停用，
 * 这个 SKU 也必须视为不可监控。
 */
export async function getSkuContext(db: Db, skuId: number) {
  const [result] = await db
    .select({
      skuId: listingSkus.id,
      externalSkuId: listingSkus.externalSkuId,
      skuName: listingSkus.name,
      providerRef: listingSkus.providerRef,
      skuEnabled: listingSkus.enabled,
      listingId: listings.id,
      listingTitle: listings.title,
      listingUrl: listings.url,
      listingPlatform: listings.platform,
      listingExternalItemId: listings.externalItemId,
      listingEnabled: listings.enabled,
      shopName: listings.shopName,
      role: listings.role,
      productId: listings.productId,
      productEnabled: products.enabled,
    })
    .from(listingSkus)
    .innerJoin(listings, eq(listingSkus.listingId, listings.id))
    .innerJoin(products, eq(listings.productId, products.id))
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

/**
 * 一次性获取所有 SKU 上下文。
 * 列表页和批量创建用它来避免 N+1 查询。
 */
export async function listSkuContexts(db: Db) {
  const rows = await db
    .select({
      skuId: listingSkus.id,
      externalSkuId: listingSkus.externalSkuId,
      skuName: listingSkus.name,
      providerRef: listingSkus.providerRef,
      skuEnabled: listingSkus.enabled,
      listingId: listings.id,
      listingTitle: listings.title,
      listingUrl: listings.url,
      listingPlatform: listings.platform,
      listingExternalItemId: listings.externalItemId,
      listingEnabled: listings.enabled,
      shopName: listings.shopName,
      role: listings.role,
      productId: listings.productId,
      productEnabled: products.enabled,
    })
    .from(listingSkus)
    .innerJoin(listings, eq(listingSkus.listingId, listings.id))
    .innerJoin(products, eq(listings.productId, products.id))

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

/** Product、Listing、SKU 任意一级停用，都视为该 SKU 不可用于监控。 */
export function isSkuContextActive(
  context: Awaited<ReturnType<typeof getSkuContext>>,
) {
  return Boolean(
    context?.skuEnabled &&
      context.listingEnabled &&
      context.productEnabled,
  )
}

/**
 * 执行一次价格检测。
 *
 * 成功路径：
 *   读取官方/自店价格 -> evaluateRule -> 更新 Monitor 状态 -> 必要时生成站内信。
 *
 * 失败路径：
 *   不把异常继续抛给 Queue，而是把 Monitor 标记为 fetch_error，便于后台排查。
 */
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

  if (!monitor.enabled) {
    throw new Error('监控已停用')
  }

  const [reference, target] = await Promise.all([
    getSkuContext(db, monitor.referenceSkuId),
    getSkuContext(db, monitor.targetSkuId),
  ])

  if (!reference || !target) {
    throw new Error('监控关联的 SKU 不存在')
  }

  const now = new Date()

  try {
    if (!isSkuContextActive(reference) || !isSkuContextActive(target)) {
      throw new Error('监控关联的商品、Listing 或 SKU 已停用')
    }

    if (!reference.providerRef) {
      throw new Error('官方 SKU 缺少 providerRef')
    }

    if (!target.providerRef) {
      throw new Error('自店 SKU 缺少 providerRef')
    }

    const token = await getMiaomiaoToken(db, fallbackToken)

    // 两个价格请求互不依赖，可以并行执行以缩短单条 Monitor 的耗时。
    const [officialPrice, ownPrice] = await Promise.all([
      getCurrentPrice(token, reference.providerRef),
      getCurrentPrice(token, target.providerRef),
    ])

    const passed = evaluateRule(monitor.ruleExpression, {
      official: officialPrice,
      own: ownPrice,
    })
    const status = passed ? 'normal' : 'violation'

    await db
      .update(monitors)
      .set({
        lastStatus: status,
        lastCheckedAt: now,
        lastError: null,
      })
      .where(eq(monitors.id, monitorId))

    // 每次检测结果为违规都创建通知，避免定时任务连续违规时漏掉提醒。
    if (status === 'violation') {
      try {
        await db.insert(notifications).values({
          monitorId,
          type: 'violation',
          title: `价格违规 · Monitor #${monitorId}`,
          content: [
            `官方 SKU：${reference.skuName}`,
            `官方价格：¥${officialPrice.toFixed(2)}`,
            `自店 SKU：${target.skuName}`,
            `自店价格：¥${ownPrice.toFixed(2)}`,
            `规则：${monitor.ruleExpression}`,
          ].join('；'),
        })
      } catch (error) {
        // 通知写入失败不应把已经完成的价格检测判为失败。
        console.error(
          JSON.stringify({
            event: 'notification_create_failed',
            monitorId,
            error: String(error),
          }),
        )
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
      error instanceof Error ? error.message : '监控检测失败'

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
