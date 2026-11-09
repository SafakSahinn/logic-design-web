import type { CircuitComponentInstance, CircuitWire, ComponentType, CustomSubcircuit, SubcircuitPortDefinition } from '../types/circuit';
import type { Radix } from '../types/logic';
import {
  ARITH_PINS,
  ARITH_TYPES,
  arithGeometry,
  configureArith,
  configureBitExtender,
  configureBitSelector,
  configurePlexer,
  configureSplitter,
  createComponentInstance,
  PLEXER_TYPES,
  pinKey,
  getComponentSize,
  setBitWidth,
  setGateWidth,
  splitterDistribution,
  updatePinPositions,
} from './circuitEngine';
import { createSubcircuitInstance } from './subcircuitManager';
import { repairWires } from './wiringEngine';

export interface ImportedCircuitSheet {
  name: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  // What could not be imported exactly (skipped parts, wide gates, negated inputs ...)
  warnings: string[];
}

export type ImportedLogisimCircuit = ImportedCircuitSheet;

export interface ImportedCircFile {
  /** One sheet per Logisim circuit, in file order */
  sheets: ImportedCircuitSheet[];
  /** IC definitions for the circuits used as subcircuits (inner ones first); the caller adds them to the
   * library before simulating. The id is derived from the circuit's content, so importing the same file
   * again gives the same ids. */
  subcircuits: CustomSubcircuit[];
  /** Name of the file's main circuit (Logisim <main>) */
  main?: string;
}

/**
 * Maps standard CAD / .circ circuit component names to LogicDesign Studio component types.
 */
function mapCircCompType(name: string, isOutputPin: boolean, constantVal?: string): ComponentType | null {
  const n = name.trim().toLowerCase();

  if (n === 'and gate') return 'and';
  if (n === 'or gate') return 'or';
  if (n === 'not gate') return 'not';
  if (n === 'nand gate') return 'nand';
  if (n === 'nor gate') return 'nor';
  if (n === 'xor gate') return 'xor';
  if (n === 'xnor gate') return 'xnor';
  if (n === 'controlled buffer') return 'triState';
  if (n === 'controlled inverter') return 'controlledInverter';
  if (n === 'buffer') return 'buffer';

  if (n === 'pin') {
    return isOutputPin ? 'probe' : 'switch';
  }
  if (n === 'clock') return 'clock';
  if (n === 'tunnel') return 'tunnel';
  if (n === 'pull resistor') return 'pullResistor';
  if (n === 'constant') {
    return constantVal === '0' || constantVal === '0x0' ? 'gnd' : 'vcc';
  }
  if (n === 'probe') return 'probe';
  if (n === 'led') return 'led';
  if (n === 'splitter') return 'splitter';
  if (n === 'bit extender') return 'bitExtender';
  if (n === 'bitselector') return 'bitSelector';
  if (n.includes('7-segment') || n === 'seven segment') return 'sevenSegment';
  if (n.includes('hex digit') || n === 'hex display') return 'hexDisplay';
  if (n.includes('buzzer') || n === 'speaker') return 'buzzer';
  if (n.includes('dot matrix') || n === 'dotmatrix') return 'dotMatrix8x8';
  if (n.includes('rgb') || n.includes('video') || n.includes('screen')) return 'rgbMatrix16x16';
  if (n.includes('keyboard') || n === 'tty') return 'asciiKeyboard';
  if (n.includes('dip switch') || n === 'dipswitch') return 'dipSwitch4';

  // Arithmetic (Logisim std/arith; Absolute, MinMax, SquareRoot, Exponentiator only in evolution)
  const arith = LOGISIM_ARITH_TYPE[n];
  if (arith) return arith;

  // Combinational
  if (n === 'multiplexer' || n === 'mux') return 'multiplexer';
  if (n === 'demultiplexer' || n === 'demux') return 'demultiplexer';
  if (n === 'decoder') return 'decoder';
  if (n === 'priority encoder') return 'priorityEncoder';
  if (n === 'alu' || n.includes('arithmetic logic unit')) return 'alu4';

  // Sequential
  if (n.includes('d flip-flop') || n === 'd flip flop') return 'dFlipFlop';
  if (n.includes('j-k flip-flop') || n === 'jk flip flop') return 'jkFlipFlop';
  if (n.includes('t flip-flop') || n === 't flip flop') return 'tFlipFlop';
  if (n === 's-r flip-flop' || n === 'sr latch') return 'srLatch';
  if (n === 'register') return 'register4';
  if (n === 'counter') return 'counter4';
  if (n.includes('shift register')) return 'shiftRegister4';
  if (n === 'ram') return 'ram16x4';
  if (n === 'rom') return 'rom16x4';

  return null;
}

// Parts whose width is taken over from the file; any other Logisim part wider than 1 bit becomes 1 bit
const WIDE_IMPORT = new Set<ComponentType>([
  'switch', 'probe', 'led', 'constant', 'tunnel', 'pullResistor', 'splitter', 'bitExtender', 'bitSelector', 'subcircuit',
  'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'not', 'buffer', 'triState', 'controlledInverter',
  'multiplexer', 'demultiplexer',
]);
// Logisim's most inputs per gate; ours takes as many
const MAX_IMPORT_GATE_INPUTS = 32;

// Logisim Probe 'radix' attribute -> ours
const RADIX: Record<string, Radix> = { '2': '2', '8': '8', '10signed': '10s', '10unsigned': '10u', '16': '16' };

/**
 * Parses coordinates string "(x,y)" into { x: number, y: number }
 */
function parseCoord(coordStr: string | null): { x: number; y: number } | null {
  if (!coordStr) return null;
  const match = coordStr.match(/\((-?\d+),\s*(-?\d+)\)/);
  if (!match) return null;
  return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
}

interface Pt {
  x: number;
  y: number;
}

const GATE_TYPES: ComponentType[] = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'];

// Logisim draws every part facing east by default; other facings turn the part around its anchor (loc)
const FACING_ROTATION: Record<string, 0 | 90 | 180 | 270> = { east: 0, south: 90, west: 180, north: 270 };

// Local (east-facing) offset -> canvas offset for a facing
const rotateOffset = (p: Pt, rot: number): Pt => {
  if (rot === 90) return { x: -p.y, y: p.x };
  if (rot === 180) return { x: -p.x, y: -p.y };
  if (rot === 270) return { x: p.y, y: -p.x };
  return p;
};

/**
 * Logisim 2.7.1 SplitterParameters: location of every split end relative to the splitter's loc (the
 * combined end), end 0 first. Not a plain rotation of the east-facing layout: facing west / north the
 * ends run the other way round (checked in Logisim for every facing and appearance).
 */
export function logisimSplitterEnds(facing: string, appear: string, fanout: number): Pt[] {
  const justify = appear === 'right' ? 1 : appear === 'left' ? -1 : 0; // center and legacy: 0
  const w = 20;
  let dx0: number, dy0: number, ddx: number, ddy: number;
  if (facing === 'north' || facing === 'south') {
    const m = facing === 'north' ? 1 : -1;
    dx0 = justify === 0 ? 10 * (Math.floor((fanout + 1) / 2) - 1) : m * justify < 0 ? -10 : 10 * fanout;
    dy0 = -m * w;
    ddx = -10;
    ddy = 0;
  } else {
    const m = facing === 'west' ? -1 : 1;
    dx0 = m * w;
    dy0 = justify === 0 ? -10 * Math.floor(fanout / 2) : m * justify > 0 ? 10 : -10 * fanout;
    ddx = 0;
    ddy = 10;
  }
  return Array.from({ length: fanout }, (_, i) => ({ x: dx0 + i * ddx, y: dy0 + i * ddy }));
}

export type LogisimPlexer = 'multiplexer' | 'demultiplexer' | 'decoder' | 'priorityEncoder';

const dirStep: Record<string, Pt> = { east: { x: 1, y: 0 }, west: { x: -1, y: 0 }, north: { x: 0, y: -1 }, south: { x: 0, y: 1 } };

