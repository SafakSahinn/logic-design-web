// Reads Verilog / SystemVerilog module headers: name, parameters and ports with their widths.
//
// This is not the synthesis path (yosys is): it gives the pins before the first synthesis, finds the top
// module, checks the part's parameter settings, and gives storeNetlist the declaration order of the ports.
// Both port styles are read:
//   ANSI      module m #(parameter W = 8) (input [W-1:0] a, output reg [W-1:0] q);
//   non-ANSI  module m (a, q); parameter W = 8; input [W-1:0] a; output [W-1:0] q; reg [W-1:0] q;
// Widths may use parameters (their defaults, or the part's overrides) in integer constant expressions.
import { MAX_PORT_WIDTH } from '../../netlist';
import { HdlError } from '../types';
import { tokenizeVerilog, type VerilogToken } from './lexer';

export type VerilogDirection = 'input' | 'output' | 'inout';

export interface VerilogRange {
  msb: number;
  lsb: number;
  /** Both bounds were plain decimal numbers */
  literal: boolean;
}

export interface VerilogPortDecl {
  name: string;
  direction: VerilogDirection;
  /** Packed dimensions, outermost first; empty for a one-bit port */
  ranges: VerilogRange[];
  signed: boolean;
  width: number;
  line: number;
}

export interface VerilogParamDecl {
  name: string;
  /** Value in use: the override, else the default; unset when it cannot be evaluated (a string, a real, ...) */
  value?: number;
  /** localparam, or a body parameter of a module that has a "#(...)" list: cannot be overridden */
  local: boolean;
  line: number;
}

export interface VerilogModule {
  name: string;
  line: number;
  params: VerilogParamDecl[];
  ports: VerilogPortDecl[];
  /** Ports are declared in the header (ANSI style) */
  ansi: boolean;
}

/** Parameter values given by the part, keyed by name (Verilog is case-sensitive) */
export type ParamValues = ReadonlyMap<string, number>;

const DIRECTIONS = new Set(['input', 'output', 'inout']);
/** Net and variable types a port may have; the 32-bit ones give the width themselves */
const NET_TYPES = new Set(['wire', 'reg', 'logic', 'bit', 'tri', 'tri0', 'tri1', 'triand', 'trior', 'wand', 'wor', 'uwire', 'supply0', 'supply1', 'var']);
const ATOM_TYPES: Record<string, number> = { integer: 32, int: 32, shortint: 16, longint: 64, byte: 8, time: 64 };
const NON_INTEGER_TYPES = new Set(['real', 'realtime', 'shortreal', 'string']);
/** Blocks whose insides are skipped when looking for module-level declarations */
const SKIP_BLOCKS: Record<string, string> = {
  function: 'endfunction', task: 'endtask', generate: 'endgenerate', specify: 'endspecify', class: 'endclass',
  covergroup: 'endgroup', property: 'endproperty', sequence: 'endsequence', clocking: 'endclocking',
};
/** Design units other than modules: skipped as a whole */
const OTHER_UNITS: Record<string, string> = {
  package: 'endpackage', interface: 'endinterface', program: 'endprogram', primitive: 'endprimitive', config: 'endconfig',
  checker: 'endchecker', class: 'endclass',
};

