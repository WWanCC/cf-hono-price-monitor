# v1.3.0

本版针对管理端实际使用补了三项功能：

1. **SKU 链接**
   - 价格监控、概览最近监控、SKU 映射列表不再只显示数据库 ID。
   - 展示 SKU 名称、真实 `skuId`，并提供对应淘宝 / 天猫 SKU 链接。
   - 链接会根据平台、itemId、skuId 生成，点击可直接打开对应 SKU。

2. **喵喵折 Token 保存前验证**
   - “系统设置”按钮改为“验证并保存 Token”。
   - 验证失败不会覆盖 D1 中当前 Token。
   - 优先使用喵喵折登录态接口；若接口路径不可用，会在已有 SKU 场景下回退到真实 `offer/detail` 请求校验。

3. **自定义常用规则**
   - 新增 `rule_presets` 表与 CRUD API。
   - SKU 映射页可新增、编辑、删除常用规则，并一键套用。
   - 表达式仍使用安全规则解析器校验，不执行任意 JavaScript。

## 升级数据库

本地：

```powershell
pnpm --filter api db:migrate:local
```

生产：

```powershell
pnpm --filter api db:migrate:remote
```

新增 migration：`apps/api/drizzle/0003_rule_presets.sql`。
