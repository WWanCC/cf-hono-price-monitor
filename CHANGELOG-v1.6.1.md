# v1.6.1

## 修复

- 修复自动调度调用 service 时必须传入 Drizzle `db`、Queue binding 和 `Date` 的参数契约，避免 `db.select is not a function`。
- `scheduled()` 每次 Cron 进入时输出 `cron_tick`，每次调度结束输出 `cron_result`，可以直接观察 `matched / localTime / enqueued`。
- 生产 `wrangler.jsonc` 默认启用 Workers Logs（100% head sampling），便于在 Cloudflare Observability 中排查自动任务。
- 本地 `dev` 增加 `--test-scheduled`，可通过 `/cdn-cgi/local/scheduled` 手动模拟 Cron。
- 本地 `dev` 与 `db:migrate:local` 统一指定 `--persist-to .wrangler/state`，避免本地 D1 持久化目录不一致。

## 前端

- 系统设置页每 10 秒自动刷新“上次自动检测 / 本次投递 / 下次自动检测”运行状态，不覆盖用户尚未保存的计划编辑。
- 价格监控页每 10 秒自动刷新 Monitor 状态和最近检测时间。
- 用户正在勾选批量规则、编辑 Monitor 或新建映射时暂停自动刷新，避免 selection 被刷新打断。
- “检测全部”提交 Queue 后 2.5 秒主动刷新一次，并继续由 10 秒轮询兜底。
- Monitor 表格新增“最近检测”列，使 Cron/Queue 的后台执行结果在前端可见。

## 数据库

- 无新增表、字段或 migration；继续使用 0000 ~ 0003。