class Reader {
  pos = 0;
  readonly tokens: VerilogToken[];
  constructor(tokens: VerilogToken[]) {
    this.tokens = tokens;
  }
  peek(k = 0): VerilogToken | undefined {
    return this.tokens[this.pos + k];
  }
  is(text: string, k = 0): boolean {
    const t = this.peek(k);
    return t !== undefined && t.text === text && t.kind !== 'str';
  }
  lastLine(): number | undefined {
    return this.tokens[Math.min(this.pos, this.tokens.length) - 1]?.line;
  }
  next(): VerilogToken {
    const t = this.peek();
    if (!t) throw new HdlError('verilogEnd', 'unexpected end of the text', {}, this.lastLine());
    this.pos++;
    if (t.kind === 'directive') throw new HdlError('verilogMacro', `the macro \`${t.text} cannot be read here`, { macro: t.text }, t.line);
    return t;
  }
  expect(text: string): VerilogToken {
    const t = this.next();
    if (t.text !== text || t.kind === 'str') throw new HdlError('verilogExpected', `"${text}" expected, found "${t.text}"`, { expected: text, found: t.text }, t.line);
    return t;
  }
  ident(): VerilogToken {
    const t = this.next();
    if (t.kind !== 'id') throw new HdlError('verilogName', `a name expected, found "${t.text}"`, { found: t.text }, t.line);
    return t;
  }
  /** Skips a balanced (...) / [...] / {...} group starting at the current token */
  skipGroup(): void {
    const open = this.next();
    const close = open.text === '(' ? ')' : open.text === '[' ? ']' : '}';
    let depth = 1;
    while (depth > 0) {
      const t = this.peek();
      if (!t) throw new HdlError('verilogEnd', `"${close}" missing`, { expected: close }, open.line);
      this.pos++;
      if (t.kind === 'sym' && t.text === open.text) depth++;
      else if (t.kind === 'sym' && t.text === close) depth--;
    }
  }
}

// --- constant expressions ---------------------------------------------------------------------------

class Unknown extends Error {}

/** Value of a number token; Unknown for reals and x / z digits */
function numberValue(t: VerilogToken): number {
  const text = t.text.replace(/_/g, '');
  if (/^\d+$/.test(text)) return Number(text);
  const m = /^(\d*)'([sS]?)([bodhBODH])([0-9a-fA-F]+)$/.exec(text);
  if (m) {
    const radix = { b: 2, o: 8, d: 10, h: 16 }[m[3].toLowerCase() as 'b' | 'o' | 'd' | 'h'];
    let v = parseInt(m[4], radix);
    if (Number.isNaN(v)) throw new Unknown();
    const size = m[1] === '' ? 32 : Number(m[1]);
    if (size < 53) v %= 2 ** size;
    if (m[2] && size < 53 && v >= 2 ** (size - 1)) v -= 2 ** size;
    return v;
  }
  if (text === "'0") return 0;
  if (text === "'1") return -1;
  throw new Unknown();
}

const clog2 = (v: number): number => (v <= 1 ? 0 : Math.ceil(Math.log2(v)));

/** Binary operators by precedence, lowest first */
const BINARY: string[][] = [['||'], ['&&'], ['|'], ['^', '~^', '^~'], ['&'], ['==', '!=', '===', '!=='], ['<', '<=', '>', '>='], ['<<', '>>', '<<<', '>>>'], ['+', '-'], ['*', '/', '%'], ['**']];

function binary(op: string, a: number, b: number): number {
  switch (op) {
    case '||': return a || b ? 1 : 0;
    case '&&': return a && b ? 1 : 0;
    case '|': return a | b;
    case '^': return a ^ b;
    case '~^': case '^~': return ~(a ^ b);
    case '&': return a & b;
    case '==': case '===': return a === b ? 1 : 0;
    case '!=': case '!==': return a !== b ? 1 : 0;
    case '<': return a < b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '<<': case '<<<': return a * 2 ** b;
    case '>>': case '>>>': return Math.floor(a / 2 ** b);
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': if (b === 0) throw new Unknown(); return Math.trunc(a / b);
    case '%': if (b === 0) throw new Unknown(); return a % b;
    case '**': return a ** b;
  }
  throw new Unknown();
}

