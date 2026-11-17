// Reads VHDL entity headers: name, generics and ports with their widths.
//
// This is not the synthesis path (ghdl is): it gives the pins before the first synthesis, finds the top
// entity, and lets the .circ exporter tell what Logisim-evolution's much narrower VhdlParser can read.
// Widths may use integer generics (their defaults, or the part's overrides) in + - * / ** expressions.
import { MAX_PORT_WIDTH } from '../../netlist';
import { HdlError } from '../types';
import { tokenizeVhdl, type VhdlToken } from './lexer';

export type VhdlMode = 'in' | 'out' | 'inout' | 'buffer';

export interface VhdlRange {
  left: number;
  right: number;
  dir: 'downto' | 'to';
  /** Both bounds were plain decimal numbers */
  literal: boolean;
}

export interface VhdlPortDecl {
  name: string;
  mode: VhdlMode;
  /** Type name, lower-cased, without a package prefix */
  type: string;
  /** Unset for scalar types */
  range?: VhdlRange;
  width: number;
  line: number;
}

export interface VhdlGenericDecl {
  name: string;
  type: string;
  /** Value in use: the override, else the default; unset when neither can be evaluated */
  value?: number | boolean;
  hasDefault: boolean;
  line: number;
}

export interface VhdlEntity {
  name: string;
  line: number;
  generics: VhdlGenericDecl[];
  ports: VhdlPortDecl[];
}

/** Generic values given by the part, keyed by lower-cased name */
export type GenericValues = ReadonlyMap<string, number | boolean>;

const SCALAR_TYPES = new Set(['std_logic', 'std_ulogic', 'bit', 'boolean']);
const VECTOR_TYPES = new Set(['std_logic_vector', 'std_ulogic_vector', 'bit_vector', 'unsigned', 'signed']);

class Reader {
  pos = 0;
  readonly tokens: VhdlToken[];
  readonly end: number;
  constructor(tokens: VhdlToken[], end: number) {
    this.tokens = tokens;
    this.end = end;
  }
  peek(k = 0): VhdlToken | undefined {
    return this.pos + k < this.end ? this.tokens[this.pos + k] : undefined;
  }
  is(text: string, k = 0): boolean {
    return this.peek(k)?.text === text;
  }
  next(): VhdlToken {
    const t = this.peek();
    if (!t) throw new HdlError('vhdlEnd', 'unexpected end of the entity', {}, this.tokens[this.end - 1]?.line);
    this.pos++;
    return t;
  }
  expect(text: string): VhdlToken {
    const t = this.next();
    if (t.text !== text) throw new HdlError('vhdlExpected', `"${text}" expected, found "${t.raw}"`, { expected: text, found: t.raw }, t.line);
    return t;
  }
  ident(): VhdlToken {
    const t = this.next();
    if (t.kind !== 'id') throw new HdlError('vhdlName', `a name expected, found "${t.raw}"`, { found: t.raw }, t.line);
    return t;
  }
}

// --- constant expressions ---------------------------------------------------------------------------

type Env = ReadonlyMap<string, number | boolean>;

