/**
 * 受限价格规则表达式解析器。
 *
 * 规则来自管理员输入，因此这里故意使用词法分析 + 递归下降解析，而不是 eval。
 * 解析器只认识 official、own、数字、算术/比较/逻辑运算符和括号。
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

// 第一阶段把字符流变成受控 Token；遇到未知字符或变量立即失败。
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const char = input[i]

    if (/\s/.test(char)) {
      i++
      continue
    }

    if (/[0-9.]/.test(char)) {
      let value = ''
      while (i < input.length && /[0-9.]/.test(input[i])) {
        value += input[i]
        i++
      }
      const number = Number(value)
      if (!Number.isFinite(number)) throw new Error(`无效数字: ${value}`)
      tokens.push({ type: 'number', value: number })
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      let value = ''
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) {
        value += input[i]
        i++
      }
      if (value !== 'official' && value !== 'own') {
        throw new Error(`不允许的变量: ${value}`)
      }
      tokens.push({ type: 'identifier', value })
      continue
    }

    const two = input.slice(i, i + 2)
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'operator', value: two })
      i += 2
      continue
    }

    if (['+', '-', '*', '/', '>', '<', '!'].includes(char)) {
      tokens.push({ type: 'operator', value: char })
      i++
      continue
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char })
      i++
      continue
    }

    throw new Error(`不支持的字符: ${char}`)
  }

  return tokens
}

// 方法从低优先级到高优先级分层：|| → && → 比较 → 加减 → 乘除 → 一元 → 主表达式。
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
    if (token?.type === 'operator' && operators.includes(token.value)) {
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
    const operator = this.matchOperator('>', '>=', '<', '<=', '==', '!=')
    if (!operator) return left
    const right = this.parseAdditive()

    switch (operator) {
      case '>': return Number(left) > Number(right)
      case '>=': return Number(left) >= Number(right)
      case '<': return Number(left) < Number(right)
      case '<=': return Number(left) <= Number(right)
      case '==': return Number(left) === Number(right)
      case '!=': return Number(left) !== Number(right)
      default: throw new Error(`未知比较操作符: ${operator}`)
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
        if (right === 0) throw new Error('规则表达式不能除以 0')
        left /= right
      }
    }
    return left
  }

  private parseUnary(): number | boolean {
    if (this.matchOperator('-')) return -Number(this.parseUnary())
    if (this.matchOperator('+')) return Number(this.parseUnary())
    if (this.matchOperator('!')) return !Boolean(this.parseUnary())
    return this.parsePrimary()
  }

  private parsePrimary(): number | boolean {
    const token = this.peek()
    if (!token) throw new Error('规则表达式不完整')

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

// 对外只接受最终为 boolean 的规则，防止把孤立数字误当成价格判断结果。
export function evaluateRule(expression: string, variables: Variables) {
  const result = new Parser(tokenize(expression), variables).parse()
  if (typeof result !== 'boolean') {
    throw new Error('规则最终结果必须是 true / false')
  }
  return result
}
