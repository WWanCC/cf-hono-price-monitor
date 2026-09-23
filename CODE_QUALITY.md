# 项目代码质量评估与初学者指南

> 扫描范围：仓库中的手写业务代码、配置、数据库 Schema 和迁移文件。`node_modules`、`.wrangler`、缓存、构建产物及 source map 属于工具生成内容，不纳入业务质量评分，也不建议直接修改。

## 1. 项目是做什么的

这是一个淘宝/天猫 SKU 价格监控管理端，分为两个应用：

```text
浏览器
  │
  ├─ Vue 3 + Element Plus（apps/web）
  │       │ 本地 /api 由 Vite 代理到 9029 端口
  │       ▼
  └─ Hono Worker（apps/api）
          ├─ D1 + Drizzle：保存品牌、商品、Listing、SKU、监控和站内信
          ├─ 喵喵折：解析商品链接、读取 SKU 实时价格
          ├─ Queue：异步批量检测价格
          └─ Cron：每天按 UTC 01:00/07:00/13:00 发送检测任务
```

一次“检测全部”的完整链路是：

1. 前端调用 `POST /api/monitors/check-all`。
2. Hono 查询所有启用的 Monitor，并将 ID 分批写入 Cloudflare Queue。
3. Queue consumer 为每个 ID 调用 `checkMonitor`。
4. `checkMonitor` 读取两侧 SKU 的 `providerRef`，从喵喵折获取价格。
5. `evaluateRule` 计算自定义表达式。
6. 更新 Monitor 状态；只有从非违规变为违规时才创建站内信。

## 2. 总体评价

**结论：中等偏好，适合继续迭代的 MVP/内部管理系统。**

代码已经具备可部署的主流程，模块边界也比较容易辨认；但在自动化测试、统一错误处理、类型复用和大组件拆分方面还有明显提升空间。当前最需要优先补齐的是测试与边界保护，而不是继续增加页面功能。

| 维度 | 评价 | 依据 |
| --- | --- | --- |
| 可读性 | B | 文件职责大体清楚，但 `App.vue` 和 `style.css` 偏大；已有注释集中在少数业务节点。 |
| 类型安全 | B | 前端严格检查开启，API 多处使用 Zod；`auth.ts` 的 `currentAdmin(c: any)` 和部分环境变量强制类型转换会削弱约束。 |
| 架构 | B | 路由、服务、数据库层已分离；前端仍把多页面状态、动作和模板集中在一个组件中。 |
| 数据一致性 | B- | 外键、唯一索引、检查约束较完整；Listing 导入涉及 Listing 与 SKU 多次写入，当前没有显式事务边界说明。 |
| 安全性 | B- | PBKDF2、随机 salt、Session 哈希和 HttpOnly Cookie 做得正确；Token 按需求明文存 D1，且登录/管理接口缺少限流和 CSRF 防护说明。 |
| 错误处理 | B- | 常见业务错误有中文提示；缺少统一异常中间件，未捕获异常的响应格式和日志策略由运行时决定。 |
| 可测试性 | C | 未发现单元测试、集成测试或规则解析器测试；核心解析、规则、监控状态转换都适合优先测试。 |
| 性能与运维 | B- | 查询有索引、Queue 有批量发送与并发控制；通知轮询固定 30 秒，列表接口没有分页，日志未形成结构化观测方案。 |

## 3. 做得好的地方

### 后端与数据层

- `apps/api/src/index.ts` 用统一中间件保护管理 API，并明确放行健康检查和登录接口。
- `apps/api/src/db/schema.ts` 使用外键、唯一索引和 `check` 约束保护角色、状态和 SKU 配对关系。
- `apps/api/src/services/auth.ts` 不保存明文密码：密码通过 PBKDF2-SHA-256 和随机 salt 派生，浏览器 Cookie 只保存随机 Session Token，数据库保存 Token 的 SHA-256。
- 规则表达式由 `services/rule-expression.ts` 自己解析，不使用 `eval`，可避免把任意 JavaScript 执行能力暴露给用户输入。
- 价格异常通知采用“状态边沿”策略，连续违规不会反复刷屏，恢复后再次违规才会产生新消息。
- Queue 使用批量发送，consumer 使用 `ack`/`retry`，Cron 只负责投递任务，耗时检测不阻塞定时入口。