/** Evaluates an integer constant expression; stops before "," ")" "]" ":" ";" and other non-operators */
class Expr {
  readonly r: Reader;
  readonly env: ReadonlyMap<string, number | undefined>;
  constructor(r: Reader, env: ReadonlyMap<string, number | undefined>) {
    this.r = r;
    this.env = env;
  }
  value(): number {
    const cond = this.level(0);
    if (this.r.is('?')) {
      this.r.next();
      const a = this.value();
      this.r.expect(':');
      const b = this.value();
      return cond ? a : b;
    }
    return cond;
  }
  level(k: number): number {
    if (k === BINARY.length) return this.unary();
    let a = this.level(k + 1);
    for (;;) {
      const t = this.r.peek();
      if (!t || t.kind !== 'sym' || !BINARY[k].includes(t.text)) return a;
      this.r.next();
      // ** is right-associative
      const b = t.text === '**' ? this.level(k) : this.level(k + 1);
      a = binary(t.text, a, b);
    }
  }
  unary(): number {
    const t = this.r.next();
    if (t.kind === 'sym') {
      if (t.text === '(') {
        const v = this.value();
        this.r.expect(')');
        return v;
      }
      if (t.text === '-') return -this.unary();
      if (t.text === '+') return this.unary();
      if (t.text === '!') return this.unary() ? 0 : 1;
      if (t.text === '~') return ~this.unary();
      throw new HdlError('verilogExpression', `"${t.text}" cannot start an expression`, { found: t.text }, t.line);
    }
    if (t.kind === 'num') return numberValue(t);
    if (t.kind === 'sysid') {
      if (t.text !== '$clog2') throw new Unknown();
      this.r.expect('(');
      const v = this.value();
      this.r.expect(')');
      return clog2(v);
    }
    if (t.kind === 'id') {
      if (!this.env.has(t.text)) throw new HdlError('verilogUnknownName', `${t.text} is not a parameter`, { name: t.text }, t.line);
      const v = this.env.get(t.text);
      if (v === undefined) throw new Unknown();
      return v;
    }
    throw new Unknown();
  }
}

/** Skips an expression up to a "," ";" or the ")" that closes its list (balanced) */
function skipExpression(r: Reader): void {
  for (;;) {
    const t = r.peek();
    if (!t) return;
    if (t.kind === 'sym' && (t.text === ',' || t.text === ';' || t.text === ')')) return;
    if (t.kind === 'sym' && (t.text === '(' || t.text === '[' || t.text === '{')) r.skipGroup();
    else r.pos++;
  }
}

/** A default value: the number, or undefined when it is not an integer constant (the text is skipped) */
function defaultValue(r: Reader, env: ReadonlyMap<string, number | undefined>): number | undefined {
  const start = r.pos;
  try {
    const v = new Expr(r, env).value();
    const t = r.peek();
    if (t && !(t.kind === 'sym' && (t.text === ',' || t.text === ';' || t.text === ')'))) throw new Unknown();
    return v;
  } catch (e) {
    // not an integer constant (a string, a real, a concatenation, ...): yosys evaluates it
    if (!(e instanceof Unknown) && !(e instanceof HdlError)) throw e;
    r.pos = start;
    skipExpression(r);
    return undefined;
  }
}

/** [msb:lsb] dimensions at the current token */
function readRanges(r: Reader, env: ReadonlyMap<string, number | undefined>, what: string): VerilogRange[] {
  const ranges: VerilogRange[] = [];
  while (r.is('[')) {
    const open = r.next();
    const literal = r.peek()?.kind === 'num' && /^\d[\d_]*$/.test(r.peek()!.text) && r.is(':', 1) && r.peek(2)?.kind === 'num' && /^\d[\d_]*$/.test(r.peek(2)!.text) && r.is(']', 3);
    try {
      const msb = new Expr(r, env).value();
      if (!r.is(':')) throw new HdlError('verilogRange', `the range of ${what} must be [msb:lsb]`, { name: what }, open.line);
      r.next();
      const lsb = new Expr(r, env).value();
      r.expect(']');
      ranges.push({ msb, lsb, literal });
    } catch (e) {
      if (e instanceof Unknown) throw new HdlError('verilogRangeValue', `the range of ${what} cannot be computed`, { name: what }, open.line);
      throw e;
    }
  }
  return ranges;
}

const rangesWidth = (ranges: VerilogRange[]): number => ranges.reduce((w, d) => w * (Math.abs(d.msb - d.lsb) + 1), 1);

// --- declarations -----------------------------------------------------------------------------------

interface DataType {
  ranges: VerilogRange[];
  signed: boolean;
  /** Width given by an atom type (integer, byte, ...) */
  atom?: number;
  /** A net or variable type keyword was given */
  typed: boolean;
  /** real, string, ...: fine for a parameter, not for a port */
  nonInteger?: string;
}

