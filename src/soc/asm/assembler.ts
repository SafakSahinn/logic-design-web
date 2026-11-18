// Generic SoC assembler (Aşama 6e), the ISA-independent part of evo's Assembler / AssemblerInfo / AssemblerMacro.
// Same source format as evo (directives, "name:" labels, "#" comments, ".macro name n" ... ".endm" with @1..@n);
// GNU as behaviour where evo is incomplete: operator precedence, re-entering a section, .align/.balign/.p2align,
// .space/.skip, .set, and directives GCC output carries (.globl, .type, ...) are accepted and ignored.
import type { ProgramImage, ProgramSection, ProgramSymbol } from '../program';
import { evaluate, ExprError, type ExprScope } from './expr';
import type { AsmOperand, IsaAssembler } from './isa';
import { lexLine, type Token } from './lexer';

/** Largest program image (sum of section sizes): the largest SoC memory */
export const MAX_ASM_BYTES = 64 * 1024 * 1024;
const MAX_DIAGNOSTICS = 500;
const MAX_MACRO_DEPTH = 64;
const MAX_STATEMENTS = 1_000_000;
/** Layout rounds before overlapping sections are reported (each re-entered section usually needs one) */
const MAX_LAYOUT_ROUNDS = 8;

export interface AsmDiagnostic {
  /** 0-based source line */
  line: number;
  /** 0-based column and length of the marked text */
  col: number;
  length: number;
  /** i18n namespace and key ("soc" + "asm.error.<name>" for the generic messages) */
  ns: string;
  key: string;
  args?: Record<string, string | number>;
}

export interface AsmResult {
  ok: boolean;
  diagnostics: AsmDiagnostic[];
  /** The program when ok */
  image: ProgramImage | null;
  /** The entry point came from "_start" or the first instruction (false: no instructions at all) */
  entryFound: boolean;
}

interface Statement {
  /** Source line of the statement (the outermost call line for macro expansions) */
  line: number;
  labels: Token[];
  head?: Token;
  args: Token[];
  /** Expanded from this macro call (diagnostics point at the call) */
  call?: Token;
}

const SECTION_DIRECTIVES = new Set(['.text', '.data', '.rodata', '.bss']);
const DATA_WIDTH: Record<string, number> = {
  '.byte': 1,
  '.2byte': 2,
  '.half': 2,
  '.short': 2,
  '.4byte': 4,
  '.word': 4,
  '.long': 4,
  '.8byte': 8,
  '.dword': 8,
  '.quad': 8,
};
const STRING_DIRECTIVES = new Set(['.ascii', '.asciz', '.string']);
const IGNORED_DIRECTIVES = new Set([
  '.file',
  '.globl',
  '.global',
  '.local',
  '.ident',
  '.size',
  '.type',
  '.option',
  '.attribute',
  '.weak',
  '.hidden',
  '.end',
]);

interface Section {
  name: string;
  start: number;
  /** Location counter */
  end: number;
  /** Nothing placed yet: a .org moves the start */
  empty: boolean;
  /** Placed by a .org (not after the section opened before it) */
  fixed?: boolean;
  executable: boolean;
  /** Statement that opened the section (for overlap errors) */
  opener?: Token;
  openerLine: number;
  bytes?: Uint8Array;
}

type Item =
  | { kind: 'instr'; st: Statement; section: Section; address: number; size: number }
  | { kind: 'data'; st: Statement; section: Section; address: number; width: number; values: Token[][] }
  | { kind: 'bytes'; section: Section; address: number; bytes: number[] };

class Diagnostics {
  list: AsmDiagnostic[] = [];
  add(st: { line: number; call?: Token } | number, token: Token | undefined, key: string, args?: Record<string, string | number>, ns = 'soc'): void {
    if (this.list.length >= MAX_DIAGNOSTICS) return;
    const line = typeof st === 'number' ? st : st.line;
    const at = typeof st !== 'number' && st.call ? st.call : token;
    this.list.push({
      line,
      col: at?.col ?? 0,
      length: at?.length ?? 1,
      ns,
      key: ns === 'soc' ? `asm.error.${key}` : key,
      ...(args ? { args } : {}),
    });
  }
}

