// A small VHDL tokenizer: enough to read entity headers (names, numbers, symbols), with line numbers.
// Comments ("--" to the end of the line, VHDL-2008 block comments) are skipped. It never fails: text it does
// not know becomes one-character symbols, and ghdl reports the real errors.

export interface VhdlToken {
  kind: 'id' | 'num' | 'str' | 'char' | 'sym';
  /** Identifiers are lower-cased here (VHDL is case-insensitive); `raw` keeps the spelling */
  text: string;
  raw: string;
  line: number;
}

const TWO_CHAR = new Set([':=', '<=', '=>', '>=', '/=', '**', '<>']);

export function tokenizeVhdl(source: string): VhdlToken[] {
  const tokens: VhdlToken[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '-' && source[i + 1] === '-') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) if (source[k] === '\n') line++;
      i = stop;
      continue;
    }
    const start = i;
    if (/[A-Za-z]/.test(c)) {
      while (i < n && /\w/.test(source[i])) i++;
      const raw = source.slice(start, i);
      tokens.push({ kind: 'id', text: raw.toLowerCase(), raw, line });
      continue;
    }
    if (c === '\\') {
      // extended identifier \like this\ (case-sensitive)
      i++;
      while (i < n && source[i] !== '\\' && source[i] !== '\n') i++;
      i++;
      const raw = source.slice(start, i);
      tokens.push({ kind: 'id', text: raw, raw, line });
      continue;
    }
    if (/\d/.test(c)) {
      while (i < n && /[\w.#]/.test(source[i])) i++;
      const raw = source.slice(start, i);
      tokens.push({ kind: 'num', text: raw.toLowerCase(), raw, line });
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && source[i] !== '"' && source[i] !== '\n') i++;
      i++;
      const raw = source.slice(start, i);
      tokens.push({ kind: 'str', text: raw, raw, line });
      continue;
    }
    // a character literal 'x' (an apostrophe after a name or ")" is an attribute tick instead)
    if (c === "'" && source[i + 2] === "'") {
      const prev = tokens[tokens.length - 1];
      if (!prev || !(prev.kind === 'id' || (prev.kind === 'sym' && prev.text === ')'))) {
        const raw = source.slice(i, i + 3);
        tokens.push({ kind: 'char', text: raw, raw, line });
        i += 3;
        continue;
      }
    }
    const two = source.slice(i, i + 2);
    if (TWO_CHAR.has(two)) {
      tokens.push({ kind: 'sym', text: two, raw: two, line });
      i += 2;
      continue;
    }
    // anything else is a one-character symbol; the entity reader only looks at a few of them
    tokens.push({ kind: 'sym', text: c, raw: c, line });
    i++;
  }
  return tokens;
}