/** [net type] [signed|unsigned] [ranges] at the current token */
function readDataType(r: Reader, env: ReadonlyMap<string, number | undefined>, what: () => string): DataType {
  let typed = false;
  let atom: number | undefined;
  let signed = false;
  let nonInteger: string | undefined;
  for (;;) {
    const t = r.peek();
    if (t?.kind !== 'id') break;
    if (NET_TYPES.has(t.text)) typed = true;
    else if (t.text in ATOM_TYPES) {
      typed = true;
      atom = ATOM_TYPES[t.text];
      if (t.text !== 'time') signed = true;
    } else if (t.text === 'signed') signed = true;
    else if (t.text === 'unsigned') signed = false;
    else if (t.text === 'interconnect' || t.text === 'const' || t.text === 'automatic' || t.text === 'static') typed = true;
    else if (NON_INTEGER_TYPES.has(t.text)) {
      typed = true;
      nonInteger = t.text;
    }
    else break;
    r.next();
  }
  return { ranges: readRanges(r, env, what()), signed, atom, typed, nonInteger };
}

function makePort(name: VerilogToken, direction: VerilogDirection, type: DataType): VerilogPortDecl {
  if (type.nonInteger) throw new HdlError('verilogPortType', `the type "${type.nonInteger}" of port ${name.text} is not supported`, { port: name.text, type: type.nonInteger }, name.line);
  if (type.atom !== undefined && type.ranges.length > 0) throw new HdlError('verilogPortType', `port ${name.text} has a range on an integer type`, { port: name.text }, name.line);
  const width = type.atom ?? rangesWidth(type.ranges);
  if (width > MAX_PORT_WIDTH) throw new HdlError('portTooWide', `port ${name.text} is ${width} bits wide (at most ${MAX_PORT_WIDTH})`, { port: name.text, width, max: MAX_PORT_WIDTH }, name.line);
  return { name: name.text, direction, ranges: type.ranges, signed: type.signed, width, line: name.line };
}

/** "parameter|localparam [type] A = 1, B = 2" items after the keyword, until ";" or the end of a #( ) list */
function readParamItems(r: Reader, local: boolean, env: Map<string, number | undefined>, overrides: ParamValues, out: VerilogParamDecl[], inList: boolean): void {
  if (r.is('type')) throw new HdlError('verilogTypeParam', 'type parameters are not supported', {}, r.peek()?.line);
  readDataType(r, env, () => 'the parameter');
  for (;;) {
    const name = r.ident();
    readRanges(r, env, name.text); // unpacked dimensions of an array parameter
    let value: number | undefined;
    if (r.is('=')) {
      r.next();
      value = defaultValue(r, env);
    }
    if (!local && overrides.has(name.text)) value = overrides.get(name.text);
    if (out.some((p) => p.name === name.text)) throw new HdlError('verilogParamTwice', `parameter ${name.text} is declared twice`, { name: name.text }, name.line);
    out.push({ name: name.text, value, local, line: name.line });
    env.set(name.text, value);
    if (!r.is(',')) return;
    // in a #( ) list a "," may start a new "parameter ..." item
    if (inList && (r.is('parameter', 1) || r.is('localparam', 1))) return;
    r.next();
  }
}

function readParamList(r: Reader, env: Map<string, number | undefined>, overrides: ParamValues, out: VerilogParamDecl[]): void {
  r.expect('#');
  r.expect('(');
  if (r.is(')')) {
    r.next();
    return;
  }
  let local = false;
  for (;;) {
    if (r.is('parameter') || r.is('localparam')) local = r.next().text === 'localparam';
    readParamItems(r, local, env, overrides, out, true);
    if (r.is(')')) break;
    r.expect(',');
  }
  r.expect(')');
}

