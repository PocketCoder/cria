export interface FilterClause {
  type: 'clause';
  field: string;
  operator: FilterOperator;
  value: FilterValue;
}

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'like'
  | 'in'
  | 'not in';

export type FilterValue =
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'dateMath'; value: string; resolved: string }
  | { type: 'array'; values: FilterValue[] };

export interface FilterGroup {
  type: 'group';
  operator: '&&' | '||';
  children: FilterNode[];
}

export type FilterNode = FilterClause | FilterGroup;

export interface FilterQuery {
  ast: FilterNode | null;
  includeNulls: boolean;
}

type TokenType =
  | 'LPAREN' | 'RPAREN' | 'AND' | 'OR' | 'COMMA'
  | 'OP' | 'NUMBER' | 'BOOLEAN' | 'STRING' | 'IDENT' | 'DATE_MATH';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const ch = (pos: number): string => input.charAt(pos);

  const isWs = (c: string): boolean => c !== '' && /\s/.test(c);
  const skipWs = () => { while (i < input.length && isWs(ch(i))) i++; };

  while (i < input.length) {
    skipWs();
    if (i >= input.length) break;
    const c = ch(i);

    if (c === '&' && ch(i + 1) === '&') {
      tokens.push({ type: 'AND', value: '&&' }); i += 2; continue;
    }
    if (c === '|' && ch(i + 1) === '|') {
      tokens.push({ type: 'OR', value: '||' }); i += 2; continue;
    }
    if (c === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue; }

    if (c === '!' && ch(i + 1) === '=') { tokens.push({ type: 'OP', value: '!=' }); i += 2; continue; }
    if (c === '>' && ch(i + 1) === '=') { tokens.push({ type: 'OP', value: '>=' }); i += 2; continue; }
    if (c === '<' && ch(i + 1) === '=') { tokens.push({ type: 'OP', value: '<=' }); i += 2; continue; }
    if (c === '=') { tokens.push({ type: 'OP', value: '=' }); i++; continue; }
    if (c === '>') { tokens.push({ type: 'OP', value: '>' }); i++; continue; }
    if (c === '<') { tokens.push({ type: 'OP', value: '<' }); i++; continue; }

    if (/\d/.test(c) || (c === '.' && /\d/.test(ch(i + 1)))) {
      let num = '';
      while (i < input.length && /\d/.test(ch(i))) { num += ch(i); i++; }
      if (ch(i) === '.') {
        num += '.';
        i++;
        while (i < input.length && /\d/.test(ch(i))) { num += ch(i); i++; }
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let s = '';
      while (i < input.length && ch(i) !== quote) {
        if (ch(i) === '\\') { i++; if (i < input.length) { s += ch(i); i++; } }
        else { s += ch(i); i++; }
      }
      if (i < input.length) i++;
      tokens.push({ type: 'STRING', value: s });
      continue;
    }

    if (c === '%' || /[a-zA-Z_]/.test(c)) {
      let word = '';
      while (i < input.length && /[a-zA-Z0-9_%]/.test(ch(i))) {
        word += ch(i); i++;
      }
      const lower = word.toLowerCase();

      if (lower === 'true' || lower === 'false') {
        tokens.push({ type: 'BOOLEAN', value: lower });
      } else if (lower === 'like') {
        tokens.push({ type: 'OP', value: 'like' });
      } else if (lower === 'in') {
        tokens.push({ type: 'OP', value: 'in' });
      } else if (lower === 'not') {
        skipWs();
        if (i < input.length && ch(i) === 'i' && ch(i + 1) === 'n'
          && !/[a-zA-Z0-9_]/.test(ch(i + 2))) {
          tokens.push({ type: 'OP' as const, value: 'not in' });
          i += 2;
        } else {
          tokens.push({ type: 'IDENT' as const, value: word });
        }
      } else if (lower === 'now') {
        let j = i;
        if (ch(j) === '+' || ch(j) === '-') {
          let offset = '';
          offset += ch(j); j++;
          while (/\d/.test(ch(j))) { offset += ch(j); j++; }
          if (/[dwmy]/.test(ch(j))) { offset += ch(j); j++; }
          tokens.push({ type: 'DATE_MATH', value: `now${offset}` });
          i = j;
        } else {
          tokens.push({ type: 'DATE_MATH', value: 'now' });
        }
      } else {
        tokens.push({ type: 'IDENT', value: word });
      }
      continue;
    }

    throw new Error(`Unexpected character '${c}' at position ${i}`);
  }

  return tokens;
}

