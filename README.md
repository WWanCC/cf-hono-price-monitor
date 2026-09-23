# Price Monitor

> 代码质量评估与初学者阅读指南见 [`CODE_QUALITY.md`](./CODE_QUALITY.md)。

淘宝 / 天猫 SKU 价格监控管理端。项目为 pnpm workspace：

- `apps/api`：Hono + Cloudflare Workers + D1 + Drizzle
- `apps/web`：Vue 3 + TypeScript + Vite + Element Plus
- Cloudflare Queue：批量价格检测
- Cron：北京时间每天 09:00 / 15:00 / 21:00 自动检测

## 主要功能

- 品牌、商品、1688 上游厂家管理
- 官方商品 / 自店商品链接解析
- 真实 SKU 映射
- 自定义控价表达式，例如 `own >= official`
- 单条实时检测 / Queue 批量检测
- 价格违规站内信（仅违规提醒；正常和获取失败不提醒）
- 管理端登录账号 / 密码
- 管理端直接更新喵喵折 Token
- Token 按需求直接保存在 D1 `app_settings` 表中，不做额外加密

## 本地启动

```powershell
pnpm install
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
```

编辑 `apps/api/.dev.vars`，至少修改：

```env
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="你自己的至少8位密码"
MIAOMIAO_TOKEN=""
```

`MIAOMIAO_TOKEN` 可以留空。启动并登录后台后，到 **系统设置 -> 喵喵折 Token** 中填写。

应用数据库迁移：

> 迁移文件按编号顺序记录数据库历史。新增表或字段时请生成并应用 migration，不要直接手改线上 D1；这样本地、CI 和生产环境才能保持一致。

```powershell
pnpm --filter api db:migrate:local
```

启动：

```powershell
pnpm dev
```

默认地址：

- Web：`http://localhost:5174`
- API：`http://127.0.0.1:9029`

Vite 已将 `/api` 代理到 9029。

## 已有旧数据库升级

如果你已经运行过上一版，只需应用新增 migration：

```powershell
pnpm --filter api db:migrate:local
```

会新增：

- `app_settings`
- `admin_users`
- `admin_sessions`
- `notifications`

不会删除现有商品、SKU、Monitor 数据。

## 登录账号

首次登录时，如果 D1 还没有管理员，后端会使用 `.dev.vars` 中的：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

创建管理员。之后可以在后台 **系统设置** 页面修改登录账号和密码。

密码不会明文存入 D1；数据库只保存 PBKDF2-SHA256 派生结果与随机 salt。登录 Session 使用 HttpOnly Cookie，有效期 7 天。

## 喵喵折 Token

后台 **系统设置 -> 喵喵折 Token** 可以直接填写或替换 Token。

- 支持粘贴 token 本体
- 也支持粘贴 `Bearer xxx`，后端会自动去掉 `Bearer `
- 保存后立即用于手动检测、Queue 与 Cron
- D1 中直接保存 Token（按当前需求不额外加密）
- API 只返回掩码，不会把完整 Token 再返回给浏览器

`.dev.vars` 中的 `MIAOMIAO_TOKEN` 仅作为兼容 fallback。

## 站内信规则

只有 Monitor 从 **非违规状态 -> violation** 时创建一条站内信。

这样同一个违规连续被 Cron 检测时不会每次都刷一条消息。恢复正常后，如果以后再次违规，会再次生成新提醒。

当前按需求：

- `normal`：不提醒
- `fetch_error`：不提醒
- `violation`：提醒

## Queue 与“检测全部”

点击“检测全部”时，接口只是把所有启用的 Monitor 提交到 `price-monitor-checks` Queue。

前端提示：

> 已提交 N 条检测任务，正在后台处理

这不等于 N 条已经检测完成。Queue consumer 会随后逐条执行，并更新 Monitor 状态；如果进入违规状态，同时生成站内信。

## 生产部署

先创建 Queue：

```powershell
pnpm exec wrangler queues create price-monitor-checks
```

初始化远程 D1：

```powershell
pnpm --filter api db:migrate:remote
```

首次部署前设置管理员初始化 Secret：

```powershell
cd apps/api
pnpm exec wrangler secret put ADMIN_USERNAME
pnpm exec wrangler secret put ADMIN_PASSWORD
```

喵喵折 Token 可以在后台登录后直接填写，因此生产环境不强制设置 `MIAOMIAO_TOKEN` Secret。

回到仓库根目录：

```powershell
pnpm deploy
```

生产 `wrangler.jsonc` 会把 `apps/web/dist` 作为 Worker 静态资源，并让 `/api/*` 优先进入 Hono Worker。

## 安全边界

- `/api/auth/login` 与 `/api/health` 为公开接口
- 其余 `/api/*` 必须有有效管理员 Session
- 静态前端可以被访问，但未登录只能看到登录页，无法读取或修改管理数据
- 管理密码不明文保存
- 喵喵折 Token 根据当前需求明文保存于 D1，但完整值不会通过设置查询接口回传


## v1.3.0

本版新增：

- 价格监控与 SKU 映射列表直接显示 SKU 名称、真实 `skuId`，并提供对应淘宝 / 天猫 SKU 链接。
- 喵喵折 Token 在“系统设置”点击保存时会先验证有效性；验证失败不会覆盖当前已保存 Token。
- 新增 D1 表 `rule_presets`，支持在 SKU 映射页创建、编辑、删除和直接套用自定义常用规则。
- 本地前端端口固定为 `5174`，API 端口为 `9029`。

从 v1.2.0 升级后务必执行：

```powershell
pnpm --filter api db:migrate:local
```

生产 D1：

```powershell
pnpm --filter api db:migrate:remote
```

新增 migration：`0003_rule_presets.sql`。
