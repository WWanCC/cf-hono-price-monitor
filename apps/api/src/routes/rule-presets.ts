/**
 * 常用价格规则模板接口。
 * 模板只负责保存“名称 + 表达式”，创建 Monitor 时把表达式复制过去。
 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { rulePresets } from '../db/schema'
import { isUniqueError, parsePositiveIntParam } from '../lib/http'
import { evaluateRule } from '../services/rule-expression'

const createSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空'),
  expression: z.string().trim().min(1, '表达式不能为空'),
})

const updateSchema = createSchema.partial()

export const rulePresetsRoute = new Hono<{
  Bindings: CloudflareBindings
}>()

/** 用安全示例价格做语法检查，不会访问外部接口。 */
function validateExpression(expression: string) {
  evaluateRule(expression, { official: 100, own: 100 })
}

rulePresetsRoute.get('/', async (c) => {
  const data = await createDb(c.env.DB)
    .select()
    .from(rulePresets)
    .orderBy(rulePresets.id)

  return c.json({ success: true, data })
})

rulePresetsRoute.post(
  '/',
  zValidator('json', createSchema),
  async (c) => {
    const body = c.req.valid('json')

    try {
      validateExpression(body.expression)
    } catch (error) {
      return c.json(
        {
          success: false,
          message:
            error instanceof Error ? error.message : '表达式无效',
        },
        400,
      )
    }

    try {
      const [preset] = await createDb(c.env.DB)
        .insert(rulePresets)
        .values(body)
        .returning()

      return c.json({ success: true, data: preset }, 201)
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json(
          { success: false, message: '规则名称已存在' },
          409,
        )
      }
      throw error
    }
  },
)

rulePresetsRoute.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id = parsePositiveIntParam(c)
    if (!id) {
      return c.json({ success: false, message: '无效的规则 ID' }, 400)
    }

    const body = c.req.valid('json')

    if (body.expression) {
      try {
        validateExpression(body.expression)
      } catch (error) {
        return c.json(
          {
            success: false,
            message:
              error instanceof Error ? error.message : '表达式无效',
          },
          400,
        )
      }
    }

    try {
      const [preset] = await createDb(c.env.DB)
        .update(rulePresets)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(rulePresets.id, id))
        .returning()

      return preset
        ? c.json({ success: true, data: preset })
        : c.json({ success: false, message: '规则不存在' }, 404)
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json(
          { success: false, message: '规则名称已存在' },
          409,
        )
      }
      throw error
    }
  },
)

rulePresetsRoute.delete('/:id', async (c) => {
  const id = parsePositiveIntParam(c)
  if (!id) {
    return c.json({ success: false, message: '无效的规则 ID' }, 400)
  }

  const [deleted] = await createDb(c.env.DB)
    .delete(rulePresets)
    .where(eq(rulePresets.id, id))
    .returning({ id: rulePresets.id })

  return deleted
    ? c.json({ success: true, data: true })
    : c.json({ success: false, message: '规则不存在' }, 404)
})