/**
 * Logisim 2.7.1 plexer ports (std/plexers updatePorts) relative to the part's loc, in Logisim's port order:
 *  - Multiplexer:   data 0..n-1, select, [enable], output (at loc)
 *  - Demultiplexer: outputs 0..n-1, select, [enable], data input (at loc)
 *  - Decoder:       outputs 0..n-1, select (at loc), [enable]
 *  - Priority Encoder: inputs 0..n-1, output (at loc), EN_IN, EN_OUT, GS (no enable / select location)
 * The two-way parts have their own table per facing, which is not a rotation of the east one; every facing
 * and select location was checked on the Logisim 2.7.1 jar.
 */
export function logisimPlexerPorts(kind: LogisimPlexer, facing: string, selloc: string, select: number, enable: boolean): Pt[] {
  const n = 1 << select;
  const m = selloc === 'tr' ? -1 : 1;
  const tr = (p: Pt, d: number): Pt => ({ x: p.x + (dirStep[facing] ?? dirStep.east).x * d, y: p.y + (dirStep[facing] ?? dirStep.east).y * d });
  const P = (x: number, y: number): Pt => ({ x, y });
  if (kind === 'priorityEncoder') {
    if (facing === 'north' || facing === 'south') {
      const x = -5 * n + 10;
      const y = facing === 'north' ? 40 : -40;
      return [...Array.from({ length: n }, (_, k) => P(x + 10 * k, y)), P(0, 0), P(x + 10 * n, y / 2), P(x - 10, y / 2), P(10, 0)];
    }
    const x = facing === 'west' ? 40 : -40;
    const y = -5 * n + 10;
    return [...Array.from({ length: n }, (_, k) => P(x, y + 10 * k)), P(0, 0), P(x / 2, y + 10 * n), P(x / 2, y - 10), P(0, 10)];
  }
  if (kind === 'decoder') {
    const isTr = selloc === 'tr';
    let ps: Pt[];
    if (n === 2) {
      if (facing === 'north' || facing === 'south') {
        const y = facing === 'north' ? -10 : 10;
        ps = isTr ? [P(-30, y), P(-10, y)] : [P(10, y), P(30, y)];
      } else {
        const x = facing === 'west' ? -10 : 10;
        ps = isTr ? [P(x, 10), P(x, 30)] : [P(x, -30), P(x, -10)];
      }
    } else {
      let dx: number, ddx: number, dy: number, ddy: number;
      if (facing === 'north' || facing === 'south') {
        dy = facing === 'north' ? -20 : 20;
        ddy = 0;
        dx = isTr ? -10 * n : 0;
        ddx = 10;
      } else {
        dx = facing === 'west' ? -20 : 20;
        ddx = 0;
        dy = isTr ? 0 : -10 * n;
        ddy = 10;
      }
      ps = Array.from({ length: n }, (_, k) => P(dx + k * ddx, dy + k * ddy));
    }
    return [...ps, P(0, 0), ...(enable ? [tr(P(0, 0), -10)] : [])];
  }
  const isMux = kind === 'multiplexer';
  // The demultiplexer is the multiplexer mirrored: its ends sit on the facing side
  const s = isMux ? 1 : -1;
  let ps: Pt[];
  let sel: Pt;
  if (n === 2) {
    if (facing === 'west') {
      ps = [P(s * 30, -10), P(s * 30, 10)];
      sel = P(s * 20, m * 20);
    } else if (facing === 'north') {
      ps = [P(-10, s * 30), P(10, s * 30)];
      sel = P(m * -20, s * 20);
    } else if (facing === 'south') {
      ps = [P(-10, -s * 30), P(10, -s * 30)];
      sel = P(m * -20, -s * 20);
    } else {
      ps = [P(-s * 30, -10), P(-s * 30, 10)];
      sel = P(-s * 20, m * 20);
    }
  } else {
    let dx = -(n / 2) * 10;
    let ddx = 10;
    let dy = -(n / 2) * 10;
    let ddy = 10;
    if (facing === 'west') {
      dx = s * 40;
      ddx = 0;
      sel = P(s * 20, m * (dy + 10 * n));
    } else if (facing === 'north') {
      dy = s * 40;
      ddy = 0;
      sel = P(m * dx, s * 20);
    } else if (facing === 'south') {
      dy = -s * 40;
      ddy = 0;
      sel = P(m * dx, -s * 20);
    } else {
      dx = -s * 40;
      ddx = 0;
      sel = P(-s * 20, m * (dy + 10 * n));
    }
    ps = Array.from({ length: n }, (_, k) => P(dx + k * ddx, dy + k * ddy));
  }
  return [...ps, sel, ...(enable ? [tr(sel, isMux ? 10 : -10)] : []), P(0, 0)];
}

/** Our pin key for each Logisim plexer port (same order as logisimPlexerPorts) */
export function logisimPlexerPortKeys(kind: LogisimPlexer, select: number, enable: boolean): string[] {
  const n = 1 << select;
  const many = (p: string) => Array.from({ length: n }, (_, k) => `${p}${k}`);
  const en = enable ? ['en'] : [];
  if (kind === 'multiplexer') return [...many('in'), 'sel', ...en, 'out'];
  if (kind === 'demultiplexer') return [...many('out'), 'sel', ...en, 'in'];
  if (kind === 'decoder') return [...many('out'), 'sel', ...en];
  return [...many('in'), 'out', 'en', 'eo', 'gs'];
}

/**
 * Plexer attribute defaults of the program that wrote a file. Logisim leaves attributes at their default out
 * of the file, and the defaults changed: Logisim 2.7.1 floats disabled outputs and (from 2.6.3.220) gives
 * MUX / DEMUX / decoder an enable input; Logisim-evolution disables to 0 and, after 3.6.1, adds no enable
 * to new MUX / DEMUX (the decoder keeps it).
 */