function resolveDateMath(value: string, now: Date): string {
  if (value === 'now') return now.toISOString();

  const match = value.match(/^now([+-])(\d+)([dwmy])$/);
  if (!match) return now.toISOString();

  const sign = match[1]! === '+' ? 1 : -1;
  const amount = parseInt(match[2]!, 10) * sign;
  const unit = match[3]!;

  const d = new Date(now);
  switch (unit) {
    case 'd': d.setDate(d.getDate() + amount); break;
    case 'w': d.setDate(d.getDate() + amount * 7); break;
    case 'm': d.setMonth(d.getMonth() + amount); break;
    case 'y': d.setFullYear(d.getFullYear() + amount); break;
  }
  return d.toISOString();
}

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  consume(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('Unexpected end of input');
    this.pos++;
    return t;
  }

  expect(type: TokenType, value?: string): Token {
    const t = this.peek();
    if (!t || t.type !== type || (value !== undefined && t.value !== value)) {
      const got = t ? `${t.type}(${t.value})` : 'EOF';
      const want = value ? `${type}(${value})` : type;
      throw new Error(`Expected ${want}, got ${got}`);
    }
    return this.consume();
  }

  parseExpression(): FilterNode {
    let left = this.parseTerm();

    while (this.peek()?.type === 'OR') {
      this.consume();
      const right = this.parseTerm();
      left = {
        type: 'group',
        operator: '||',
        children: [left, right],
      };
    }

    return left;
  }

  parseTerm(): FilterNode {
    let left = this.parseFactor();

    while (this.peek()?.type === 'AND') {
      this.consume();
      const right = this.parseFactor();
      left = {
        type: 'group',
        operator: '&&',
        children: [left, right],
      };
    }

    return left;
  }

  parseFactor(): FilterNode {
    if (this.peek()?.type === 'LPAREN') {
      this.consume();
      const expr = this.parseExpression();
      this.expect('RPAREN');
      return expr;
    }

    return this.parseClause();
  }

  parseClause(): FilterClause {
    const fieldToken = this.expect('IDENT');

    const opToken = this.expect('OP');
    const operator = opToken.value as FilterOperator;

    const values = this.parseValues(operator);

    return {
      type: 'clause',
      field: fieldToken.value,
      operator,
      value: values.length === 1 ? values[0]! : { type: 'array', values },
    };
  }

  parseValues(operator: FilterOperator): FilterValue[] {
    const values: FilterValue[] = [];
    values.push(this.parseValue());
    while ((operator === 'in' || operator === 'not in') && this.peek()?.type === 'COMMA') {
      this.consume();
      values.push(this.parseValue());
    }
    return values;
  }

  parseValue(): FilterValue {
    const t = this.peek();
    if (!t) throw new Error('Expected a value');

    switch (t.type) {
      case 'NUMBER':
        this.consume();
        return { type: 'number', value: parseFloat(t.value) };
      case 'BOOLEAN':
        this.consume();
        return { type: 'boolean', value: t.value === 'true' };
      case 'STRING':
        this.consume();
        return { type: 'string', value: t.value };
      case 'IDENT':
        this.consume();
        return { type: 'string', value: t.value };
      case 'DATE_MATH':
        this.consume();
        return { type: 'dateMath', value: t.value, resolved: '' };
      default:
        throw new Error(`Unexpected token ${t.type}(${t.value}) when expecting a value`);
    }
  }
}

export function parseFilterQuery(input: string, now?: Date): FilterQuery {
  const trimmed = input.trim();
  if (!trimmed) return { ast: null, includeNulls: false };

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { ast: null, includeNulls: false };

  const parser = new Parser(tokens);
  const ast = parser.parseExpression();

  resolveDateMathInAst(ast, now ?? new Date());

  return { ast, includeNulls: false };
}

function resolveDateMathInAst(node: FilterNode, now: Date): void {
  if (node.type === 'clause') {
    resolveDateMathInValue(node.value, now);
  } else {
    for (const child of node.children) {
      resolveDateMathInAst(child, now);
    }
  }
}

function resolveDateMathInValue(value: FilterValue, now: Date): void {
  if (value.type === 'dateMath') {
    value.resolved = resolveDateMath(value.value, now);
  } else if (value.type === 'array') {
    for (const v of value.values) {
      resolveDateMathInValue(v, now);
    }
  }
}