/** The header's port list: ANSI declarations, or the names of a non-ANSI module (no types) */
function readPortList(r: Reader, env: Map<string, number | undefined>, module: string): { ansi: boolean; ports: VerilogPortDecl[]; names: VerilogToken[] } {
  r.expect('(');
  const ports: VerilogPortDecl[] = [];
  const names: VerilogToken[] = [];
  if (r.is(')')) {
    r.next();
    return { ansi: false, ports, names };
  }
  const first = r.peek();
  const ansi = first?.kind === 'id' && (DIRECTIONS.has(first.text) || NET_TYPES.has(first.text) || first.text in ATOM_TYPES || first.text === 'ref');
  let direction: VerilogDirection | undefined;
  let type: DataType | undefined;
  for (;;) {
    if (ansi) {
      const t = r.peek();
      if (t?.kind === 'id' && t.text === 'ref') throw new HdlError('verilogPortType', 'ref ports are not supported', {}, t.line);
      let explicit = false;
      if (t?.kind === 'id' && DIRECTIONS.has(t.text)) {
        direction = r.next().text as VerilogDirection;
        explicit = true;
      }
      const at = r.pos;
      const declared = readDataType(r, env, () => r.peek()?.text ?? 'the port');
      if (!direction) throw new HdlError('verilogPortDirection', `the first port of module ${module} has no direction`, { module }, t?.line);
      // a name after a name ("my_if bus", a user type) is an interface or typedef port
      if (r.peek()?.kind === 'id' && r.peek(1)?.kind === 'id') {
        const bad = r.peek()!;
        throw new HdlError('verilogPortType', `the type "${bad.text}" of port ${r.peek(1)!.text} is not supported`, { port: r.peek(1)!.text, type: bad.text }, bad.line);
      }
      // a port without direction and type keeps the previous ones; a new direction alone means a plain wire
      if (explicit || declared.typed || declared.ranges.length > 0 || r.pos !== at) type = declared;
      const name = r.ident();
      if (r.is('[')) throw new HdlError('verilogUnpacked', `port ${name.text} is an array (unpacked dimension)`, { port: name.text }, name.line);
      ports.push(makePort(name, direction, type ?? declared));
      if (r.is('=')) {
        r.next();
        skipExpression(r);
      }
    } else {
      const t = r.peek();
      if (t?.kind === 'sym' && (t.text === '.' || t.text === '{')) throw new HdlError('verilogPortExpression', `module ${module} uses a port expression`, { module }, t.line);
      names.push(r.ident());
      if (r.is('[')) throw new HdlError('verilogPortExpression', `module ${module} uses a port expression`, { module }, r.peek()!.line);
    }
    if (r.is(')')) break;
    r.expect(',');
  }
  r.expect(')');
  return { ansi, ports, names };
}

/** Skips from the current token to the closing keyword of a block, keeping nested blocks of the same kind */
function skipBlock(r: Reader, open: string, close: string): void {
  let depth = 1;
  r.next();
  while (depth > 0) {
    const t = r.peek();
    if (!t) throw new HdlError('verilogEnd', `"${close}" missing`, { expected: close }, r.lastLine());
    r.pos++;
    if (t.kind !== 'id') continue;
    if (t.text === open) depth++;
    else if (t.text === close) depth--;
  }
}

/** Skips a statement up to its ";" (balanced groups) */
function skipStatement(r: Reader): void {
  for (;;) {
    const t = r.peek();
    if (!t) return;
    if (t.kind === 'sym' && t.text === ';') {
      r.pos++;
      return;
    }
    if (t.kind === 'id' && t.text === 'endmodule') return;
    if (t.kind === 'sym' && (t.text === '(' || t.text === '[' || t.text === '{')) r.skipGroup();
    else r.pos++;
  }
}

