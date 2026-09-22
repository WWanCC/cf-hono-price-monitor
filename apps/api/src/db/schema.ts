import {sql} from 'drizzle-orm'
import {
    check,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const timestamp = () =>
    integer({mode: 'timestamp'})
        .notNull()
        .default(sql`(unixepoch()
                     )`)

//
// 品牌
//

export const brands = sqliteTable(
    'brands',
    {
        id: integer('id').primaryKey({autoIncrement: true}),

        name: text('name').notNull(),
        note: text('note'),

        enabled: integer('enabled', {mode: 'boolean'})
            .notNull()
            .default(true),

        createdAt: timestamp(),
        updatedAt: timestamp().$onUpdate(() => new Date()),
    },
    (table) => [
        uniqueIndex('brands_name_unique').on(table.name),
    ],
)

//
// 上游厂家
//

export const suppliers = sqliteTable(
    'suppliers',
    {
        id: integer('id').primaryKey({autoIncrement: true}),

        name: text('name').notNull(),

        // 1688店铺名称
        shopName: text('shop_name'),

        // 1688厂家/店铺首页
        shopUrl: text('shop_url'),

        note: text('note'),

        enabled: integer('enabled', {mode: 'boolean'})
            .notNull()
            .default(true),

        createdAt: timestamp(),
        updatedAt: timestamp().$onUpdate(() => new Date()),
    },
    (table) => [
        index('suppliers_name_idx').on(table.name),
    ],
)

//
// 我们系统中的逻辑商品
//

export const products = sqliteTable(
    'products',
    {
        id: integer('id').primaryKey({autoIncrement: true}),

        brandId: integer('brand_id')
            .notNull()
            .references(() => brands.id, {
                onDelete: 'restrict',
            }),

        supplierId: integer('supplier_id')
            .references(() => suppliers.id, {
                onDelete: 'set null',
            }),

        name: text('name').notNull(),

        // 这个商品对应的1688具体货源链接
        supplierProductUrl: text('supplier_product_url'),

        note: text('note'),

        enabled: integer('enabled', {mode: 'boolean'})
            .notNull()
            .default(true),

        createdAt: timestamp(),
        updatedAt: timestamp().$onUpdate(() => new Date()),
    },
    (table) => [
        index('products_brand_id_idx').on(table.brandId),
        index('products_supplier_id_idx').on(table.supplierId),
    ],
)

//
// 淘宝/天猫的一条商品 Listing
//
// 例如：
// Kimpets官方旗舰店的某条淘宝商品
// 或
// 我们自己店里的某条淘宝商品
//

export const listings = sqliteTable(
    'listings',
    {
        id: integer('id').primaryKey({autoIncrement: true}),

        productId: integer('product_id')
            .notNull()
            .references(() => products.id, {
                onDelete: 'cascade',
            }),

        // official = 官方店
        // own      = 自己店铺
        role: text('role', {
            enum: ['official', 'own'],
        }).notNull(),

        // taobao / tmall
        //
        // 暂时不做数据库枚举限制，
        // 后面增加平台不用迁移数据库。
        platform: text('platform').notNull(),

        // 淘宝 itemId
        externalItemId: text('external_item_id').notNull(),

        title: text('title'),

        shopName: text('shop_name'),

        url: text('url').notNull(),

        // 当前使用什么价格数据提供方
        priceProvider: text('price_provider')
            .notNull()
            .default('miaomiaozhe'),

        // 喵喵折解析出来的 offer_unique_id 等引用
        //
        // 使用通用名字，避免数据库彻底绑定喵喵折。
        providerRef: text('provider_ref'),

        enabled: integer('enabled', {mode: 'boolean'})
            .notNull()
            .default(true),

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
            sql`${table.role}
            in ('official', 'own')`,
        ),
    ],
)

//
// 淘宝/天猫真实 SKU
//

export const listingSkus = sqliteTable(
    'listing_skus',
    {
        id: integer('id').primaryKey({autoIncrement: true}),

        listingId: integer('listing_id')
            .notNull()
            .references(() => listings.id, {
                onDelete: 'cascade',
            }),

        // 淘宝真实 skuId
        externalSkuId: text('external_sku_id').notNull(),

        //例如 红色 / M
        name: text('name').notNull(),

        // 喵喵折这个 SKU 对应的 offer_unique_id
        providerRef: text('provider_ref'),

        enabled: integer('enabled', {mode: 'boolean'})
            .notNull()
            .default(true),

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

//
// 价格监控关系
//

export const monitors = sqliteTable(
    'monitors',
    {
        id: integer('id').primaryKey({autoIncrement: true}),

        // 官方 SKU
        referenceSkuId: integer('reference_sku_id')
            .notNull()
            .references(() => listingSkus.id, {
                onDelete: 'cascade',
            }),

        // 自己店里的 SKU
        targetSkuId: integer('target_sku_id')
            .notNull()
            .references(() => listingSkus.id, {
                onDelete: 'cascade',
            }),

        //
        // 后续自己实现表达式解析器
        //
        // 例如：
        //
        // own >= official
        // own >= official * 0.95
        // own >= official - 5
        //
        ruleExpression: text('rule_expression')
            .notNull()
            .default('own >= official'),

        enabled: integer('enabled', {mode: 'boolean'})
            .notNull()
            .default(true),

        //
        // pending
        // normal
        // violation
        // fetch_error
        //
        lastStatus: text('last_status', {
            enum: [
                'pending',
                'normal',
                'violation',
                'fetch_error',
            ],
        })
            .notNull()
            .default('pending'),

        lastCheckedAt: integer('last_checked_at', {
            mode: 'timestamp',
        }),

        lastError: text('last_error'),

        createdAt: timestamp(),
        updatedAt: timestamp().$onUpdate(() => new Date()),
    },
    (table) => [
        index('monitors_reference_sku_id_idx').on(
            table.referenceSkuId,
        ),

        index('monitors_target_sku_id_idx').on(
            table.targetSkuId,
        ),

        uniqueIndex('monitors_pair_unique').on(
            table.referenceSkuId,
            table.targetSkuId,
        ),

        check(
            'monitors_different_skus_check',
            sql`${table.referenceSkuId}
            <>
            ${table.targetSkuId}`,
        ),

        check(
            'monitors_last_status_check',
            sql`${table.lastStatus}
            in (
        'pending',
        'normal',
        'violation',
        'fetch_error'
      )`,
        ),
    ],
)

