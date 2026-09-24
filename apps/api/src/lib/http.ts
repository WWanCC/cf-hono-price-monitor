/** Hono 路由中会重复使用的小型 HTTP/数据库辅助函数。 */
type ParamContext = {
  req: {
    param(name: string): string
  }
}

/** 把路径参数解析为正整数；失败返回 null，由路由决定具体错误文案。 */
export function parsePositiveIntParam(
  c: ParamContext,
  name = 'id',
) {
  const value = Number(c.req.param(name))

  if (!Number.isInteger(value) || value <= 0) {
    return null
  }

  return value
}

/** D1/SQLite 唯一索引冲突统一识别。 */
export function isUniqueError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed')
  )
}
