// What Logisim-evolution makes of this part's VHDL text.
//
// Evo's VHDL Entity reads only the entity's ports, with the regular expressions of std/hdl/VhdlParser, which
// are much narrower than VHDL: one entity closed by "end <same name>;", ports of type std_logic or
// std_logic_vector(<number> downto <number>) with mode in / out / inout, no generics. A text it cannot read
// stops the file's loading at an error dialog. readEvoVhdl() follows that parser step by step, so the export
// report can say whether evo opens the file and with which pins.
import { genericValues, parseGenericSettings, readVhdlEntities, type VhdlEntity } from '../../hdl';
import type { PortShape } from '../shared/netlistPart';

/** Why evo's parser refuses a text (its IllegalVhdlContentException messages) */
export type EvoVhdlFailure =
  | { code: 'duplicated' }
  | { code: 'noEntity' }
  | { code: 'portDecl' }
  | { code: 'portType'; port: string }
  | { code: 'portMode'; port: string };

export type EvoVhdlResult = { ok: true; name: string; inputs: PortShape[]; outputs: PortShape[] } | ({ ok: false } & EvoVhdlFailure);

const ENTITY = /\s*entity\s+(\w+)\s+is\s+(.*?end)\s+(\w+)\s*;/gis;
const PORTS = /\s*port\s*[(](.*)[)]\s*;\s*end/is;
const PORT_NAME = /\s*(\w+)\s*/i;
const LINE = /:\s*(\w+)\s+std_logic/i;
const VECTOR = /:\s*(\w+)\s+std_logic_vector\s*[(]\s*(\d+)\s+downto\s+(\d+)\s*[)]/i;

/** VhdlParser.removeComments: "--" to the end of its line, then trim */
function removeComments(source: string): string {
  let s = source;
  let from: number;
  while ((from = s.indexOf('--')) !== -1) {
    const nl = s.indexOf('\n', from);
    const cr = s.indexOf('\r', from);
    const to = nl !== -1 ? nl : cr !== -1 ? cr : s.length;
    s = s.slice(0, from) + s.slice(to);
  }
  return s.trim();
}

/** Java's String.split(regex): the pieces between matches, trailing empty pieces dropped */
function javaSplit(input: string, re: RegExp): string[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out: string[] = [];
  let index = 0;
  for (const m of input.matchAll(g)) {
    if (m[0].length === 0 && m.index === 0) continue;
    out.push(input.slice(index, m.index));
    index = m.index + m[0].length;
  }
  if (out.length === 0) return [input];
  out.push(input.slice(index));
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

type Fail = { ok: false } & EvoVhdlFailure;
const fail = (f: EvoVhdlFailure): Fail => ({ ok: false, ...f });

/** VhdlParser.getType */
const portKind = (mode: string): 'input' | 'output' | undefined => (mode === 'in' ? 'input' : mode === 'out' || mode === 'inout' ? 'output' : undefined);

/** parseLine / parseVector on `rest` (the statement after its names): the kind and width, or a failure */
function portType(statement: string, rest: string, port: string): { kind: 'input' | 'output'; width: number } | Fail {
  const vector = statement.toLowerCase().includes('std_logic_vector');
  const m = vector ? VECTOR.exec(rest) : LINE.exec(rest);
  if (!m) return fail({ code: 'portType', port });
  const kind = portKind(m[1].toLowerCase());
  if (!kind) return fail({ code: 'portMode', port });
  return { kind, width: vector ? Number.parseInt(m[2], 10) - Number.parseInt(m[3], 10) + 1 : 1 };
}

/** The ports and name evo reads from a VHDL text, or why it refuses it */
export function readEvoVhdl(source: string): EvoVhdlResult {
  const input = removeComments(source);
  const parts = javaSplit(input, ENTITY);
  if (parts.length > 2) return fail({ code: 'duplicated' });
  const m = new RegExp(ENTITY.source, 'is').exec(input);
  if (!m || m[1] !== m[3]) return fail({ code: 'noEntity' });
  const inputs: PortShape[] = [];
  const outputs: PortShape[] = [];
  const ports = PORTS.exec(m[2]);
  if (ports) {
    // java.util.Scanner with delimiter ";": empty statements between two ";" are kept, a final empty one is not
    const statements = ports[1].split(';');
    if (statements.length > 1 && statements[statements.length - 1] === '') statements.pop();
    for (const raw of statements) {
      const statement = raw.trim();
      let names: string[];
      let rest: string;
      if (statement.includes(',')) {
        const colon = statement.indexOf(':');
        if (colon === -1) return fail({ code: 'portDecl' });
        names = statement.slice(0, colon).split(',').map((n) => n.trim());
        rest = statement;
      } else {
        const n = PORT_NAME.exec(statement);
        if (!n) return fail({ code: 'portDecl' });
        names = [n[0].trim()];
        rest = statement.slice(n.index + n[0].length);
      }
      const type = portType(statement, rest, names[0] ?? '');
      if ('ok' in type) return type;
      for (const name of names) (type.kind === 'input' ? inputs : outputs).push({ name, width: type.width });
    }
  }
  return { ok: true, name: m[1], inputs, outputs };
}

export type EvoIssue =
  | { code: 'unreadable'; failure: EvoVhdlFailure }
  | { code: 'ports' }
  | { code: 'generics'; names: string }
  | { code: 'genericsSet'; generics: string };

/** The entity evo uses: the first one of the text (evo refuses texts with more) */
function firstEntity(source: string, generics: string): VhdlEntity | undefined {
  let overrides = new Map<string, number | boolean>();
  try {
    overrides = new Map(genericValues(parseGenericSettings(generics)));
  } catch {
    // bad generics are reported by the part itself
  }
  const first = readVhdlEntities(source, overrides)[0];
  return first?.ok ? first.entity : undefined;
}

const samePorts = (a: PortShape[], b: PortShape[]) =>
  a.length === b.length && a.every((p, i) => p.width === b[i].width && p.name.toLowerCase() === b[i].name.toLowerCase());

/**
 * What evo will make of the part: whether it reads the text at all, whether its pins are the part's (they are
 * wired by position), and the generics it does not know. `pins` are the part's current ports.
 */
export function evoIssues(source: string, generics: string, pins: { inputs: PortShape[]; outputs: PortShape[] }): EvoIssue[] {
  const read = readEvoVhdl(source);
  if (!read.ok) {
    const { ok: _ok, ...failure } = read;
    return [{ code: 'unreadable', failure }];
  }
  const out: EvoIssue[] = [];
  if (!samePorts(read.inputs, pins.inputs) || !samePorts(read.outputs, pins.outputs)) out.push({ code: 'ports' });
  const entity = firstEntity(source, generics);
  if (entity && entity.generics.length > 0) {
    out.push({ code: 'generics', names: entity.generics.map((g) => g.name).join(', ') });
    if (generics.trim() !== '') out.push({ code: 'genericsSet', generics: generics.trim() });
  }
  return out;
}
