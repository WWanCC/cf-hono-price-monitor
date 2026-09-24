# v1.4.0

## Added
- Brand/Supplier/Product/Listing/Monitor CRUD 补齐。
- 前端编辑、停用/启用、删除按钮与危险操作确认。
- Listing/SKU 状态管理。
- 统一 Hono `onError` JSON 响应。
- 公共 ID 参数解析工具。

## Fixed
- Cloudflare Workers PBKDF2 150000 次运行失败，调整为 100000。
- `.dev.vars` 被错误提交的问题。
- Listing 重导入后旧 SKU 仍保持启用的问题。
- 前后端能力不一致：后端已有 PATCH 但前端无调用入口。

## Notes
- 本版不新增数据库表，沿用现有 D1 Schema 与 migration 历史。
