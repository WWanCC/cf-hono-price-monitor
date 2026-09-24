/**
 * 浏览器端 API 客户端。
 *
 * 维护约定：
 * - Vue 页面不要直接写 fetch；所有请求统一经过本文件。
 * - Cookie、JSON 解析和错误转换只维护一份。
 * - 后端新增端点时，先在这里补类型和方法，再让页面调用。
 */

export type Brand = {
  id: number
  name: string
  note: string | null
  enabled: boolean
}

export type Supplier = {
  id: number
  name: string
  shopName: string | null
  shopUrl: string | null
  note: string | null
  enabled: boolean
}

export type Product = {
  id: number
  name: string
  brandId: number
  brandName: string
  supplierId: number | null
  supplierName: string | null
  supplierProductUrl: string | null
  note: string | null
  enabled: boolean
}

export type Listing = {
  id: number
  productId: number
  role: 'official' | 'own'
  platform: string
  externalItemId: string
  title: string | null
  shopName: string | null
  url: string
  providerRef: string | null
  enabled: boolean
}

export type ListingSku = {
  id: number
  listingId: number
  externalSkuId: string
  name: string
  providerRef: string | null
  enabled: boolean
}

export type MonitorSkuInfo = {
  id: number
  externalSkuId: string
  name: string
  shopName: string | null
  listingTitle: string | null
  url: string
  enabled: boolean
}

export type Monitor = {
  id: number
  referenceSkuId: number
  targetSkuId: number
  ruleExpression: string
  enabled: boolean
  lastStatus: 'pending' | 'normal' | 'violation' | 'fetch_error'
  lastCheckedAt: string | number | null
  lastError: string | null
  referenceSku: MonitorSkuInfo | null
  targetSku: MonitorSkuInfo | null
}

/** 批量创建 Monitor 时提交的一个 SKU 配对。 */
export type MonitorPairInput = {
  referenceSkuId: number
  targetSkuId: number
}

/** 批量创建结果，用于在页面上明确告诉用户哪些被跳过。 */
export type MonitorRecord = Omit<Monitor, 'referenceSku' | 'targetSku'>

export type MonitorBatchCreateResult = {
  requested: number
  uniqueRequested: number
  created: number
  skippedExisting: number
  skippedDuplicateInRequest: number
  monitors: MonitorRecord[]
}

/** 批量给既有 Monitor 应用规则后的汇总结果。 */
export type MonitorBatchRuleResult = {
  requested: number
  uniqueRequested: number
  updated: number
  missing: number
  enabledAfterApply: boolean
  monitors: MonitorRecord[]
}

export type RulePreset = {
  id: number
  name: string
  expression: string
  createdAt: string | number
  updatedAt: string | number
}

export type Notification = {
  id: number
  monitorId: number | null
  type: string
  title: string
  content: string
  read: boolean
  createdAt: string | number
}

export type AdminUser = {
  id: number
  username: string
}

export type TokenSetting = {
  configured: boolean
  maskedToken: string
  source: 'database' | 'environment' | 'none'
  validated?: boolean
}

/** 系统设置中的自动价格检测计划。 */
export type PriceCheckScheduleSetting = {
  enabled: boolean
  timezone: string
  times: string[]
  lastRun: {
    scheduledAt: string
    triggeredAt: string
    enqueued: number
  } | null
  /** 按 schedule.timezone 格式化后的上次计划时间。 */
  lastRunLocal: string | null
  /** 按 schedule.timezone 计算出的下一次本地计划时间。 */
  nextRunLocal: string | null
}

export type CheckResult = {
  monitorId: number
  status: Monitor['lastStatus']
  checkedAt: string
  error?: string
  official?: {
    name: string
    price: number
    url: string
  }
  own?: {
    name: string
    price: number
    url: string
  }
}

type Envelope<T> = {
  success: boolean
  data: T
  message?: string
}

