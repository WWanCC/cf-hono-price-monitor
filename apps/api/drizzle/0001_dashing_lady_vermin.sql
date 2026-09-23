-- 为已有 SKU 补充第三方服务引用，检测实时价格时使用该 provider_ref。
ALTER TABLE `listing_skus`
ADD COLUMN `provider_ref` text;
