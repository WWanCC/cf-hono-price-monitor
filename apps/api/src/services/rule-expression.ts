type Variables = {
    official: number
    own: number
}

type Token =
    | { type: 'number'; value: number }
    | { type: 'identifier'; value: string }
    | { type: 'operator'; value: string }
    | { type: 'paren'; value: '(' | ')' }

function tokenize(input: string): Token[] {
    const tokens: Token[] = []

    let i = 0

    while (i < input.length) {
        const char = input[i]

        if (/\s/.test(char)) {
            i++
            continue
        }

        // number
        if (/[0-9.]/.test(char)) {
            let value = ''

            while (
                i < input.length &&
                /[0-9.]/.test(input[i])
                ) {
                value += input[i]
                i++
            }

            const number = Number(value)

            if (!Number.isFinite(number)) {
                throw new Error(
                    `无效数字: ${value}`,
                )
            }

            tokens.push({
                type: 'number',
                value: number,
            })

            continue
        }

        // identifier
        if (/[A-Za-z_]/.test(char)) {
            let value = ''

            while (
                i < input.length &&
                /[A-Za-z0-9_]/.test(input[i])
                ) {
                value += input[i]
                i++
            }

            if (
                value !== 'official' &&
                value !== 'own'
            ) {
                throw new Error(
                    `不允许的变量: ${value}`,
                )
            }

            tokens.push({
                type: 'identifier',
                value,
            })

            continue
        }

        const two = input.slice(i, i + 2)

        if (
            [
                '>=',
                '<=',
                '==',
                '!=',
                '&&',
                '||',
            ].includes(two)
        ) {
            tokens.push({
                type: 'operator',
                value: two,
            })

            i += 2
            continue
        }

        if (
            [
                '+',
                '-',
                '*',
                '/',
                '>',
                '<',
                '!',
            ].includes(char)
        ) {
            tokens.push({
                type: 'operator',
                value: char,
            })

            i++
            continue
        }

        if (char === '(' || char === ')') {
            tokens.push({
                type: 'paren',
                value: char,
            })

            i++
            continue
        }

        throw new Error(
            `不支持的字符: ${char}`,
        )
    }

    return tokens
}

class Parser {
    private position = 0

    constructor(
        private readonly tokens: Token[],
        private readonly variables: Variables,
    ) {}

    parse() {
        const result = this.parseOr()

        if (
            this.position !==
            this.tokens.length
        ) {
            throw new Error(
                '规则表达式存在无法解析的内容',
            )
        }

        return result
    }

    private peek() {
        return this.tokens[this.position]
    }

    private matchOperator(
        ...operators: string[]
    ) {
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

        while (
            this.matchOperator('||')
            ) {
            const right = this.parseAnd()

            left =
                Boolean(left) ||
                Boolean(right)
        }

        return left
    }

    private parseAnd(): number | boolean {
        let left = this.parseComparison()

        while (
            this.matchOperator('&&')
            ) {
            const right =
                this.parseComparison()

            left =
                Boolean(left) &&
                Boolean(right)
        }

        return left
    }

    private parseComparison(): number | boolean {
        let left = this.parseAdditive()

        const operator =
            this.matchOperator(
                '>',
                '>=',
                '<',
                '<=',
                '==',
                '!=',
            )

        if (!operator) {
            return left
        }

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
        }

        throw new Error(
            `未知比较操作符: ${operator}`,
        )
    }

    private parseAdditive(): number {
        let left =
            Number(this.parseMultiplicative())

        while (true) {
            const operator =
                this.matchOperator('+', '-')

            if (!operator) {
                break
            }

            const right =
                Number(
                    this.parseMultiplicative(),
                )

            if (operator === '+') {
                left += right
            } else {
                left -= right
            }
        }

        return left
    }

    private parseMultiplicative(): number {
        let left =
            Number(this.parseUnary())

        while (true) {
            const operator =
                this.matchOperator('*', '/')

            if (!operator) {
                break
            }

            const right =
                Number(this.parseUnary())

            if (operator === '*') {
                left *= right
            } else {
                if (right === 0) {
                    throw new Error(
                        '规则表达式不能除以 0',
                    )
                }

                left /= right
            }
        }

        return left
    }

    private parseUnary(): number | boolean {
        const minus =
            this.matchOperator('-')

        if (minus) {
            return -Number(
                this.parseUnary(),
            )
        }

        const plus =
            this.matchOperator('+')

        if (plus) {
            return Number(
                this.parseUnary(),
            )
        }

        const not =
            this.matchOperator('!')

        if (not) {
            return !Boolean(
                this.parseUnary(),
            )
        }

        return this.parsePrimary()
    }

    private parsePrimary(): number | boolean {
        const token = this.peek()

        if (!token) {
            throw new Error(
                '规则表达式不完整',
            )
        }

        if (token.type === 'number') {
            this.position++
            return token.value
        }

        if (
            token.type ===
            'identifier'
        ) {
            this.position++

            return this.variables[
                token.value as keyof Variables
                ]
        }

        if (
            token.type === 'paren' &&
            token.value === '('
        ) {
            this.position++

            const value = this.parseOr()

            const close = this.peek()

            if (
                close?.type !== 'paren' ||
                close.value !== ')'
            ) {
                throw new Error(
                    '缺少右括号 )',
                )
            }

            this.position++

            return value
        }

        throw new Error(
            '规则表达式格式错误',
        )
    }
}

export function evaluateRule(
    expression: string,
    variables: Variables,
) {
    const tokens = tokenize(expression)

    const parser = new Parser(
        tokens,
        variables,
    )

    const result = parser.parse()

    if (
        typeof result !== 'boolean'
    ) {
        throw new Error(
            '规则最终结果必须是 true / false',
        )
    }

    return result
}