/** Evaluates tokens [from, to) as an integer or boolean expression; undefined when it is not one we know */
function evaluate(tokens: VhdlToken[], env: Env): number | boolean | undefined {
  let i = 0;
  const peek = () => tokens[i]?.text;
  const primary = (): number | boolean | undefined => {
    const t = tokens[i++];
    if (!t) return undefined;
    if (t.kind === 'num') return /^\d+$/.test(t.text) ? Number(t.text) : undefined;
    if (t.kind === 'id') {
      if (t.text === 'true') return true;
      if (t.text === 'false') return false;
      return env.get(t.text);
    }
    if (t.text === '(') {
      const v = sum();
      if (tokens[i++]?.text !== ')') return undefined;
      return v;
    }
    if (t.text === '-' || t.text === '+') {
      const v = power();
      return typeof v === 'number' ? (t.text === '-' ? -v : v) : undefined;
    }
    return undefined;
  };
  const power = (): number | boolean | undefined => {
    const base = primary();
    if (peek() !== '**') return base;
    i++;
    const exp = primary();
    return typeof base === 'number' && typeof exp === 'number' && exp >= 0 ? base ** exp : undefined;
  };
  const product = (): number | boolean | undefined => {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === 'mod' || peek() === 'rem') {
      const op = tokens[i++].text;
      const r = power();
      if (typeof v !== 'number' || typeof r !== 'number') return undefined;
      if (op === '*') v = v * r;
      else if (r === 0) return undefined;
      else if (op === '/') v = Math.trunc(v / r);
      else if (op === 'rem') v = v % r;
      else v = ((v % r) + r) % r;
    }
    return v;
  };
  const sum = (): number | boolean | undefined => {
    let v = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[i++].text;
      const r = product();
      if (typeof v !== 'number' || typeof r !== 'number') return undefined;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return i === tokens.length ? v : undefined;
}

// --- declarations -----------------------------------------------------------------------------------

/** Tokens of one parenthesised interface list, split at top-level ";" */
function interfaceItems(r: Reader): VhdlToken[][] {
  r.expect('(');
  const items: VhdlToken[][] = [];
  let item: VhdlToken[] = [];
  let depth = 0;
  for (;;) {
    const t = r.next();
    if (t.text === '(') depth++;
    if (t.text === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (t.text === ';' && depth === 0) {
      items.push(item);
      item = [];
      continue;
    }
    item.push(t);
  }
  if (item.length > 0) items.push(item);
  r.expect(';');
  return items;
}

/** Splits "a, b : rest" into names and the tokens after the colon */
function namesAndRest(item: VhdlToken[]): { names: VhdlToken[]; rest: VhdlToken[] } {
  let k = 0;
  if (item[0]?.text === 'signal' || item[0]?.text === 'constant') k++;
  const names: VhdlToken[] = [];
  for (;;) {
    const t = item[k++];
    if (!t || t.kind !== 'id') throw new HdlError('vhdlName', `a name expected, found "${t?.raw ?? ''}"`, { found: t?.raw ?? '' }, t?.line ?? item[0]?.line);
    names.push(t);
    const sep = item[k++];
    if (sep?.text === ':') break;
    if (sep?.text !== ',') throw new HdlError('vhdlExpected', `":" expected, found "${sep?.raw ?? ''}"`, { expected: ':', found: sep?.raw ?? '' }, sep?.line ?? t.line);
  }
  return { names, rest: item.slice(k) };
}

/** Index of the first top-level ":=" in tokens, or tokens.length */
function defaultStart(tokens: VhdlToken[]): number {
  let depth = 0;
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].text === '(') depth++;
    else if (tokens[k].text === ')') depth--;
    else if (tokens[k].text === ':=' && depth === 0) return k;
  }
  return tokens.length;
}

function parseGenerics(items: VhdlToken[][], overrides: GenericValues, env: Map<string, number | boolean>): VhdlGenericDecl[] {
  const out: VhdlGenericDecl[] = [];
  for (const item of items) {
    const { names, rest } = namesAndRest(item);
    const d = defaultStart(rest);
    // "integer", "natural range 1 to 32", "boolean": the first name is the type
    const type = rest.slice(0, d).find((t) => t.kind === 'id')?.text ?? '';
    const def = d < rest.length ? evaluate(rest.slice(d + 1), env) : undefined;
    for (const name of names) {
      const value = overrides.has(name.text) ? overrides.get(name.text) : def;
      if (value !== undefined) env.set(name.text, value);
      out.push({ name: name.raw, type, value, hasDefault: d < rest.length, line: name.line });
    }
  }
  return out;
}

