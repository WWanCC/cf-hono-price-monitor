# v1.3.1

- 修复喵喵折 Token 保存时始终 HTTP 404 的验证问题。
- 移除未确认存在的 `/api/zero/me` 校验。
- Token 验证只使用已经实际验证可用的 `offer/detail` 与 `parseClipboard` 链路。
- 已有 Listing / SKU 时自动选择样本验证。
- 全新数据库首次配置时，可在系统设置额外粘贴一个淘宝 / 天猫商品链接完成验证。
- 验证失败不会覆盖当前已保存 Token。
