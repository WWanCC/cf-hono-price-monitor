# 代码维护说明（v1.6.0）

## 推荐阅读顺序

1. `apps/api/src/db/schema.ts`：理解实体、外键和删除关系。
2. `apps/api/src/index.ts`：理解 HTTP / Cron / Queue 三类 Worker 入口。
3. `apps/api/src/services/price-check-schedule.ts`：理解自动检测计划与时区换算。
4. `apps/api/src/services/monitor-scheduler.ts`：理解 Cron 如何决定是否投递 Queue。
5. `apps/api/src/routes/*`：HTTP 参数校验、状态码和响应格式。
6. `apps/api/src/services/*`：业务逻辑。
7. `apps/web/src/api.ts`：前端与后端之间的唯一请求入口。
8. `apps/web/src/pages/*`：各管理页面。

## 自动检测计划的分层

v1.6.0 不再把真实业务检测时间写死在 `wrangler.jsonc`。

### 第一层：Cloudflare Cron

```json
{
  "triggers": {
    "crons": ["* * * * *"]
  }
}
```

它只负责每分钟唤醒 Worker。

### 第二层：D1 业务计划

计划保存在既有 `app_settings`：

```text
key = price_check_schedule
```

示例值：

```json
{
  "enabled": true,
  "timezone": "Asia/Shanghai",
  "times": ["09:00", "15:00", "21:00"]
}
```

真正的判断逻辑位于：

```text
apps/api/src/services/price-check-schedule.ts
apps/api/src/services/monitor-scheduler.ts
```

如果当前分钟没有命中计划，只读一次配置就结束，不会调用喵喵折。

### 为什么不让管理端直接修改 Cloudflare Cron

因为 Cloudflare Cron 属于部署配置。让普通管理端直接改部署配置会引入：

- Cloudflare API Token 权限管理；
- 配置发布延迟；
- 开发 / 生产配置漂移；
- 修改检测时间却必须操作部署资源。

当前设计把“基础唤醒频率”和“业务检测时间”解耦，修改 D1 后即可生效。

## 上次 / 下次自动检测

`price_check_schedule_last_run` 保存最近一次命中的 Cron：

```json
{
  "scheduledAt": "2026-09-24T13:00:00.000Z",
  "triggeredAt": "2026-09-24T13:00:01.234Z",
  "enqueued": 38
}
```

它还有一个作用：**幂等保护**。同一个 UTC 分钟如果被重复触发，不会重复投递同一批 Monitor。

设置页显示的“上次 / 下次自动检测”按计划自己的 `timezone` 展示，而不是按浏览器本地时区猜测。

## Monitor 的两阶段模型

管理端把 Monitor 操作拆成两个阶段，但数据库仍复用同一张 `monitors` 表。

### 阶段 1：SKU 映射

`MonitorsPage.vue` 只负责选择逻辑商品、官方 SKU、自店 SKU 和配对方式。

配对纯逻辑在：

```text
apps/web/src/monitor-pairing.ts
```

页面最终调用：

```text
POST /api/monitors/mappings/batch
```

后端新记录保存为：

```text
ruleExpression = ''
enabled = false
```

空规则表示“只完成映射，尚未配置规则”；停用保证 Cron/Queue 不会提前检测。

### 阶段 2：批量应用规则

用户在价格监控表格勾选多行，然后选择一条常用规则。

页面调用：

```text
PATCH /api/monitors/batch-rule
```

后端负责去重 ID、验证表达式、分块 UPDATE，并可选地同时启用 Monitor。

## 为什么批量 SQL 要分块

Cloudflare D1 对单条 SQL 的 bound parameters 有上限。

- 批量创建 Monitor 每行绑定多个值，因此 INSERT 按较小批次执行；
- 批量规则更新包含表达式、enabled 和多个 id，因此 ID 分块处理。

不要为了缩短代码把这些分块重新合成一条超大的 SQL。

## 前后端校验边界

前端校验只用于更早给用户反馈，不能作为数据安全边界。

后端仍必须验证：

- SKU 是否存在；
- reference 是否属于 official Listing；
- target 是否属于 own Listing；
- 两侧 SKU 是否属于同一逻辑商品；
- Product / Listing / SKU 是否处于启用状态；
- 价格规则是否能解析为 boolean；
- 未配置规则的 Monitor 不允许直接启用；
- 自动检测时区必须是有效 IANA timezone；
- 自动检测时间必须符合 `HH:mm`。

## 维护约定

- 页面不要直接 `fetch`，统一在 `apps/web/src/api.ts` 增加方法。
- HTTP 路由不要复制复杂业务校验，优先下沉到 `services/`。
- 批量操作优先返回汇总数量，让 UI 清楚反馈 created / skipped / updated。
- 删除遵循 `schema.ts` 的外键策略，不要在 UI 中假设级联关系。
- 新增数据库字段后先修改 `schema.ts`，再生成新的 migration；不要修改已经在线上执行过的历史 migration。
- 单一全局配置优先评估是否可以继续复用 `app_settings`，不要为了一个 JSON 配置轻易新增表。
- `.dev.vars`、Token、生产密码不得提交版本库。
- 注释重点解释“为什么这样设计”、业务约束和副作用，不逐行翻译代码。


## v1.6.1：异步任务的前端同步

Cron 和 Queue 都发生在浏览器之外，服务端即使已经更新 D1，Vue 页面也不会被动收到通知。当前采用 10 秒轻量轮询而不是 WebSocket：管理后台规模较小、状态变化频率低，这种方案更简单且容易维护。轮询只获取必要资源，并在用户批量勾选或编辑时暂停，避免打断操作。

调度入口必须保持明确的参数边界：`dispatchScheduledPriceChecks(db, queue, scheduledAt)`。`env.DB` 需要先经过 `createDb()` 转换成 Drizzle Database，不能直接把 `env` 作为数据库参数传入。
