# Price Monitor v1.6.1

淘宝 / 天猫 SKU 价格监控管理端。

技术栈：Vue 3 + TypeScript + Vite + Element Plus + Hono + Cloudflare Workers + D1 + Drizzle + Queue + Cron。

## v1.6.1：自动检测时间可配置

v1.5.1 以前，生产环境把每天三次检测直接写死在 `wrangler.jsonc`：

```text
09:00 / 15:00 / 21:00（Asia/Shanghai）
```

v1.6.1 改成两层调度：

```text
Cloudflare Cron：每分钟唤醒一次
            ↓
读取 D1 中的自动检测计划
            ↓
当前“计划时区 + HH:mm”是否命中？
      ├─ 否：立即结束，不调用喵喵折
      └─ 是：把启用 Monitor 投递到 Queue
                     ↓
              Queue 执行价格检测
```

管理端 `系统设置 -> 自动价格检测` 现在支持：

- 开启 / 停用自动检测；
- 自定义多个每日检测时间；
- IANA 时区，例如 `Asia/Shanghai`；
- 显示上次自动检测时间和投递数量；
- 显示下一次自动检测时间；
- 一键恢复旧版 `09:00 / 15:00 / 21:00`。

如果升级后还没有保存过新的检测计划，系统会自动使用旧版默认计划，因此升级不会突然停止自动检测。

## v1.5.1 工作流继续保留

价格监控仍然按实际运营流程拆成两步：

1. **先建立 SKU 映射**
   - 进入“价格监控 -> 新增 SKU 映射”；
   - 官方 SKU、自店 SKU 都可以多选；
   - 支持“按选择顺序一一配对”和“全部组合”；
   - 此时只保存映射，不要求提前选择价格规则；
   - 新建映射默认停用，避免规则尚未配置时被自动检测。

2. **完成映射后统一应用规则**
   - 在价格监控列表勾选需要处理的多条映射；
   - 在表格上方选择“常用规则”；
   - 点击“应用到已选”；
   - 可勾选“应用后启用”，一次完成规则写入和启用。

## 主要能力

- SKU 多选与一一配对 / 全组合；
- 列表多选后统一应用规则；
- 单条 Monitor 可单独修改规则；
- 品牌、上游厂家、商品、Listing、Monitor CRUD；
- Product 删除级联 Listing -> SKU -> Monitor；
- Brand 有 Product 引用时拒绝删除；
- Supplier 删除后 Product.supplierId 自动置空；
- Listing 重导入会停用已消失的旧 SKU；
- D1 保存全局检测计划，无需新增 Schedule 数据表；
- Queue 执行真正的价格检测；
- PBKDF2 使用 Cloudflare Workers 支持的 100000 iterations；
- `.dev.vars` 不进入版本控制；
- 顶层统一异常响应、结构化日志和 Session 清理。

## 目录

```text
apps/
├─ api/
│  ├─ drizzle/                         # D1 migration SQL
│  └─ src/
│     ├─ db/                           # Drizzle Schema / DB 初始化
│     ├─ lib/                          # 通用 HTTP 小工具
│     ├─ routes/                       # Hono HTTP 路由
│     └─ services/
│        ├─ price-check-schedule.ts    # 检测计划、时区、上下次运行计算
│        ├─ monitor-scheduler.ts       # Cron 命中判断 + Queue 投递
│        └─ ...
└─ web/
   └─ src/
      ├─ pages/                        # 按业务拆分的 Vue 页面
      ├─ monitor-pairing.ts            # SKU 配对纯函数
      ├─ api.ts                        # 浏览器端唯一 API 客户端
      └─ App.vue                       # 登录态 / 导航 / 页面壳
```

更详细的代码阅读与维护说明见 `MAINTAINABILITY.md`。

## 本地启动

> 源码包不会包含 `node_modules`。第一次解压到新目录后必须先执行 `pnpm install`，否则 Vite 会出现类似 `Failed to resolve import "element-plus"` 的依赖解析错误。

```powershell
pnpm install
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
pnpm --filter api db:migrate:local
pnpm dev
```

默认地址：

- Web: `http://localhost:5174`
- API: `http://127.0.0.1:9029`

## 从 v1.5.1 升级

v1.6.1 **没有修改数据库 Schema**，自动检测计划复用既有 `app_settings` 表，所以不需要新增 migration。

部署前建议：

```powershell
pnpm install
pnpm build:web
pnpm --filter api db:migrate:remote
pnpm deploy
```

部署后进入：

```text
系统设置 -> 自动价格检测
```

确认时区和每日检测时间。

> 注意：v1.6.1 的 `wrangler.jsonc` 已把 Cloudflare Cron 改成 `* * * * *`。真正抓价仍然只发生在管理端设置的时间点。

## 删除策略

- Brand -> Product: `restrict`
- Supplier -> Product: `set null`
- Product -> Listing -> SKU -> Monitor: `cascade`
- Monitor -> Notification: `set null`

## 安全提示

- `.dev.vars`、Worker Secret、喵喵折 Token 不要提交到 Git；
- 生产管理员密码使用独立强密码；
- 喵喵折 Token 当前按既定需求明文保存在 D1；设置查询接口只返回掩码。


## v1.6.1 自动检测可观测性与前端同步

- Cloudflare Cron 仍为 `* * * * *`，每分钟只做计划匹配；命中 GUI 保存的时间才投递 Queue。
- `cron_tick` / `cron_result` 日志用于确认 Cron 是否进入、时间是否命中、投递数量。
- 系统设置和价格监控页面每 10 秒轻量刷新服务端运行状态。
- 本地启动已包含 `--test-scheduled --persist-to .wrangler/state`。本地 Cron 不会按墙钟自动执行，可访问 `/cdn-cgi/local/scheduled` 模拟。
- 本地数据库固定在 `apps/api/.wrangler/state`；切换到另一个项目文件夹仍然会得到另一套本地 D1。