function parseModule(r: Reader, overrides: ParamValues): VerilogModule {
  r.next(); // module / macromodule
  if (r.is('static') || r.is('automatic')) r.next();
  const name = r.ident();
  const params: VerilogParamDecl[] = [];
  const env = new Map<string, number | undefined>();
  // package imports in the header
  while (r.is('import')) skipStatement(r);
  const hasParamList = r.is('#');
  if (hasParamList) readParamList(r, env, overrides, params);
  let ansi = false;
  let ports: VerilogPortDecl[] = [];
  let names: VerilogToken[] = [];
  if (r.is('(')) ({ ansi, ports, names } = readPortList(r, env, name.text));
  r.expect(';');

  // body: module-level declarations, at begin/end depth 0 and outside functions, tasks and generate blocks
  const body = new Map<string, VerilogPortDecl>();
  const netRanges = new Map<string, DataType>();
  let depth = 0;
  for (;;) {
    const t = r.peek();
    if (!t) throw new HdlError('verilogEnd', `module ${name.text} has no "endmodule"`, { module: name.text }, name.line);
    if (t.kind === 'directive') {
      r.pos++;
      continue;
    }
    if (t.kind !== 'id') {
      if (t.kind === 'sym' && (t.text === '(' || t.text === '[' || t.text === '{')) r.skipGroup();
      else r.pos++;
      continue;
    }
    if (t.text === 'endmodule') {
      r.pos++;
      if (r.is(':')) {
        r.next();
        const closing = r.ident();
        if (closing.text !== name.text) throw new HdlError('verilogEndName', `"endmodule : ${closing.text}" does not match module ${name.text}`, { module: name.text, found: closing.text }, closing.line);
      }
      break;
    }
    if (t.text in SKIP_BLOCKS) {
      skipBlock(r, t.text, SKIP_BLOCKS[t.text]);
      continue;
    }
    if (t.text === 'begin' || t.text === 'case' || t.text === 'casex' || t.text === 'casez') {
      depth++;
      r.pos++;
      continue;
    }
    if (t.text === 'end' || t.text === 'endcase') {
      depth = Math.max(0, depth - 1);
      r.pos++;
      continue;
    }
    if (depth > 0) {
      r.pos++;
      continue;
    }
    if (t.text === 'parameter' || t.text === 'localparam') {
      r.next();
      readParamItems(r, t.text === 'localparam' || hasParamList, env, overrides, params, false);
      r.expect(';');
      continue;
    }
    if (DIRECTIONS.has(t.text)) {
      if (ansi) throw new HdlError('verilogMixedPorts', `module ${name.text} declares port ${r.peek(1)?.text ?? ''} again in its body`, { module: name.text }, t.line);
      const direction = r.next().text as VerilogDirection;
      const type = readDataType(r, env, () => r.peek()?.text ?? 'the port');
      for (;;) {
        const n = r.ident();
        if (r.is('[')) throw new HdlError('verilogUnpacked', `port ${n.text} is an array (unpacked dimension)`, { port: n.text }, n.line);
        if (!names.some((x) => x.text === n.text)) throw new HdlError('verilogNotInList', `${n.text} is not in the port list of module ${name.text}`, { port: n.text, module: name.text }, n.line);
        if (body.has(n.text)) throw new HdlError('verilogPortTwice', `port ${n.text} is declared twice`, { port: n.text }, n.line);
        body.set(n.text, makePort(n, direction, type));
        if (r.is('=')) {
          r.next();
          skipExpression(r);
        }
        if (!r.is(',')) break;
        r.next();
      }
      r.expect(';');
      continue;
    }
    if (!ansi && (NET_TYPES.has(t.text) || t.text in ATOM_TYPES) && t.text !== 'var') {
      // "reg [3:0] q;" after "output q;" may give the port its range
      r.next();
      const start = r.pos;
      let type: DataType;
      try {
        type = readDataType(r, env, () => 'a net');
      } catch {
        r.pos = start;
        skipStatement(r);
        continue;
      }
      const atomType = t.text in ATOM_TYPES ? ATOM_TYPES[t.text] : undefined;
      while (r.peek()?.kind === 'id') {
        const n = r.next();
        netRanges.set(n.text, { ...type, atom: type.atom ?? atomType, typed: true });
        skipExpression(r);
        if (!r.is(',')) break;
        r.next();
      }
      skipStatement(r);
      continue;
    }
    skipStatement(r);
  }

  if (!ansi) {
    for (const n of names) {
      const p = body.get(n.text);
      if (!p) throw new HdlError('verilogNoDirection', `port ${n.text} of module ${name.text} has no input/output declaration`, { port: n.text, module: name.text }, n.line);
      const net = netRanges.get(n.text);
      if (net && p.ranges.length === 0 && (net.ranges.length > 0 || net.atom !== undefined)) {
        ports.push(makePort({ kind: 'id', text: p.name, line: p.line }, p.direction, { ...net, signed: p.signed || net.signed }));
      } else ports.push(p);
    }
  }
  const seen = new Set<string>();
  for (const p of ports) {
    if (seen.has(p.name)) throw new HdlError('verilogPortTwice', `port ${p.name} is declared twice`, { port: p.name }, p.line);
    seen.add(p.name);
  }
  return { name: name.text, line: name.line, params, ports, ansi };
}

