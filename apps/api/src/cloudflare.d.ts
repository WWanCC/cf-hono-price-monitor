interface CloudflareBindings {
  DB: D1Database
  ASSETS: Fetcher
  PRICE_CHECK_QUEUE: Queue<import('./services/monitor-scheduler').PriceCheckMessage>
  ADMIN_USERNAME?: string
  ADMIN_PASSWORD?: string
  MIAOMIAO_TOKEN?: string
}
