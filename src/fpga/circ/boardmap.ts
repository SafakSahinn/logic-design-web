// A design's board mapping in a .circ file, as Logisim-evolution stores it (Aşama 6i-5).
//
// evo keeps one <boardmap boardname="..."> per board inside the <circuit> it maps (XmlWriter.fromMap /
// XmlReader.loadMap) with one <mc> per mapped part, keyed by the part's label path ("/LED1"):
//   <mc key="/x" open="open"/>          every pin open
//   <mc key="/x" vconst="5"/>           every pin a constant, pin i = bit i
//   <mc key="/x" map="10,20"/>          the part on the whole resource whose rectangle holds the point
//   <mc key="/x" pmap="10_20_3,open,1,u"/>   pin by pin: resource "x_y" + its pin, open, a constant, unmapped
// The unit is the evo part the canvas part is written as (a Pin, a DIP switch, a 7-segment display ...), with that
// part's pin order (evo MapComponent / ComponentMapInformationContainer). A canvas part whose ports come from
// several written parts (an LED with several inputs: one output Pin each) has one unit per written part.
import type { CircuitComponentInstance, CircuitWire } from '../../types/circuit';
import { pinKey } from '../../utils/circuitEngine';
import { getTopLevelPorts } from '../../utils/hdlGenerator';
import type { BoardDefinition } from '../board/model';
import { labelProblem } from '../drc/design';
import {
  boardIoKey,
  collectMappableParts,
  dirCompatible,
  findBoardIo,
  ioLogicalPinCount,
  ioLogicalPinDir,
  mapWhole,
  uniformTarget,
  wholeResourceOf,
  type BoardMapping,
  type MappablePart,
  type PinDir,
  type PinTarget,
} from '../map/model';

// --- the evo parts canvas parts are written as -------------------------------------------------------------

/** One pin of an evo part: a canvas pin and its bit; no bit = every bit of that pin, LSB first */
export interface EvoPinRef {
  pinId: string;
  bit?: number;
}

/** A part of the written .circ the board map names by its label */
export interface EvoMapUnit {
  compId: string;
  /** The label it is written with (the map key is "/" + label) */
  label: string;
  /** Its pins in evo's order */
  pins: EvoPinRef[];
}

/**
 * The pins, in evo's order, of the one evo part a canvas part is written as and read back from (the .circ export
 * and import), when that part can be mapped in evo: an input / output Pin (switch, push button, LED, probe,
 * buzzer; evo's LED and Button come in as LED and push button), a DIP switch (switch 1..n), a 7-segment display
 * (segments a..g, dp: evo SevenSegment.Segment_A..DP), an RGB LED (red, green, blue) and a port I/O (its data
 * pins). Null for every other part: evo has no map for it (LED bar, dot matrix, hex digit display ...), or it is
 * written as several parts.
 */
export function evoPartPins(c: CircuitComponentInstance): EvoPinRef[] | null {
  const key = (k: string) => [...c.inputs, ...c.outputs].find((p) => pinKey(c, p) === k);
  const keyed = (keys: string[]): EvoPinRef[] | null => {
    const pins = keys.map(key);
    return pins.every((p) => !!p) ? pins.map((p) => ({ pinId: p!.id })) : null;
  };
  switch (c.type) {
    case 'switch':
    case 'pushbutton':
      return c.outputs.length === 1 ? [{ pinId: c.outputs[0].id }] : null;
    case 'led':
    case 'probe':
    case 'buzzer':
      return c.inputs.length === 1 ? [{ pinId: c.inputs[0].id }] : null;
    case 'dipSwitch':
      return keyed(c.outputs.map((_, i) => `out${i}`));
    case 'sevenSegment':
      return keyed(['inA', 'inB', 'inC', 'inD', 'inE', 'inF', 'inG', ...(key('inDP') ? ['inDP'] : [])]);
    case 'rgbLed':
      return keyed(['r', 'g', 'b']);
    case 'portIo': {
      // input: the data comes out of 'out'; output: it goes into 'in'; bidirectional: the pins read on 'out'
      const out = key('out');
      const inp = key('in');
      const p = out ?? inp;
      return p ? [{ pinId: p.id }] : null;
    }
    default:
      return null;
  }
}

