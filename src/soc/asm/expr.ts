// Expressions of the SoC assembler (Aşama 6e), with GNU as precedence (evo evaluates strictly left to right):
//   unary - ~ +   >   * / % << >>   >   | & ^   >   + -
// Values are 64-bit (BigInt) while computing; symbols are labels, .equ names and "." / "pc" (the location counter).
import type { Token } from './lexer';

export type ExprErrorKey = 'expectedValue' | 'divisionByZero' | 'unknownSymbol' | 'unbalancedBrackets' | 'badShift';

export class ExprError extends Error {
  readonly key: ExprErrorKey;
  readonly token: Token | undefined;
  readonly args: Record<string, string>;
  constructor(key: ExprErrorKey, token: Token | undefined, args: Record<string, string> = {}) {
    super(key);
    this.key = key;
    this.token = token;
    this.args = args;
  }
}

export interface ExprScope {
  /** Value of a symbol, or undefined when unknown (yet) */
  symbol(name: string): bigint | undefined;
  /** Location counter */
  here: bigint;
  /** Names that mean the location counter ("." always; "pc" unless the ISA has a register "pc") */
  isHere(name: string): boolean;
}

const LEVELS: string[][] = [['+', '-'], ['|', '&', '^'], ['*', '/', '%', '<<', '>>']];
const OPEN = new Set(['(', '[']);
const CLOSE: Record<string, string> = { '(': ')', '[': ']' };

/** Evaluates tokens[0..] as one expression; all tokens must be used */
export function evaluate(tokens: Token[], scope: ExprScope): bigint {
  let pos = 0;
  const peek = () => tokens[pos];

  function binary(level: number): bigint {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    for (;;) {
      const t = peek();
      if (!t || t.kind !== 'punct' || !LEVELS[level].includes(t.text)) return left;
      pos++;
      const right = binary(level + 1);
      left = apply(t, left, right);
    }
  }

  function unary(): bigint {
    const t = peek();
    if (!t) throw new ExprError('expectedValue', tokens[tokens.length - 1]);
    if (t.kind === 'punct' && (t.text === '-' || t.text === '~' || t.text === '+')) {
      pos++;
      const v = unary();
      return BigInt.asIntN(64, t.text === '-' ? -v : t.text === '~' ? ~v : v);
    }
    if (t.kind === 'punct' && OPEN.has(t.text)) {
      pos++;
      const v = binary(0);
      const close = peek();
      if (!close || close.text !== CLOSE[t.text]) throw new ExprError('unbalancedBrackets', t);
      pos++;
      return v;
    }
    if (t.kind === 'number') {
      pos++;
      return BigInt.asIntN(64, t.value!);
    }
    if (t.kind === 'ident') {
      pos++;
      if (scope.isHere(t.text)) return scope.here;
      const v = scope.symbol(t.text);
      if (v === undefined) throw new ExprError('unknownSymbol', t, { name: t.text });
      return v;
    }
    throw new ExprError('expectedValue', t);
  }

  function apply(op: Token, a: bigint, b: bigint): bigint {
    switch (op.text) {
      case '+':
        return BigInt.asIntN(64, a + b);
      case '-':
        return BigInt.asIntN(64, a - b);
      case '*':
        return BigInt.asIntN(64, a * b);
      case '/':
      case '%':
        if (b === 0n) throw new ExprError('divisionByZero', op);
        return BigInt.asIntN(64, op.text === '/' ? a / b : a % b);
      case '<<':
      case '>>':
        if (b < 0n || b > 63n) throw new ExprError('badShift', op);
        return BigInt.asIntN(64, op.text === '<<' ? a << b : a >> b);
      case '|':
        return a | b;
      case '&':
        return a & b;
      default:
        return a ^ b;
    }
  }

  if (tokens.length === 0) throw new ExprError('expectedValue', undefined);
  const v = binary(0);
  if (pos < tokens.length) throw new ExprError('expectedValue', tokens[pos]);
  return v;
}
