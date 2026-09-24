# v1.6.1 Validation

本文件记录生成包内已经执行的检查，以及当前容器无法完成的检查。

## 已完成

- TypeScript 5.8 parser 对全部 `.ts` 和 Vue `<script setup lang="ts">` 做语法解析：通过（37 个脚本单元）。
- `package.json`、`wrangler.jsonc`、`wrangler.dev.jsonc`、`PROJECT-MANIFEST.json` JSON 解析：通过。
- 0000 ~ 0003 D1 migration 在 SQLite 内存库按顺序执行：通过。
- 检查 `scheduled()` 参数链路：`createDb(env.DB)` -> `dispatchScheduledPriceChecks(db, env.PRICE_CHECK_QUEUE, scheduledAt)`。
- 检查 `cron_tick` / `cron_result` 日志均存在。
- 检查生产 `wrangler.jsonc`：Cron 为 `* * * * *`，D1 / Queue / Assets 绑定保留，Workers Logs observability 已启用。
- 检查本地 `dev`：包含 `--test-scheduled --persist-to .wrangler/state`。
- 检查 `db:migrate:local`：使用同一 `.wrangler/state` 持久化目录。
- 检查 Settings 页：10 秒仅刷新运行状态，不覆盖用户尚未保存的计划编辑。
- 检查 Monitor 页：10 秒刷新 Monitor；批量选择、编辑、新建时暂停；新增“最近检测”列。

## 已在线实测的前序链路

用户在 v1.6.0 修正 `scheduled()` 参数后，Cloudflare `wrangler tail` 已观察到：

```text
cron_tick
cron_result matched=true enqueued=2
Queue price-monitor-checks (2 messages)
queue_check monitorId=3 status=violation
queue_check monitorId=4 status=violation
```

因此 v1.6.1 保留同一正确的 Scheduler -> Queue -> checkMonitor 调用方式，并补齐前端状态同步。

## 当前环境未完成

当前生成容器无法解析 `registry.npmjs.org`，因此无法在这里执行：

```text
pnpm install
pnpm build:web
wrangler dev
wrangler deploy
```

请在本机解压后执行：

```powershell
pnpm install
pnpm build:web
```

生产部署前再执行：

```powershell
pnpm --filter api db:migrate:remote
pnpm deploy
```

## 依赖锁文件

本生成包没有重新生成 `pnpm-lock.yaml`，因为当前容器无法访问 npm registry。依赖版本范围没有从 v1.6.0 改动；第一次解压请执行 `pnpm install` 生成/更新锁文件。正式纳入 Git 仓库后建议提交该锁文件。