export function logisimPlexerDefaults(source: string, kind: LogisimPlexer): { enable: boolean; disabled: '0' | 'Z' } {
  const v = (source.match(/\d+/g) ?? ['2', '7', '1']).map(Number);
  const cmp = (o: number[]) => {
    for (let k = 0; k < Math.max(v.length, o.length); k++) {
      const d = (v[k] ?? 0) - (o[k] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  // The priority encoder has no enable setting: its EN_IN is always there
  if (kind === 'priorityEncoder') return { enable: true, disabled: (v[0] ?? 2) < 3 ? 'Z' : '0' };
  if ((v[0] ?? 2) < 3) return { enable: cmp([2, 6, 3, 220]) >= 0, disabled: 'Z' };
  return { enable: kind === 'decoder' || cmp([3, 6, 1]) <= 0, disabled: '0' };
}

// Logisim arithmetic element names (std/arith, library "#Arithmetic"); the last four are evolution's
const LOGISIM_ARITH: Array<[ComponentType, string]> = [
  ['adder', 'Adder'],
  ['subtractor', 'Subtractor'],
  ['multiplier', 'Multiplier'],
  ['divider', 'Divider'],
  ['negator', 'Negator'],
  ['comparator', 'Comparator'],
  ['shifter', 'Shifter'],
  ['bitAdder', 'BitAdder'],
  ['bitFinder', 'BitFinder'],
  ['absolute', 'Absolute'],
  ['minMax', 'MinMax'],
  ['squareRoot', 'SquareRoot'],
  ['exponentiator', 'Exponentiator'],
];
const LOGISIM_ARITH_TYPE: Record<string, ComponentType> = Object.fromEntries(LOGISIM_ARITH.map(([t, n]) => [n.toLowerCase(), t]));
/** Logisim element name of each arithmetic part */
export const LOGISIM_ARITH_NAME = Object.fromEntries(LOGISIM_ARITH) as Partial<Record<ComponentType, string>>;
/** Arithmetic parts Logisim 2.7.1 does not have (evolution only) */
export const EVO_ONLY_ARITH = new Set<ComponentType>(['absolute', 'minMax', 'squareRoot', 'exponentiator']);

/**
 * Connection points of a Logisim arithmetic part relative to its loc, each with our pin key (inputs first,
 * in ARITH_PINS order). Logisim's arithmetic parts have no facing: they always face east.
 */
export function logisimArithPorts(type: ComponentType, inputs: number): Array<{ key: string; off: Pt }> {
  const g = arithGeometry(type, inputs);
  const spec = ARITH_PINS[type]!;
  const ins = type === 'bitAdder' ? Array.from({ length: inputs }, (_, i) => `in${i}`) : spec.inputs;
  return [...ins, ...spec.outputs].map((key) => ({ key, off: { x: g.pins[key].x - g.anchor.x, y: g.pins[key].y - g.anchor.y } }));
}

type ArithMode = 'signed' | 'signedUnsigned' | 'unsigned';
const ARITH_MODE_ATTR: Record<string, ArithMode> = { twosComplement: 'signed', signedUnsigned: 'signedUnsigned', unsigned: 'unsigned' };
/** Logisim 'mode' attribute value of our operand reading */
export const LOGISIM_ARITH_MODE: Record<ArithMode, string> = { signed: 'twosComplement', signedUnsigned: 'signedUnsigned', unsigned: 'unsigned' };
/** Parts with a 'mode' attribute (2.7.1: only the comparator) */
export const ARITH_MODE_PARTS = new Set<ComponentType>(['comparator', 'multiplier', 'divider', 'minMax', 'exponentiator']);

/**
 * Settings of a Logisim arithmetic part. Logisim leaves attributes at their default out of the file:
 * width 8 (evolution's exponentiator 32), one bit adder input, shift 'll', find 'low1', and mode
 * twosComplement for the comparator, unsigned for the others. Logisim 2.7.1 has no multiplier mode, but
 * its 32-bit multiplier works on Java ints and so multiplies signed: read that one as signed.
 */
export function logisimArithSettings(
  type: ComponentType,
  attr: Record<string, string>,
  source: string
): { width: number; inputs: number; mode?: ArithMode; shiftType?: string; findType?: string; notes: string[] } {
  const notes: string[] = [];
  const major = Number((source.match(/\d+/) ?? ['2'])[0]);
  const int = (v: string | undefined, dflt: number) => {
    const n = v === undefined ? NaN : parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  let width = int(attr.width, type === 'exponentiator' ? 32 : 8);
  if (width > 32) {
    notes.push(`${width} bitlik, 32 bit olarak alındı.`);
    width = 32;
  }
  let inputs = type === 'bitAdder' ? int(attr.inputs, 1) : 1;
  if (inputs > 32) {
    notes.push(`${inputs} girişli, 32 girişle alındı.`);
    inputs = 32;
  }
  let mode: ArithMode | undefined;
  if (ARITH_MODE_PARTS.has(type)) {
    mode = ARITH_MODE_ATTR[attr.mode ?? ''];
    if (mode === 'signedUnsigned' && type !== 'multiplier') mode = undefined;
    if (!mode) mode = type === 'comparator' ? 'signed' : type === 'multiplier' && major < 3 && width === 32 ? 'signed' : 'unsigned';
  }
  if (type === 'divider' && major < 3 && width === 32 && !attr.mode)
    notes.push(`Logisim 2.7.1'in 32 bitlik bölücüsü, üst girişin en yüksek biti 1 iken farklı sonuç verebilir (evolution gibi hesaplanıyor).`);
  const shiftType = type === 'shifter' ? (['ll', 'lr', 'ar', 'rl', 'rr'].includes(attr.shift) ? attr.shift : 'll') : undefined;
  const findType = type === 'bitFinder' ? (['low1', 'high1', 'low0', 'high0'].includes(attr.type) ? attr.type : 'low1') : undefined;
  return { width, inputs, mode, shiftType, findType, notes };
}

/**
 * Logisim 2.7.1 DefaultAppearance: where each Pin of a circuit appears on its subcircuit box, relative to
 * the anchor (the instance's loc). A pin facing east sits on the west edge and so on; pins of an edge are
 * ordered by y (west / east) or x (north / south), 10 apart. The anchor is the first east port, else the
 * first north, west, south one.
 */
export function logisimDefaultPortOffsets(pins: Array<{ loc: Pt; facing: string }>): Pt[] {
  const edgeOf: Record<string, 'west' | 'east' | 'north' | 'south'> = { east: 'west', west: 'east', north: 'south', south: 'north' };
  const edge: Record<'west' | 'east' | 'north' | 'south', number[]> = { west: [], east: [], north: [], south: [] };
  pins.forEach((p, i) => edge[edgeOf[p.facing] ?? 'west'].push(i));
  // Location.compareTo: x first, then y
  const cmpXY = (a: number, b: number) => pins[a].loc.x - pins[b].loc.x || pins[a].loc.y - pins[b].loc.y;
  edge.west.sort((a, b) => pins[a].loc.y - pins[b].loc.y || cmpXY(a, b));
  edge.east.sort((a, b) => pins[a].loc.y - pins[b].loc.y || cmpXY(a, b));
  edge.north.sort(cmpXY);
  edge.south.sort(cmpXY);
  const [nN, nS, nE, nW] = [edge.north.length, edge.south.length, edge.east.length, edge.west.length];
  const maxVert = Math.max(nN, nS);
  const maxHorz = Math.max(nE, nW);
  const offset = (numFacing: number, numOpposite: number, maxOthers: number) => {
    const maxThis = Math.max(numFacing, numOpposite);
    const maxOffs = maxThis <= 1 ? (maxOthers === 0 ? 15 : 10) : maxThis === 2 ? 10 : maxOthers === 0 ? 5 : 10;
    return maxOffs + 10 * Math.trunc((maxThis - numFacing) / 2);
  };
  const dim = (maxThis: number, maxOthers: number) => (maxThis < 3 ? 30 : maxOthers === 0 ? 10 * maxThis : 10 * maxThis + 10);
  const oN = offset(nN, nS, maxHorz);
  const oS = offset(nS, nN, maxHorz);
  const oE = offset(nE, nW, maxVert);
  const oW = offset(nW, nE, maxVert);
  const width = dim(maxVert, maxHorz);
  const height = dim(maxHorz, maxVert);
  const anchor = nE > 0 ? { x: width, y: oE } : nN > 0 ? { x: oN, y: 0 } : nW > 0 ? { x: 0, y: oW } : nS > 0 ? { x: oS, y: height } : { x: 0, y: 0 };
  const out: Pt[] = new Array(pins.length);
  edge.west.forEach((pi, k) => (out[pi] = { x: 0 - anchor.x, y: oW + 10 * k - anchor.y }));
  edge.east.forEach((pi, k) => (out[pi] = { x: width - anchor.x, y: oE + 10 * k - anchor.y }));
  edge.north.forEach((pi, k) => (out[pi] = { x: oN + 10 * k - anchor.x, y: 0 - anchor.y }));
  edge.south.forEach((pi, k) => (out[pi] = { x: oS + 10 * k - anchor.x, y: height - anchor.y }));
  return out;
}

// Logisim controlled buffer / inverter: data input, then control input (below the body when
// right-handed, above when left-handed). The inverter is 30 long unless its size is narrow (20).
const controlledOffsets = (type: ComponentType, size: number, leftHanded: boolean): Pt[] => {
  const len = type === 'controlledInverter' && size !== 20 ? 30 : 20;
  return [
    { x: -len, y: 0 },
    { x: -(len - 10), y: leftHanded ? -10 : 10 },
  ];
};

// Logisim 2.7 gate input spacing (AbstractGate), checked in Logisim for size 50 and 2..5 inputs
const gateInputOffsets = (inputs: number, size: number): number[] => {
  let ss: number, sd: number, sl: number;
  if (inputs <= 3) {
    if (size < 40) [ss, sd, sl] = [-5, 10, 10];
    else if (size < 60 || inputs <= 2) [ss, sd, sl] = [-10, 20, 20];
    else [ss, sd, sl] = [-15, 30, 30];
  } else if (inputs === 4 && size >= 60) [ss, sd, sl] = [-5, 20, 0];
  else [ss, sd, sl] = [-5, 10, 10];
  return Array.from({ length: inputs }, (_, i) =>
    inputs % 2 ? ss * (inputs - 1) + sd * i : ss * inputs + sd * i + (i >= inputs / 2 ? sl : 0)
  );
};
// Flip-flop connection points relative to loc (Q at loc), measured in Logisim 2.7.1
const FF_POINTS: Record<string, { inputs: Pt[]; outputs: Pt[] }> = {
  dFlipFlop: { inputs: [{ x: -40, y: 20 }, { x: -40, y: 0 }], outputs: [{ x: 0, y: 0 }, { x: 0, y: 20 }] }, // D, CLK
  tFlipFlop: { inputs: [{ x: -40, y: 20 }, { x: -40, y: 0 }, { x: -10, y: 30 }], outputs: [{ x: 0, y: 0 }, { x: 0, y: 20 }] }, // T, CLK, reset
  jkFlipFlop: { inputs: [{ x: -40, y: 0 }, { x: -40, y: 10 }, { x: -40, y: 20 }], outputs: [{ x: 0, y: 0 }, { x: 0, y: 20 }] }, // J, CLK, K
  srLatch: { inputs: [{ x: -40, y: 0 }, { x: -40, y: 20 }], outputs: [{ x: 0, y: 0 }, { x: 0, y: 20 }] }, // S, R (clock dropped)
};

// Logisim 2.7.1 BitSelector: data and select inputs per facing (output at loc); not a plain rotation
const BIT_SELECTOR_POINTS: Record<string, [Pt, Pt]> = {
  east: [{ x: -30, y: 0 }, { x: -10, y: 10 }],
  west: [{ x: 30, y: 0 }, { x: 10, y: 10 }],
  north: [{ x: 0, y: 30 }, { x: -10, y: 10 }],
  south: [{ x: 0, y: -30 }, { x: -10, y: -10 }],
};

// FNV-1a, for content-derived IC ids
const hash32 = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

// A Logisim Pin of a circuit, i.e. a port when the circuit is used as a subcircuit
interface CircPin {
  loc: Pt;
  facing: string;
  isOutput: boolean;
  label: string;
  width: number;
  compId: string;
  pinId: string;
}

interface SubcircuitInfo {
  def: CustomSubcircuit;
  // Logisim port locations relative to the instance's loc (facing east), in our port order
  inOffsets: Pt[];
  outOffsets: Pt[];
}

/**
 * Parses Standard CAD XML (.circ) file and converts to native project sheets.
 *
 * Logisim stores a wire as many straight segments that only touch the parts at their pin locations, and
 * Logisim parts have other sizes than ours. So the importer rebuilds the electrical nets from the wire
 * geometry (segments joined at endpoints, or an endpoint on another segment), finds which Logisim pin
 * location each net reaches, and connects the matching pins of our parts. repairWires then routes them.
 * Bit widths come over as they are (wide pins, constants, splitters, bit extenders / selectors, IC
 * ports); a circuit used inside another one becomes an IC definition.
 */
export function importCircXmlFile(xmlText: string): ImportedCircFile {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

  const circuits = Array.from(xmlDoc.getElementsByTagName('circuit'));
  // Version of the program that wrote the file (its attribute defaults are not written out)
  const fileSource = xmlDoc.documentElement?.getAttribute('source') ?? '2.7.1';
  if (circuits.length === 0) {
    throw new Error('Geçerli bir .circ devre dosyası bulunamadı (circuit etiketi yok).');
  }

  const circuitByName = new Map<string, Element>();
  circuits.forEach((c, i) => circuitByName.set(c.getAttribute('name') || `Devre ${i + 1}`, c));
  // Logisim parts that carry no logic
  const DECORATIVE = new Set(['text', 'probe text']);

  const imported = new Map<string, { sheet: ImportedCircuitSheet; pins: CircPin[]; signature: string }>();
  const inProgress = new Set<string>();
  const subInfo = new Map<string, SubcircuitInfo | null>();
  const subcircuits: CustomSubcircuit[] = [];

  // IC definition of a circuit used as a subcircuit (null: recursive use)
  const subcircuitOf = (name: string): SubcircuitInfo | null => {
    if (subInfo.has(name)) return subInfo.get(name)!;
    const r = importNamed(name);
    if (!r) return null;
    const elem = circuitByName.get(name)!;

    // Port locations: the circuit's own appearance when the file has one, else Logisim's default
    let offsets = logisimDefaultPortOffsets(r.pins);
    const appear = elem.getElementsByTagName('appear')[0];
    if (appear) {
      const centre = (e: Element): Pt => ({
        x: Number(e.getAttribute('x')) + Number(e.getAttribute('width')) / 2,
        y: Number(e.getAttribute('y')) + Number(e.getAttribute('height')) / 2,
      });
      const anchorElem = appear.getElementsByTagName('circ-anchor')[0];
      const ports = Array.from(appear.getElementsByTagName('circ-port'));
      if (anchorElem && ports.length) {
        const a = centre(anchorElem);
        const custom = r.pins.map((p) => {
          const port = ports.find((e) => {
            // Logisim writes the pin location as "x,y" here (no parentheses)
            const m = (e.getAttribute('pin') || '').match(/(-?\d+)\s*,\s*(-?\d+)/);
            const at = m ? { x: Number(m[1]), y: Number(m[2]) } : null;
            return at && at.x === p.loc.x && at.y === p.loc.y;
          });
          if (!port) return null;
          const c = centre(port);
          return { x: c.x - a.x, y: c.y - a.y };
        });
        if (custom.every((c) => c)) offsets = custom as Pt[];
      }
    }

    // Our IC: inputs on the left, outputs on the right, each in the order they appear on the Logisim box
    const order = r.pins.map((_, i) => i).sort((a, b) => offsets[a].y - offsets[b].y || offsets[a].x - offsets[b].x);
    const ins = order.filter((i) => !r.pins[i].isOutput);
    const outs = order.filter((i) => r.pins[i].isOutput);
    const port = (i: number, k: number): SubcircuitPortDefinition => {
      const p = r.pins[i];
      const def: SubcircuitPortDefinition = {
        id: `port_${p.isOutput ? 'out' : 'in'}_${k}`,
        name: p.label || `${p.isOutput ? 'out' : 'in'}${k}`,
        type: p.isOutput ? 'output' : 'input',
        targetCompId: p.compId,
        targetPinId: p.pinId,
      };
      // Logisim takes a port's width from its Pin
      if (p.width > 1) def.width = p.width;
      return def;
    };
    const ports = [...ins.map(port), ...outs.map(port)];
    const components: CircuitComponentInstance[] = JSON.parse(JSON.stringify(r.sheet.components));
    const def: CustomSubcircuit = {
      id: `sub_circ_${hash32(name + '|' + r.signature)}`,
      name,
      chipCode: 'IC-CIRC',
      description: `Logisim .circ dosyasından içe aktarıldı ("${name}" devresi).`,
      category: 'custom',
      width: 120,
      height: Math.max(60, (Math.max(ins.length, outs.length) + 1) * 20),
      ports,
      components,
      wires: repairWires(JSON.parse(JSON.stringify(r.sheet.wires)), components),
      createdAt: 0,
    };
    const info = { def, inOffsets: ins.map((i) => offsets[i]), outOffsets: outs.map((i) => offsets[i]) };
    subInfo.set(name, info);
    subcircuits.push(def);
    return info;
  };

  const importNamed = (name: string) => {
    if (imported.has(name)) return imported.get(name)!;
    if (inProgress.has(name)) return null;
    inProgress.add(name);
    const r = importCircuit(circuitByName.get(name)!, name, circuits.indexOf(circuitByName.get(name)!));
    inProgress.delete(name);
    imported.set(name, r);
    return r;
  };

  const importCircuit = (circuitElem: Element, circuitName: string, cIdx: number) => {
    const rawComps = Array.from(circuitElem.getElementsByTagName('comp'));
    const rawWires = Array.from(circuitElem.getElementsByTagName('wire'));
    // Content signature for the IC id: parts with their attributes, wires, and the ICs used inside
    const sig: string[] = [];

    // 1. Wire segments and nets (union-find over grid points)
    const segs: Array<{ a: Pt; b: Pt }> = [];
    for (const wireNode of rawWires) {
      const a = parseCoord(wireNode.getAttribute('from'));
      const b = parseCoord(wireNode.getAttribute('to'));
      sig.push(`w${wireNode.getAttribute('from')}${wireNode.getAttribute('to')}`);
      if (a && b && (a.x !== b.x || a.y !== b.y)) segs.push({ a, b });
    }
    const key = (p: Pt) => `${p.x},${p.y}`;
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      if (!parent.has(k)) parent.set(k, k);
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let c = k;
      while (parent.get(c) !== r) {
        const n = parent.get(c)!;
        parent.set(c, r);
        c = n;
      }
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const onSeg = (p: Pt, s: { a: Pt; b: Pt }) =>
      (s.a.x === s.b.x && p.x === s.a.x && p.y >= Math.min(s.a.y, s.b.y) && p.y <= Math.max(s.a.y, s.b.y)) ||
      (s.a.y === s.b.y && p.y === s.a.y && p.x >= Math.min(s.a.x, s.b.x) && p.x <= Math.max(s.a.x, s.b.x));
    const endpoints = new Map<string, Pt>();
    for (const s of segs) {
      union(key(s.a), key(s.b));
      endpoints.set(key(s.a), s.a);
      endpoints.set(key(s.b), s.b);
    }
    // An endpoint lying on another segment connects to it (Logisim splits the wire there)
    for (const p of endpoints.values()) {
      for (const s of segs) if (onSeg(p, s)) union(key(p), key(s.a));
    }
    // Net of a Logisim pin location: an endpoint there, or a segment passing over it
    const netAt = (p: Pt): string | null => {
      if (endpoints.has(key(p))) return find(key(p));
      for (const s of segs) if (onSeg(p, s)) return find(key(s.a));
      return null;
    };

    // 2. Parts: create ours and remember which Logisim pin location belongs to which of our pins
    const components: CircuitComponentInstance[] = [];
    const skipped = new Map<string, number>();
    const warnings: string[] = [];
    const pins: CircPin[] = [];
    const attach: Array<{ at: Pt; compId: string; pinId: string; isOutput: boolean }> = [];
    // Our parts are bigger than Logisim's (an AND gate is 80px instead of 50px), spread the layout out
    const SCALE = 1.6;
    const scaled = (p: Pt): Pt => ({ x: Math.round((p.x * SCALE) / 10) * 10, y: Math.round((p.y * SCALE) / 10) * 10 });

    // Pass 1: read every part, and collect the connection points of the non-gate ones so a gate input
    // counts as used when a wire, a tunnel or another part's pin touches it
    type RawPart = {
      compName: string;
      loc: Pt;
      nativeType: ComponentType;
      attr: Record<string, string>;
      isOutput: boolean;
      label?: string;
      facing: string;
      rot: number;
      size: number;
      width: number;
      inputsAttr: number;
      xorMode?: string;
      /** Negated gate inputs, 1-based (Logisim negateN + 1) */
      negated: number[];
      leftHanded: boolean;
      pull?: string;
      outMode?: '01' | '0Z' | 'Z1';
      sub?: SubcircuitInfo;
      where: string;
    };
    const parts: RawPart[] = [];
    const occupied = new Set<string>();
    const local = (loc: Pt, off: Pt, rot: number): Pt => {
      const r = rotateOffset(off, rot);
      return { x: loc.x + r.x, y: loc.y + r.y };
    };
    const num = (v: string | undefined, dflt: number) => {
      const n = v === undefined ? NaN : parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : dflt;
    };
    // Splitter end points, bit extender / selector inputs (the output or combined end is at loc)
    const splitterEnds = (attr: Record<string, string>) => logisimSplitterEnds(attr.facing || 'east', attr.appear || 'left', num(attr.fanout, 2));
    const extenderPoints = (attr: Record<string, string>): Pt[] =>
      (attr.type ?? 'zero') === 'input' ? [{ x: -40, y: 0 }, { x: -20, y: -20 }] : [{ x: -40, y: 0 }];
    // Plexer settings from the attributes, falling back to the writing program's defaults
    const plexerSettings = (kind: LogisimPlexer, attr: Record<string, string>) => {
      const d = logisimPlexerDefaults(fileSource, kind);
      const select = Math.min(5, num(attr.select, kind === 'priorityEncoder' ? 3 : 1));
      const enable = kind === 'priorityEncoder' ? true : attr.enable === 'true' ? true : attr.enable === 'false' ? false : d.enable;
      return {
        select,
        enable,
        disabled: attr.disabled === '0' || attr.disabled === 'Z' ? (attr.disabled as '0' | 'Z') : d.disabled,
        tristate: attr.tristate === 'true',
        selloc: attr.selloc === 'tr' ? ('tr' as const) : ('bl' as const),
        ports: logisimPlexerPorts(kind, attr.facing || 'east', attr.selloc || 'bl', select, enable),
      };
    };
    for (let i = 0; i < rawComps.length; i++) {
      const compNode = rawComps[i];
      const compName = compNode.getAttribute('name') || '';
      const loc = parseCoord(compNode.getAttribute('loc'));
      if (!loc) continue;

      const attrs = compNode.getElementsByTagName('a');
      const attr: Record<string, string> = {};
      for (let a = 0; a < attrs.length; a++) {
        const aName = attrs[a].getAttribute('name');
        if (aName) attr[aName] = attrs[a].getAttribute('val') ?? attrs[a].textContent ?? '';
      }
      sig.push(`c${compNode.getAttribute('lib') ?? ''}:${compName}${compNode.getAttribute('loc')}${Object.entries(attr).map(([k, v]) => `${k}=${v}`).join(',')}`);
      const isOutput = attr.output === 'true';
      const constVal = attr.value ?? attr.val;
      const label = attr.label || undefined;
      const facing = attr.facing || 'east';
      const size = parseInt(attr.size ?? '', 10) || 0;
      const width = num(attr.width, 1);
      const inputsAttr = parseInt(attr.inputs ?? '', 10) || 0;
      const leftHanded = attr.control === 'left';
      const outMode = attr.out === '0Z' || attr.out === 'Z1' ? attr.out : undefined;
      const negated = Object.entries(attr)
        .filter(([k, v]) => /^negate\d+$/.test(k) && v === 'true')
        .map(([k]) => Number(k.slice(6)) + 1)
        .sort((a, b) => a - b);

      // A part named after another circuit of the file (no library) is a subcircuit instance
      const isSub = !compNode.getAttribute('lib') && circuitByName.has(compName);
      let nativeType = isSub ? 'subcircuit' : mapCircCompType(compName, isOutput, constVal);
      let sub: SubcircuitInfo | undefined;
      if (isSub) {
        sub = subcircuitOf(compName) ?? undefined;
        if (!sub) {
          warnings.push(`${compName} (${loc.x},${loc.y}): devre kendi içinde kendini kullanıyor, alt devre örneği alınmadı.`);
          continue;
        }
        sig.push(`s${sub.def.id}`);
      }
      if (!nativeType) {
        if (!DECORATIVE.has(compName.trim().toLowerCase())) {
          const why = compName || '(adsız)';
          skipped.set(why, (skipped.get(why) || 0) + 1);
        }
        continue;
      }
      // Wide constants and output pins keep their width
      if ((nativeType === 'gnd' || nativeType === 'vcc') && width > 1) nativeType = 'constant';
      // A Logisim output Pin has a fixed width, like our LED (drawn the same way when wide); a probe would
      // follow its net and hide a width mismatch
      if (nativeType === 'probe' && compName.trim().toLowerCase() === 'pin') nativeType = 'led';
      const where = `${compName}${label ? ` "${label}"` : ''} (${loc.x},${loc.y})`;
      if (width > 1 && !WIDE_IMPORT.has(nativeType) && !ARITH_TYPES.has(nativeType)) warnings.push(`${where}: ${width} bitlik, tek bit olarak alındı.`);
      const rot = FACING_ROTATION[facing] ?? 0;
      parts.push({ compName, loc, nativeType, attr, isOutput, label, facing, rot, size, width, inputsAttr, xorMode: attr.xor, negated, leftHanded, pull: attr.pull, outMode, sub, where });

      occupied.add(key(loc)); // every Logisim part has a connection at loc (gate output, pin, Q ...)
      const ff = FF_POINTS[nativeType];
      if (ff) for (const off of [...ff.inputs, ...ff.outputs]) occupied.add(key(local(loc, off, rot)));
      if (nativeType === 'triState' || nativeType === 'controlledInverter') {
        for (const off of controlledOffsets(nativeType, size, leftHanded)) occupied.add(key(local(loc, off, rot)));
      }
      const extra: Pt[] =
        nativeType === 'splitter'
          ? splitterEnds(attr)
          : nativeType === 'bitExtender'
            ? extenderPoints(attr)
            : nativeType === 'bitSelector'
              ? BIT_SELECTOR_POINTS[facing] ?? BIT_SELECTOR_POINTS.east
              : PLEXER_TYPES.has(nativeType)
                ? plexerSettings(nativeType as LogisimPlexer, attr).ports
                : ARITH_TYPES.has(nativeType)
                ? logisimArithPorts(nativeType, logisimArithSettings(nativeType, attr, fileSource).inputs).map((p) => p.off)
                : sub
                ? [...sub.inOffsets, ...sub.outOffsets].map((o) => rotateOffset(o, rot))
                : [];
      for (const off of extra) occupied.add(key({ x: loc.x + off.x, y: loc.y + off.y }));
    }
    const used = (p: Pt) => netAt(p) !== null || occupied.has(key(p));
    let privatePoints = 0; // fake coordinates that only join the parts of one split gate

    // Our part with pin `pinId` on the (scaled) Logisim loc; `points` are the Logisim connection points
    // of its pins (null: that pin has none)
    const place = (inst: CircuitComponentInstance, anchorPinId: string, loc: Pt, label: string | undefined, points: Array<[string, Pt | null]>) => {
      inst = updatePinPositions(inst);
      const a = [...inst.inputs, ...inst.outputs].find((p) => p.id === anchorPinId)!;
      const anchor = scaled(loc);
      inst = updatePinPositions({ ...inst, x: inst.x + anchor.x - a.x, y: inst.y + anchor.y - a.y });
      if (label) inst.label = label;
      components.push(inst);
      for (const [pinId, at] of points) {
        const pin = [...inst.inputs, ...inst.outputs].find((p) => p.id === pinId);
        if (pin && at) attach.push({ at, compId: inst.id, pinId, isOutput: pin.type === 'output' });
      }
      return inst;
    };
    const at = (loc: Pt, off: Pt): Pt => ({ x: loc.x + off.x, y: loc.y + off.y });

    // Pass 2: our parts, pinned to the exact Logisim connection points
    for (const part of parts) {
      const { loc, nativeType, attr, label, rot, size, width, inputsAttr, xorMode, negated, leftHanded, pull, outMode, where } = part;
      const anchor = scaled(loc);
      const isGate = GATE_TYPES.includes(nativeType);

      const isControlled = nativeType === 'triState' || nativeType === 'controlledInverter';
      if (isGate || nativeType === 'not' || nativeType === 'buffer' || isControlled) {
        let inputPoints: Pt[];
        // Negated inputs among the kept (wired) input points
        let gateNegated: number[] = [];
        if (isGate) {
          const isXor = nativeType === 'xor' || nativeType === 'xnor';
          const bubble = nativeType === 'nand' || nativeType === 'nor' || nativeType === 'xnor' ? 10 : 0;
          const gsize = size || 50;
          // No 'inputs' attribute: Logisim 2.7 defaults to 5; every smaller count uses a subset of those points
          const n = inputsAttr || 5;
          const axis = gsize + (isXor ? 10 : 0) + bubble;
          // A negated input (Logisim 'negateN', N from 0) sits 10 further out, behind its bubble
          const neg = new Set(negated.map((k) => k - 1));
          const slots = gateInputOffsets(n, gsize)
            .map((dy, k) => ({ k, pt: local(loc, { x: -(axis + (neg.has(k) ? 10 : 0)), y: dy }, rot) }))
            .filter((sl) => used(sl.pt));
          inputPoints = slots.map((sl) => sl.pt);
          gateNegated = slots.flatMap((sl, j) => (neg.has(sl.k) ? [j] : []));
        } else if (isControlled) {
          inputPoints = controlledOffsets(nativeType, size, leftHanded).map((off) => local(loc, off, rot));
        } else if (nativeType === 'buffer') {
          inputPoints = [local(loc, { x: -20, y: 0 }, rot)]; // Logisim buffer is 20 long, no size attribute
        } else {
          inputPoints = [local(loc, { x: -(size || 30), y: 0 }, rot)];
        }

        // Our gates take at most 5 inputs: wider Logisim gates become groups of the base operation
        // feeding the original gate (inversion stays on the last one), joined by private connection points
        if (isGate && inputPoints.length > MAX_IMPORT_GATE_INPUTS) {
          const base: ComponentType = nativeType === 'nand' ? 'and' : nativeType === 'nor' ? 'or' : nativeType === 'xnor' ? 'xor' : nativeType;
          const feeds: Pt[] = [];
          for (let gi = 0; gi * 5 < inputPoints.length; gi++) {
            const group = inputPoints.slice(gi * 5, gi * 5 + 5);
            if (group.length === 1) {
              feeds.push(group[0]);
              continue;
            }
            let sub = createComponentInstance(base, 0, 0);
            sub.inputs = group.map((_, k) => ({ id: `${sub.id}_in${k}`, name: String.fromCharCode(65 + k), type: 'input' as const, value: 0 as const, x: 0, y: 0 }));
            sub.state = { ...sub.state, gateInputsCount: group.length };
            sub = updatePinPositions(sub);
            sub = updatePinPositions({ ...sub, x: anchor.x - 200 - sub.outputs[0].x, y: anchor.y + gi * 120 - sub.outputs[0].y });
            components.push(sub);
            group.forEach((pt, k) => attach.push({ at: pt, compId: sub.id, pinId: sub.inputs[k].id, isOutput: false }));
            const link = { x: -1e6 - privatePoints++, y: -1e6 };
            attach.push({ at: link, compId: sub.id, pinId: sub.outputs[0].id, isOutput: true });
            feeds.push(link);
          }
          inputPoints = feeds;
        }

        let inst = createComponentInstance(nativeType, 0, 0);
        if (isGate && inputPoints.length > 2) {
          const n = Math.min(MAX_IMPORT_GATE_INPUTS, inputPoints.length);
          inst.inputs = Array.from({ length: n }).map((_, k) => ({
            id: `${inst.id}_in${k}`,
            name: String.fromCharCode(65 + k),
            type: 'input' as const,
            value: 0 as const,
            x: 0,
            y: 0,
          }));
          inst.state = { ...inst.state, gateInputsCount: n };
        }
        inst.rotation = rot as 0 | 90 | 180 | 270;
        // Output Value applies to the gate that drives the net (the last one of a split wide gate)
        if (outMode) inst.state = { ...inst.state, outputMode: outMode };
        if (gateNegated.length) inst.state = { ...inst.state, negated: gateNegated };
        // A Logisim XOR without the attribute is "exactly one 1" (its default); ours defaults to parity
        if ((nativeType === 'xor' || nativeType === 'xnor') && xorMode !== 'odd') inst.state = { ...inst.state, xorMode: 'one' };
        if (width > 1) inst = setGateWidth(inst, width);
        inst = updatePinPositions(inst);
        // Put our output pin exactly on the (scaled) Logisim anchor
        const out = inst.outputs[0];
        inst = updatePinPositions({ ...inst, x: anchor.x - out.x, y: anchor.y - out.y });
        if (label) inst.label = label;
        components.push(inst);

        attach.push({ at: loc, compId: inst.id, pinId: inst.outputs[0].id, isOutput: true });
        inputPoints.slice(0, inst.inputs.length).forEach((pt, k) => {
          attach.push({ at: pt, compId: inst.id, pinId: inst.inputs[k].id, isOutput: false });
        });
        continue;
      }

      if (nativeType === 'splitter') {
        // Logisim splitter: combined end at loc; bitN = end index from 0, 'none' = not mapped (ours: end from 1, 0 = none)
        const fanout = num(attr.fanout, 2);
        const incoming = num(attr.incoming, 2);
        const dflt = splitterDistribution(fanout, incoming);
        const bitEnd = Array.from({ length: incoming }, (_, b) => {
          const v = attr[`bit${b}`];
          if (v === undefined) return dflt[b];
          if (v === 'none') return 0;
          const e = parseInt(v, 10);
          return Number.isFinite(e) && e >= 0 && e < fanout ? e + 1 : 0;
        });
        const appear = attr.appear === 'right' ? 'right' : attr.appear === 'center' || attr.appear === 'legacy' ? 'center' : 'left';
        let inst = configureSplitter(createComponentInstance('splitter', 0, 0), { incoming, fanout, appear, bitEnd });
        inst.rotation = rot as 0 | 90 | 180 | 270;
        const ends = splitterEnds(attr);
        place(inst, inst.inputs[0].id, loc, label, [[inst.inputs[0].id, loc], ...inst.outputs.map((p, i): [string, Pt] => [p.id, at(loc, ends[i])])]);
        continue;
      }
      if (nativeType === 'bitExtender') {
        const type = (['zero', 'one', 'sign', 'input'] as const).find((t) => t === attr.type) ?? 'zero';
        const inst = configureBitExtender(createComponentInstance('bitExtender', 0, 0), { inWidth: num(attr.in_width, 8), outWidth: num(attr.out_width, 16), type });
        const pts = extenderPoints(attr);
        place(inst, inst.outputs[0].id, loc, label, [
          [inst.outputs[0].id, loc],
          [inst.inputs[0].id, at(loc, pts[0])],
          ...(inst.inputs[1] ? ([[inst.inputs[1].id, at(loc, pts[1])]] as Array<[string, Pt]>) : []),
        ]);
        continue;
      }
      if (nativeType === 'bitSelector') {
        let inst = configureBitSelector(createComponentInstance('bitSelector', 0, 0), { dataWidth: num(attr.width, 8), groupWidth: num(attr.group, 1) });
        inst.rotation = rot as 0 | 90 | 180 | 270;
        const [d, s] = BIT_SELECTOR_POINTS[part.facing] ?? BIT_SELECTOR_POINTS.east;
        inst = updatePinPositions(inst);
        place(inst, inst.outputs[0].id, loc, label, [
          [inst.outputs[0].id, loc],
          [inst.inputs[0].id, at(loc, d)],
          [inst.inputs[1].id, at(loc, s)],
        ]);
        continue;
      }
      if (PLEXER_TYPES.has(nativeType)) {
        const kind = nativeType as LogisimPlexer;
        const st = plexerSettings(kind, attr);
        let inst = createComponentInstance(kind, 0, 0);
        inst = {
          ...inst,
          rotation: rot as 0 | 90 | 180 | 270,
          state: { ...inst.state, plexDisabled: st.disabled, plexTristate: st.tristate, selectLoc: st.selloc },
        };
        inst = configurePlexer(inst, { select: st.select, width, enable: st.enable });
        const keys = logisimPlexerPortKeys(kind, st.select, st.enable);
        const idOf = (k: string) => [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k)?.id;
        const anchorKey = kind === 'demultiplexer' ? 'in' : kind === 'decoder' ? 'sel' : 'out';
        place(
          inst,
          idOf(anchorKey)!,
          loc,
          label,
          keys.map((k, j): [string, Pt | null] => [idOf(k) ?? '', at(loc, st.ports[j])])
        );
        continue;
      }
      if (ARITH_TYPES.has(nativeType)) {
        // Exact Logisim geometry: the frame's anchor is the Logisim loc, every pin on its connection point
        const st = logisimArithSettings(nativeType, attr, fileSource);
        for (const n of st.notes) warnings.push(`${where}: ${n}`);
        let inst = createComponentInstance(nativeType, 0, 0);
        inst = {
          ...inst,
          state: {
            ...inst.state,
            ...(st.mode ? { arithMode: st.mode } : {}),
            ...(st.shiftType ? { shiftType: st.shiftType as 'll' } : {}),
            ...(st.findType ? { findType: st.findType as 'low1' } : {}),
          },
        };
        inst = configureArith(inst, { width: st.width, inputs: st.inputs });
        const g = arithGeometry(nativeType, st.inputs);
        inst = updatePinPositions({ ...inst, x: anchor.x - g.anchor.x, y: anchor.y - g.anchor.y });
        if (label) inst.label = label;
        components.push(inst);
        for (const { key: k, off } of logisimArithPorts(nativeType, st.inputs)) {
          const pin = [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k);
          if (pin) attach.push({ at: at(loc, off), compId: inst.id, pinId: pin.id, isOutput: pin.type === 'output' });
        }
        continue;
      }
      if (nativeType === 'subcircuit' && part.sub) {
        const { def, inOffsets, outOffsets } = part.sub;
        const inst = createSubcircuitInstance(def, 0, 0, label || def.name);
        const anchorPin = inst.outputs[0] ?? inst.inputs[0];
        if (!anchorPin) {
          components.push(updatePinPositions({ ...inst, x: anchor.x, y: anchor.y }));
          continue;
        }
        place(inst, anchorPin.id, loc, undefined, [
          ...inst.inputs.map((p, k): [string, Pt] => [p.id, at(loc, rotateOffset(inOffsets[k], rot))]),
          ...inst.outputs.map((p, k): [string, Pt] => [p.id, at(loc, rotateOffset(outOffsets[k], rot))]),
        ]);
        continue;
      }

      let inst = updatePinPositions(createComponentInstance(nativeType, 0, 0));
      if (nativeType === 'tunnel') {
        // Logisim tunnel: one connection point at loc; ours joins every tunnel with the same label (width follows the net)
        const pin = inst.inputs[0];
        inst = updatePinPositions({ ...inst, x: anchor.x - pin.x, y: anchor.y - pin.y, label: label || 'Tünel' });
        components.push(inst);
        attach.push({ at: loc, compId: inst.id, pinId: inst.inputs[0].id, isOutput: false });
        continue;
      }
      // Wide input / output pins and constants keep their width (and a constant its value)
      if ((nativeType === 'switch' || nativeType === 'led') && width > 1) inst = setBitWidth(inst, width);
      if (nativeType === 'constant') {
        inst = setBitWidth(inst, width);
        const v = parseConstValue(attr.value ?? attr.val);
        inst.state = { ...inst.state, constValue: width >= 32 ? v >>> 0 : v % 2 ** width };
      }
      if (nativeType === 'probe' && attr.radix && RADIX[attr.radix]) inst.state = { ...inst.state, radix: RADIX[attr.radix] };
      const pinsOf = [...inst.inputs, ...inst.outputs];
      if (pinsOf.length === 1) {
        // Single-pin parts (pins, probes, LEDs, clocks, constants): the Logisim loc IS the pin
        inst = updatePinPositions({ ...inst, x: anchor.x - pinsOf[0].x, y: anchor.y - pinsOf[0].y });
        if (label) inst.label = label;
        // Logisim's pull attribute: 0 (default), 1 or X
        if (nativeType === 'pullResistor') inst.state = { ...inst.state, pullValue: pull === '1' ? 1 : pull === 'X' ? 'X' : 0 };
        components.push(inst);
        const pin = [...inst.inputs, ...inst.outputs][0];
        attach.push({ at: loc, compId: inst.id, pinId: pin.id, isOutput: pin.type === 'output' });
        // A Logisim Pin is a port of its circuit when the circuit is used as a subcircuit
        if (part.compName.trim().toLowerCase() === 'pin') {
          pins.push({ loc, facing: part.facing, isOutput: part.isOutput, label: label || '', width, compId: inst.id, pinId: pin.id });
        }
        continue;
      }

      const ff = FF_POINTS[nativeType];
      if (ff) {
        // Flip-flops: exact Logisim points (Q at loc)
        inst = updatePinPositions({ ...inst, x: anchor.x - inst.outputs[0].x, y: anchor.y - inst.outputs[0].y });
        if (label) inst.label = label;
        components.push(inst);
        ff.inputs.forEach((off, k) => inst.inputs[k] && attach.push({ at: local(loc, off, rot), compId: inst.id, pinId: inst.inputs[k].id, isOutput: false }));
        ff.outputs.forEach((off, k) => inst.outputs[k] && attach.push({ at: local(loc, off, rot), compId: inst.id, pinId: inst.outputs[k].id, isOutput: true }));
        if (nativeType === 'srLatch') warnings.push(`${where}: Logisim'deki saatli S-R flip-flop, saatsiz SR mandal olarak alındı.`);
        const extra = nativeType === 'tFlipFlop' ? [{ x: -30, y: 30 }] : [{ x: -10, y: 30 }, { x: -30, y: 30 }];
        if (extra.some((off) => netAt(local(loc, off, rot)) !== null)) warnings.push(`${where}: preset / reset girişleri alınmadı.`);
        continue;
      }

      // Other chips: their Logisim geometry is not modelled; connect wire endpoints near each of our pins
      inst = updatePinPositions({ ...inst, x: anchor.x, y: anchor.y });
      if (label) inst.label = label;
      components.push(inst);
      warnings.push(`${where}: bağlantıları yaklaşık olarak kuruldu, kontrol edin.`);
      for (const pin of [...inst.inputs, ...inst.outputs]) {
        let best: Pt | null = null;
        let bestD = 30;
        for (const p of endpoints.values()) {
          const sp = scaled(p);
          const d = Math.hypot(sp.x - pin.x, sp.y - pin.y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best) attach.push({ at: best, compId: inst.id, pinId: pin.id, isOutput: pin.type === 'output' });
      }
    }

    // 3. One star of pin-to-pin connections per net, driven from an output pin when there is one
    const byNet = new Map<string, typeof attach>();
    for (const a of attach) {
      const net = netAt(a.at) ?? `pin:${key(a.at)}`; // parts touching pin-to-pin without a wire
      if (!byNet.has(net)) byNet.set(net, []);
      byNet.get(net)!.push(a);
    }
    const wires: CircuitWire[] = [];
    let wireNo = 0;
    for (const members of byNet.values()) {
      const unique = members.filter((m, i) => members.findIndex((o) => o.pinId === m.pinId) === i);
      if (unique.length < 2) continue;
      const driver = unique.find((m) => m.isOutput) || unique[0];
      for (const m of unique) {
        if (m === driver) continue;
        wires.push({
          id: `wire_circ_${cIdx}_${wireNo++}`,
          fromCompId: driver.compId,
          fromPinId: driver.pinId,
          toCompId: m.compId,
          toPinId: m.pinId,
          value: 0,
        });
      }
    }

    // 3b. Our parts are larger than Logisim's (a wide pin is one cell per bit), so a part can land on
    // another one: on its pins (the simulator joins pins sharing a grid point, which would short nets) or
    // over its body (hiding it). Connections are explicit wires here, so nudge such parts down until both
    // their pins and their body are clear.
    const pinPoint = (p: Pt) => `${Math.round(p.x / 10) * 10},${Math.round(p.y / 10) * 10}`;
    const box = (c: CircuitComponentInstance) => {
      const { width, height } = getComponentSize(c);
      const turned = c.rotation === 90 || c.rotation === 270;
      const [w, h] = turned ? [height, width] : [width, height];
      const cx = c.x + width / 2;
      const cy = c.y + height / 2;
      const pts = [...c.inputs, ...c.outputs];
      return {
        x1: Math.min(cx - w / 2, ...pts.map((p) => p.x)),
        y1: Math.min(cy - h / 2, ...pts.map((p) => p.y)),
        x2: Math.max(cx + w / 2, ...pts.map((p) => p.x)),
        y2: Math.max(cy + h / 2, ...pts.map((p) => p.y)),
      };
    };
    const taken = new Map<string, string>();
    const boxes: Array<ReturnType<typeof box>> = [];
    const overlaps = (b: ReturnType<typeof box>) => boxes.some((o) => b.x1 < o.x2 && o.x1 < b.x2 && b.y1 < o.y2 && o.y1 < b.y2);
    for (let k = 0; k < components.length; k++) {
      let comp = components[k];
      for (let tries = 0; tries < 400; tries++) {
        const pts = [...comp.inputs, ...comp.outputs].map(pinPoint);
        if (!pts.some((pt) => taken.has(pt) && taken.get(pt) !== comp.id) && !overlaps(box(comp))) break;
        comp = updatePinPositions({ ...comp, y: comp.y + 10 });
      }
      components[k] = comp;
      boxes.push(box(comp));
      for (const p of [...comp.inputs, ...comp.outputs]) taken.set(pinPoint(p), comp.id);
    }

    // 4. Keep everything on the positive canvas with a margin
    if (components.length > 0) {
      const minX = Math.min(...components.map((c) => Math.min(c.x, ...[...c.inputs, ...c.outputs].map((p) => p.x))));
      const minY = Math.min(...components.map((c) => Math.min(c.y, ...[...c.inputs, ...c.outputs].map((p) => p.y))));
      const dx = Math.round((60 - minX) / 10) * 10;
      const dy = Math.round((60 - minY) / 10) * 10;
      for (let k = 0; k < components.length; k++) {
        components[k] = updatePinPositions({ ...components[k], x: components[k].x + dx, y: components[k].y + dy });
      }
    }

    skipped.forEach((count, what) => warnings.unshift(`Desteklenmeyen bileşen atlandı: ${what}${count > 1 ? ` ×${count}` : ''}`));

    return { sheet: { name: circuitName, components, wires, warnings }, pins, signature: sig.join(';') };
  };

  const sheets: ImportedCircuitSheet[] = [];
  for (const [name] of circuitByName) {
    const r = importNamed(name);
    if (r) sheets.push(r.sheet);
  }
  return { sheets, subcircuits, main: xmlDoc.getElementsByTagName('main')[0]?.getAttribute('name') || undefined };
}

// Logisim writes a Constant's value as hex (0x..); older files may hold a decimal
function parseConstValue(v: string | undefined): number {
  if (v === undefined || v === '') return 1; // Logisim's default constant is 1
  const n = /^0x/i.test(v) ? parseInt(v.slice(2), 16) : parseInt(v, 10);
  return Number.isFinite(n) ? n : 1;
}

/** Sheets only (the IC definitions of subcircuits are dropped); kept for older callers. */
export function importCircXmlProject(xmlText: string): ImportedCircuitSheet[] {
  return importCircXmlFile(xmlText).sheets;
}

// Backward-compatible alias
export const importLogisimCirc = importCircXmlProject;