function parsePorts(items: VhdlToken[][], env: Env): VhdlPortDecl[] {
  const out: VhdlPortDecl[] = [];
  for (const item of items) {
    const { names, rest } = namesAndRest(item);
    const body = rest.slice(0, defaultStart(rest));
    let k = 0;
    let mode: VhdlMode = 'in';
    if (['in', 'out', 'inout', 'buffer', 'linkage'].includes(body[0]?.text ?? '')) {
      if (body[0].text === 'linkage') throw new HdlError('vhdlMode', 'linkage ports are not supported', { mode: 'linkage' }, body[0].line);
      mode = body[k++].text as VhdlMode;
    }
    // type name, possibly with a package prefix (ieee.std_logic_1164.std_logic)
    let typeToken = body[k++];
    while (body[k]?.text === '.' && body[k + 1]?.kind === 'id') {
      typeToken = body[k + 1];
      k += 2;
    }
    if (!typeToken || typeToken.kind !== 'id') throw new HdlError('vhdlPortType', 'port type expected', { type: typeToken?.raw ?? '' }, typeToken?.line ?? names[0].line);
    const type = typeToken.text;
    let range: VhdlRange | undefined;
    if (SCALAR_TYPES.has(type)) {
      if (k < body.length) throw new HdlError('vhdlPortType', `unexpected "${body[k].raw}" after ${typeToken.raw}`, { type: typeToken.raw }, body[k].line);
    } else if (VECTOR_TYPES.has(type)) {
      if (body[k]?.text !== '(' || body[body.length - 1]?.text !== ')') throw new HdlError('vhdlRange', `${typeToken.raw} needs a range like (7 downto 0)`, { type: typeToken.raw }, typeToken.line);
      const inner = body.slice(k + 1, body.length - 1);
      let depth = 0;
      let split = -1;
      for (let j = 0; j < inner.length; j++) {
        if (inner[j].text === '(') depth++;
        else if (inner[j].text === ')') depth--;
        else if (depth === 0 && (inner[j].text === 'downto' || inner[j].text === 'to')) {
          split = j;
          break;
        }
      }
      const left = split > 0 ? evaluate(inner.slice(0, split), env) : undefined;
      const right = split > 0 ? evaluate(inner.slice(split + 1), env) : undefined;
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new HdlError('vhdlRange', `cannot work out the range of ${names.map((n) => n.raw).join(', ')}`, { port: names[0].raw }, typeToken.line);
      }
      const dir = inner[split].text as 'downto' | 'to';
      if (dir === 'downto' ? left < right : left > right) throw new HdlError('vhdlNullRange', `${names[0].raw} has an empty range`, { port: names[0].raw }, typeToken.line);
      const literal = split === 1 && inner.length === 3 && inner[0].kind === 'num' && inner[2].kind === 'num';
      range = { left, right, dir, literal };
    } else {
      throw new HdlError('vhdlPortType', `port type ${typeToken.raw} is not supported`, { type: typeToken.raw }, typeToken.line);
    }
    const width = range ? Math.abs(range.left - range.right) + 1 : 1;
    for (const name of names) {
      if (width > MAX_PORT_WIDTH) throw new HdlError('portTooWide', `port ${name.raw} is ${width} bits wide (at most ${MAX_PORT_WIDTH})`, { port: name.raw, width, max: MAX_PORT_WIDTH }, name.line);
      out.push({ name: name.raw, mode, type, ...(range ? { range } : {}), width, line: name.line });
    }
  }
  return out;
}

