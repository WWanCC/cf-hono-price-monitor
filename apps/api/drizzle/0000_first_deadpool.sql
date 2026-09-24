-- 业务主表迁移：品牌、厂家、商品、Listing、SKU 和 Monitor。
CREATE TABLE `brands` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `note` text,
  `enabled` integer DEFAULT true NOT NULL,
  `createdAt` integer DEFAULT (unixepoch()) NOT NULL,
  `updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_name_unique` ON `brands` (`name`);
--> statement-breakpoint
CREATE TABLE `suppliers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `shop_name` text,
  `shop_url` text,
  `note` text,
  `enabled` integer DEFAULT true NOT NULL,
  `createdAt` integer DEFAULT (unixepoch()) NOT NULL,
  `updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `suppliers_name_idx` ON `suppliers` (`name`);
--> statement-breakpoint
CREATE TABLE `products` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `brand_id` integer NOT NULL,
  `supplier_id` integer,
  `name` text NOT NULL,
  `supplier_product_url` text,
  `note` text,
  `enabled` integer DEFAULT true NOT NULL,
  `createdAt` integer DEFAULT (unixepoch()) NOT NULL,
  `updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `products_brand_id_idx` ON `products` (`brand_id`);
--> statement-breakpoint
CREATE INDEX `products_supplier_id_idx` ON `products` (`supplier_id`);
--> statement-breakpoint
CREATE TABLE `listings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `product_id` integer NOT NULL,
  `role` text NOT NULL,
  `platform` text NOT NULL,
  `external_item_id` text NOT NULL,
  `title` text,
  `shop_name` text,
  `url` text NOT NULL,
  `price_provider` text DEFAULT 'miaomiaozhe' NOT NULL,
  `provider_ref` text,
  `enabled` integer DEFAULT true NOT NULL,
  `createdAt` integer DEFAULT (unixepoch()) NOT NULL,
  `updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `listings_role_check` CHECK(`role` in ('official', 'own'))
);
--> statement-breakpoint
CREATE INDEX `listings_product_id_idx` ON `listings` (`product_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_platform_item_unique` ON `listings` (`platform`,`external_item_id`);
--> statement-breakpoint
CREATE TABLE `listing_skus` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `listing_id` integer NOT NULL,
  `external_sku_id` text NOT NULL,
  `name` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `createdAt` integer DEFAULT (unixepoch()) NOT NULL,
  `updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listing_skus_listing_id_idx` ON `listing_skus` (`listing_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_skus_listing_sku_unique` ON `listing_skus` (`listing_id`,`external_sku_id`);
--> statement-breakpoint
CREATE TABLE `monitors` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `reference_sku_id` integer NOT NULL,
  `target_sku_id` integer NOT NULL,
  `rule_expression` text DEFAULT 'own >= official' NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `last_status` text DEFAULT 'pending' NOT NULL,
  `last_checked_at` integer,
  `last_error` text,
  `createdAt` integer DEFAULT (unixepoch()) NOT NULL,
  `updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`reference_sku_id`) REFERENCES `listing_skus`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`target_sku_id`) REFERENCES `listing_skus`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `monitors_different_skus_check` CHECK(`reference_sku_id` <> `target_sku_id`),
  CONSTRAINT `monitors_last_status_check` CHECK(`last_status` in ('pending','normal','violation','fetch_error'))
);
--> statement-breakpoint
CREATE INDEX `monitors_reference_sku_id_idx` ON `monitors` (`reference_sku_id`);
--> statement-breakpoint
CREATE INDEX `monitors_target_sku_id_idx` ON `monitors` (`target_sku_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitors_pair_unique` ON `monitors` (`reference_sku_id`,`target_sku_id`);
