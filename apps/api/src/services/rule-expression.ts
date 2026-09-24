/**
 * 受限价格规则表达式解析器。
 *
 * 规则来自管理员输入，因此不能使用 eval/new Function。
 * 这里用“词法分析 + 递归下降解析”只允许：
 * - 变量 official、own；
 * - 数字；
 * - + - * /；
 * - > >= < <= == !=；
 * - && || !；
 * - 括号。
 */
type Variables = {
  official: number
  own: number
}

type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' }

/** 把字符串转换成受控 Token；遇到未知变量/字符立即失败。 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]

    if (/\s/.test(char)) {
      index++
      continue
    }

    if (/[0-9.]/.test(char)) {
      let value = ''

      while (
        index < input.length &&
        /[0-9.]/.test(input[index])
      ) {
        value += input[index]
        index++
      }

      const number = Number(value)
      if (!Number.isFinite(number)) {
        throw new Error(`无效数字: ${value}`)
      }

      tokens.push({ type: 'number', value: number })
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      let value = ''

      while (
        index < input.length &&
        /[A-Za-z0-9_]/.test(input[index])
      ) {
        value += input[index]
        index++
      }

      if (value !== 'official' && value !== 'own') {
        throw new Error(`不允许的变量: ${value}`)
      }

      tokens.push({ type: 'identifier', value })
      continue
    }

    const twoChars = input.slice(index, index + 2)
    if (
      ['>=', '<=', '==', '!=', '&&', '||'].includes(twoChars)
    ) {
      tokens.push({ type: 'operator', value: twoChars })
      index += 2
      continue
    }

    if (['+', '-', '*', '/', '>', '<', '!'].includes(char)) {
      tokens.push({ type: 'operator', value: char })
      index++
      continue
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char })
      index++
      continue
    }

    throw new Error(`不支持的字符: ${char}`)
  }

  return tokens
}

/**
 * 递归下降解析器。
 * 方法层级从低优先级到高优先级：
 *   || -> && -> 比较 -> + - -> * / -> 一元 -> 基础值
 */
class Parser {
  private position = 0

  constructor(
    private readonly tokens: Token[],
    private readonly variables: Variables,
  ) {}

  parse() {
    const result = this.parseOr()

    if (this.position !== this.tokens.length) {
      throw new Error('规则表达式存在无法解析的内容')
    }

    return result
  }

  private peek() {
    return this.tokens[this.position]
  }

  private matchOperator(...operators: string[]) {
    const token = this.peek()

    if (
      token?.type === 'operator' &&
      operators.includes(token.value)
    ) {
      this.position++
      return token.value
    }

    return null
  }

  private parseOr(): number | boolean {
    let left = this.parseAnd()

    while (this.matchOperator('||')) {
      left = Boolean(left) || Boolean(this.parseAnd())
    }

    return left
  }

  private parseAnd(): number | boolean {
    let left = this.parseComparison()

    while (this.matchOperator('&&')) {
      left = Boolean(left) && Boolean(this.parseComparison())
    }

    return left
  }

  private parseComparison(): number | boolean {
    const left = this.parseAdditive()
    const operator = this.matchOperator(
      '>',
      '>=',
      '<',
      '<=',
      '==',
      '!=',
    )

    if (!operator) return left

    const right = this.parseAdditive()

    switch (operator) {
      case '>':
        return Number(left) > Number(right)
      case '>=':
        return Number(left) >= Number(right)
      case '<':
        return Number(left) < Number(right)
      case '<=':
        return Number(left) <= Number(right)
      case '==':
        return Number(left) === Number(right)
      case '!=':
        return Number(left) !== Number(right)
      default:
        throw new Error(`未知比较操作符: ${operator}`)
    }
  }

  private parseAdditive(): number {
    let left = Number(this.parseMultiplicative())

    while (true) {
      const operator = this.matchOperator('+', '-')
      if (!operator) break

      const right = Number(this.parseMultiplicative())
      left = operator === '+' ? left + right : left - right
    }

    return left
  }

  private parseMultiplicative(): number {
    let left = Number(this.parseUnary())

    while (true) {
      const operator = this.matchOperator('*', '/')
      if (!operator) break

      const right = Number(this.parseUnary())

      if (operator === '*') {
        left *= right
      } else {
        if (right === 0) {
          throw new Error('规则表达式不能除以 0')
        }
        left /= right
      }
    }

    return left
  }

  private parseUnary(): number | boolean {
    if (this.matchOperator('-')) {
      return -Number(this.parseUnary())
    }

    if (this.matchOperator('+')) {
      return Number(this.parseUnary())
    }

    if (this.matchOperator('!')) {
      return !Boolean(this.parseUnary())
    }

    return this.parsePrimary()
  }

  private parsePrimary(): number | boolean {
    const token = this.peek()

    if (!token) {
      throw new Error('规则表达式不完整')
    }

    if (token.type === 'number') {
      this.position++
      return token.value
    }

    if (token.type === 'identifier') {
      this.position++
      return this.variables[token.value as keyof Variables]
    }

    if (token.type === 'paren' && token.value === '(') {
      this.position++
      const value = this.parseOr()
      const close = this.peek()

      if (close?.type !== 'paren' || close.value !== ')') {
        throw new Error('缺少右括号 )')
      }

      this.position++
      return value
    }

    throw new Error('规则表达式格式错误')
  }
}

/**
 * 对外只允许最终结果为 boolean。
 * 例如单独输入 `100` 虽然可以计算，但不是合法的价格“判断规则”。
 */
export function evaluateRule(
  expression: string,
  variables: Variables,
) {
  const result = new Parser(
    tokenize(expression),
    variables,
  ).parse()

  if (typeof result !== 'boolean') {
    throw new Error('规则最终结果必须是 true / false')
  }

  return result
}
