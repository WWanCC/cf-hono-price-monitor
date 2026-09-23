/**
 * 常用规则模板接口。模板保存前复用同一个规则解析器校验，确保套用到 Monitor 时可执行。
 */
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { rulePresets } from '../db/schema'
import { evaluateRule } from '../services/rule-expression'

const createRulePresetSchema = z.object({
  name: z.string().trim().min(1, '规则名称不能为空').max(50),
  expression: z.string().trim().min(1, '规则表达式不能为空').max(300),
})

const updateRulePresetSchema = createRulePresetSchema.partial()

// 规则预设和 Monitor 使用同一套解析器，避免“模板能保存但套用后不能执行”。
function validateExpression(expression: string) {
  evaluateRule(expression, {
    official: 100,
    own: 100,
  })
}

export const rulePresetsRoute = new Hono<{
  Bindings: CloudflareBindings
}>()

rulePresetsRoute.get('/', async (c) => {
  const db = createDb(c.env.DB)
  const data = await db
    .select()
    .from(rulePresets)
    .orderBy(rulePresets.id)

  return c.json({
    success: true,
    data,
  })
})

rulePresetsRoute.post(
  '/',
  zValidator('json', createRulePresetSchema),
  async (c) => {
    const db = createDb(c.env.DB)
    const body = c.req.valid('json')

    try {
      validateExpression(body.expression)
    } catch (error) {
      return c.json(
        {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : '规则表达式无效',
        },
        400,
      )
    }

    try {
      const [created] = await db
        .insert(rulePresets)
        .values({
          name: body.name,
          expression: body.expression,
        })
        .returning()

      return c.json(
        {
          success: true,
          data: created,
        },
        201,
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        return c.json(
          {
            success: false,
            message: '常用规则名称已存在',
          },
          409,
        )
      }

      throw error
    }
  },
)

rulePresetsRoute.patch(
  '/:id',
  zValidator('json', updateRulePresetSchema),
  async (c) => {
    const id = Number(c.req.param('id'))

    if (!Number.isInteger(id) || id <= 0) {
      return c.json(
        {
          success: false,
          message: '无效的常用规则 ID',
        },
        400,
      )
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
              error instanceof Error
                ? error.message
                : '规则表达式无效',
          },
          400,
        )
      }
    }

    try {
      const db = createDb(c.env.DB)
      const [updated] = await db
        .update(rulePresets)
        .set({
          ...body,
          updatedAt: new Date(),
        })
        .where(eq(rulePresets.id, id))
        .returning()

      if (!updated) {
        return c.json(
          {
            success: false,
            message: '常用规则不存在',
          },
          404,
        )
      }

      return c.json({
        success: true,
        data: updated,
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        return c.json(
          {
            success: false,
            message: '常用规则名称已存在',
          },
          409,
        )
      }

      throw error
    }
  },
)

rulePresetsRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))

  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      {
        success: false,
        message: '无效的常用规则 ID',
      },
      400,
    )
  }

  const db = createDb(c.env.DB)
  const [deleted] = await db
    .delete(rulePresets)
    .where(eq(rulePresets.id, id))
    .returning()

  if (!deleted) {
    return c.json(
      {
        success: false,
        message: '常用规则不存在',
      },
      404,
    )
  }

  return c.json({
    success: true,
    data: true,
  })
})