function parseEntity(r: Reader, overrides: GenericValues): VhdlEntity {
  const head = r.expect('entity');
  const name = r.ident();
  r.expect('is');
  const env = new Map<string, number | boolean>();
  let generics: VhdlGenericDecl[] = [];
  let ports: VhdlPortDecl[] = [];
  for (;;) {
    const t = r.peek();
    if (!t) throw new HdlError('vhdlEnd', `entity ${name.raw} has no "end"`, { entity: name.raw }, head.line);
    if (t.text === 'generic') {
      r.next();
      generics = parseGenerics(interfaceItems(r), overrides, env);
    } else if (t.text === 'port') {
      r.next();
      ports = parsePorts(interfaceItems(r), env);
    } else if (t.text === 'end' || t.text === 'begin') {
      break;
    } else {
      // other declarations of the entity (constants, attributes, use clauses): skip to their ";"
      while (r.peek() && r.next().text !== ';');
    }
  }
  while (r.peek() && !r.is('end')) r.next();
  r.expect('end');
  if (r.is('entity')) r.next();
  const closing = r.peek();
  if (closing?.kind === 'id') {
    r.next();
    if (closing.text !== name.text) throw new HdlError('vhdlEndName', `"end ${closing.raw}" does not match entity ${name.raw}`, { entity: name.raw, found: closing.raw }, closing.line);
  }
  r.expect(';');
  return { name: name.raw, line: name.line, generics, ports };
}

/** One entity of the text: read, or the error that stopped reading it */
export type VhdlEntityResult = { name: string; line: number } & ({ ok: true; entity: VhdlEntity } | { ok: false; error: HdlError });

/** Every entity of the text, in order; an entity that cannot be read does not stop the others */
export function readVhdlEntities(source: string, overrides: GenericValues = new Map()): VhdlEntityResult[] {
  const tokens = tokenizeVhdl(source);
  const out: VhdlEntityResult[] = [];
  for (let i = 0; i < tokens.length; i++) {
    // "entity <name> is" starts a design unit ("entity work.x" in an instantiation does not match)
    if (tokens[i].text !== 'entity' || tokens[i + 1]?.kind !== 'id' || tokens[i + 2]?.text !== 'is') continue;
    const r = new Reader(tokens, tokens.length);
    r.pos = i;
    const name = tokens[i + 1].raw;
    const line = tokens[i + 1].line;
    try {
      out.push({ name, line, ok: true, entity: parseEntity(r, overrides) });
      i = r.pos - 1;
    } catch (e) {
      out.push({ name, line, ok: false, error: e instanceof HdlError ? e : new HdlError('internal', String(e)) });
    }
  }
  return out;
}

/** Every entity of the text, in order; throws HdlError at the first one it cannot read */
export function parseVhdlEntities(source: string, overrides: GenericValues = new Map()): VhdlEntity[] {
  return readVhdlEntities(source, overrides).map((r) => {
    if (!r.ok) throw r.error;
    return r.entity;
  });
}

/** Names of entities the text instantiates or declares as components (lower-cased) */
function instantiatedNames(tokens: VhdlToken[]): Set<string> {
  const used = new Set<string>();
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind !== 'id') continue;
    if (tokens[k - 1]?.text === '.' && tokens[k - 2]?.text === 'work' && tokens[k - 3]?.text === 'entity') used.add(t.text);
    else if (tokens[k - 1]?.text === 'component') used.add(t.text);
    else if (tokens[k - 1]?.text === ':' && (tokens[k + 1]?.text === 'port' || tokens[k + 1]?.text === 'generic') && tokens[k + 2]?.text === 'map') used.add(t.text);
  }
  return used;
}

/**
 * The top entity, close to how ghdl --synth -e (no unit) picks it: the entity nothing else instantiates; when
 * several qualify, the last one. Throws HdlError when there is no entity or the top one cannot be read.
 */
export function topVhdlEntity(source: string, overrides: GenericValues = new Map()): VhdlEntity {
  const entities = readVhdlEntities(source, overrides);
  if (entities.length === 0) throw new HdlError('vhdlNoEntity', 'the text has no entity');
  const used = instantiatedNames(tokenizeVhdl(source));
  const free = entities.filter((e) => !used.has(e.name.toLowerCase()));
  const top = (free.length > 0 ? free : entities)[(free.length > 0 ? free : entities).length - 1];
  if (!top.ok) throw top.error;
  return top.entity;
}
