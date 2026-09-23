/**
 * D1 的单一数据模型定义。
 *
 * 表结构、字段类型、索引和部分约束都在这里声明；Drizzle migration 文件是把
 * 这些变化应用到真实数据库的历史记录，两者需要保持同步。
 */
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// Drizzle 的 timestamp mode 会在 TypeScript 中使用 Date，同时在 SQLite 中保存 Unix 秒。
const timestamp = () =>
  integer({ mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`)

// 品牌和商品是业务主数据；enabled 是逻辑停用标记，不等同于删除。
export const brands = sqliteTable(
  'brands',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    note: text('note'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: timestamp(),
    updatedAt: timestamp().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('brands_name_unique').on(table.name),
  ],
)

export const suppliers = sqliteTable(
  'suppliers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    shopName: text('shop_name'),
    shopUrl: text('shop_url'),
    note: text('note'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: timestamp(),
    updatedAt: timestamp().$onUpdate(() => new Date()),
  },
  (table) => [
    index('suppliers_name_idx').on(table.name),
  ],
)

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    brandId: integer('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    supplierId: integer('supplier_id')
      .references(() => suppliers.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    supplierProductUrl: text('supplier_product_url'),
    note: text('note'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: timestamp(),
    updatedAt: timestamp().$onUpdate(() => new Date()),
  },
  (table) => [
    index('products_brand_id_idx').on(table.brandId),
    index('products_supplier_id_idx').on(table.supplierId),
  ],
)

// 一个 Listing 代表某个平台上的商品页面；role 区分官方参考价和自店售价。
export const listings = sqliteTable(
  'listings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['official', 'own'] }).notNull(),
    platform: text('platform').notNull(),
    externalItemId: text('external_item_id').notNull(),
    title: text('title'),
    shopName: text('shop_name'),
    url: text('url').notNull(),
    priceProvider: text('price_provider').notNull().default('miaomiaozhe'),
    providerRef: text('provider_ref'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: timestamp(),
    updatedAt: timestamp().$onUpdate(() => new Date()),
  },
  (table) => [
    index('listings_product_id_idx').on(table.productId),
    uniqueIndex('listings_platform_item_unique').on(
      table.platform,
      table.externalItemId,
    ),
    check(
      'listings_role_check',
      sql`${table.role} in ('official', 'own')`,
    ),
  ],
)

export const listingSkus = sqliteTable(
  'listing_skus',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    listingId: integer('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    externalSkuId: text('external_sku_id').notNull(),
    name: text('name').notNull(),
    providerRef: text('provider_ref'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: timestamp(),
    updatedAt: timestamp().$onUpdate(() => new Date()),
  },
  (table) => [
    index('listing_skus_listing_id_idx').on(table.listingId),
    uniqueIndex('listing_skus_listing_sku_unique').on(
      table.listingId,
      table.externalSkuId,
    ),
  ],
)

// Monitor 只保存两侧 SKU 的关系和最近一次检测结果，实时价格仍从喵喵折读取。
export const monitors = sqliteTable(
  'monitors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    referenceSkuId: integer('reference_sku_id')
      .notNull()
      .references(() => listingSkus.id, { onDelete: 'cascade' }),
    targetSkuId: integer('target_sku_id')
      .notNull()
      .references(() => listingSkus.id, { onDelete: 'cascade' }),
    ruleExpression: text('rule_expression')
      .notNull()
      .default('own >= official'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastStatus: text('last_status', {
      enum: ['pending', 'normal', 'violation', 'fetch_error'],
    }).notNull().default('pending'),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
    lastError: text('last_error'),
    createdAt: timestamp(),
    updatedAt: timestamp().$onUpdate(() => new Date()),
  },
  (table) => [
    index('monitors_reference_sku_id_idx').on(table.referenceSkuId),
    index('monitors_target_sku_id_idx').on(table.targetSkuId),
    uniqueIndex('monitors_pair_unique').on(
      table.referenceSkuId,
      table.targetSkuId,
    ),
    check(
      'monitors_different_skus_check',
      sql`${table.referenceSkuId} <> ${table.targetSkuId}`,
    ),
    check(
      'monitors_last_status_check',
      sql`${table.lastStatus} in ('pending','normal','violation','fetch_error')`,
    ),
  ],
)

//
// 常用价格规则
//
export const rulePresets = sqliteTable(
  'rule_presets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    expression: text('expression').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex('rule_presets_name_unique').on(table.name),
  ],
)

//
// 管理端设置（喵喵折 Token 等）
//
export const appSettings = sqliteTable(
  'app_settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
)

//
// 管理员账号
//
export const adminUsers = sqliteTable(
  'admin_users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex('admin_users_username_unique').on(table.username),
  ],
)

// 数据库只保存 sessionHash，不保存浏览器拿到的原始 Session Token。
export const adminSessions = sqliteTable(
  'admin_sessions',
  {
    sessionHash: text('session_hash').primaryKey(),
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('admin_sessions_user_idx').on(table.adminUserId),
    index('admin_sessions_expires_idx').on(table.expiresAt),
  ],
)

//
// 站内信：仅在价格违规状态首次出现时创建
//
export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    monitorId: integer('monitor_id').references(() => monitors.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull().default('violation'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    read: integer('read', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('notifications_monitor_idx').on(table.monitorId),
    index('notifications_read_idx').on(table.read),
  ],
)