### 前端

- `apps/web/src/api.ts` 统一处理 JSON 解析、HTTP 错误和业务 `success` 字段，页面动作不需要重复编写 fetch 错误判断。
- 前端启用了 `strict`、`noUnusedLocals`、`noUnusedParameters` 等检查，能尽早发现不少拼写和类型问题。
- 登录初始化、Token 掩码、通知已读、Queue 异步提示等关键用户路径都有明确反馈。

## 4. 需要改进的地方

### P1：建议优先处理

1. **补自动化测试**：为 `evaluateRule` 覆盖优先级、括号、除零、非法变量、非法字符和空表达式；为 `checkMonitor` 覆盖 normal/violation/fetch_error 以及通知边沿；为 `auth` 覆盖密码验证和 Session 过期。
2. **统一异常处理**：在 Hono 顶层增加 `app.onError`，统一输出 `{ success: false, message }`，同时避免把第三方响应或内部堆栈直接返回给客户端。
3. **收紧类型**：把 `apps/api/src/routes/auth.ts` 中的 `c: any` 改为 Hono 的具体 Context 类型，并为 Cloudflare 环境变量建立项目级类型定义，减少重复的强制转换。
4. **明确写入一致性**：Listing 导入的 Listing 更新/创建与 SKU upsert 应明确事务可用性、失败重试后的结果，以及“旧 SKU 是否需要停用”的规则。

### P2：建议随后处理

- 抽出通用的正整数 ID 参数校验，减少各路由重复的 `Number(...)` 逻辑。
- 统一 Zod 校验：品牌创建目前使用手写 `c.req.json`，可以与其他资源一样使用 `zValidator`。
- 将 `App.vue` 按页面或功能拆分为组件，把 API 请求和表单状态从视图模板中分离，降低修改一个页面时的回归风险。
- 为通知和商品列表增加分页/游标，避免数据量增长后每次加载全部记录。
- 将日志改为包含 request/monitor ID 的结构化日志，并区分可预期业务错误与外部服务错误。
- 为管理登录增加失败次数限制、审计日志和 CSRF 策略评估；Token 明文保存是当前需求下的已知折衷，生产环境应限制 D1 和日志访问权限。

### P3：可维护性优化

- 保持 CSS 分区和格式化，避免整段单行样式影响审查和学习。
- 抽取前后端共享的状态枚举/响应类型，减少字符串重复。
- 为 API 增加 OpenAPI 或至少在 README 中列出端点、请求体和错误码。
- 清理过期 Session 的策略可以改为定期任务或在查询时惰性清理。

## 5. 初学者建议阅读顺序

1. 先看 `README.md`，了解本地端口、迁移、管理员初始化和 Token 约束。
2. 看 `apps/api/src/db/schema.ts`，理解数据表和外键关系。
3. 看 `apps/api/src/index.ts`，理解 Worker 入口、路由注册和登录中间件。
4. 读 `routes/products.ts`、`routes/listings.ts`、`routes/monitors.ts`，跟着“商品 → Listing → SKU → Monitor”主线走一遍。
5. 再读 `services/miaomiaozhe.ts`、`services/monitor.ts` 和 `services/rule-expression.ts`，理解外部服务、检测和规则计算。
6. 最后读 `apps/web/src/api.ts` 与 `apps/web/src/App.vue`，把页面按钮和后端端点对应起来。

## 6. 常用命令

```powershell
pnpm install
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
pnpm --filter api db:migrate:local
pnpm dev
pnpm --filter web build
pnpm --filter api cf-typegen
```

- 本地 Web：`http://localhost:5174`
- 本地 API：`http://127.0.0.1:9029`
- 新增或修改数据库结构时，应先生成迁移，再按顺序应用迁移；不要直接手改线上 D1。
- `.dev.vars`、Worker Secret、D1 数据和日志都可能包含敏感信息，不应提交到版本库或复制到工单。

## 7. 扫描边界

本报告和代码注释只针对仓库中的手写业务代码与配置。依赖包、Wrangler 本地状态、source map、缓存和构建目录由工具生成，修改它们既不能改善项目质量，也会在重新安装/构建时丢失。
