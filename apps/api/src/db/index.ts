/**
 * 数据库访问层的最小封装。
 *
 * Drizzle 的 schema 参数让查询结果可以获得完整类型；业务模块只依赖 Db 类型，
 * 不需要知道 D1 驱动的具体初始化细节。
 */
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export function createDb(db: D1Database) {
  return drizzle(db, { schema })
}

export type Db = ReturnType<typeof createDb>