/**
 * 页面层只需要捕获 ApiError，不需要理解 HTTP Response 的细节。
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

/**
 * 统一请求入口。
 *
 * credentials=same-origin 让 HttpOnly Session Cookie 自动随请求发送；
 * 后端所有业务响应都使用 { success, data, message } envelope。
 */
async function req<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  const text = await response.text()
  let body: Envelope<T> | null = null

  try {
    body = text ? (JSON.parse(text) as Envelope<T>) : null
  } catch {
    throw new ApiError(
      `接口返回非 JSON（HTTP ${response.status}）`,
      response.status,
    )
  }

  if (!response.ok || !body?.success) {
    throw new ApiError(
      body?.message || `请求失败（HTTP ${response.status}）`,
      response.status,
    )
  }

  return body.data
}

/** 创建 JSON 请求配置，避免每个 API 方法重复 JSON.stringify。 */
function json(method: string, value?: unknown): RequestInit {
  return {
    method,
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }
}

export const api = {
  // -------------------- Authentication --------------------
  login: (value: { username: string; password: string }) =>
    req<AdminUser>('/api/auth/login', json('POST', value)),

  me: () => req<AdminUser>('/api/auth/me'),

  logout: () => req<boolean>('/api/auth/logout', json('POST')),

  updateAccount: (value: {
    currentPassword: string
    username?: string
    newPassword?: string
  }) => req<AdminUser>('/api/auth/account', json('PATCH', value)),

  // -------------------- Brands --------------------
  brands: () => req<Brand[]>('/api/brands'),

  createBrand: (value: { name: string; note?: string | null }) =>
    req<Brand>('/api/brands', json('POST', value)),

  updateBrand: (
    id: number,
    value: Partial<Pick<Brand, 'name' | 'note' | 'enabled'>>,
  ) => req<Brand>(`/api/brands/${id}`, json('PATCH', value)),

  deleteBrand: (id: number) =>
    req<boolean>(`/api/brands/${id}`, json('DELETE')),

  // -------------------- Suppliers --------------------
  suppliers: () => req<Supplier[]>('/api/suppliers'),

  createSupplier: (value: {
    name: string
    shopName?: string | null
    shopUrl?: string | null
    note?: string | null
  }) => req<Supplier>('/api/suppliers', json('POST', value)),

  updateSupplier: (
    id: number,
    value: Partial<Omit<Supplier, 'id'>>,
  ) => req<Supplier>(`/api/suppliers/${id}`, json('PATCH', value)),

  deleteSupplier: (id: number) =>
    req<boolean>(`/api/suppliers/${id}`, json('DELETE')),

  // -------------------- Products --------------------
  products: () => req<Product[]>('/api/products'),

  createProduct: (value: {
    brandId: number
    supplierId?: number | null
    name: string
    supplierProductUrl?: string | null
    note?: string | null
  }) => req<Product>('/api/products', json('POST', value)),

  updateProduct: (
    id: number,
    value: Partial<{
      brandId: number
      supplierId: number | null
      name: string
      supplierProductUrl: string | null
      note: string | null
      enabled: boolean
    }>,
  ) => req<Product>(`/api/products/${id}`, json('PATCH', value)),

  deleteProduct: (id: number) =>
    req<boolean>(`/api/products/${id}`, json('DELETE')),

  // -------------------- Listing / SKU --------------------
  listings: (productId?: number) =>
    req<Listing[]>(
      productId ? `/api/listings?productId=${productId}` : '/api/listings',
    ),

  skus: (listingId: number) =>
    req<ListingSku[]>(`/api/listings/${listingId}/skus`),

  importListing: (value: {
    productId: number
    role: 'official' | 'own'
    content: string
  }) =>
    req<{ listingId: number; skuCount: number; skus: ListingSku[] }>(
      '/api/listings/import',
      json('POST', value),
    ),

  updateListing: (id: number, value: { enabled?: boolean }) =>
    req<Listing>(`/api/listings/${id}`, json('PATCH', value)),

  deleteListing: (id: number) =>
    req<boolean>(`/api/listings/${id}`, json('DELETE')),

  updateSku: (id: number, value: { enabled: boolean }) =>
    req<ListingSku>(`/api/listings/skus/${id}`, json('PATCH', value)),

  // -------------------- Monitors --------------------
  monitors: () => req<Monitor[]>('/api/monitors'),

  createMonitor: (value: MonitorPairInput & { ruleExpression: string }) =>
    req<MonitorRecord>('/api/monitors', json('POST', value)),

  /**
   * 兼容旧流程：创建时就同时写入规则。
   * 新版管理端主要使用 createMonitorMappingsBatch + applyMonitorRuleBatch。
   */
  createMonitorsBatch: (value: {
    pairs: MonitorPairInput[]
    ruleExpression: string
    enabled?: boolean
  }) =>
    req<MonitorBatchCreateResult>(
      '/api/monitors/batch',
      json('POST', value),
    ),

  /**
   * 只保存官方 SKU -> 自店 SKU 的映射，不在这里选择价格规则。
   * 新建映射默认停用，等用户在列表中勾选后统一应用规则。
   */
  createMonitorMappingsBatch: (value: { pairs: MonitorPairInput[] }) =>
    req<MonitorBatchCreateResult>(
      '/api/monitors/mappings/batch',
      json('POST', value),
    ),

  /** 给列表里勾选的多条 Monitor 统一应用一条规则。 */
  applyMonitorRuleBatch: (value: {
    monitorIds: number[]
    ruleExpression: string
    enableAfterApply?: boolean
  }) =>
    req<MonitorBatchRuleResult>(
      '/api/monitors/batch-rule',
      json('PATCH', value),
    ),

  updateMonitor: (
    id: number,
    value: { enabled?: boolean; ruleExpression?: string },
  ) => req<Monitor>(`/api/monitors/${id}`, json('PATCH', value)),

  deleteMonitor: (id: number) =>
    req<boolean>(`/api/monitors/${id}`, json('DELETE')),

  check: (id: number) =>
    req<CheckResult>(`/api/monitors/${id}/check`, json('POST')),

  checkAll: () =>
    req<{ enqueued: number }>('/api/monitors/check-all', json('POST')),

  // -------------------- Rule presets --------------------
  rulePresets: () => req<RulePreset[]>('/api/rule-presets'),

  createRulePreset: (value: { name: string; expression: string }) =>
    req<RulePreset>('/api/rule-presets', json('POST', value)),

  updateRulePreset: (
    id: number,
    value: { name?: string; expression?: string },
  ) => req<RulePreset>(`/api/rule-presets/${id}`, json('PATCH', value)),

  deleteRulePreset: (id: number) =>
    req<boolean>(`/api/rule-presets/${id}`, json('DELETE')),

  // -------------------- Notifications --------------------
  notifications: () => req<Notification[]>('/api/notifications'),

  unreadCount: () =>
    req<{ count: number }>('/api/notifications/unread-count'),

  readNotification: (id: number) =>
    req<Notification>(`/api/notifications/${id}/read`, json('PATCH')),

  readAllNotifications: () =>
    req<boolean>('/api/notifications/read-all', json('POST')),

  deleteNotification: (id: number) =>
    req<boolean>(`/api/notifications/${id}`, json('DELETE')),

  // -------------------- Settings --------------------
  tokenSetting: () => req<TokenSetting>('/api/settings/miaomiaozhe'),

  saveToken: (token: string, validationUrl?: string) =>
    req<TokenSetting>(
      '/api/settings/miaomiaozhe',
      json('PUT', { token, validationUrl }),
    ),

  priceCheckSchedule: () =>
    req<PriceCheckScheduleSetting>('/api/settings/price-check-schedule'),

  savePriceCheckSchedule: (value: {
    enabled: boolean
    timezone: string
    times: string[]
  }) =>
    req<PriceCheckScheduleSetting>(
      '/api/settings/price-check-schedule',
      json('PUT', value),
    ),
}
