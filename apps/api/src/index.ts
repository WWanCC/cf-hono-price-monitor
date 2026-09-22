import { Hono } from 'hono'
import { brandsRoute } from './routes/brands'

const app = new Hono<{
  Bindings: CloudflareBindings
}>()

app.get('/api/health', (c) => {
  return c.json({
    success: true,
    message: 'price-monitor api is running',
  })
})

app.route('/api/brands', brandsRoute)

export default app