// A small Verilog / SystemVerilog tokenizer: enough to read module headers (names, numbers, symbols), with
// line numbers. Comments and attributes "(* ... *)" are skipped. It handles the preprocessor directives a
// header may depend on: `define (object-like macros, expanded where they are used), `undef, `ifdef / `ifndef /
// `elsif / `else / `endif; other directives (`timescale, `default_nettype, ...) are skipped with their line.
// It never fails on text it does not know (that becomes one-character symbols; yosys reports the real errors),
// but a macro with arguments or an `include cannot be followed, so a use of one is marked as kind 'directive'.

export interface VerilogToken {
  kind: 'id' | 'sysid' | 'num' | 'str' | 'sym' | 'directive';
  /** Verilog is case-sensitive: the text as written; escaped identifiers without the backslash */
  text: string;
  line: number;
}

const OPERATORS = [
  '<<<=', '>>>=', '===', '!==', '<<<', '>>>', '<<=', '>>=', '==?', '!=?',
  '**', '<<', '>>', '==', '!=', '<=', '>=', '&&', '||', '~&', '~|', '~^', '^~', '+:', '-:', '->', '::', '++', '--', '+=', '-=',
];

/** Directives that are skipped together with the rest of their line */
const LINE_DIRECTIVES = new Set([
  'timescale', 'default_nettype', 'resetall', 'celldefine', 'endcelldefine', 'unconnected_drive', 'nounconnected_drive',
  'line', 'pragma', 'begin_keywords', 'end_keywords', 'undefineall',
]);

interface Macro {
  /** Tokens of the body, already lexed; unset for a macro with arguments */
  body?: VerilogToken[];
}

/** Number-like text: decimal, real, sized / based literal ("8'hFF", "'b1010", "'1") */
const NUMBER = /^(?:\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)?(?:\s*'[sS]?[bodhBODH]\s*[0-9a-fA-FxXzZ?_]+|'[01xXzZ])?/;

export function tokenizeVerilog(source: string): VerilogToken[] {
  const out: VerilogToken[] = [];
  const macros = new Map<string, Macro>();
  // `ifdef stack: is the current branch live, and has an earlier branch of this `ifdef been taken
  const conds: { live: boolean; taken: boolean; parentLive: boolean }[] = [];
  const live = () => conds.length === 0 || conds[conds.length - 1].live;

  let i = 0;
  let line = 1;
  const n = source.length;

  /** The rest of the current line (with "\" line continuations), consumed */
  const restOfLine = (): string => {
    let text = '';
    while (i < n && source[i] !== '\n') {
      if (source[i] === '\\' && source[i + 1] === '\n') {
        i += 2;
        line++;
        text += ' ';
        continue;
      }
      if (source[i] === '/' && source[i + 1] === '/') {
        while (i < n && source[i] !== '\n') i++;
        break;
      }
      text += source[i++];
    }
    return text;
  };

  const push = (t: VerilogToken) => {
    if (live()) out.push(t);
  };

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
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if ((c === '/' && source[i + 1] === '*') || (c === '(' && source[i + 1] === '*' && source[i + 2] !== ')')) {
      const close = c === '/' ? '*/' : '*)';
      const end = source.indexOf(close, i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) if (source[k] === '\n') line++;
      i = stop;
      continue;
    }
    if (c === '`') {
      const m = /^`([A-Za-z_][\w$]*)/.exec(source.slice(i, i + 256));
      if (!m) {
        push({ kind: 'sym', text: c, line });
        i++;
        continue;
      }
      const name = m[1];
      const at = line;
      i += m[0].length;
      if (name === 'ifdef' || name === 'ifndef') {
        const arg = /^\s*([A-Za-z_][\w$]*)/.exec(restOfLine())?.[1] ?? '';
        const defined = macros.has(arg);
        const cond = name === 'ifdef' ? defined : !defined;
        conds.push({ live: live() && cond, taken: cond, parentLive: live() });
      } else if (name === 'elsif') {
        const arg = /^\s*([A-Za-z_][\w$]*)/.exec(restOfLine())?.[1] ?? '';
        const top = conds[conds.length - 1];
        if (top) {
          const cond = !top.taken && macros.has(arg);
          top.live = top.parentLive && cond;
          top.taken ||= cond;
        }
      } else if (name === 'else') {
        const top = conds[conds.length - 1];
        if (top) {
          top.live = top.parentLive && !top.taken;
          top.taken = true;
        }
      } else if (name === 'endif') {
        conds.pop();
      } else if (name === 'define') {
        const text = restOfLine();
        if (!live()) continue;
        const d = /^\s*([A-Za-z_][\w$]*)(\()?/.exec(text);
        if (!d) continue;
        if (d[2]) macros.set(d[1], {});
        else macros.set(d[1], { body: tokenizeVerilog(text.slice(d[0].length)).map((t) => ({ ...t, line: at })) });
      } else if (name === 'undef') {
        const arg = /^\s*([A-Za-z_][\w$]*)/.exec(restOfLine())?.[1];
        if (arg && live()) macros.delete(arg);
      } else if (LINE_DIRECTIVES.has(name)) {
        restOfLine();
      } else {
        const macro = macros.get(name);
        if (macro?.body) {
          for (const t of macro.body) push({ ...t, line: at });
        } else {
          // `include, a macro with arguments, or an unknown macro: the reader cannot follow it
          push({ kind: 'directive', text: name, line: at });
        }
      }
      continue;
    }
    if (c === '"') {
      let k = i + 1;
      while (k < n && source[k] !== '"' && source[k] !== '\n') k += source[k] === '\\' ? 2 : 1;
      push({ kind: 'str', text: source.slice(i + 1, k), line });
      i = Math.min(k + 1, n);
      continue;
    }
    if (c === '\\') {
      let k = i + 1;
      while (k < n && !/\s/.test(source[k])) k++;
      push({ kind: 'id', text: source.slice(i + 1, k), line });
      i = k;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w$]*/.exec(source.slice(i, i + 1024))!;
      push({ kind: 'id', text: m[0], line });
      i += m[0].length;
      continue;
    }
    if (c === '$' && /[A-Za-z_]/.test(source[i + 1] ?? '')) {
      const m = /^\$[\w$]+/.exec(source.slice(i, i + 1024))!;
      push({ kind: 'sysid', text: m[0], line });
      i += m[0].length;
      continue;
    }
    if (/\d/.test(c) || (c === "'" && /[sSbBoOdDhH01xXzZ]/.test(source[i + 1] ?? ''))) {
      const m = NUMBER.exec(source.slice(i, i + 1024));
      if (m && m[0] !== '') {
        push({ kind: 'num', text: m[0].replace(/\s+/g, ''), line });
        i += m[0].length;
        continue;
      }
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    push({ kind: 'sym', text: op ?? c, line });
    i += op ? op.length : 1;
  }
  return out;
}
