// Line lexer of the SoC assembler (Aşama 6e). The syntax is evo's (AssemblerHighlighter): "#" comments, "name:"
// labels, ".directives", decimal and 0x numbers, "strings", "@n" macro parameters, + - * / % << >>; plus the GNU as
// basics evo lacks: 0b numbers, 'c' characters, & | ^ ~, and "." as the location counter.

export type TokenKind =
  | 'ident' // name, opcode, register or directive
  | 'number'
  | 'string'
  | 'macroParam' // @1 .. @n
  | 'punct'; // , : ( ) [ ] + - * / % << >> & | ^ ~

export interface Token {
  kind: TokenKind;
  /** ident/punct text; string value (escapes resolved) */
  text: string;
  /** number value */
  value?: bigint;
  /** 0-based column */
  col: number;
  length: number;
}

export interface LexError {
  col: number;
  key: 'unknownCharacter' | 'unterminatedString' | 'badNumber' | 'badCharacter' | 'badEscape';
}

const PUNCT2 = ['<<', '>>'];
const PUNCT1 = ',:()[]+-*/%&|^~{}';

function isIdentStart(c: string): boolean {
  return /[A-Za-z_.$]/.test(c);
}
function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_.$]/.test(c);
}

/** Resolves one escape after "\" at s[i]; returns the bytes and the index after it */
function escape(s: string, i: number): { bytes: number[]; next: number } | null {
  const c = s[i];
  const simple: Record<string, number> = { b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '\\': 92, '"': 34, "'": 39 };
  if (c in simple) return { bytes: [simple[c]], next: i + 1 };
  if (c === 'x' || c === 'X') {
    let j = i + 1;
    while (j < s.length && /[0-9a-fA-F]/.test(s[j])) j++;
    if (j === i + 1) return null;
    return { bytes: [parseInt(s.slice(i + 1, j), 16) & 0xff], next: j };
  }
  if (/[0-7]/.test(c)) {
    let j = i;
    while (j < s.length && j < i + 3 && /[0-7]/.test(s[j])) j++;
    return { bytes: [parseInt(s.slice(i, j), 8) & 0xff], next: j };
  }
  return null;
}

/** UTF-8 bytes of a string literal's content; strings keep their bytes in `text` as latin-1 code units */
function utf8(ch: string): number[] {
  return [...new TextEncoder().encode(ch)];
}

export function lexLine(line: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') break;
    const start = i;
    if (c === '"') {
      const bytes: number[] = [];
      i++;
      let closed = false;
      while (i < line.length) {
        const d = line[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && i + 1 < line.length) {
          const e = escape(line, i + 1);
          if (!e) {
            errors.push({ col: i, key: 'badEscape' });
            i += 2;
            continue;
          }
          bytes.push(...e.bytes);
          i = e.next;
          continue;
        }
        const cp = line.codePointAt(i)!;
        const ch = String.fromCodePoint(cp);
        bytes.push(...utf8(ch));
        i += ch.length;
      }
      if (!closed) errors.push({ col: start, key: 'unterminatedString' });
      tokens.push({ kind: 'string', text: String.fromCharCode(...bytes), col: start, length: i - start });
      continue;
    }
    if (c === "'") {
      // character constant: 'a' or '\n' (the closing quote is optional in GNU as)
      let value: number | null = null;
      let j = i + 1;
      if (line[j] === '\\') {
        const e = escape(line, j + 1);
        if (e) {
          value = e.bytes[0];
          j = e.next;
        }
      } else if (j < line.length) {
        const bytes = utf8(String.fromCodePoint(line.codePointAt(j)!));
        if (bytes.length === 1) value = bytes[0];
        j += String.fromCodePoint(line.codePointAt(j)!).length;
      }
      if (value === null) {
        errors.push({ col: start, key: 'badCharacter' });
        i = j;
        continue;
      }
      if (line[j] === "'") j++;
      tokens.push({ kind: 'number', text: line.slice(start, j), value: BigInt(value), col: start, length: j - start });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < line.length && /[0-9A-Za-z_]/.test(line[j])) j++;
      const text = line.slice(i, j);
      const clean = text.replace(/_/g, '');
      let value: bigint | null = null;
      if (/^0[xX][0-9a-fA-F]+$/.test(clean) || /^0[bB][01]+$/.test(clean) || /^[0-9]+$/.test(clean)) value = BigInt(clean);
      if (value === null) errors.push({ col: start, key: 'badNumber' });
      else tokens.push({ kind: 'number', text, value, col: start, length: j - start });
      i = j;
      continue;
    }
    if (c === '@') {
      let j = i + 1;
      while (j < line.length && /[0-9]/.test(line[j])) j++;
      if (j > i + 1) {
        tokens.push({ kind: 'macroParam', text: line.slice(i, j), value: BigInt(line.slice(i + 1, j)), col: start, length: j - start });
        i = j;
        continue;
      }
      // "@progbits" and similar section type words: an identifier
      while (j < line.length && isIdentPart(line[j])) j++;
      tokens.push({ kind: 'ident', text: line.slice(i, j), col: start, length: j - start });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < line.length && isIdentPart(line[j])) j++;
      tokens.push({ kind: 'ident', text: line.slice(i, j), col: start, length: j - start });
      i = j;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (PUNCT2.includes(two)) {
      tokens.push({ kind: 'punct', text: two, col: start, length: 2 });
      i += 2;
      continue;
    }
    if (PUNCT1.includes(c)) {
      tokens.push({ kind: 'punct', text: c, col: start, length: 1 });
      i++;
      continue;
    }
    errors.push({ col: start, key: 'unknownCharacter' });
    i++;
  }
  return { tokens, errors };
}
