# v1.6.0

## 新功能：可配置自动检测时间

- 系统设置新增“自动价格检测”卡片。
- 支持启用 / 停用自动检测。
- 支持配置多个每日 `HH:mm` 检测时间。
- 支持 IANA 时区，默认 `Asia/Shanghai`。
- 支持显示上次自动检测、上次投递 Monitor 数量和下一次自动检测时间。
- 支持一键恢复旧版 `09:00 / 15:00 / 21:00` 默认计划。

## 调度架构

- Cloudflare Cron 从固定每日三次改为 `* * * * *`（每分钟唤醒）。
- 每分钟只读取 D1 中的计划并判断是否命中当前本地时间。
- 未命中时不会查询价格、不会投递 Queue、不会调用喵喵折。
- 命中时才扫描启用 Monitor 并投递到 `price-monitor-checks` Queue。
- 增加同一 UTC Cron 分钟的幂等保护，避免重复投递。
- Session 清理不再每分钟执行，改为每天 UTC 00:05 执行一次。

## 数据存储

复用既有 `app_settings`：

```text
price_check_schedule
price_check_schedule_last_run
```

没有新增表、字段或 migration。

## API

新增：

```text
GET /api/settings/price-check-schedule
PUT /api/settings/price-check-schedule
```

## 向后兼容

数据库里没有 `price_check_schedule` 时，自动使用：

```json
{
  "enabled": true,
  "timezone": "Asia/Shanghai",
  "times": ["09:00", "15:00", "21:00"]
}
```

因此从 v1.5.1 升级后，旧的每天三次检测行为会继续保留。
