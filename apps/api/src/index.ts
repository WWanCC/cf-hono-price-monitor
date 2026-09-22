import {Hono} from 'hono'

import {brandsRoute} from './routes/brands'
import {productsRoute} from './routes/products'
import {suppliersRoute} from './routes/suppliers'

import {miaomiaozheRoute} from './routes/miaomiaozhe'
import { listingsRoute } from './routes/listings'
import { monitorsRoute } from './routes/monitors'

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
app.route('/api/suppliers', suppliersRoute)
app.route('/api/products', productsRoute)
app.route('/api/providers/miaomiaozhe',miaomiaozheRoute)
app.route('/api/listings',listingsRoute)
app.route('/api/monitors', monitorsRoute)

export default app