/** A label evo keeps (CorrectLabel) and the map key can carry (its reader splits a key on spaces) */
export function isEvoMapLabel(label: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(label) && !labelProblem(label);
}

// --- evo's element order ----------------------------------------------------------------------------------------

/**
 * evo XmlWriter.sort orders an element's children by name, then by their attributes written as name="value"
 * ('&' and '"' escaped), sorted and joined by spaces, comparing UTF-16 code units (String.compareTo).
 */
export function evoAttrKey(attrs: readonly (readonly [string, string])[]): string {
  return attrs
    .map(([n, v]) => `${n}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .sort()
    .join(' ');
}

// --- writing ------------------------------------------------------------------------------------------------------

/** What the .circ could not carry, as an i18n code of the fpga namespace ('circ.note.<code>') and its values */
export interface CircMapNote {
  code: 'notWritten' | 'renamed' | 'otherBoards' | 'boardMissing' | 'unknownKey' | 'notMappable' | 'nestedKey' | 'legacyKey' | 'sizeMismatch' | 'badTarget' | 'ambiguousKey' | 'userMapKept';
  values: Record<string, string | number>;
}

const attrEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface BoardmapWriteInput {
  circuitName: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  mapping: BoardMapping;
  board: BoardDefinition;
  /** The written parts that can carry a map, in file order */
  units: EvoMapUnit[];
}

/** Indices of the part's pins behind the evo pins (-1: not a pin of the part) */
function unitPinIndices(part: MappablePart, refs: EvoPinRef[]): number[] {
  const out: number[] = [];
  for (const r of refs) {
    if (r.bit !== undefined) {
      out.push(part.pins.findIndex((p) => p.source?.pinId === r.pinId && p.source.bit === r.bit));
      continue;
    }
    const bits = part.pins
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p.source?.pinId === r.pinId)
      .sort((a, b) => a.p.source!.bit - b.p.source!.bit);
    if (bits.length === 0) out.push(-1);
    else out.push(...bits.map((x) => x.i));
  }
  return out;
}

const partText = (part: MappablePart) => part.label ?? part.pins[0]?.port ?? part.compId;

/**
 * Canvas ids of the parts whose map writeBoardmap would write: the stored targets still fit the part (one per pin;
 * a part whose width changed is left out) and at least one pin is mapped.
 */
export function mappedPartIds(input: { circuitName: string; components: CircuitComponentInstance[]; wires: CircuitWire[]; mapping: BoardMapping }): Set<string> {
  const parts = collectMappableParts(getTopLevelPorts(input.circuitName, input.components, input.wires), input.components);
  const ids = new Set<string>();
  for (const part of parts) {
    const t = input.mapping.parts[part.compId];
    if (t && t.length === part.pins.length && t.some((x) => !!x)) ids.add(part.compId);
  }
  return ids;
}

/**
 * The <boardmap> lines of a circuit (4 spaces in, its <mc> 6, as evo writes them), or none when nothing is
 * mapped. A part pin the file cannot carry (its part has no evo map) is reported.
 */
export function writeBoardmap(input: BoardmapWriteInput): { lines: string[]; notes: CircMapNote[] } {
  const { mapping, board } = input;
  const notes: CircMapNote[] = [];
  const parts = collectMappableParts(getTopLevelPorts(input.circuitName, input.components, input.wires), input.components);
  const targetsOf = (part: MappablePart) => {
    const t = mapping.parts[part.compId];
    return t && t.length === part.pins.length ? t : null;
  };
  // Every mapped pin, at evo's level: one entry per unit, and the rest of each part (it still takes resources)
  const evoParts: BoardMapping['parts'] = {};
  const written: { unit: EvoMapUnit; part: MappablePart; idx: number[]; id: string }[] = [];
  for (const part of parts) {
    const targets = targetsOf(part);
    if (!targets || targets.every((t) => !t)) continue;
    const covered = new Set<number>();
    input.units
      .filter((u) => u.compId === part.compId)
      .forEach((unit, k) => {
        const idx = unitPinIndices(part, unit.pins);
        if (idx.length === 0 || idx.some((i) => i < 0)) return;
        idx.forEach((i) => covered.add(i));
        const id = `${part.compId}#${k}`;
        evoParts[id] = idx.map((i) => targets[i] ?? null);
        written.push({ unit, part, idx, id });
      });
    const rest = targets.map((t, i) => (covered.has(i) ? null : t));
    if (rest.some((t) => !!t)) {
      evoParts[part.compId] = rest;
      notes.push({ code: 'notWritten', values: { part: partText(part) } });
    }
  }
  const evoMapping: BoardMapping = { board: mapping.board, parts: evoParts };
  const entries = new Map<string, [string, string][]>();
  for (const { unit, part, idx, id } of written) {
    const targets = evoParts[id];
    if (targets.every((t) => !t)) continue;
    const key = `/${unit.label}`;
    if (entries.has(key)) continue;
    const uniform = uniformTarget(targets);
    const unitPart: MappablePart = { ...part, compId: id, evoKey: key, pins: idx.map((i) => part.pins[i]) };
    const io = uniform ? undefined : wholeResourceOf(unitPart, targets, board, evoMapping);
    let attr: [string, string];
    if (uniform === 'open') attr = ['open', 'open'];
    else if (uniform) attr = ['vconst', uniform.value.toString()];
    else if (io) attr = ['map', `${io.rect.x},${io.rect.y}`];
    else attr = ['pmap', targets.map(pmapEntry).join(',')];
    entries.set(key, [['key', key], attr]);
  }
  if (entries.size === 0) return { lines: [], notes };
  // evo writes attributes sorted by name ('key' comes first) and the <mc>s sorted (XmlWriter.sort)
  const mcs = [...entries.values()]
    .map((attrs) => ({ sortKey: evoAttrKey(attrs), line: `      <mc ${attrs.map(([n, v]) => `${n}="${attrEsc(v)}"`).join(' ')}/>` }))
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((m) => m.line);
  const lines = [`    <boardmap boardname="${attrEsc(board.name)}">`, ...mcs, '    </boardmap>'];
  return { lines, notes };
}

