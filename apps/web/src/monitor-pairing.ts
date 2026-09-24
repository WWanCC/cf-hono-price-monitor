/**
 * Monitor 批量配对的纯函数。
 *
 * 这个文件不依赖 Vue / Element Plus，因此配对规则可以独立测试，也方便以后增加
 * “按 SKU 名自动匹配”等策略，而不把算法继续堆进页面组件。
 */
import type { MonitorPairInput } from './api'

export type PairingMode = 'zip' | 'cartesian'

/** 根据两侧已选 SKU 生成最终 Monitor 配对。 */
export function buildMonitorPairs(
  referenceSkuIds: number[],
  targetSkuIds: number[],
  mode: PairingMode,
): MonitorPairInput[] {
  if (mode === 'zip') {
    const count = Math.min(referenceSkuIds.length, targetSkuIds.length)

    return referenceSkuIds.slice(0, count).map(
      (referenceSkuId, index) => ({
        referenceSkuId,
        targetSkuId: targetSkuIds[index],
      }),
    )
  }

  return referenceSkuIds.flatMap((referenceSkuId) =>
    targetSkuIds.map((targetSkuId) => ({
      referenceSkuId,
      targetSkuId,
    })),
  )
}

/** 返回空字符串表示选择合法，否则返回可直接展示给用户的提示。 */
export function validateMonitorPairSelection(
  referenceCount: number,
  targetCount: number,
  mode: PairingMode,
  generatedCount: number,
  maxBatch: number,
) {
  if (referenceCount === 0 || targetCount === 0) {
    return '请至少选择 1 个官方 SKU 和 1 个自店 SKU'
  }

  if (mode === 'zip' && referenceCount !== targetCount) {
    return `一一配对要求两侧数量一致：当前官方 ${referenceCount} 个，自店 ${targetCount} 个`
  }

  if (generatedCount > maxBatch) {
    return `本次会生成 ${generatedCount} 条监控，单次最多 ${maxBatch} 条`
  }

  return ''
}