/** One module of the text: read, or the error that stopped reading it */
export type VerilogModuleResult = { name: string; line: number } & ({ ok: true; module: VerilogModule } | { ok: false; error: HdlError });

/** Index just past the "endmodule" that closes the module starting at `from` (for recovery after an error) */
function moduleEnd(tokens: VerilogToken[], from: number): number {
  for (let k = from + 1; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind !== 'id') continue;
    if (t.text === 'endmodule') return k + 1;
    if (t.text === 'module' || t.text === 'macromodule') return k;
  }
  return tokens.length;
}

function scan(tokens: VerilogToken[], overrides: ParamValues): VerilogModuleResult[] {
  const out: VerilogModuleResult[] = [];
  const r = new Reader(tokens);
  while (r.pos < tokens.length) {
    const t = tokens[r.pos];
    if (t.kind === 'id' && t.text in OTHER_UNITS) {
      try {
        skipBlock(r, t.text, OTHER_UNITS[t.text]);
      } catch {
        r.pos = tokens.length;
      }
      continue;
    }
    if (t.kind !== 'id' || (t.text !== 'module' && t.text !== 'macromodule')) {
      r.pos++;
      continue;
    }
    const nameTok = tokens[r.pos + 1];
    const name = nameTok?.kind === 'id' && nameTok.text !== 'static' && nameTok.text !== 'automatic' ? nameTok.text : (tokens[r.pos + 2]?.text ?? '');
    const line = nameTok?.line ?? t.line;
    const start = r.pos;
    try {
      out.push({ name, line, ok: true, module: parseModule(r, overrides) });
    } catch (e) {
      out.push({ name, line, ok: false, error: e instanceof HdlError ? e : new HdlError('internal', String(e)) });
      r.pos = moduleEnd(tokens, start);
    }
  }
  return out;
}

/** Every module of the text, in order; a module that cannot be read does not stop the others */
export function readVerilogModules(source: string, overrides: ParamValues = new Map()): VerilogModuleResult[] {
  return scan(tokenizeVerilog(source), overrides);
}

/** Every module of the text, in order; throws HdlError at the first one it cannot read */
export function parseVerilogModules(source: string, overrides: ParamValues = new Map()): VerilogModule[] {
  return readVerilogModules(source, overrides).map((r) => {
    if (!r.ok) throw r.error;
    return r.module;
  });
}

/** Names the text instantiates: "name #(" or "name inst (" inside a module body */
function instantiatedNames(tokens: VerilogToken[], modules: Set<string>): Set<string> {
  const used = new Set<string>();
  let inModule = false;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind !== 'id') continue;
    if (t.text === 'module' || t.text === 'macromodule') {
      inModule = true;
      k++; // the module's own name
      continue;
    }
    if (t.text === 'endmodule') inModule = false;
    else if (inModule && modules.has(t.text)) {
      const next = tokens[k + 1];
      if (next && ((next.kind === 'sym' && next.text === '#') || next.kind === 'id')) used.add(t.text);
    }
  }
  return used;
}

/**
 * The top module, as yosys `hierarchy -auto-top` would pick it when nothing else decides: a module nothing
 * else instantiates; when several qualify, the last one. Throws HdlError when there is no module or the top
 * one cannot be read.
 */
export function topVerilogModule(source: string, overrides: ParamValues = new Map()): VerilogModule {
  const tokens = tokenizeVerilog(source);
  const modules = scan(tokens, overrides);
  if (modules.length === 0) throw new HdlError('verilogNoModule', 'the text has no module');
  const used = instantiatedNames(tokens, new Set(modules.map((m) => m.name)));
  const free = modules.filter((m) => !used.has(m.name));
  const list = free.length > 0 ? free : modules;
  const top = list[list.length - 1];
  if (!top.ok) throw top.error;
  return top.module;
}