function pmapEntry(t: PinTarget | null): string {
  if (!t) return 'u';
  if (t.kind === 'open') return 'open';
  if (t.kind === 'const') return String(t.value);
  return `${t.io}_${t.pin}`;
}

/**
 * A label for each unit that evo keeps and the map can name: the written one when it is usable and not taken
 * (ignoring case, as evo), else a free one made from it (or from evo's annotation name: Input, Output, ...).
 * `taken` holds every other label of the circuit (upper case) and grows with the ones given here.
 */
export function evoMapLabel(label: string, fallback: string, taken: Set<string>): string {
  const free = (l: string) => isEvoMapLabel(l) && !taken.has(l.toUpperCase());
  let result = label;
  if (!free(result)) {
    // letters with marks as their base letter (ş -> s, İ -> I; dotless ı -> i), anything else unusable -> '_'
    const ascii = label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
    let base = ascii.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base || !/^[A-Za-z]/.test(base)) base = fallback;
    result = base;
    for (let n = 1; !free(result); n++) result = `${base}_${n}`;
  }
  taken.add(result.toUpperCase());
  return result;
}

// --- reading ------------------------------------------------------------------------------------------------------

export type CircPinMapInfo = null | { kind: 'open' } | { kind: 'const'; value: bigint } | { kind: 'pin'; x: number; y: number; pin: number };

/** One <mc> as evo reads it (CircuitMapInfo) */
export type CircMapInfo =
  | { kind: 'open' }
  | { kind: 'const'; value: bigint }
  /** map="x,y", or the old valx / valy / valw / valh rectangle (its corner) */
  | { kind: 'whole'; x: number; y: number }
  | { kind: 'pins'; pins: CircPinMapInfo[] };

export interface CircBoardmap {
  board: string;
  /** Key -> map, in file order (a key written twice keeps its first place and its last map, as a HashMap) */
  entries: Map<string, CircMapInfo>;
}