/** Splits tokens at top-level commas */
function splitOperands(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  let cur: Token[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'punct' && (t.text === '(' || t.text === '[')) depth++;
    if (t.kind === 'punct' && (t.text === ')' || t.text === ']')) depth--;
    if (depth === 0 && t.kind === 'punct' && t.text === ',') {
      out.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length > 0 || out.length > 0) out.push(cur);
  return out;
}

function lower(t: Token | undefined): string {
  return t ? t.text.toLowerCase() : '';
}

export function assemble(source: string, isa: IsaAssembler): AsmResult {
  const diag = new Diagnostics();
  const opcodes = new Set(isa.opcodes.map((o) => o.toLowerCase()));
  const registers = new Set(isa.registers.map((r) => r.toLowerCase()));
  const isRegister = (t: Token) => t.kind === 'ident' && registers.has(t.text.toLowerCase());
  const pcIsHere = !registers.has('pc');
  /** Storage of the ISA's expression functions for this run */
  const memo = new Map<string, bigint>();
  const call = (here: bigint) => (name: string, arg: bigint) => {
    const fn = isa.functions && Object.prototype.hasOwnProperty.call(isa.functions, name) ? isa.functions[name] : undefined;
    return fn ? fn(arg, { here, memo }) : undefined;
  };

  // 1. lex into statements
  const raw: Statement[] = [];
  source.split('\n').forEach((text, line) => {
    const { tokens, errors } = lexLine(text);
    for (const e of errors) diag.add(line, { kind: 'punct', text: '', col: e.col, length: 1 }, e.key);
    const labels: Token[] = [];
    let i = 0;
    while (i + 1 < tokens.length && tokens[i].kind === 'ident' && tokens[i + 1].kind === 'punct' && tokens[i + 1].text === ':') {
      labels.push(tokens[i]);
      i += 2;
    }
    if (i < tokens.length && tokens[i].kind === 'punct' && tokens[i].text === ':') {
      diag.add(line, tokens[i], 'missingLabelName');
      i++;
    }
    const head = tokens[i];
    if (head && head.kind !== 'ident') {
      diag.add(line, head, 'expectedInstruction');
      raw.push({ line, labels, args: [] });
      return;
    }
    raw.push({ line, labels, head, args: tokens.slice(i + 1) });
  });

  // 2. macro definitions
  interface Macro {
    name: string;
    params: number;
    body: Statement[];
  }
  const macros = new Map<string, Macro>();
  const program: Statement[] = [];
  for (let k = 0; k < raw.length; k++) {
    const st = raw[k];
    if (lower(st.head) !== '.macro') {
      if (lower(st.head) === '.endm') diag.add(st, st.head, 'endmWithoutMacro');
      else program.push(st);
      continue;
    }
    const nameTok = st.args[0];
    const countTok = st.args[1]?.kind === 'punct' && st.args[1].text === ',' ? st.args[2] : st.args[1];
    if (!nameTok || nameTok.kind !== 'ident' || nameTok.text.startsWith('.')) {
      diag.add(st, st.head, 'expectedMacroName');
      continue;
    }
    if (countTok && countTok.kind !== 'number') {
      diag.add(st, countTok, 'expectedMacroParameterCount');
      continue;
    }
    const macro: Macro = { name: nameTok.text, params: countTok ? Number(countTok.value) : 0, body: [] };
    if (st.labels.length) program.push({ line: st.line, labels: st.labels, args: [] });
    let closed = false;
    for (k++; k < raw.length; k++) {
      const b = raw[k];
      if (lower(b.head) === '.endm') {
        if (b.labels.length) macro.body.push({ line: b.line, labels: b.labels, args: [] });
        closed = true;
        break;
      }
      if (lower(b.head) === '.macro') diag.add(b, b.head, 'macroInsideMacro');
      else macro.body.push(b);
    }
    if (!closed) diag.add(st, st.head, 'macroNotClosed');
    else if (opcodes.has(macro.name.toLowerCase())) diag.add(st, nameTok, 'macroNameIsOpcode', { name: macro.name });
    else if (macros.has(macro.name)) diag.add(st, nameTok, 'duplicateMacro', { name: macro.name });
    else {
      for (const b of macro.body) {
        for (const t of b.args) {
          if (t.kind === 'macroParam' && (Number(t.value) < 1 || Number(t.value) > macro.params)) {
            diag.add(b, t, 'macroParameterNotDefined', { param: t.text });
          }
        }
      }
      macros.set(macro.name, macro);
    }
  }

  // 3. macro expansion (labels defined inside a macro are local to each expansion)
  const statements: Statement[] = [];
  let expansion = 0;
  const expand = (st: Statement, depth: number, call: Token | undefined, line: number): void => {
    if (statements.length > MAX_STATEMENTS) return;
    const macro = st.head && !opcodes.has(lower(st.head)) ? macros.get(st.head.text) : undefined;
    if (!macro) {
      statements.push(call ? { ...st, line, call } : st);
      return;
    }
    const callTok = call ?? st.head!;
    if (depth >= MAX_MACRO_DEPTH) {
      diag.add({ line, call }, st.head, 'macroRecursion', { name: macro.name });
      return;
    }
    const args = st.args.length ? splitOperands(st.args) : [];
    if (args.length !== macro.params || args.some((a) => a.length === 0)) {
      diag.add({ line, call }, st.head, 'macroParameterCount', { name: macro.name, count: macro.params });
      return;
    }
    if (st.labels.length) statements.push({ line, labels: st.labels, args: [], call });
    const id = ++expansion;
    const local = new Set(macro.body.flatMap((b) => b.labels.map((l) => l.text)));
    const rename = (t: Token): Token => (t.kind === 'ident' && local.has(t.text) ? { ...t, text: `${t.text}\u0001${id}` } : t);
    for (const b of macro.body) {
      const bodyArgs = b.args.flatMap((t) => (t.kind === 'macroParam' ? (args[Number(t.value) - 1] ?? []) : [rename(t)]));
      expand({ line: b.line, labels: b.labels.map(rename), head: b.head, args: bodyArgs }, depth + 1, callTok, line);
    }
  };
  for (const st of program) expand(st, 0, undefined, st.line);
  if (statements.length > MAX_STATEMENTS) diag.add(0, undefined, 'programTooLarge');

  // 4. layout: sections, addresses, labels, .equ. A section starts where the section opened before it ends; going
  // back into an earlier section makes it longer, so the layout runs again with the starts the previous round ended
  // with, until they no longer change (GNU ld's consecutive placement). A section moved by .org stays put.
  const runLayout = (planned: ReadonlyMap<string, number>) => {
    const symbols = new Map<string, bigint>();
    const labelNames = new Set<string>();
    /** .equ names whose value depends on a label or the location counter (may change between layout rounds) */
    const addressDependent = new Set<string>();
    /** Section of each label (a .org on an empty section moves the labels at its start) */
    const labelSection = new Map<string, Section>();
    const sections = new Map<string, Section>();
    const order: Section[] = [];
    const items: Item[] = [];
    let current: Section | null = null;
    let totalBytes = 0;
    const lines = new Map<number, number>();

    const openSection = (name: string, st: Statement, tok: Token | undefined): Section => {
      let s = sections.get(name);
      if (!s) {
        const start = planned.get(name) ?? (current ? current.end : 0);
        s = { name, start, end: start, empty: true, executable: false, opener: tok, openerLine: st.line };
        sections.set(name, s);
        order.push(s);
      }
      current = s;
      return s;
    };
    const section = (st: Statement): Section => current ?? openSection('.text', st, st.head);
    const advance = (s: Section, bytes: number, st: Statement, tok: Token | undefined): boolean => {
      if (s.end + bytes > 0x100000000) {
        diag.add(st, tok, 'addressOverflow');
        return false;
      }
      totalBytes += bytes;
      if (totalBytes > MAX_ASM_BYTES) {
        diag.add(st, tok, 'programTooLarge');
        return false;
      }
      s.end += bytes;
      s.empty = false;
      return true;
    };
    let usedAddress = false;
    const constScope = (here: number): ExprScope => ({
      symbol: (n) => {
        if (labelNames.has(n) || addressDependent.has(n)) usedAddress = true;
        return symbols.get(n);
      },
      here: BigInt(here),
      isHere: (n) => {
        const yes = n === '.' || (pcIsHere && n.toLowerCase() === 'pc');
        if (yes) usedAddress = true;
        return yes;
      },
      call: call(BigInt(here)),
    });
    /** Value of an operand that depends on no address, for instructionSize */
    const addressFree = (tokens: Token[] | undefined): bigint | undefined => {
      if (!tokens || tokens.length === 0 || tokens.some(isRegister)) return undefined;
      try {
        return evaluate(tokens, {
          symbol: (n) => (labelNames.has(n) || addressDependent.has(n) ? undefined : symbols.get(n)),
          here: 0n,
          isHere: () => false,
        });
      } catch (e) {
        if (e instanceof ExprError) return undefined;
        throw e;
      }
    };
    const constant = (tokens: Token[], st: Statement, here: number): bigint | null => {
      try {
        return evaluate(tokens, constScope(here));
      } catch (e) {
        if (e instanceof ExprError) diag.add(st, e.token ?? st.head, e.key, e.args);
        else throw e;
        return null;
      }
    };

    let tooLarge = false;
    for (const st of statements) {
      if (tooLarge) break;
      for (const l of st.labels) {
        if (symbols.has(l.text)) {
          diag.add(st, l, 'duplicateLabel', { name: l.text.split('\u0001')[0] });
          continue;
        }
        const s = section(st);
        symbols.set(l.text, BigInt(s.end));
        labelNames.add(l.text);
        labelSection.set(l.text, s);
      }
      if (!st.head) continue;
      const name = lower(st.head);
      const ops = () => splitOperands(st.args);

      if (opcodes.has(name)) {
        const s = section(st);
        const operandTokens = splitOperands(st.args);
        const size = isa.instructionSize(name, (k) => addressFree(operandTokens[k]));
        const address = s.end;
        if (!advance(s, size, st, st.head)) {
          tooLarge = true;
          break;
        }
        s.executable = true;
        items.push({ kind: 'instr', st, section: s, address, size });
        if (!lines.has(address)) lines.set(address, st.line);
        continue;
      }
      if (!name.startsWith('.')) {
        diag.add(st, st.head, 'unknownInstruction', { name: st.head.text });
        continue;
      }
      if (IGNORED_DIRECTIVES.has(name) || name.startsWith('.cfi_')) continue;
      if (name === '.section') {
        const n = st.args[0];
        if (!n || n.kind !== 'ident') diag.add(st, st.head, 'expectedSectionName');
        else openSection(n.text, st, n);
        continue;
      }
      if (SECTION_DIRECTIVES.has(name)) {
        openSection(name, st, st.head);
        continue;
      }
      if (name === '.equ' || name === '.set') {
        let [nameOp, valueOp, ...rest] = ops();
        // evo writes ".equ NAME value" without the comma
        if (!valueOp && nameOp && nameOp.length > 1 && nameOp[0].kind === 'ident') [nameOp, valueOp] = [[nameOp[0]], nameOp.slice(1)];
        const n = nameOp?.[0];
        if (!n || nameOp.length !== 1 || n.kind !== 'ident') {
          diag.add(st, n ?? st.head, 'expectedSymbolName');
          continue;
        }
        if (!valueOp || rest.length) {
          diag.add(st, st.head, 'expectedSymbolAndValue');
          continue;
        }
        if (labelNames.has(n.text) || (name === '.equ' && symbols.has(n.text))) {
          diag.add(st, n, 'duplicateName', { name: n.text });
          continue;
        }
        // (no implicit .text: a leading .equ must not open a section at 0)
        usedAddress = false;
        const v = constant(valueOp, st, (current as Section | null)?.end ?? 0);
        if (v !== null) symbols.set(n.text, v);
        if (usedAddress) addressDependent.add(n.text);
        else addressDependent.delete(n.text);
        continue;
      }
      if (name === '.org') {
        const [a, ...rest] = ops();
        if (!a || rest.length) {
          diag.add(st, st.head, 'expectedNumber');
          continue;
        }
        const s = section(st);
        const v = constant(a, st, s.end);
        if (v === null) continue;
        if (v < 0n || v > 0xffffffffn) {
          diag.add(st, a[0], 'addressOverflow');
          continue;
        }
        const addr = Number(v);
        if (s.empty) {
          // labels placed at the old start move with it
          for (const [n, ls] of labelSection) if (ls === s) symbols.set(n, BigInt(addr));
          s.start = s.end = addr;
          s.fixed = true;
        } else if (addr < s.end) diag.add(st, a[0], 'orgBackwards');
        else if (!advance(s, addr - s.end, st, st.head)) tooLarge = true;
        continue;
      }
      if (name === '.zero' || name === '.space' || name === '.skip') {
        const [a, fill, ...rest] = ops();
        if (!a || rest.length) {
          diag.add(st, st.head, 'expectedNumber');
          continue;
        }
        const s = section(st);
        const n = constant(a, st, s.end);
        const f = fill ? constant(fill, st, s.end) : 0n;
        if (n === null || f === null) continue;
        if (n < 0n) {
          diag.add(st, a[0], 'expectedPositiveNumber');
          continue;
        }
        if (n > BigInt(MAX_ASM_BYTES)) {
          diag.add(st, a[0], 'programTooLarge');
          tooLarge = true;
          continue;
        }
        const address = s.end;
        if (!advance(s, Number(n), st, st.head)) tooLarge = true;
        else if ((f & 0xffn) !== 0n) items.push({ kind: 'bytes', section: s, address, bytes: new Array(Number(n)).fill(Number(f & 0xffn)) });
        continue;
      }
      if (name === '.align' || name === '.p2align' || name === '.balign') {
        const [a, fill, ...rest] = ops();
        if (!a || rest.length) {
          diag.add(st, st.head, 'expectedNumber');
          continue;
        }
        const s = section(st);
        const n = constant(a, st, s.end);
        const f = fill ? constant(fill, st, s.end) : 0n;
        if (n === null || f === null) continue;
        // .align is a power of two on RISC-V and Nios II, like .p2align; .balign takes the byte count
        let boundary: number;
        if (name === '.balign') {
          boundary = Number(n);
          if (n <= 0n || n > 0x10000000n || (boundary & (boundary - 1)) !== 0) {
            diag.add(st, a[0], 'badAlignment');
            continue;
          }
        } else {
          if (n < 0n || n > 28n) {
            diag.add(st, a[0], 'badAlignment');
            continue;
          }
          boundary = 2 ** Number(n);
        }
        const pad = (boundary - (s.end % boundary)) % boundary;
        if (pad === 0) continue;
        const address = s.end;
        const nop = isa.nop;
        if (!advance(s, pad, st, st.head)) tooLarge = true;
        else if (!fill && s.executable && nop && nop.length > 0 && (address + pad) % nop.length === 0 && pad >= nop.length) {
          // as GNU as: zero bytes up to the next instruction boundary, nops from there on
          const lead = (nop.length - (address % nop.length)) % nop.length;
          items.push({ kind: 'bytes', section: s, address: address + lead, bytes: Array.from({ length: pad - lead }, (_, k) => nop[k % nop.length]) });
        } else if ((f & 0xffn) !== 0n) items.push({ kind: 'bytes', section: s, address, bytes: new Array(pad).fill(Number(f & 0xffn)) });
        continue;
      }
      if (STRING_DIRECTIVES.has(name)) {
        const list = ops();
        if (!list.length || list.some((o) => o.length !== 1 || o[0].kind !== 'string')) {
          diag.add(st, st.head, 'expectedString');
          continue;
        }
        const s = section(st);
        for (const o of list) {
          const bytes = [...o[0].text].map((c) => c.charCodeAt(0));
          if (name !== '.ascii') bytes.push(0);
          const address = s.end;
          if (!advance(s, bytes.length, st, o[0])) {
            tooLarge = true;
            break;
          }
          items.push({ kind: 'bytes', section: s, address, bytes });
        }
        continue;
      }
      if (name in DATA_WIDTH) {
        const values = ops();
        if (!values.length || values.some((v) => v.length === 0)) {
          diag.add(st, st.head, 'expectedNumber');
          continue;
        }
        const s = section(st);
        const width = DATA_WIDTH[name];
        const address = s.end;
        if (!advance(s, width * values.length, st, st.head)) {
          tooLarge = true;
          continue;
        }
        items.push({ kind: 'data', st, section: s, address, width, values });
        continue;
      }
      diag.add(st, st.head, 'unsupportedDirective', { name: st.head.text });
    }

    return { symbols, labelNames, order, items, lines };
  };
  const diagMark = diag.list.length;
  let layout = runLayout(new Map());
  for (let round = 1; round < MAX_LAYOUT_ROUNDS; round++) {
    const planned = new Map<string, number>();
    let changed = false;
    let prevEnd = 0;
    for (const s of layout.order) {
      if (!s.fixed) {
        planned.set(s.name, prevEnd);
        if (s.start !== prevEnd) changed = true;
      }
      prevEnd = s.end;
    }
    if (!changed) break;
    diag.list.length = diagMark;
    layout = runLayout(planned);
  }
  const { symbols, labelNames, order, items, lines } = layout;

  // 5. overlapping sections
  const used = order.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < used.length; i++) {
    const a = used[i];
    const b = used[i + 1];
    if (b.start < a.end) {
      diag.add(a.openerLine, a.opener, 'overlappingSections', { a: a.name, b: b.name });
      diag.add(b.openerLine, b.opener, 'overlappingSections', { a: b.name, b: a.name });
    }
  }
  if (diag.list.length) return { ok: false, diagnostics: diag.list, image: null, entryFound: false };

  // 6. emit
  for (const s of order) s.bytes = new Uint8Array(s.end - s.start);
  const le = isa.littleEndian;
  const put = (s: Section, address: number, value: bigint, width: number) => {
    for (let k = 0; k < width; k++) {
      const shift = BigInt(8 * (le ? k : width - 1 - k));
      s.bytes![address - s.start + k] = Number((value >> shift) & 0xffn);
    }
  };
  const fullScope = (here: number): ExprScope => ({
    symbol: (n) => symbols.get(n),
    here: BigInt(here),
    isHere: (n) => n === '.' || (pcIsHere && n.toLowerCase() === 'pc'),
    call: call(BigInt(here)),
  });
  const valueOf = (tokens: Token[], st: Statement, here: number): bigint | null => {
    try {
      return evaluate(tokens, fullScope(here));
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      diag.add(st, e.token ?? st.head, e.key, e.key === 'unknownSymbol' ? { name: (e.args.name ?? '').split('\u0001')[0] } : e.args);
      return null;
    }
  };
  const openBracket = isa.brackets === 'round' ? '(' : '[';
  const closeBracket = isa.brackets === 'round' ? ')' : ']';

  // Functions that pair up (RISC-V %pcrel_lo naming the %pcrel_hi at a label) must see the final addresses only,
  // whatever the order of the lines: values from the layout rounds are dropped, then every instruction operand
  // is evaluated once without reporting errors so the pairing data exists before the real pass.
  memo.clear();
  for (const item of items) {
    if (item.kind !== 'instr' || !item.st.args.some((t) => t.kind === 'ident')) continue;
    for (const op of splitOperands(item.st.args)) {
      const n = op.length;
      const expr = n >= 3 && op[n - 3].text === openBracket && isRegister(op[n - 2]) && op[n - 1].text === closeBracket ? op.slice(0, n - 3) : op;
      if (!expr.length || expr.some(isRegister)) continue;
      try {
        evaluate(expr, fullScope(item.address));
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
      }
    }
  }

  for (const item of items) {
    if (item.kind === 'bytes') {
      item.section.bytes!.set(item.bytes, item.address - item.section.start);
      continue;
    }
    if (item.kind === 'data') {
      item.values.forEach((v, k) => {
        const value = valueOf(v, item.st, item.address + k * item.width);
        if (value === null) return;
        const bits = BigInt(item.width * 8);
        if (item.width < 8 && (value >= 1n << bits || value < -(1n << (bits - 1n)))) {
          diag.add(item.st, v[0], 'valueOutOfRange', { bits: item.width * 8 });
          return;
        }
        put(item.section, item.address + k * item.width, BigInt.asUintN(item.width * 8, value), item.width);
      });
      continue;
    }
    const { st, address, size } = item;
    const opcode = lower(st.head);
    const operandTokens = st.args.length ? splitOperands(st.args) : [];
    const operands: AsmOperand[] = [];
    let bad = false;
    for (const [index, op] of operandTokens.entries()) {
      if (op.length === 0) {
        diag.add(st, st.head, 'expectedOperand');
        bad = true;
        break;
      }
      if (op.length === 1 && isRegister(op[0])) {
        operands.push({ kind: 'reg', name: op[0].text.toLowerCase() });
        continue;
      }
      const named = op.length === 1 && op[0].kind === 'ident' ? isa.namedOperand?.(opcode, op[0].text.toLowerCase(), index) : undefined;
      if (named !== undefined) {
        operands.push({ kind: 'imm', value: named });
        continue;
      }
      const n = op.length;
      if (n >= 3 && op[n - 3].text === openBracket && isRegister(op[n - 2]) && op[n - 1].text === closeBracket) {
        const offsetTokens = op.slice(0, n - 3);
        const offset = offsetTokens.length ? valueOf(offsetTokens, st, address) : 0n;
        if (offset === null) {
          bad = true;
          break;
        }
        operands.push({ kind: 'mem', offset: Number(offset), base: op[n - 2].text.toLowerCase() });
        continue;
      }
      if (op.some(isRegister)) {
        diag.add(st, op.find(isRegister), 'registerInExpression');
        bad = true;
        break;
      }
      const v = valueOf(op, st, address);
      if (v === null) {
        bad = true;
        break;
      }
      operands.push({ kind: 'imm', value: Number(v) });
    }
    if (bad) continue;
    const encoded = isa.encode({ opcode, operands, address, size });
    if ('error' in encoded) {
      const e = encoded.error;
      const tok = e.operand !== undefined ? operandTokens[e.operand]?.[0] : st.head;
      diag.add(st, tok ?? st.head, e.key, e.args, e.ns);
      continue;
    }
    if (encoded.bytes.length !== size) {
      diag.add(st, st.head, 'encodingSizeMismatch', { name: st.head!.text, expected: size, got: encoded.bytes.length });
      continue;
    }
    item.section.bytes!.set(encoded.bytes.map((b) => b & 0xff), address - item.section.start);
  }
  if (diag.list.length) return { ok: false, diagnostics: diag.list, image: null, entryFound: false };

  // 7. program image
  const programSections: ProgramSection[] = order
    .filter((s) => s.end > s.start)
    .map((s) => ({ name: s.name, start: s.start, size: s.end - s.start, executable: s.executable }));
  const programSymbols: ProgramSymbol[] = [...labelNames]
    .filter((n) => !n.includes('\u0001'))
    .map((n) => ({ name: n, address: Number(BigInt.asUintN(32, symbols.get(n)!)) }))
    .sort((a, b) => a.address - b.address);
  let entry = -1;
  if (labelNames.has('_start')) entry = Number(symbols.get('_start')!);
  else for (const it of items) if (it.kind === 'instr' && (entry < 0 || it.address < entry)) entry = it.address;
  const image: ProgramImage = {
    entry: Math.max(entry, 0),
    chunks: order.filter((s) => s.end > s.start).map((s) => ({ address: s.start, data: s.bytes!, zeroFill: 0 })),
    sections: programSections,
    symbols: programSymbols,
    lines,
  };
  return { ok: true, diagnostics: [], image, entryFound: entry >= 0 };
}
