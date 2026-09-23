/**
 * 浏览器端 API 客户端和后端响应类型。
 *
 * 页面只调用这里暴露的方法，不直接拼 fetch；这样 Cookie、JSON 解析、业务错误转换
 * 和端点路径集中在一个地方，后端返回错误时页面可以统一接收 ApiError。
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

export type CheckResult = {
  monitorId: number
  status: Monitor['lastStatus']
  ruleExpression?: string
  checkedAt: string
  error?: string
  official?: {
    skuId: number
    externalSkuId: string
    name: string
    price: number
    url: string
  }
  own?: {
    skuId: number
    externalSkuId: string
    name: string
    price: number
    url: string
  }
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

// 所有管理端响应都遵循 success/data/message envelope；错误也可能只有 message。
type Envelope<T> = {
  success: boolean
  data: T
  message?: string
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// 页面调用的统一入口：带上同源 Cookie，解析 JSON，并把 HTTP/业务失败转换为 ApiError。
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
    body = text ? JSON.parse(text) : null
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

// 按资源分组暴露端点，组件不需要重复拼接 URL 或设置 JSON 请求头。
export const api = {
  health: async () => {
    const response = await fetch('/api/health')
    if (!response.ok) {
      throw new Error(`API 不可用（HTTP ${response.status}）`)
    }
    return response.json() as Promise<{ success: boolean; message: string }>
  },

  login: (value: { username: string; password: string }) =>
    req<AdminUser>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(value),
    }),

  me: () => req<AdminUser>('/api/auth/me'),

  logout: () =>
    req<boolean>('/api/auth/logout', {
      method: 'POST',
    }),

  updateAccount: (value: {
    currentPassword: string
    username?: string
    newPassword?: string
  }) =>
    req<AdminUser>('/api/auth/account', {
      method: 'PATCH',
      body: JSON.stringify(value),
    }),

  brands: () => req<Brand[]>('/api/brands'),
  createBrand: (value: { name: string; note?: string }) =>
    req<Brand>('/api/brands', {
      method: 'POST',
      body: JSON.stringify(value),
    }),

  suppliers: () => req<Supplier[]>('/api/suppliers'),
  createSupplier: (value: {
    name: string
    shopName?: string | null
    shopUrl?: string | null
    note?: string | null
  }) =>
    req<Supplier>('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(value),
    }),

  products: () => req<Product[]>('/api/products'),
  createProduct: (value: {
    brandId: number
    supplierId?: number | null
    name: string
    supplierProductUrl?: string | null
    note?: string | null
  }) =>
    req<Product>('/api/products', {
      method: 'POST',
      body: JSON.stringify(value),
    }),

  listings: (productId: number) =>
    req<Listing[]>(`/api/listings?productId=${productId}`),

  skus: (listingId: number) =>
    req<ListingSku[]>(`/api/listings/${listingId}/skus`),

  importListing: (value: {
    productId: number
    role: 'official' | 'own'
    content: string
  }) =>
    req<{ listingId: number; skuCount: number; skus: ListingSku[] }>(
      '/api/listings/import',
      {
        method: 'POST',
        body: JSON.stringify(value),
      },
    ),

  monitors: () => req<Monitor[]>('/api/monitors'),

  createMonitor: (value: {
    referenceSkuId: number
    targetSkuId: number
    ruleExpression: string
  }) =>
    req<Monitor>('/api/monitors', {
      method: 'POST',
      body: JSON.stringify(value),
    }),

  rulePresets: () =>
    req<RulePreset[]>('/api/rule-presets'),

  createRulePreset: (value: {
    name: string
    expression: string
  }) =>
    req<RulePreset>('/api/rule-presets', {
      method: 'POST',
      body: JSON.stringify(value),
    }),

  updateRulePreset: (
    id: number,
    value: {
      name?: string
      expression?: string
    },
  ) =>
    req<RulePreset>(`/api/rule-presets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(value),
    }),

  deleteRulePreset: (id: number) =>
    req<boolean>(`/api/rule-presets/${id}`, {
      method: 'DELETE',
    }),

  check: (id: number) =>
    req<CheckResult>(`/api/monitors/${id}/check`, {
      method: 'POST',
    }),

  checkAll: () =>
    req<{ enqueued: number }>('/api/monitors/check-all', {
      method: 'POST',
    }),

  updateMonitor: (
    id: number,
    value: { enabled?: boolean; ruleExpression?: string },
  ) =>
    req<Monitor>(`/api/monitors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(value),
    }),

  tokenSetting: () =>
    req<TokenSetting>('/api/settings/miaomiaozhe'),

  saveToken: (token: string, validationUrl?: string) =>
    req<TokenSetting>('/api/settings/miaomiaozhe', {
      method: 'PUT',
      body: JSON.stringify({ token, validationUrl }),
    }),

  notifications: () =>
    req<Notification[]>('/api/notifications'),

  unreadCount: () =>
    req<{ count: number }>('/api/notifications/unread-count'),

  readNotification: (id: number) =>
    req<Notification>(`/api/notifications/${id}/read`, {
      method: 'PATCH',
    }),

  readAllNotifications: () =>
    req<boolean>('/api/notifications/read-all', {
      method: 'POST',
    }),
}