const unsignedInt = (s: string): number | null => (/^\+?\d+$/.test(s) && Number(s) <= 0xffffffff ? Number(s) : null);
const signedLong = (s: string): bigint | null => {
  if (!/^[+-]?\d+$/.test(s)) return null;
  const v = BigInt(s);
  return v >= -(1n << 63n) && v < 1n << 63n ? v : null;
};
const unsignedLong = (s: string): bigint | null => {
  if (!/^\+?\d+$/.test(s)) return null;
  const v = BigInt(s);
  return v < 1n << 64n ? v : null;
};

/** One <mc>'s map (evo XmlReader.loadMap / MapComponent.getMapInfo); null when evo would drop it */
export function readMapInfo(mc: Element): CircMapInfo | null {
  if (mc.hasAttribute('open')) return { kind: 'open' };
  if (mc.hasAttribute('vconst')) {
    const v = signedLong(mc.getAttribute('vconst') ?? '');
    return v === null ? null : { kind: 'const', value: v };
  }
  if (['valx', 'valy', 'valw', 'valh'].every((a) => mc.hasAttribute(a))) {
    const [x, y, w, h] = ['valx', 'valy', 'valw', 'valh'].map((a) => unsignedInt(mc.getAttribute(a) ?? ''));
    return x === null || y === null || w === null || h === null ? null : { kind: 'whole', x, y };
  }
  if (mc.hasAttribute('map')) {
    const xy = (mc.getAttribute('map') ?? '').split(',');
    if (xy.length !== 2) return null;
    const [x, y] = xy.map(unsignedInt);
    return x === null || y === null ? null : { kind: 'whole', x, y };
  }
  if (mc.hasAttribute('pmap')) {
    const pins: CircPinMapInfo[] = [];
    for (const s of (mc.getAttribute('pmap') ?? '').split(',')) {
      if (s === 'u') pins.push(null);
      else if (s === 'open') pins.push({ kind: 'open' });
      else if (s.includes('_')) {
        const parts = s.split('_');
        if (parts.length !== 3) return null;
        const [x, y, pin] = parts.map(unsignedInt);
        if (x === null || y === null || pin === null) return null;
        pins.push({ kind: 'pin', x, y, pin });
      } else {
        const v = unsignedLong(s);
        if (v === null) return null;
        pins.push({ kind: 'const', value: v });
      }
    }
    return { kind: 'pins', pins };
  }
  return null;
}

/** The <boardmap>s of a <circuit> element, as evo reads them (nameless boards and empty maps are skipped) */
export function readBoardmaps(circuit: Element): CircBoardmap[] {
  const result: CircBoardmap[] = [];
  for (const bm of Array.from(circuit.childNodes)) {
    if (bm.nodeType !== 1 || (bm as Element).tagName !== 'boardmap') continue;
    const board = (bm as Element).getAttribute('boardname') ?? '';
    if (!board) continue;
    const entries = new Map<string, CircMapInfo>();
    for (const mc of Array.from(bm.childNodes)) {
      if (mc.nodeType !== 1 || (mc as Element).tagName !== 'mc') continue;
      const key = (mc as Element).getAttribute('key') ?? '';
      if (!key) continue;
      const info = readMapInfo(mc as Element);
      if (info) entries.set(key, info);
    }
    if (entries.size > 0) result.push({ board, entries });
  }
  return result;
}

export interface BoardmapApplyInput {
  circuitName: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  board: BoardDefinition;
}

/**
 * A loaded board map as the sheet's mapping (evo MappableResourcesContainer.tryMap / MapComponent.tryMap): each
 * key names a part by its label; a whole map takes the resource holding the point, a pin map is used only when it
 * has as many pins as the part, and a pin evo could not map there (no such resource or pin, wrong direction)
 * stays unmapped.
 */
