# Review Fixes / Current Baseline

本文件汇总从 v1.4 起已经完成的代码审查修复，以及 v1.6.0 新增的维护性改动。

## 已完成

1. Cloudflare Workers PBKDF2 iteration 调整为 `100000`。
2. `.dev.vars` 从版本控制排除，只保留 `.dev.vars.example`。
3. Brand / Supplier / Product / Listing / Monitor CRUD 补全。
4. 前端 API 与后端 PATCH / DELETE 能力对齐。
5. Brand 删除前检查 Product 引用。
6. Listing 重导入时自动停用已经消失的旧 SKU。
7. 全局 `app.onError` 统一 500 响应。
8. 正整数 URL 参数解析逻辑抽取复用。
9. Auth Context 类型收紧，减少 `any`。
10. 过期 Session 定期清理。
11. 结构化请求 / Queue / Cron 日志。
12. 巨型 `App.vue` 拆分成业务页面。
13. SKU 映射与规则配置拆成两个运营阶段。
14. Monitor 支持列表多选后批量应用规则。
15. 批量 D1 SQL 分块，降低 bound parameter 超限风险。
16. 自动检测计划从部署期固定 Cron 解耦为 D1 可配置业务计划。
17. 自动检测增加 IANA timezone 支持和同分钟幂等保护。
18. 每分钟 Cron 下，Session 清理降为每日执行，避免无意义高频 DELETE。
19. 新增代码继续保持职责说明、约束说明和“为什么这样做”的维护注释。

## 当前仍可继续增强

- 自动化测试矩阵 / CI；
- 登录失败频率限制与安全审计表；
- 大数据量分页 / cursor；
- Listing 导入更强的原子一致性；
- 前端按路由懒加载，进一步降低首屏 bundle；
- 自动检测计划未来如需“按星期”“节假日”“不同 Monitor 不同计划”，应升级为独立 schedule 表，而不是继续堆叠单个 JSON。


## v1.6.1 追加修复

- 自动调度 service 调用参数契约明确为 Drizzle DB + Queue + Date。
- Cron 每次调用与调度结果都有结构化日志。
- Workers Logs 在生产配置中开启。
- 本地 Scheduled 测试和 D1 persist path 固定。
- 前端增加自动运行状态轮询和最近检测时间列。
