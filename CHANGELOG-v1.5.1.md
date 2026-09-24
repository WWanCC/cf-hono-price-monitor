# v1.5.1

## 价格监控工作流调整

- “新增监控”改为“新增 SKU 映射”。
- 新建映射阶段不再选择规则，只处理官方 SKU -> 自店 SKU 的对应关系。
- 新建映射保存为 `ruleExpression=''`、`enabled=false`，不会提前进入 Cron 检测。
- 价格监控表格增加多选复选框。
- 表格上方增加“常用规则”下拉框和“应用到已选”按钮。
- 支持一次给多条已勾选映射应用同一规则。
- 支持“应用后启用”，将批量规则写入与启用合并为一次操作。
- 未配置规则的行显示“未配置 / 待配置”，且不能直接启用或手动检测。

## 后端

- 新增 `POST /api/monitors/mappings/batch`：批量创建纯 SKU 映射。
- 新增 `PATCH /api/monitors/batch-rule`：批量应用规则。
- 后端禁止未配置规则的映射直接 `enabled=true`。
- 批量规则更新按 ID 分块，避免 D1 单条 SQL bound parameter 过多。
- 原 `POST /api/monitors/batch` 保留，用于兼容“创建时即带规则”的 API 调用。

## 数据库

- 无 Schema 变化。
- 无新增 migration。
