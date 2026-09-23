/** Drizzle Kit 用这份配置从 Schema 生成 SQLite/D1 migration。 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
})