export function applyBoardmap(bm: CircBoardmap, input: BoardmapApplyInput): { mapping: BoardMapping; notes: CircMapNote[] } {
  const { board } = input;
  const notes: CircMapNote[] = [];
  const mapping: BoardMapping = { board: board.name, parts: {} };
  const parts = collectMappableParts(getTopLevelPorts(input.circuitName, input.components, input.wires), input.components);
  for (const [key, info] of bm.entries) {
    // evo getHierarchyName: the last word, before any '#', split on '/'
    const words = key.split(' ');
    const hier = words[words.length - 1];
    if (hier.includes('#')) {
      notes.push({ code: 'legacyKey', values: { key } });
      continue;
    }
    const path = hier.split('/').filter((s) => s.length > 0);
    if (path.length !== 1) {
      notes.push({ code: path.length > 1 ? 'nestedKey' : 'unknownKey', values: { key } });
      continue;
    }
    // (a tunnel carries its net's name, often a pin's label; a part with no map here, e.g. a hex digit display or
    // a clock, is said as such)
    const labelled = input.components.filter((c) => c.type !== 'tunnel' && c.label?.trim() === path[0]);
    const comps = labelled.filter((c) => evoPartPins(c));
    if (comps.length !== 1) {
      notes.push({ code: comps.length ? 'ambiguousKey' : labelled.length ? 'notMappable' : 'unknownKey', values: { key } });
      continue;
    }
    const comp = comps[0];
    const part = parts.find((p) => p.compId === comp.id);
    const refs = evoPartPins(comp);
    const idx = part && refs ? unitPinIndices(part, refs) : [];
    if (!part || !refs || idx.length === 0 || idx.some((i) => i < 0)) {
      notes.push({ code: 'notMappable', values: { key } });
      continue;
    }
    const unitPart: MappablePart = { ...part, pins: idx.map((i) => part.pins[i]) };
    const n = idx.length;
    let targets: (PinTarget | null)[] | null = null;
    // evo tryOpenMap / tryConstantMap: only outputs (or bidirectional pins) are left open, only inputs take a constant
    const canOpen = (dir: PinDir) => dir !== 'in';
    const canConst = (dir: PinDir) => dir === 'in';
    if (info.kind === 'open') {
      if (unitPart.pins.every((p) => canOpen(p.dir))) targets = Array.from({ length: n }, () => ({ kind: 'open' as const }));
      else notes.push({ code: 'badTarget', values: { key } });
    } else if (info.kind === 'const') {
      if (unitPart.pins.every((p) => canConst(p.dir))) {
        targets = Array.from({ length: n }, (_, i) => ({ kind: 'const' as const, value: ((BigInt.asUintN(64, info.value) >> BigInt(i)) & 1n ? 1 : 0) as 0 | 1 }));
      } else notes.push({ code: 'badTarget', values: { key } });
    } else if (info.kind === 'whole') {
      const io = findBoardIo(board, `${info.x}_${info.y}`);
      targets = io ? mapWhole(unitPart, io) : null;
      if (!targets) notes.push({ code: 'badTarget', values: { key } });
    } else if (info.pins.length !== n) {
      notes.push({ code: 'sizeMismatch', values: { key, pins: info.pins.length, expected: n } });
    } else {
      let bad = false;
      targets = info.pins.map((p, i): PinTarget | null => {
        if (!p) return null;
        const pinDir = unitPart.pins[i].dir;
        if ((p.kind === 'open' && !canOpen(pinDir)) || (p.kind === 'const' && !canConst(pinDir))) {
          bad = true;
          return null;
        }
        if (p.kind === 'open') return { kind: 'open' };
        if (p.kind === 'const') return { kind: 'const', value: p.value & 1n ? 1 : 0 };
        const io = findBoardIo(board, `${p.x}_${p.y}`);
        const dir = io ? ioLogicalPinDir(io, p.pin) : undefined;
        if (!io || p.pin >= ioLogicalPinCount(io) || !dir || !dirCompatible(unitPart.pins[i].dir, dir)) {
          bad = true;
          return null;
        }
        return { kind: 'pin', io: boardIoKey(io), pin: p.pin };
      });
      if (bad) notes.push({ code: 'badTarget', values: { key } });
    }
    if (!targets) continue;
    const current = mapping.parts[part.compId] ?? part.pins.map(() => null);
    idx.forEach((pi, j) => (current[pi] = targets![j] ?? null));
    mapping.parts[part.compId] = current;
  }
  return { mapping, notes };
}
