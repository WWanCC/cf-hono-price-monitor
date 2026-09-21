import { Hono } from 'hono'

const app = new Hono()

app.get('/api/health', (c) => {
  return c.json({
    success: true,
    message: 'price-monitor api is running',
  })
})

export default app