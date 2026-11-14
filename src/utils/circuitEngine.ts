import type {
  ComponentType,
  ComponentMetadata,
  CircuitComponentInstance,
  CircuitWire,
  CircuitPin,
  CircuitPreset,
  TruthTableData,
  TruthTableEntry,
} from '../types/circuit';
import { MAX_BIT_WIDTH, bitsToNumber, numberToBits, resolveDrivers, summarizeBits, type SignalValue } from '../types/logic';
import { evaluateSubcircuitStateful, getSubcircuitDefinition, subcircuitPortWidth } from './subcircuitManager';
import { repairWires, setComponentBodySizeResolver } from './wiringEngine';
import { TTL_CHIPS, evalTtl, isTtlType, ttlChipOf, ttlInKey, ttlPinOfKey, ttlPinPoint, ttlPorts, ttlRcOf, ttlNow, ttlSeqCopy, ttlSeqInit, ttlSize, type TtlChip } from './ttlChips';
import type { TtlType } from '../types/circuit';

// ---- Arithmetic geometry (Logisim std/arith). Function declarations: the catalog below uses them -------------

/** Shifter distance width: enough bits to count to the data width (at least 1), like Logisim. */
export function shifterDistBits(w: number): number {
  let s = 1;
  while (1 << s < w) s++;
  return s;
}

/** Bit adder output width: enough bits to count every input bit (Logisim BitAdder.computeOutputBits). */
export function bitAdderOutBits(w: number, n: number): number {
  let o = 1;
  while (2 ** o <= w * n) o++;
  return o;
}

/** Bit finder index width: enough bits to number every input bit (at least 1). */
export function bitFinderOutBits(w: number): number {
  let o = 1;
  while (2 ** o <= w - 1) o++;
  return o;
}

/** ALU operation select width (declared before the catalog, which needs it) */
export const ALU_OP_BITS = 3;

/** Width of an arithmetic part's pin for data width w (bit adder: n inputs). */
export function arithPinWidth(type: ComponentType, key: string, w: number, n: number): number {
  if (type === 'alu') return key === 'a' || key === 'b' || key === 'out' ? w : key === 'op' ? ALU_OP_BITS : 1;
  if (key === 'gt' || key === 'eq' || key === 'lt' || key === 'ovf' || key === 'present') return 1;
  if (key === 'cin' || key === 'cout' || key === 'bin' || key === 'bout') return type === 'multiplier' ? w : 1;
  if (key === 'dist') return shifterDistBits(w);
  if (key === 'out' && type === 'bitAdder') return bitAdderOutBits(w, n);
  if (key === 'out' && type === 'bitFinder') return bitFinderOutBits(w);
  return w;
}

/**
 * Unrotated layout of an arithmetic part, the frame's origin at the body's top-left corner. Logisim's
 * geometry: a 40x40 body whose location is the main output in the middle of the right side; operands on the
 * left (A above, B below, a single input in the middle), carry / borrow / upper-half input on top, carry /
 * borrow / remainder / flag output at the bottom. The bit adder grows 10px per input past 3 (its box is
 * rounded out to the 10px grid). `anchor` is Logisim's location in this frame.
 */
export function arithGeometry(type: ComponentType, n: number): {
  width: number;
  height: number;
  pins: Record<string, { x: number; y: number }>;
  anchor: { x: number; y: number };
} {
  if (type === 'alu') {
    // No Logisim counterpart: A and B on the left, Y in the middle of the right side (the location, like
    // the other arithmetic parts), operation select and carry-in on top, the four flags along the bottom.
    // Square, so a turned body keeps its pins on the 10px grid
    return {
      width: 60,
      height: 60,
      pins: {
        a: { x: 0, y: 20 },
        b: { x: 0, y: 40 },
        op: { x: 20, y: 0 },
        cin: { x: 40, y: 0 },
        out: { x: 60, y: 30 },
        z: { x: 10, y: 60 },
        n: { x: 20, y: 60 },
        c: { x: 40, y: 60 },
        v: { x: 50, y: 60 },
      },
      anchor: { x: 60, y: 30 },
    };
  }
  if (type === 'bitAdder') {
    const top = n < 4 ? 20 : Math.floor((n - 1) / 2) * 10 + 5;
    const h = Math.max(40, 10 * n);
    const t = Math.ceil(top / 10) * 10;
    const height = t + Math.ceil((h - top) / 10) * 10;
    let y = 0;
    let dy = 10;
    if (n === 2) {
      y = -10;
      dy = 20;
    } else if (n === 3) y = -10;
    else if (n > 3) y = Math.floor((n - 1) / 2) * -10;
    const pins: Record<string, { x: number; y: number }> = { out: { x: 40, y: t } };
    for (let i = 0; i < n; i++) pins[`in${i}`] = { x: 0, y: t + y + i * dy };
    return { width: 40, height, pins, anchor: { x: 40, y: t } };
  }
  const top = { x: 20, y: 0 };
  const bottom = { x: 20, y: 40 };
  const pins: Record<string, { x: number; y: number }> = {
    a: { x: 0, y: 10 },
    b: { x: 0, y: 30 },
    dist: { x: 0, y: 30 },
    in: { x: 0, y: 20 },
    out: { x: 40, y: 20 },
    cin: top,
    bin: top,
    upper: type === 'exponentiator' ? bottom : top,
    cout: bottom,
    bout: bottom,
    rem: bottom,
    ovf: bottom,
    present: bottom,
    gt: { x: 40, y: 10 },
    eq: { x: 40, y: 20 },
    lt: { x: 40, y: 30 },
    min: { x: 40, y: 10 },
    max: { x: 40, y: 30 },
  };
  return { width: 40, height: 40, pins, anchor: { x: 40, y: 20 } };
}

// Catalog entry of an arithmetic part with its default settings (8 bits, Logisim's default; exponentiator 32
// like evolution; bit adder 1 input)
function arithMeta(type: ComponentType, name: string, ins: [string, string][], outs: [string, string][], description: string): ComponentMetadata {
  const w = type === 'exponentiator' ? 32 : 8;
  const g = arithGeometry(type, 1);
  const pin = ([id, label]: [string, string], kind: 'input' | 'output') => {
    const width = arithPinWidth(type, id, w, 1);
    return { id, name: label, type: kind, relX: g.pins[id].x, relY: g.pins[id].y, ...(width > 1 ? { width } : {}) };
  };
  return {
    type,
    name,
    category: 'arithmetic',
    width: g.width,
    height: g.height,
    inputs: ins.map((p) => pin(p, 'input')),
    outputs: outs.map((p) => pin(p, 'output')),
    description,
  };
}

// ---- Memory geometry (Logisim std/memory, classic appearance). Function declarations: the catalog uses them ----

/** Data inputs of a flip-flop, in Logisim's port order */
export function flipFlopDataKeys(type: ComponentType): string[] {
  return type === 'flipFlopD' ? ['d'] : type === 'flipFlopT' ? ['t'] : type === 'flipFlopJK' ? ['j', 'k'] : ['s', 'r'];
}

/** Pin keys of a memory part in the order the simulator relies on (shift register: stage pins d0.. / q0.. while parallel) */
export function memPinKeys(type: ComponentType, len: number, parallel: boolean): { inputs: string[]; outputs: string[] } {
  if (type === 'register') return { inputs: ['d', 'clk', 'clr', 'en'], outputs: ['q'] };
  if (type === 'counter') return { inputs: ['d', 'clk', 'clr', 'ld', 'ct', 'ud'], outputs: ['q', 'carry'] };
  if (type === 'shiftRegister') {
    const stages = (p: string) => (parallel ? Array.from({ length: len }, (_, i) => `${p}${i}`) : []);
    return { inputs: ['sh', 'in', 'clk', 'clr', ...(parallel ? ['ld'] : []), ...stages('d')], outputs: ['out', ...stages('q')] };
  }
  return { inputs: [...flipFlopDataKeys(type), 'clk', 'clr', 'pre', 'en'], outputs: ['q', 'qn'] };
}

/** Width of a memory part's pin for data width w: the data pins are w bits, controls 1 bit */
export function memPinWidth(type: ComponentType, key: string, w: number): number {
  if (type === 'register' || type === 'counter') return key === 'd' || key === 'q' ? w : 1;
  if (type === 'shiftRegister') return key === 'in' || key === 'out' || /^[dq]\d+$/.test(key) ? w : 1;
  return 1;
}

/**
 * Unrotated layout of a memory part, origin at the body's top-left corner. Pins sit where Logisim's classic
 * appearance has them (flip-flop: data and clock on the left, Q / Q' on the right, reset 0 / preset 1 /
 * enable along the bottom; register / counter: data, enable, load on the left, clock and clear along the
 * bottom, up/down on top; shift register: shift, data, clock on the left, load and parallel inputs on top,
 * clear and parallel outputs along the bottom). Logisim's 30px wide register / counter and the shift register
 * are made 10px wider on the right where needed, so a quarter turn around the body centre keeps every pin on
 * the 10px grid (width minus height must be a multiple of 20). `anchor` is Logisim's location in this frame.
 */
export function memGeometry(type: ComponentType, len: number, parallel: boolean): {
  width: number;
  height: number;
  pins: Record<string, { x: number; y: number }>;
  anchor: { x: number; y: number };
} {
  if (type === 'register' || type === 'counter') {
    const pins: Record<string, { x: number; y: number }> = {
      d: { x: 0, y: 20 },
      clk: { x: 10, y: 40 },
      clr: { x: 20, y: 40 },
      q: { x: 40, y: 20 },
    };
    if (type === 'register') pins.en = { x: 0, y: 30 };
    else Object.assign(pins, { ld: { x: 0, y: 10 }, ct: { x: 0, y: 30 }, ud: { x: 10, y: 0 }, carry: { x: 40, y: 30 } });
    return { width: 40, height: 40, pins, anchor: { x: 40, y: 20 } };
  }
  if (type === 'shiftRegister') {
    const width = parallel ? Math.ceil((20 + 10 * len) / 20) * 20 : 40;
    const pins: Record<string, { x: number; y: number }> = {
      sh: { x: 0, y: 10 },
      in: { x: 0, y: 20 },
      clk: { x: 0, y: 30 },
      clr: { x: 10, y: 40 },
      out: { x: width, y: 20 },
    };
    if (parallel) {
      pins.ld = { x: 10, y: 0 };
      for (let i = 0; i < len; i++) {
        pins[`d${i}`] = { x: 20 + 10 * i, y: 0 };
        pins[`q${i}`] = { x: 20 + 10 * i, y: 40 };
      }
    }
    return { width, height: 40, pins, anchor: { x: 0, y: 20 } };
  }
  const two = type === 'flipFlopJK' || type === 'flipFlopSR';
  const [a, b] = flipFlopDataKeys(type);
  const pins: Record<string, { x: number; y: number }> = two
    ? { [a]: { x: 0, y: 10 }, [b]: { x: 0, y: 30 }, clk: { x: 0, y: 20 } }
    : { [a]: { x: 0, y: 30 }, clk: { x: 0, y: 10 } };
  Object.assign(pins, { q: { x: 40, y: 10 }, qn: { x: 40, y: 30 }, clr: { x: 30, y: 40 }, pre: { x: 10, y: 40 }, en: { x: 20, y: 40 } });
  return { width: 40, height: 40, pins, anchor: { x: 40, y: 10 } };
}

const MEM_PIN_LABELS: Record<string, string> = {
  d: 'D', t: 'T', j: 'J', k: 'K', s: 'S', r: 'R', clk: 'CLK', clr: 'CLR', pre: 'PRE', en: 'EN', q: 'Q', qn: "Q'",
  ld: 'LD', ct: 'CT', ud: 'UD', carry: 'C', sh: 'SH', in: 'IN', out: 'OUT',
};
/** Label of a memory part's pin (stage pins: D0.. / Q0..) */
export function memPinLabel(key: string): string {
  return MEM_PIN_LABELS[key] ?? key.toUpperCase();
}

// Catalog entry of a memory part with Logisim's defaults (register / counter 8 bits; shift register 1 bit,
// 8 stages, parallel load)
function memMeta(type: ComponentType, name: string, description: string): ComponentMetadata {
  const isShift = type === 'shiftRegister';
  const w = type === 'register' || type === 'counter' ? 8 : 1;
  const len = isShift ? 8 : 1;
  const g = memGeometry(type, len, true);
  const keys = memPinKeys(type, len, true);
  const pin = (id: string, kind: 'input' | 'output') => {
    const width = memPinWidth(type, id, w);
    return { id, name: memPinLabel(id), type: kind, relX: g.pins[id].x, relY: g.pins[id].y, ...(width > 1 ? { width } : {}) };
  };
  return {
    type,
    name,
    category: 'sequential',
    width: g.width,
    height: g.height,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    description,
  };
}

// ---- RAM / ROM / random geometry (Logisim std/memory Mem, Random). Function declarations: the catalog uses them ----

export interface RamConfig {
  /** Address bits (2-24) */
  addrWidth: number;
  /** Data bits (1-32; random generator: its output width) */
  dataWidth: number;
  flavor: 'logisim' | 'evolution';
  /** Logisim 2.7.1 RAM bus */
  bus: 'combined' | 'asynch' | 'separate';
  /** evolution RAM data bus */
  dataBus: 'bidir' | 'separate' | 'controlled';
  /** evolution RAM trigger */
  trigger: 'rising' | 'falling' | 'high' | 'low';
  /** evolution RAM: byte enable pins wanted (they exist only above 8 data bits with an edge trigger) */
  byteEnables: boolean;
  /** evolution RAM: clear pin */
  clearPin: boolean;
}

/** Default settings: Logisim's 8 address and 8 data bits, 2.7.1 rules (random generator: 8 bits) */
export function defaultRamConfig(): RamConfig {
  return { addrWidth: 8, dataWidth: 8, flavor: 'logisim', bus: 'combined', dataBus: 'separate', trigger: 'rising', byteEnables: false, clearPin: false };
}

/** Byte enable pins of an evolution RAM (RamAppearance.getNrBEPorts) */
export function ramByteEnableCount(cfg: RamConfig): number {
  const edge = cfg.trigger === 'rising' || cfg.trigger === 'falling';
  return cfg.flavor === 'evolution' && cfg.byteEnables && edge && cfg.dataWidth > 8 ? Math.ceil(cfg.dataWidth / 8) : 0;
}

/**
 * Pin keys of a RAM / ROM / random generator in the order the simulator relies on. A bidirectional data bus
 * (2.7.1 combined / asynch, evolution bidir) is the output 'd' plus the input 'dio' on the same point, which
 * reads the bus back.
 */
export function ramPinKeys(type: ComponentType, cfg: RamConfig): { inputs: string[]; outputs: string[] } {
  if (type === 'random') return { inputs: ['ck', 'nxt', 'rst'], outputs: ['out'] };
  if (type === 'dualRam') return dualRamPinKeys(cfg);
  const evo = cfg.flavor === 'evolution';
  if (type === 'rom') return { inputs: evo ? ['a'] : ['a', 'cs'], outputs: ['d'] };
  if (!evo) {
    const sep = cfg.bus === 'separate';
    return {
      inputs: ['a', 'cs', 'oe', 'clr', ...(cfg.bus === 'asynch' ? [] : ['clk']), ...(sep ? ['we', 'din'] : ['dio'])],
      outputs: ['d'],
    };
  }
  const edge = cfg.trigger === 'rising' || cfg.trigger === 'falling';
  const bidir = cfg.dataBus === 'bidir';
  return {
    inputs: [
      'a',
      ...(bidir ? [] : ['din']),
      'oe',
      'we',
      ...(edge ? ['clk'] : []),
      ...Array.from({ length: ramByteEnableCount(cfg) }, (_, i) => `be${i}`),
      ...(cfg.clearPin ? ['clr'] : []),
      ...(bidir ? ['dio'] : []),
    ],
    outputs: ['d'],
  };
}

/**
 * Pin keys of a dual-port RAM (Logisim-evolution 5 DualRam, port order of DualRamAppearance): port 0 keeps the
 * single RAM's keys, port 1 adds '1' (a1, din1, oe1, we1, clk1, dio1, d1). Byte enables are numbered like
 * evolution's: be0..be(n-1) port 0, be(n)..be(2n-1) port 1 (n = bytes per word). One clear pin for both ports.
 */
export function dualRamPinKeys(cfg: RamConfig): { inputs: string[]; outputs: string[] } {
  const edge = cfg.trigger === 'rising' || cfg.trigger === 'falling';
  const bidir = cfg.dataBus === 'bidir';
  const nBE = ramByteEnableCount(cfg);
  return {
    inputs: [
      'a',
      'a1',
      ...(bidir ? [] : ['din', 'din1']),
      'oe',
      'oe1',
      'we',
      'we1',
      ...(edge ? ['clk', 'clk1'] : []),
      ...Array.from({ length: 2 * nBE }, (_, i) => `be${i}`),
      ...(cfg.clearPin ? ['clr'] : []),
      ...(bidir ? ['dio', 'dio1'] : []),
    ],
    outputs: ['d', 'd1'],
  };
}

/** Width of a RAM / ROM / random generator pin */
export function ramPinWidth(type: ComponentType, key: string, cfg: RamConfig): number {
  if (type === 'random') return key === 'out' ? cfg.dataWidth : 1;
  if (key === 'a' || key === 'a1') return cfg.addrWidth;
  return ['d', 'dio', 'din', 'd1', 'dio1', 'din1'].includes(key) ? cfg.dataWidth : 1;
}

/**
 * Unrotated layout, origin at the body's top-left corner. RAM / ROM: Logisim's 140 x 80 box (Mem bounds -140,-40):
 * address on the left, data on the right (its location), separate data input below the address, controls along
 * the bottom (2.7.1: WE 'str', CS 'sel', CLK, OE 'ld', CLR); an evolution RAM keeps those spots and puts byte
 * enables on top. Random generator: Logisim's 30 x 40 box made 10px wider on the right (a quarter turn about the
 * centre keeps the pins on the grid), clock and next on the left, reset at the bottom.
 */
export function ramGeometry(type: ComponentType, _cfg: RamConfig): {
  width: number;
  height: number;
  pins: Record<string, { x: number; y: number }>;
  anchor: { x: number; y: number };
} {
  if (type === 'random') {
    return { width: 40, height: 40, pins: { out: { x: 40, y: 20 }, ck: { x: 0, y: 10 }, nxt: { x: 0, y: 30 }, rst: { x: 10, y: 40 } }, anchor: { x: 40, y: 20 } };
  }
  if (type === 'dualRam') {
    // 180 x 160: port 0 in the upper half (controls on top), port 1 in the lower half (controls at the bottom),
    // addresses and data inputs on the left, data on the right, the shared clear pin between the ports
    const pins: Record<string, { x: number; y: number }> = {
      a: { x: 0, y: 40 },
      din: { x: 0, y: 60 },
      clr: { x: 0, y: 80 },
      a1: { x: 0, y: 120 },
      din1: { x: 0, y: 140 },
      d: { x: 180, y: 40 },
      dio: { x: 180, y: 40 },
      d1: { x: 180, y: 120 },
      dio1: { x: 180, y: 120 },
      we: { x: 30, y: 0 },
      clk: { x: 50, y: 0 },
      oe: { x: 70, y: 0 },
      we1: { x: 30, y: 160 },
      clk1: { x: 50, y: 160 },
      oe1: { x: 70, y: 160 },
    };
    const nBE = ramByteEnableCount(_cfg);
    for (let i = 0; i < nBE; i++) {
      pins[`be${i}`] = { x: 90 + 20 * i, y: 0 };
      pins[`be${nBE + i}`] = { x: 90 + 20 * i, y: 160 };
    }
    return { width: 180, height: 160, pins, anchor: { x: 180, y: 40 } };
  }
  const pins: Record<string, { x: number; y: number }> = {
    a: { x: 0, y: 40 },
    d: { x: 140, y: 40 },
    dio: { x: 140, y: 40 },
    din: { x: 0, y: 60 },
    we: { x: 30, y: 80 },
    cs: { x: 50, y: 80 },
    clk: { x: 70, y: 80 },
    oe: { x: 90, y: 80 },
    clr: { x: 110, y: 80 },
  };
  for (let i = 0; i < 4; i++) pins[`be${i}`] = { x: 30 + 20 * i, y: 0 };
  return { width: 140, height: 80, pins, anchor: { x: 140, y: 40 } };
}

const RAM_PIN_LABELS: Record<string, string> = {
  a: 'A', d: 'D', dio: 'D', din: 'DIN', cs: 'sel', oe: 'OE', clr: 'CLR', clk: 'CLK', we: 'WE', ck: 'CK', nxt: 'NXT', rst: 'RST', out: 'Q',
};
export function ramPinLabel(key: string, type?: ComponentType): string {
  if (type === 'dualRam') {
    // evolution's classic labels: A0 / A1, D0 / D1, ... (byte enables keep their running number)
    if (/^be\d+$/.test(key)) return key.toUpperCase();
    if (key === 'clr') return 'CLR';
    const port = key.endsWith('1') ? '1' : '0';
    const base = port === '1' ? key.slice(0, -1) : key;
    return (RAM_PIN_LABELS[base] ?? base.toUpperCase()) + port;
  }
  return RAM_PIN_LABELS[key] ?? key.toUpperCase();
}

function ramMeta(type: ComponentType, name: string, description: string): ComponentMetadata {
  const cfg = { ...defaultRamConfig(), ...(type === 'dualRam' ? { flavor: 'evolution' as const } : {}) };
  const g = ramGeometry(type, cfg);
  const keys = ramPinKeys(type, cfg);
  const pin = (id: string, kind: 'input' | 'output') => {
    const width = ramPinWidth(type, id, cfg);
    return { id, name: ramPinLabel(id, type), type: kind, relX: g.pins[id].x, relY: g.pins[id].y, ...(width > 1 ? { width } : {}) };
  };
  return {
    type,
    name,
    category: 'sequential',
    width: g.width,
    height: g.height,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    description,
  };
}

// ---- Parametric I/O parts (Logisim std/io; Aşama 3g) ------------------------------------------------
// dipSwitch = Logisim-evolution DipSwitch, ledBar = evolution LedBar, dotMatrix = Logisim DotMatrix,
// hexDigit = Logisim Hex Digit Display. Our drawings are twice Logisim's (one dot / segment / switch = 20px)
// so every pin sits on the 10px grid; the pin order and bit order are Logisim's.

export interface IoConfig {
  /** DIP switches / LED bar segments, 1-32 */
  size: number;
  ledBarMode: 'separated' | 'oneWire';
  cols: number;
  rows: number;
  matrixInput: 'column' | 'row' | 'select';
  /** Pins on the bottom / left side (bl) or on the top / right side (tr) (evolution 'selloc') */
  selectLoc: 'bl' | 'tr';
  /** Hex digit / 7-segment decimal point input */
  dp: boolean;
}

export function defaultIoConfig(): IoConfig {
  return { size: 8, ledBarMode: 'separated', cols: 5, rows: 7, matrixInput: 'column', selectLoc: 'bl', dp: true };
}

function ioPinKeys(type: ComponentType, cfg: IoConfig): { inputs: string[]; outputs: string[] } {
  const seq = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  switch (type) {
    case 'dipSwitch':
      return { inputs: [], outputs: seq('out', cfg.size) };
    case 'ledBar':
      return { inputs: cfg.ledBarMode === 'oneWire' ? ['in'] : seq('in', cfg.size), outputs: [] };
    case 'dotMatrix':
      if (cfg.matrixInput === 'column') return { inputs: seq('c', cfg.cols), outputs: [] };
      if (cfg.matrixInput === 'row') return { inputs: seq('r', cfg.rows), outputs: [] };
      return { inputs: ['col', 'row'], outputs: [] };
    case 'hexDigit':
      return { inputs: cfg.dp ? ['in', 'dp'] : ['in'], outputs: [] };
    default:
      return { inputs: [], outputs: [] };
  }
}

function ioPinWidth(type: ComponentType, key: string, cfg: IoConfig): number {
  if (type === 'ledBar' && key === 'in') return cfg.ledBarMode === 'oneWire' ? cfg.size : 1;
  if (type === 'dotMatrix') {
    if (key === 'col') return cfg.cols;
    if (key === 'row') return cfg.rows;
    return key.startsWith('c') ? cfg.rows : cfg.cols;
  }
  if (type === 'hexDigit' && key === 'in') return 4;
  return 1;
}

function ioPinLabel(type: ComponentType, key: string): string {
  const n = key.replace(/^\D+/, '');
  if (type === 'dipSwitch') return `Q${n}`;
  if (type === 'ledBar') return key === 'in' ? 'D' : `D${n}`;
  if (type === 'hexDigit') return key === 'dp' ? 'DP' : 'D';
  if (key === 'col') return 'C';
  if (key === 'row') return 'R';
  return `${key[0].toUpperCase()}${n}`;
}

/** Body size and pin points (unrotated, relative to the top-left corner) of a parametric I/O part */
export function ioGeometry(type: ComponentType, cfg: IoConfig): { width: number; height: number; pins: Record<string, { x: number; y: number }> } {
  const pins: Record<string, { x: number; y: number }> = {};
  const U = 20;
  if (type === 'dipSwitch') {
    // Logisim-evolution facing east: the switches stacked top to bottom, one output each on the right
    const n = cfg.size;
    for (let i = 0; i < n; i++) pins[`out${i}`] = { x: 3 * U, y: U * (i + 1) };
    return { width: 3 * U, height: U * (n + 1), pins };
  }
  if (type === 'hexDigit') {
    // width - height a multiple of 20: rotated about its centre the pins stay on the 10px grid and on the body edge
    return { width: 60, height: 100, pins: { in: { x: 0, y: 30 }, dp: { x: 0, y: 60 } } };
  }
  // LED bar = a 1-row dot matrix (evolution LedBar: segments 3 dots tall, 'separated' = column input, 'one wire' = row input)
  const bar = type === 'ledBar';
  const cols = bar ? cfg.size : cfg.cols;
  const rows = bar ? 1 : cfg.rows;
  const cellH = bar ? 3 * U : U;
  const width = U * cols;
  const height = cellH * rows;
  const tr = cfg.selectLoc === 'tr';
  const mode = bar ? (cfg.ledBarMode === 'oneWire' ? 'row' : 'column') : cfg.matrixInput;
  if (mode === 'column') {
    // Logisim: column i's pin under the middle of the column (above it with selloc top-right), bit 0 = bottom dot
    for (let i = 0; i < cols; i++) pins[bar ? `in${i}` : `c${i}`] = { x: U * i + U / 2, y: tr ? 0 : height };
  } else if (mode === 'row') {
    // Logisim: row i's pin beside the middle of the row, bit 0 = rightmost dot
    for (let i = 0; i < rows; i++) pins[bar ? 'in' : `r${i}`] = { x: tr ? width : 0, y: cellH * i + cellH / 2 };
  } else if (rows === 1) {
    // Logisim-evolution select with one row: column vector on the left, row bit on the right
    pins.col = { x: 0, y: U / 2 };
    pins.row = { x: width, y: U / 2 };
  } else {
    // Logisim select: column vector, row vector 10px (ours 20px) below it, around the middle of the side
    const x = tr ? width : 0;
    const y0 = (U / 2) * rows - U / 2;
    pins.col = { x, y: y0 };
    pins.row = { x, y: y0 + U };
  }
  return { width, height, pins };
}

function ioMeta(type: ComponentType, name: string, description: string): ComponentMetadata {
  const cfg = defaultIoConfig();
  const g = ioGeometry(type, cfg);
  const keys = ioPinKeys(type, cfg);
  const pin = (id: string, kind: 'input' | 'output') => {
    const width = ioPinWidth(type, id, cfg);
    return { id, name: ioPinLabel(type, id), type: kind, relX: g.pins[id].x, relY: g.pins[id].y, ...(width > 1 ? { width } : {}) };
  };
  return {
    type,
    name,
    category: type === 'dipSwitch' ? 'inputs' : 'outputs',
    width: g.width,
    height: g.height,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    description,
  };
}

// ---- Logisim-evolution std/io parts of Aşama 5a ------------------------------------------------------------
// rgbLed = RgbLed, joystick = Joystick, matrixKeypad = MatrixKeypad, portIo = PortIO, realTimeClock = RealTimeClock.
// Drawn twice Logisim's size like the Aşama 3g parts; rotation 0 is evolution's default facing (RGB LED:
// west, the others: east). Pin order and behaviour follow evolution 5.0.0's propagate().

export interface Io5Config {
  /** Joystick output width, 2-5 */
  joyBits: number;
  keypadMode: 'raw' | 'pmod';
  keypadSize: 'normal' | 'large';
  /** Port I/O pins, 1-32 (evolution allows 64 on one bus; ours stop at our widest wire) */
  portSize: number;
  portDir: 'input' | 'output' | 'inoutSingle' | 'inoutMulti';
  rtcType: 'ms' | 's';
  rtcSize: 'medium' | 'narrow';
}

export const IO5_TYPES = new Set<ComponentType>(['rgbLed', 'joystick', 'matrixKeypad', 'portIo', 'realTimeClock']);
export const PORT_IO_MAX = 32;
export const JOYSTICK_RANGE = 14;
/** Matrix keypad key labels, row-major (evolution KEY_LABELS_RAW / KEY_LABELS_PMOD_KYPD) */
export const KEYPAD_LABELS_RAW = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];
export const KEYPAD_LABELS_PMOD = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '0', 'F', 'E', 'D'];
/** Keys whose label is a setting in raw mode (A, B, C, D, *, #) and where they sit */
export const KEYPAD_CUSTOM_KEYS = [3, 7, 11, 15, 12, 14];
export const KEYPAD_DEFAULT_CUSTOM = ['A', 'B', 'C', 'D', '*', '#'];

export function defaultIo5Config(): Io5Config {
  return { joyBits: 4, keypadMode: 'raw', keypadSize: 'normal', portSize: 8, portDir: 'inoutSingle', rtcType: 'ms', rtcSize: 'medium' };
}

const clampRange = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

export function getIo5Config(comp: CircuitComponentInstance): Io5Config {
  const d = defaultIo5Config();
  const st = comp.state;
  return {
    joyBits: clampRange(st.joyBits ?? d.joyBits, 2, 5),
    keypadMode: st.keypadMode ?? d.keypadMode,
    keypadSize: st.keypadSize ?? d.keypadSize,
    portSize: clampRange(st.portSize ?? d.portSize, 1, PORT_IO_MAX),
    portDir: st.portDir ?? d.portDir,
    rtcType: st.rtcType ?? d.rtcType,
    rtcSize: st.rtcSize ?? d.rtcSize,
  };
}

function io5PinKeys(type: ComponentType, cfg: Io5Config): { inputs: string[]; outputs: string[] } {
  switch (type) {
    case 'rgbLed':
      return { inputs: ['r', 'g', 'b'], outputs: [] };
    case 'joystick':
      return { inputs: [], outputs: ['x', 'y'] };
    case 'matrixKeypad':
      return { inputs: ['r0', 'r1', 'r2', 'r3'], outputs: ['c0', 'c1', 'c2', 'c3'] };
    case 'portIo':
      if (cfg.portDir === 'input') return { inputs: [], outputs: ['out'] };
      if (cfg.portDir === 'output') return { inputs: ['in'], outputs: [] };
      return { inputs: ['en', 'in'], outputs: ['out'] };
    case 'realTimeClock':
      return { inputs: [], outputs: ['out'] };
    default:
      return { inputs: [], outputs: [] };
  }
}

function io5PinWidth(type: ComponentType, key: string, cfg: Io5Config): number {
  if (type === 'joystick') return cfg.joyBits;
  if (type === 'portIo') return key === 'en' && cfg.portDir === 'inoutSingle' ? 1 : cfg.portSize;
  if (type === 'realTimeClock') return 32;
  return 1;
}

function io5PinLabel(type: ComponentType, key: string): string {
  if (type === 'matrixKeypad') return `${key[0].toUpperCase()}${Number(key.slice(1)) + 1}`;
  if (type === 'realTimeClock') return 'T';
  return key.toUpperCase();
}

/** Body size and pin points (unrotated, relative to the top-left corner) of an Aşama 5a part */
export function io5Geometry(type: ComponentType, cfg: Io5Config): { width: number; height: number; pins: Record<string, { x: number; y: number }> } {
  switch (type) {
    case 'rgbLed':
      // evolution facing west: red on the left, green on top, blue at the bottom (20 x 20)
      return { width: 40, height: 40, pins: { r: { x: 0, y: 20 }, g: { x: 20, y: 0 }, b: { x: 20, y: 40 } } };
    case 'joystick':
      // evolution facing east: 30 x 30 body, X and Y 10px apart on the right side
      return { width: 60, height: 60, pins: { x: { x: 60, y: 20 }, y: { x: 60, y: 40 } } };
    case 'matrixKeypad': {
      // evolution: row inputs along the bottom, column outputs down the right side, both from the top-left corner
      const s = cfg.keypadSize === 'large' ? 240 : 120;
      const pins: Record<string, { x: number; y: number }> = {};
      for (let i = 0; i < 4; i++) {
        pins[`r${i}`] = { x: 20 * (i + 1), y: s };
        pins[`c${i}`] = { x: s, y: 20 * (i + 1) };
      }
      return { width: s, height: s, pins };
    }
    case 'portIo': {
      // evolution facing east: (10 + ceil(n / 2) * 10) x 50 for n >= 8 pins; enable on the left side at 10, the
      // bus pins along the top edge from 10 on (input-only / output-only: the one bus at 10)
      const n = Math.max(cfg.portSize, 8);
      const width = 2 * (10 + Math.floor((n + 1) / 2) * 10);
      const pins: Record<string, { x: number; y: number }> =
        cfg.portDir === 'input'
          ? { out: { x: 20, y: 0 } }
          : cfg.portDir === 'output'
            ? { in: { x: 20, y: 0 } }
            : { en: { x: 0, y: 20 }, in: { x: 20, y: 0 }, out: { x: 40, y: 0 } };
      return { width, height: 100, pins };
    }
    case 'realTimeClock': {
      // evolution's default facing east: the 64-bit output on the right side, body 40 x 40 (medium) or 20 x 20 (narrow)
      const s = cfg.rtcSize === 'narrow' ? 40 : 80;
      return { width: s, height: s, pins: { out: { x: s, y: s / 2 } } };
    }
    default:
      return { width: 40, height: 40, pins: {} };
  }
}

function io5Meta(type: ComponentType, name: string, description: string): ComponentMetadata {
  const cfg = defaultIo5Config();
  const g = io5Geometry(type, cfg);
  const keys = io5PinKeys(type, cfg);
  const pin = (id: string, kind: 'input' | 'output') => {
    const width = io5PinWidth(type, id, cfg);
    return { id, name: io5PinLabel(type, id), type: kind, relX: g.pins[id].x, relY: g.pins[id].y, ...(width > 1 ? { width } : {}) };
  };
  return {
    type,
    name,
    category: type === 'rgbLed' ? 'outputs' : 'inputs',
    width: g.width,
    height: g.height,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    description,
  };
}

/**
 * New settings of an Aşama 5a part; pins keep their ids (and wires), widths follow the settings. Port I/O pins
 * that still exist keep the level the user gave them.
 */
export function configureIo5(comp: CircuitComponentInstance, patch: Partial<Io5Config>): CircuitComponentInstance {
  const cfg: Io5Config = { ...getIo5Config(comp), ...patch };
  cfg.joyBits = clampRange(cfg.joyBits, 2, 5);
  cfg.portSize = clampRange(cfg.portSize, 1, PORT_IO_MAX);
  const state = { ...comp.state };
  if (comp.type === 'joystick') state.joyBits = cfg.joyBits;
  else if (comp.type === 'matrixKeypad') {
    state.keypadMode = cfg.keypadMode;
    state.keypadSize = cfg.keypadSize;
  } else if (comp.type === 'portIo') {
    const mask = cfg.portSize >= 32 ? 0xffffffff : 2 ** cfg.portSize - 1;
    state.portSize = cfg.portSize;
    state.portDir = cfg.portDir;
    state.portPokeKnown = ((state.portPokeKnown ?? 0) & mask) >>> 0;
    state.portPokeVal = ((state.portPokeVal ?? 0) & mask) >>> 0;
  } else if (comp.type === 'realTimeClock') {
    state.rtcType = cfg.rtcType;
    state.rtcSize = cfg.rtcSize;
  }
  const keys = io5PinKeys(comp.type, cfg);
  const old = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(pinKey(comp, p), p);
  const pin = (key: string, type: 'input' | 'output'): CircuitPin => {
    const name = io5PinLabel(comp.type, key);
    const prev = old.get(key);
    const fresh = newPin(comp, key, name, type);
    const base = prev && prev.type === type ? prev : type === 'output' ? { ...fresh, value: 'Z' as SignalValue } : fresh;
    return { ...pinWithWidth(base, io5PinWidth(comp.type, key, cfg)), name };
  };
  return updatePinPositions({
    ...comp,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    state,
  });
}

/** Joystick: move the stick (evolution units from the centre, clamped to ±14); 0, 0 = released */
export function setJoystick(comp: CircuitComponentInstance, dx: number, dy: number): CircuitComponentInstance {
  const c = (v: number) => clampRange(v, -JOYSTICK_RANGE, JOYSTICK_RANGE);
  return { ...comp, state: { ...comp.state, joyX: c(dx), joyY: c(dy) } };
}

/** Evolution Joystick.propagate: a position -14..14 as the output number (1 .. 2^bits - 1, centre about half) */
export function joystickValue(pos: number, bits: number): number {
  const steps = 2 ** bits - 1;
  let v = Math.floor(((clampRange(pos, -JOYSTICK_RANGE, JOYSTICK_RANGE) + 14) * steps) / 29) + 1;
  if (bits > 4 && v >= Math.floor(steps / 2)) v++;
  return v;
}

/** Matrix keypad: press / release the key in row `row`, column `col` (0-3) */
export function setKeypadKey(comp: CircuitComponentInstance, row: number, col: number, pressed: boolean): CircuitComponentInstance {
  if (row < 0 || row > 3 || col < 0 || col > 3) return comp;
  const bit = 1 << (row * 4 + col);
  const cur = comp.state.keypadPressed ?? 0;
  return { ...comp, state: { ...comp.state, keypadPressed: pressed ? cur | bit : cur & ~bit } };
}

/** Matrix keypad key labels as drawn (row-major): raw mode takes the custom A-D / * / # labels, first character only */
export function keypadLabels(comp: CircuitComponentInstance): string[] {
  if (getIo5Config(comp).keypadMode === 'pmod') return [...KEYPAD_LABELS_PMOD];
  const labels = [...KEYPAD_LABELS_RAW];
  const custom = comp.state.keypadKeys ?? [];
  KEYPAD_CUSTOM_KEYS.forEach((k, i) => {
    const l = custom[i];
    if (l) labels[k] = l.slice(0, 1);
  });
  return labels;
}

/**
 * Evolution MatrixKeypad.propagate: column outputs from the row inputs through the pressed keys.
 * Raw: no pressed key floats; pressed keys pass their row's value, two different known values give E.
 * PmodKYPD: 1 unless a pressed key's row is 0 (then 0); E on a row, or a 1 row against a 0 column, gives E.
 * (Evolution's unknown is our x on an input and a floating output.)
 */
export function keypadColumns(pressed: number, mode: 'raw' | 'pmod', rows: SignalValue[]): SignalValue[] {
  const U: SignalValue = 'Z';
  const cols: SignalValue[] = [];
  for (let col = 0; col < 4; col++) {
    let v: SignalValue = mode === 'pmod' ? 1 : U;
    for (let row = 0; row < 4; row++) {
      if (!((pressed >>> (row * 4 + col)) & 1)) continue;
      const r: SignalValue = rows[row] === 'X' || rows[row] === 'Z' ? U : rows[row];
      if (mode === 'raw') {
        if (v === U) v = r;
        else if (r !== U && v !== r) v = 'E';
      } else if (r === 0) {
        if (v === 1) v = 0;
        else if (v !== 0) v = 'E';
      } else if (r === 'E') v = 'E';
      else if (r === 1 && v === 0) v = 'E';
    }
    cols.push(v);
  }
  return cols;
}

/** Port I/O: a click on pin i cycles the level the user gives it: floating -> 0 -> 1 -> floating (evolution togglePokeValue) */
export function togglePortPin(comp: CircuitComponentInstance, i: number): CircuitComponentInstance {
  if (i < 0 || i >= getIo5Config(comp).portSize) return comp;
  const bit = 2 ** i;
  let k = comp.state.portPokeKnown ?? 0;
  let v = comp.state.portPokeVal ?? 0;
  const isKnown = Math.floor(k / bit) % 2 === 1;
  const isOne = Math.floor(v / bit) % 2 === 1;
  if (!isKnown) k += bit; // floating -> 0
  else if (!isOne) v += bit; // 0 -> 1
  else {
    k -= bit; // 1 -> floating
    v -= bit;
  }
  return { ...comp, state: { ...comp.state, portPokeKnown: k >>> 0, portPokeVal: v >>> 0 } };
}

/** The level the user gave Port I/O pin i: 0, 1 or 'Z' (floating, evolution's unknown) */
export function portPokeOf(comp: CircuitComponentInstance, i: number): SignalValue {
  const bit = 2 ** i;
  if (Math.floor((comp.state.portPokeKnown ?? 0) / bit) % 2 === 0) return 'Z';
  return Math.floor((comp.state.portPokeVal ?? 0) / bit) % 2 === 1 ? 1 : 0;
}

/**
 * Evolution PortState.getPinValue for every pin: output-only shows the circuit's value, input-only the user's;
 * in/out: enable x -> E, enable 1 -> the circuit's value (E if the user set a different level), any other
 * enable (0 or E) -> the user's level. Evolution's unknown comes out floating. An input wired to nothing is NIL in
 * evolution and NIL.get(i) is E (checked with evolution 5.0.0): an open enable acts like E (the user's level), an
 * open data input gives E on every pin (state.portOpen, set by the simulator).
 */
export function portIoPins(comp: CircuitComponentInstance): SignalValue[] {
  const cfg = getIo5Config(comp);
  const n = cfg.portSize;
  const byKey = (k: string) => comp.inputs.find((p) => pinKey(comp, p) === k);
  const unk = (v: SignalValue) => v === 'X' || v === 'Z';
  const norm = (v: SignalValue): SignalValue => (unk(v) ? 'Z' : v);
  const open = comp.state.portOpen ?? 0;
  const data = cfg.portDir === 'input' ? [] : open & 2 ? Array<SignalValue>(n).fill('E') : readBits(byKey('in'), n).map(norm);
  const en: SignalValue[] =
    open & 1 ? Array<SignalValue>(n).fill('E') : cfg.portDir === 'inoutSingle' ? readBits(byKey('en'), 1) : cfg.portDir === 'inoutMulti' ? readBits(byKey('en'), n) : [];
  const out: SignalValue[] = [];
  for (let i = 0; i < n; i++) {
    const poke = portPokeOf(comp, i);
    if (cfg.portDir === 'output') out.push(data[i]);
    else if (cfg.portDir === 'input') out.push(poke);
    else {
      const input = data[i];
      const e = en[cfg.portDir === 'inoutSingle' ? 0 : i];
      const result: SignalValue = poke === 'Z' || poke === input ? input : 'E';
      out.push(unk(e) ? 'E' : e === 1 ? result : poke);
    }
  }
  return out;
}

/** Real-time clock time source (wall clock, milliseconds since 1970); test rigs replace it */
let rtcClock: () => number = () => Date.now();
// One simulateCircuit run reads the clock once, so a clock that ticks mid-run cannot keep the circuit from settling
let rtcFrozen: number | null = null;
export function setRtcClock(fn?: () => number): void {
  rtcClock = fn ?? (() => Date.now());
}
/** The real-time clock's output: the low 32 bits of evolution's 64-bit epoch milliseconds / seconds */
export function rtcValue(type: 'ms' | 's'): number {
  const now = rtcFrozen ?? rtcClock();
  const v = type === 's' ? Math.floor(now / 1000) : Math.floor(now);
  return ((v % 2 ** 32) + 2 ** 32) % 2 ** 32;
}

/** RGB LED colour bits (bit 0 red, 1 green, 2 blue) as evolution paints them: an input lights only on a 1 (active low: inverted) */
export function rgbLedBits(comp: CircuitComponentInstance): number {
  let sum = 0;
  comp.inputs.forEach((p, i) => {
    if (i < 3 && readBits(p, 1)[0] === 1) sum |= 1 << i;
  });
  return comp.state.ioActiveLow ? sum ^ 7 : sum;
}

// ---- Logisim-evolution BFH library of Aşama 5b -----------------------------------------------------------------
// binToBcd = BinToBcd (Binary_to_BCD_converter), bcdToSevenSegment = BcdToSevenSegmentDisplay
// (BCD_to_7_Segment_decoder). Drawn twice Logisim's size; evolution gives neither part a facing, so rotation 0 is
// its only layout. Pin order and behaviour follow evolution 5.0.0's propagate().

export const BFH_TYPES = new Set<ComponentType>(['binToBcd', 'bcdToSevenSegment']);
export const BIN_TO_BCD_MIN_BITS = 4;
export const BIN_TO_BCD_MAX_BITS = 13;
export const BIN_TO_BCD_DEFAULT_BITS = 9;
/** BCD to 7-segment output order (evolution SEGMENT_A .. SEGMENT_G) */
export const BCD_SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
/** Evolution's segment patterns for 0-9, bit 0 = segment a */
export const BCD_7SEG_CODES = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111];

/** Input width of a binary to BCD converter (4-13) */
export function binToBcdBits(comp: CircuitComponentInstance): number {
  return clampRange(comp.state.binBits ?? BIN_TO_BCD_DEFAULT_BITS, BIN_TO_BCD_MIN_BITS, BIN_TO_BCD_MAX_BITS);
}

/** Number of BCD digit outputs: the decimal digits of 2^bits (evolution (int) (log10(1 << bits) + 1)) */
export function binToBcdDigits(bits: number): number {
  return String(2 ** bits).length;
}

/**
 * Add-3 cells of the combinational shift-and-add-3 (double dabble) converter, in order: before input bit `bit` is
 * shifted in, BCD digit `digit` gets a cell when it can be 5 or more there (the bits shifted in so far are at most
 * 2^(bits-1-bit) - 1). Evolution's BinToBcd HDL has the same cells (3 for 6 bits, 9 for 9, 21 for 13).
 */
export function binToBcdAdd3Cells(bits: number): { bit: number; digit: number }[] {
  const cells: { bit: number; digit: number }[] = [];
  const digits = binToBcdDigits(bits);
  for (let bit = bits - 1; bit >= 0; bit--) {
    const max = 2 ** (bits - 1 - bit) - 1;
    for (let digit = 0; digit < digits; digit++) if (Math.floor(max / 10 ** digit) >= 5) cells.push({ bit, digit });
  }
  return cells;
}

function bfhPinKeys(type: ComponentType, bits: number): { inputs: string[]; outputs: string[] } {
  if (type === 'binToBcd') return { inputs: ['bin'], outputs: Array.from({ length: binToBcdDigits(bits) }, (_, k) => `d${k}`) };
  if (type === 'bcdToSevenSegment') return { inputs: ['bcd'], outputs: [...BCD_SEGMENTS] };
  return { inputs: [], outputs: [] };
}

function bfhPinWidth(type: ComponentType, key: string, bits: number): number {
  if (type === 'binToBcd') return key === 'bin' ? bits : 4;
  return key === 'bcd' ? 4 : 1;
}

function bfhPinLabel(type: ComponentType, key: string): string {
  if (type === 'binToBcd') return key === 'bin' ? 'Bin' : String(10 ** Number(key.slice(1)));
  return key === 'bcd' ? 'BCD' : key;
}

/** Body size and pin points (unrotated, relative to the top-left corner) of an Aşama 5b part */
export function bfhGeometry(type: ComponentType, bits: number): { width: number; height: number; pins: Record<string, { x: number; y: number }> } {
  if (type === 'binToBcd') {
    // evolution: bounds (-30, -20, n * 60, 40); input at (-30, 0), digit 10^k on the top edge at ((n - 1 - k) * 60, -20)
    const n = binToBcdDigits(bits);
    const pins: Record<string, { x: number; y: number }> = { bin: { x: 0, y: 40 } };
    for (let k = 0; k < n; k++) pins[`d${k}`] = { x: (n - 1 - k) * 120 + 60, y: 0 };
    return { width: n * 120, height: 80, pins };
  }
  if (type === 'bcdToSevenSegment') {
    // evolution: bounds (-10, -20, 50, 100); g f a b on the inner box's top edge (y 0), e d c on its bottom edge
    // (y 60), the BCD input at the bottom (10, 80). The segment pins sit inside the body, as in evolution.
    const at = (x: number, y: number) => ({ x: 2 * (x + 10), y: 2 * (y + 20) });
    return {
      width: 100,
      height: 200,
      pins: { a: at(20, 0), b: at(30, 0), c: at(20, 60), d: at(10, 60), e: at(0, 60), f: at(10, 0), g: at(0, 0), bcd: at(10, 80) },
    };
  }
  return { width: 40, height: 40, pins: {} };
}

function bfhMeta(type: ComponentType, name: string, description: string): ComponentMetadata {
  const bits = BIN_TO_BCD_DEFAULT_BITS;
  const g = bfhGeometry(type, bits);
  const keys = bfhPinKeys(type, bits);
  const pin = (id: string, kind: 'input' | 'output') => {
    const width = bfhPinWidth(type, id, bits);
    return { id, name: bfhPinLabel(type, id), type: kind, relX: g.pins[id].x, relY: g.pins[id].y, ...(width > 1 ? { width } : {}) };
  };
  return {
    type,
    name,
    category: 'combinational',
    width: g.width,
    height: g.height,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    description,
  };
}

/** New input width of a binary to BCD converter; pins that still exist keep their ids (and wires) */
export function configureBfh(comp: CircuitComponentInstance, patch: { binBits?: number }): CircuitComponentInstance {
  const bits = clampRange(patch.binBits ?? binToBcdBits(comp), BIN_TO_BCD_MIN_BITS, BIN_TO_BCD_MAX_BITS);
  const state = comp.type === 'binToBcd' ? { ...comp.state, binBits: bits } : comp.state;
  const keys = bfhPinKeys(comp.type, bits);
  const old = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(pinKey(comp, p), p);
  const pin = (key: string, type: 'input' | 'output'): CircuitPin => {
    const name = bfhPinLabel(comp.type, key);
    const prev = old.get(key);
    const base = prev && prev.type === type ? prev : newPin(comp, key, name, type);
    return { ...pinWithWidth(base, bfhPinWidth(comp.type, key, bits)), name };
  };
  return updatePinPositions({
    ...comp,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    state,
  });
}

/**
 * Evolution BinToBcd.propagate: digit outputs (index 0 = ones), each a 4-bit number. An input that is not fully
 * defined is read as -1, which Java's integer division leaves as 0 in the upper digits and -1 (1111) in the ones.
 */
export function binToBcdValues(input: SignalValue[], digits: number): number[] {
  let v = bitsToNumber(input) ?? -1;
  const out = new Array<number>(digits).fill(0);
  for (let i = digits; i > 0; i--) {
    const w = 10 ** (i - 1);
    const n = Math.trunc(v / w);
    out[i - 1] = n & 0xf;
    v -= n * w;
  }
  return out;
}

/** Evolution BcdToSevenSegmentDisplay.propagate: segments a-g for 0-9; any other or undefined input makes all x */
export function bcdSegmentValues(input: SignalValue[]): SignalValue[] {
  const v = bitsToNumber(input) ?? -1;
  if (v < 0 || v > 9) return new Array<SignalValue>(7).fill('X');
  return BCD_SEGMENTS.map((_, i) => ((BCD_7SEG_CODES[v] >> i) & 1) as 0 | 1);
}

// ---- Logisim-evolution std/io Keyboard, TTY and Telnet of Aşama 5c ---------------------------------------------
// keyboard = Keyboard, tty = TTY, telnet = Telnet. Drawn twice Logisim's size; evolution gives none of them a
// facing, so rotation 0 is their only layout. Pin order and behaviour follow evolution 5.0.0's propagate() and its
// KeyboardData / TtyState / TelnetServer.ByteBuffer. The parts keep their contents in the component state: the
// keyboard buffer and cursor, the terminal rows, the Telnet receive buffer and the bytes it sent.

export const IO5C_TYPES = new Set<ComponentType>(['keyboard', 'tty', 'telnet']);
export const KEYBOARD_BUFFER_MAX = 256;
export const KEYBOARD_DEFAULT_BUFFER = 32;
export const TTY_ROWS_MAX = 48;
export const TTY_COLS_MAX = 120;
export const TTY_DEFAULT_ROWS = 8;
export const TTY_DEFAULT_COLS = 32;
export const TELNET_DEFAULT_PORT = 8000;
export const TELNET_DEFAULT_BUFFER = 1024;
export const TELNET_BUFFER_MAX = 16 * 1024 * 1024;
/** Sent Telnet bytes kept in the state for the terminal / network side to pick up (older ones are dropped) */
export const TELNET_TX_KEEP = 4096;
/** Evolution TTY default colours: Color.BLACK text on new Color(0, 0, 0, 64) */
export const TTY_DEFAULT_COLOR = '#000000';
export const TTY_DEFAULT_BG = '#00000040';
/** Evolution TTY column width (Tty.COL_WIDTH, the width of 'W' in its 11 pt monospaced font) and row height */
const TTY_COL_WIDTH = 7;
const TTY_ROW_HEIGHT = 15;
const TTY_BORDER = 6;

export interface Io5cConfig {
  /** Keyboard buffer length, 1-256 (evolution 'buflen') */
  kbdBufLen: number;
  /** Terminal rows 1-48 and columns 1-120 (evolution 'rows', 'cols') */
  ttyRows: number;
  ttyCols: number;
  /** Telnet TCP port 1-65535, receive buffer length (evolution 'port', 'buflen') and telnet negotiation ('telnetMode') */
  telnetPort: number;
  telnetBufLen: number;
  telnetMode: boolean;
}

export function getIo5cConfig(comp: CircuitComponentInstance): Io5cConfig {
  const st = comp.state;
  return {
    kbdBufLen: clampRange(st.kbdBufLen ?? KEYBOARD_DEFAULT_BUFFER, 1, KEYBOARD_BUFFER_MAX),
    ttyRows: clampRange(st.ttyRows ?? TTY_DEFAULT_ROWS, 1, TTY_ROWS_MAX),
    ttyCols: clampRange(st.ttyCols ?? TTY_DEFAULT_COLS, 1, TTY_COLS_MAX),
    telnetPort: clampRange(st.telnetPort ?? TELNET_DEFAULT_PORT, 1, 65535),
    telnetBufLen: clampRange(st.telnetBufLen ?? TELNET_DEFAULT_BUFFER, 1, TELNET_BUFFER_MAX),
    telnetMode: st.telnetMode === true,
  };
}

function io5cPinKeys(type: ComponentType): { inputs: string[]; outputs: string[] } {
  if (type === 'keyboard') return { inputs: ['clr', 'clk', 'en'], outputs: ['avl', 'out'] };
  if (type === 'tty') return { inputs: ['clr', 'clk', 'we', 'in'], outputs: [] };
  if (type === 'telnet') return { inputs: ['in', 'clk', 'wr', 'rd'], outputs: ['out', 'av'] };
  return { inputs: [], outputs: [] };
}

function io5cPinWidth(type: ComponentType, key: string): number {
  if (key === 'out') return type === 'telnet' ? 8 : 7;
  if (key === 'in') return type === 'telnet' ? 8 : 7;
  return 1;
}

const IO5C_PIN_LABELS: Record<string, string> = { clr: 'CLR', clk: 'CK', en: 'RE', we: 'WE', avl: 'AV', av: 'AV', out: 'OUT', in: 'IN', wr: 'WR', rd: 'RD' };

/** Body size and pin points (unrotated, relative to the top-left corner) of an Aşama 5c part */
export function io5cGeometry(type: ComponentType, cfg: Io5cConfig): { width: number; height: number; pins: Record<string, { x: number; y: number }> } {
  if (type === 'keyboard') {
    // evolution: bounds (0, -15, 145, 25); clock (0, 0), CLR (20, 10), RE (10, 10), available (130, 10), data (140, 10)
    return { width: 290, height: 50, pins: { clr: { x: 40, y: 50 }, clk: { x: 0, y: 30 }, en: { x: 20, y: 50 }, avl: { x: 260, y: 50 }, out: { x: 280, y: 50 } } };
  }
  if (type === 'tty') {
    // evolution: bounds (0, 10 - h, w, h) with w = 12 + 7 * cols, h = 12 + 15 * rows (both at least 30); clock (0, 0),
    // CLR (20, 10), WE (10, 10), data (0, -10). Ours is rounded up to twice the grid: the pins along the bottom stay
    // on the grid, and so do the body corners of a rotated terminal (half the width - height difference is whole grid)
    const w = Math.max(30, 2 * TTY_BORDER + cfg.ttyCols * TTY_COL_WIDTH);
    const h = Math.max(30, 2 * TTY_BORDER + cfg.ttyRows * TTY_ROW_HEIGHT);
    const width = Math.ceil((2 * w) / 20) * 20;
    const height = Math.ceil((2 * h) / 20) * 20;
    return { width, height, pins: { clr: { x: 40, y: height }, clk: { x: 0, y: height - 20 }, we: { x: 20, y: height }, in: { x: 0, y: height - 40 } } };
  }
  if (type === 'telnet') {
    // evolution: bounds (-30, -20, 40, 60); in (-30, 10), clock (-30, 20), write (-30, 30) on the left, out (10, 10),
    // available (10, 20), read (10, 30) on the right
    return {
      width: 80,
      height: 120,
      pins: { in: { x: 0, y: 60 }, clk: { x: 0, y: 80 }, wr: { x: 0, y: 100 }, out: { x: 80, y: 60 }, av: { x: 80, y: 80 }, rd: { x: 80, y: 100 } },
    };
  }
  return { width: 40, height: 40, pins: {} };
}

function io5cDefaultConfig(): Io5cConfig {
  return getIo5cConfig({ state: {} } as CircuitComponentInstance);
}

function io5cMeta(type: ComponentType, name: string, description: string): ComponentMetadata {
  const g = io5cGeometry(type, io5cDefaultConfig());
  const keys = io5cPinKeys(type);
  const pin = (id: string, kind: 'input' | 'output') => {
    const width = io5cPinWidth(type, id);
    return { id, name: IO5C_PIN_LABELS[id] ?? id, type: kind, relX: g.pins[id].x, relY: g.pins[id].y, ...(width > 1 ? { width } : {}) };
  };
  return {
    type,
    name,
    category: type === 'tty' ? 'outputs' : 'inputs',
    width: g.width,
    height: g.height,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    description,
  };
}

/**
 * New settings of an Aşama 5c part, applied to its contents the way evolution does when the attribute changes:
 * a shorter keyboard buffer drops the characters past its end (KeyboardData.updateBufferLength), a resized terminal
 * keeps its last rows and cuts long ones (TtyState.updateSize), a new Telnet port or buffer length starts with an
 * empty buffer (a new server / ByteBuffer; a new server also has no previous clock level).
 */
export function configureIo5c(comp: CircuitComponentInstance, patch: Partial<Io5cConfig>): CircuitComponentInstance {
  const old = getIo5cConfig(comp);
  const cfg: Io5cConfig = { ...old, ...patch };
  cfg.kbdBufLen = clampRange(cfg.kbdBufLen, 1, KEYBOARD_BUFFER_MAX);
  cfg.ttyRows = clampRange(cfg.ttyRows, 1, TTY_ROWS_MAX);
  cfg.ttyCols = clampRange(cfg.ttyCols, 1, TTY_COLS_MAX);
  cfg.telnetPort = clampRange(cfg.telnetPort, 1, 65535);
  cfg.telnetBufLen = clampRange(cfg.telnetBufLen, 1, TELNET_BUFFER_MAX);
  let state = { ...comp.state };
  if (comp.type === 'keyboard') {
    state.kbdBufLen = cfg.kbdBufLen;
    const buf = state.kbdBuf ?? '';
    if (buf.length > cfg.kbdBufLen) state.kbdBuf = buf.slice(0, cfg.kbdBufLen);
    if ((state.kbdCursor ?? 0) > cfg.kbdBufLen) state.kbdCursor = cfg.kbdBufLen;
  } else if (comp.type === 'tty') {
    state.ttyRows = cfg.ttyRows;
    state.ttyCols = cfg.ttyCols;
    state = { ...state, ...ttyResize(ttyStateOf(comp.state, old), cfg.ttyRows, cfg.ttyCols) };
  } else if (comp.type === 'telnet') {
    state.telnetPort = cfg.telnetPort;
    state.telnetBufLen = cfg.telnetBufLen;
    state.telnetMode = cfg.telnetMode || undefined;
    // a changed setting makes evolution run propagate() again
    state.telnetDirty = true;
    if (cfg.telnetPort !== old.telnetPort || cfg.telnetBufLen !== old.telnetBufLen) {
      state.telnetRx = undefined;
      if (cfg.telnetPort !== old.telnetPort) state.lastClk = undefined;
    }
  }
  const keys = io5cPinKeys(comp.type);
  const oldPins = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) oldPins.set(pinKey(comp, p), p);
  const pin = (key: string, type: 'input' | 'output'): CircuitPin => {
    const name = IO5C_PIN_LABELS[key] ?? key;
    const prev = oldPins.get(key);
    const base = prev && prev.type === type ? prev : newPin(comp, key, name, type);
    return { ...pinWithWidth(base, io5cPinWidth(comp.type, key)), name };
  };
  return updatePinPositions({
    ...comp,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    state,
  });
}

// ---- keyboard: KeyboardData, a buffer with an editing cursor; the circuit takes characters from its front

/** Whether evolution's keyboard takes a typed character (Keyboard.Poker.keyTyped): not a control character, except backspace, newline and form feed */
export function keyboardAccepts(code: number): boolean {
  const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  return !control || code === 8 || code === 10 || code === 12;
}

/** Characters inserted at the cursor (KeyboardData.insert); those that do not fit in the buffer are dropped */
export function keyboardType(comp: CircuitComponentInstance, text: string): CircuitComponentInstance {
  const cap = getIo5cConfig(comp).kbdBufLen;
  let buf = comp.state.kbdBuf ?? '';
  let pos = Math.min(comp.state.kbdCursor ?? 0, buf.length);
  for (const ch of text.split('')) {
    if (buf.length >= cap) break;
    buf = buf.slice(0, pos) + ch + buf.slice(pos);
    pos++;
  }
  return { ...comp, state: { ...comp.state, kbdBuf: buf, kbdCursor: pos } };
}

/** Editing keys of evolution's keyboard (Keyboard.Poker.keyPressed): delete at the cursor, cursor left / right / home / end */
export function keyboardKey(comp: CircuitComponentInstance, key: 'delete' | 'left' | 'right' | 'home' | 'end'): CircuitComponentInstance {
  const buf = comp.state.kbdBuf ?? '';
  const pos = Math.min(comp.state.kbdCursor ?? 0, buf.length);
  let next = { buf, pos };
  if (key === 'delete') next = pos < buf.length ? { buf: buf.slice(0, pos) + buf.slice(pos + 1), pos } : next;
  else if (key === 'left') next = pos > 0 ? { buf, pos: pos - 1 } : next;
  else if (key === 'right') next = pos < buf.length ? { buf, pos: pos + 1 } : next;
  else if (key === 'home') next = { buf, pos: 0 };
  else next = { buf, pos: buf.length };
  if (next.buf === buf && next.pos === pos) return comp;
  return { ...comp, state: { ...comp.state, kbdBuf: next.buf, kbdCursor: next.pos } };
}

/** Keyboard buffer as evolution shows it: control characters as spaces (KeyboardData.toString), and the cursor */
export function keyboardText(comp: CircuitComponentInstance): { text: string; cursor: number; specials: { at: number; code: number }[] } {
  const buf = comp.state.kbdBuf ?? '';
  const specials: { at: number; code: number }[] = [];
  let text = '';
  for (let i = 0; i < buf.length; i++) {
    const code = buf.charCodeAt(i);
    const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (control) specials.push({ at: i, code });
    text += control ? ' ' : buf[i];
  }
  return { text, cursor: Math.min(comp.state.kbdCursor ?? 0, buf.length), specials };
}

/**
 * Part of the keyboard buffer shown in a box `max` characters wide, after evolution's KeyboardData.updateDisplay: the
 * whole buffer when it fits, otherwise a window that keeps the cursor in view; a cut-off front keeps the first
 * character followed by an ellipsis (it is the next one the circuit reads), a cut-off end ends with one.
 */
export function keyboardView(text: string, cursor: number, max: number): { start: number; end: number } {
  const len = text.length;
  const room = Math.max(max, 4);
  if (len <= room) return { start: 0, end: len };
  const pos = Math.min(Math.max(cursor, 0), len);
  // front cut: first character + ellipsis, then the end of the buffer
  if (pos > len - (room - 2)) return { start: len - (room - 2), end: len };
  // end cut: the start of the buffer, then an ellipsis
  if (pos < room - 1) return { start: 0, end: room - 1 };
  // both cut: the cursor with one character after it
  const end = Math.min(len - 1, pos + 1);
  return { start: end - (room - 3), end };
}

// ---- terminal: TtyState, the rows above the cursor's row plus the row being written

interface TtyContents {
  ttyLines: string[];
  ttyRow: number;
  ttyLast: string;
}

function ttyStateOf(st: CircuitComponentInstance['state'], cfg: Io5cConfig): TtyContents {
  const n = cfg.ttyRows - 1;
  const lines = st.ttyLines && st.ttyLines.length === n ? st.ttyLines : Array.from({ length: n }, (_, i) => st.ttyLines?.[i] ?? '');
  return { ttyLines: lines, ttyRow: Math.min(st.ttyRow ?? 0, n), ttyLast: st.ttyLast ?? '' };
}

/** TtyState.updateSize */
function ttyResize(t: TtyContents, rows: number, cols: number): TtyContents {
  let lines = t.ttyLines;
  let row = t.ttyRow;
  let last = t.ttyLast;
  if (rows - 1 !== lines.length) {
    if (rows - 1 > lines.length || row < rows - 1) {
      lines = [...lines.slice(0, row), ...new Array<string>(rows - 1 - row).fill('')];
    } else {
      lines = lines.slice(row - rows + 1, row);
      row = rows - 1;
    }
  }
  lines = lines.map((s) => (s.length > cols ? s.slice(0, cols) : s));
  if (last.length > cols) last = last.slice(0, cols);
  return { ttyLines: lines, ttyRow: row, ttyLast: last };
}

/**
 * TtyState.add: form feed clears the screen, backspace deletes the last character of the current row, newline /
 * carriage return end the row, other control characters are ignored, a printable character starts a new row when
 * the current one is full. At the bottom the rows scroll up. Evolution's one-row terminal throws an index error
 * there (its commit() copies a negative length); ours scrolls the single row away instead.
 */
function ttyAdd(t: TtyContents, cols: number, code: number): TtyContents {
  const commit = (s: TtyContents): TtyContents => {
    const n = s.ttyLines.length;
    if (s.ttyRow >= n) return { ttyLines: n === 0 ? s.ttyLines : [...s.ttyLines.slice(1), s.ttyLast], ttyRow: s.ttyRow, ttyLast: '' };
    const lines = [...s.ttyLines];
    lines[s.ttyRow] = s.ttyLast;
    return { ttyLines: lines, ttyRow: s.ttyRow + 1, ttyLast: '' };
  };
  if (code === 12) return { ttyLines: t.ttyLines.map(() => ''), ttyRow: 0, ttyLast: '' };
  if (code === 8) return t.ttyLast.length > 0 ? { ...t, ttyLast: t.ttyLast.slice(0, -1) } : t;
  if (code === 10 || code === 13) return commit(t);
  const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  if (control) return t;
  const s = t.ttyLast.length === cols ? commit(t) : t;
  return { ...s, ttyLast: s.ttyLast + String.fromCharCode(code) };
}

/** Rows of a terminal as evolution draws them (TtyState.getRowString) and the cursor */
export function ttyScreen(comp: CircuitComponentInstance): { rows: string[]; cursorRow: number; cursorCol: number } {
  const cfg = getIo5cConfig(comp);
  const t = ttyStateOf(comp.state, cfg);
  const rows = Array.from({ length: cfg.ttyRows }, (_, i) => (i < t.ttyRow ? t.ttyLines[i] : i === t.ttyRow ? t.ttyLast : ''));
  return { rows, cursorRow: t.ttyRow, cursorCol: t.ttyLast.length };
}

// ---- Telnet: TelnetServer.ByteBuffer (bytes received from the client) and the bytes sent to it

/** Bytes from the Telnet client (TelnetServer.dataReceived, after telnet escapes are removed): kept while the buffer has room */
export function telnetReceive(comp: CircuitComponentInstance, bytes: number[]): CircuitComponentInstance {
  const cap = getIo5cConfig(comp).telnetBufLen;
  let rx = comp.state.telnetRx ?? '';
  for (const b of bytes) if (rx.length < cap) rx += String.fromCharCode(b & 0xff);
  return { ...comp, state: { ...comp.state, telnetRx: rx, telnetDirty: true } };
}

/** Bytes the circuit sent with index from `from` on (telnetTxCount counts every byte; the state keeps the last TELNET_TX_KEEP) */
export function telnetSent(comp: CircuitComponentInstance, from: number): { bytes: number[]; count: number } {
  const tx = comp.state.telnetTx ?? '';
  const count = comp.state.telnetTxCount ?? 0;
  const first = count - tx.length;
  const start = Math.max(from, first) - first;
  return { bytes: Array.from(tx.slice(start), (c) => c.charCodeAt(0)), count };
}

// ---- Logisim-evolution std/io RGB Video of Aşama 5d ----------------------------------------------------------
// rgbVideo = 'RGB Video' (Video.java, a ManagedComponent). Pins along the bottom edge: RST, CLK, WE, X, Y, DATA; X / Y
// are as wide as the width / height need (32 - numberOfLeadingZeros(n - 1)), DATA as the colour model's pixel size.
// The image is kept in the component state as 0xRRGGBB pixels; evolution does not save it in the .circ either.

export const VIDEO_PAGE_SIZE = 1024;
export const VIDEO_SIZE_MIN = 2;
export const VIDEO_SIZE_MAX = 4096;
export const VIDEO_SCALE_MAX = 8;
export type VideoColorModel = NonNullable<CircuitComponentInstance['state']['videoColor']>;
/** Colour models in evolution's COLOR_OPTIONS order, with its option text (the .circ value) and pixel size */
export const VIDEO_COLOR_MODELS: { id: VideoColorModel; circ: string; bits: number }[] = [
  { id: 'rgb888', circ: '888 RGB (24 bit)', bits: 24 },
  { id: 'rgb555', circ: '555 RGB (15 bit)', bits: 15 },
  { id: 'rgb565', circ: '565 RGB (16 bit)', bits: 16 },
  { id: 'rgb444', circ: '444 RGB (12 bit)', bits: 12 },
  { id: 'rgb111', circ: '8-Color RGB (3 bit)', bits: 3 },
  { id: 'atari', circ: 'Atari 2600 (7 bit)', bits: 7 },
  { id: 'xterm16', circ: 'XTerm16 (4 bit)', bits: 4 },
  { id: 'xterm256', circ: 'XTerm256 (8 bit)', bits: 8 },
  { id: 'gray4', circ: 'Grayscale (4 bit)', bits: 4 },
  { id: 'vga256', circ: 'VGA256 (8 bit)', bits: 8 },
];
/** Evolution's resolution choices (RESOLUTION_OPTIONS, without Custom) */
export const VIDEO_RESOLUTIONS: [number, number][] = [
  [128, 128], [256, 256], [320, 240], [640, 480], [960, 540], [1024, 768], [1280, 720], [1920, 1080],
];

// Indexed palettes of Video.java (atari 128 entries, the others 2^bits), measured from evolution's IndexColorModels
const VIDEO_PALETTE_HEX: Partial<Record<VideoColorModel, string>> = {
  atari:
    '0000000a0a0a3737375f5f5f7a7a7aa1a1a1c5c5c5ededed0000003521005a4500816c009c8700c3af01e8d326fffa4d' +
    '3100005907007d2b00a45200bf6d04e7952bffb950ffe0774700006e0000931302ba3b2ad55545fc7d6cffa190ffc9b8' +
    '4b000272002996034ebe2a75d94590ff6cb7ff91dcffb8ff3c0049640070880094af24bcca3fd7f266feff8affffb2ff' +
    '1e007d4500a56902c99129f1ac44ffd36bfff790ffffb7ff0000961d00bd4111e16939ff8453ffab7bffcf9ffff7c7ff' +
    '00008d0004b41728d93f50ff5a6bff8192ffa5b6ffcddeff000065001e8c0042b01b6ad83685f35dacff82d0ffa9f8ff' +
    '000f2500364c005a700482981f9db347c4da6be8fe92ffff002000004701006b2500934d1aae6842d58f66f9b48dffdb' +
    '002700004e000072000d9a0628b5204fdc4874ff6c9bff94002200004a00036e002b950045b0006dd81291fc36b9ff5d' +
    '000a00073a002b5f005286006da10095c800b9ed1ce0ff430000003521005a4500816c009c8700c3af01e8d326fffa4d',
  xterm16:
    '000000800000008000808000000080800080008080c0c0c0808080ff000000ff00ffff000000ffff00ff00ffffffffff',
  xterm256:
    '000000800000008000808000000080800080008080c0c0c0808080ff000000ff00ffff000000ffff00ff00ffffffffff' +
    '00000000005f0000870000af0000d70000ff005f00005f5f005f87005faf005fd7005fff00870000875f0087870087af' +
    '0087d70087ff00af0000af5f00af8700afaf00afd700afff00d70000d75f00d78700d7af00d7d700d7ff00ff0000ff5f' +
    '00ff8700ffaf00ffd700ffff5f00005f005f5f00875f00af5f00d75f00ff5f5f005f5f5f5f5f875f5faf5f5fd75f5fff' +
    '5f87005f875f5f87875f87af5f87d75f87ff5faf005faf5f5faf875fafaf5fafd75fafff5fd7005fd75f5fd7875fd7af' +
    '5fd7d75fd7ff5fff005fff5f5fff875fffaf5fffd75fffff87000087005f8700878700af8700d78700ff875f00875f5f' +
    '875f87875faf875fd7875fff87870087875f8787878787af8787d78787ff87af0087af5f87af8787afaf87afd787afff' +
    '87d70087d75f87d78787d7af87d7d787d7ff87ff0087ff5f87ff8787ffaf87ffd787ffffaf0000af005faf0087af00af' +
    'af00d7af00ffaf5f00af5f5faf5f87af5fafaf5fd7af5fffaf8700af875faf8787af87afaf87d7af87ffafaf00afaf5f' +
    'afaf87afafafafafd7afafffafd700afd75fafd787afd7afafd7d7afd7ffafff00afff5fafff87afffafafffd7afffff' +
    'd70000d7005fd70087d700afd700d7d700ffd75f00d75f5fd75f87d75fafd75fd7d75fffd78700d7875fd78787d787af' +
    'd787d7d787ffdfaf00dfaf5fdfaf87dfafafdfafdfdfafffdfdf00dfdf5fdfdf87dfdfafdfdfdfdfdfffdfff00dfff5f' +
    'dfff87dfffafdfffdfdfffffff0000ff005fff0087ff00afff00dfff00ffff5f00ff5f5fff5f87ff5fafff5fdfff5fff' +
    'ff8700ff875fff8787ff87afff87dfff87ffffaf00ffaf5fffaf87ffafafffafdfffafffffdf00ffdf5fffdf87ffdfaf' +
    'ffdfdfffdfffffff00ffff5fffff87ffffafffffdfffffff0808081212121c1c1c2626263030303a3a3a4444444e4e4e' +
    '5858586262626c6c6c7676768080808a8a8a9494949e9e9ea8a8a8b2b2b2bcbcbcc6c6c6d0d0d0dadadae4e4e4eeeeee',
  vga256:
    '0000000000aa00aa0000aaaaaa0000aa00aaaa5500aaaaaa5555555555ff55ff5555ffffff5555ff55ffffff55ffffff' +
    '0000001414142020202c2c2c383838454545515151616161717171828282929292a2a2a2b6b6b6cbcbcbe3e3e3ffffff' +
    '0000ff4100ff7d00ffbe00ffff00ffff00beff007dff0041ff0000ff4100ff7d00ffbe00ffff00beff007dff0041ff00' +
    '00ff0000ff4100ff7d00ffbe00ffff00beff007dff0041ff7d7dff9e7dffbe7dffdf7dffff7dffff7ddfff7dbeff7d9e' +
    'ff7d7dff9e7dffbe7dffdf7dffff7ddfff7dbeff7d9eff7d7dff7d7dff9e7dffbe7dffdf7dffff7ddfff7dbeff7d9eff' +
    'b6b6ffc7b6ffdbb6ffebb6ffffb6ffffb6ebffb6dbffb6c7ffb6b6ffc7b6ffdbb6ffebb6ffffb6ebffb6dbffb6c7ffb6' +
    'b6ffb6b6ffc7b6ffdbb6ffebb6ffffb6ebffb6dbffb6c7ff0000711c007138007155007171007171005571003871001c' +
    '710000711c007138007155007171005571003871001c710000710000711c007138007155007171005571003871001c71' +
    '383871453871553871613871713871713861713855713845713838714538715538716138717138617138557138457138' +
    '387138387145387155387161387171386171385571384571515171595171615171695171715171715169715161715159' +
    '715151715951716151716951717151697151617151597151517151517159517161517169517171516971516171515971' +
    '000041100041200041300041410041410030410020410010410000411000412000413000414100304100204100104100' +
    '004100004110004120004130004141003041002041001041202041282041302041382041412041412038412030412028' +
    '412020412820413020413820414120384120304120284120204120204128204130204138204141203841203041202841' +
    '2c2c41302c41342c413c2c41412c41412c3c412c34412c30412c2c41302c41342c413c2c41412c3c412c34412c30412c' +
    '2c412c2c41302c41342c413c2c41412c3c412c34412c3041000000000000000000000000000000000000000000000000',
};
const videoPalettes: Partial<Record<VideoColorModel, number[]>> = {};
function videoPalette(id: VideoColorModel): number[] {
  if (!videoPalettes[id]) {
    const hex = VIDEO_PALETTE_HEX[id] ?? '';
    const t: number[] = [];
    for (let i = 0; i + 6 <= hex.length; i += 6) t.push(parseInt(hex.slice(i, i + 6), 16));
    videoPalettes[id] = t;
  }
  return videoPalettes[id]!;
}

/** Red / green / blue field widths of the direct colour models (DirectColorModel masks), red highest */
const VIDEO_DIRECT: Partial<Record<VideoColorModel, [number, number, number]>> = {
  rgb888: [8, 8, 8],
  rgb555: [5, 5, 5],
  rgb565: [5, 6, 5],
  rgb444: [4, 4, 4],
  rgb111: [1, 1, 1],
};

/**
 * 0xRRGGBB evolution paints for a data value (new Color(cm.getRGB(value))). Direct models scale each field to 8 bits
 * with rounding; indexed ones look the value up. An undefined data input reads -1 (Value.toLongValue): every field
 * full = white for the direct models; the indexed models mask it to their table index (IndexColorModel pixel_mask:
 * 4 bits -> 15, 7 and 8 bits -> 255), past the 128 Atari entries that is 0 = black.
 */
export function videoRgb(model: VideoColorModel, value: number): number {
  const direct = VIDEO_DIRECT[model];
  if (direct) {
    if (value < 0) return 0xffffff;
    const [rb, gb, bb] = direct;
    const field = (shift: number, bits: number) => {
      const max = (1 << bits) - 1;
      return Math.floor((((value >>> shift) & max) * 255) / max + 0.5);
    };
    return (field(gb + bb, rb) << 16) | (field(bb, gb) << 8) | field(0, bb);
  }
  if (model === 'gray4') return 0x111111 * (value < 0 ? 15 : value & 15);
  const t = videoPalette(model);
  const bits = model === 'xterm16' ? 4 : 8;
  return t[value < 0 ? (1 << bits) - 1 : value] ?? 0;
}

export interface VideoConfig {
  color: VideoColorModel;
  reset: 'async' | 'sync';
  cursor: boolean;
  width: number;
  height: number;
  scale: number;
}

export function getVideoConfig(comp: CircuitComponentInstance): VideoConfig {
  const st = comp.state;
  return {
    color: VIDEO_COLOR_MODELS.some((m) => m.id === st.videoColor) ? st.videoColor! : 'rgb888',
    reset: st.videoReset === 'sync' ? 'sync' : 'async',
    cursor: st.videoNoCursor !== true,
    width: clampRange(st.videoWidth ?? 128, VIDEO_SIZE_MIN, VIDEO_SIZE_MAX),
    height: clampRange(st.videoHeight ?? 128, VIDEO_SIZE_MIN, VIDEO_SIZE_MAX),
    scale: clampRange(st.videoScale ?? 2, 1, VIDEO_SCALE_MAX),
  };
}

/** Bits of an X / Y input for a screen n pixels wide / high (Video.configureComponent) */
export function videoCoordBits(n: number): number {
  return Math.max(1, 32 - Math.clz32(n - 1));
}

function videoPinWidth(key: string, cfg: VideoConfig): number {
  if (key === 'x') return videoCoordBits(cfg.width);
  if (key === 'y') return videoCoordBits(cfg.height);
  if (key === 'data') return VIDEO_COLOR_MODELS.find((m) => m.id === cfg.color)!.bits;
  return 1;
}

const VIDEO_PIN_KEYS = ['rst', 'clk', 'we', 'x', 'y', 'data'];
const VIDEO_PIN_LABELS: Record<string, string> = { rst: 'RST', clk: 'CLK', we: 'WE', x: 'X', y: 'Y', data: 'DATA' };

/**
 * Body size and pin points (unrotated, from the top-left corner). Evolution: bounds (-30, -bh, bw, bh) with
 * bw = max(scale * width + 14, 100), bh = max(scale * height + 14, 20), pins on the bottom edge at x = 0, 10, 20,
 * 40, 50, 60. Ours is twice that, rounded up to twice the grid like the terminal (corners stay on the grid when
 * rotated); the screen sits 14 from the top-left corner.
 */
export function videoGeometry(cfg: VideoConfig): { width: number; height: number; pins: Record<string, { x: number; y: number }> } {
  const bw = Math.max(cfg.scale * cfg.width + 14, 100);
  const bh = Math.max(cfg.scale * cfg.height + 14, 20);
  const width = Math.ceil((2 * bw) / 20) * 20;
  const height = Math.ceil((2 * bh) / 20) * 20;
  const at = (x: number) => ({ x: 60 + 2 * x, y: height });
  return { width, height, pins: { rst: at(0), clk: at(10), we: at(20), x: at(40), y: at(50), data: at(60) } };
}

function videoMeta(): ComponentMetadata {
  const cfg = getVideoConfig({ state: {} } as CircuitComponentInstance);
  const g = videoGeometry(cfg);
  return {
    type: 'rgbVideo',
    name: 'RGB Video',
    category: 'outputs',
    width: g.width,
    height: g.height,
    inputs: VIDEO_PIN_KEYS.map((k) => {
      const width = videoPinWidth(k, cfg);
      return { id: k, name: VIDEO_PIN_LABELS[k], type: 'input' as const, relX: g.pins[k].x, relY: g.pins[k].y, ...(width > 1 ? { width } : {}) };
    }),
    outputs: [],
    description:
      'Piksel ekranı (Logisim-evolution RGB Video): saatin yükselen kenarında WE 1 ise (X, Y) pikseline DATA rengini yazar. Çözünürlük 2-4096, 10 renk modeli (24 bit RGB, 555, 565, 444, 8 renk, Atari, XTerm16/256, gri, VGA256), ölçek 1-8. RST 1 iken ekran siyaha döner (asenkron ya da saatle)',
  };
}

/** Pixel at (x, y) as 0xRRGGBB (black where nothing was drawn) */
export function videoPixel(comp: CircuitComponentInstance, x: number, y: number): number {
  const w = getVideoConfig(comp).width;
  const i = y * w + x;
  return comp.state.videoPages?.[Math.floor(i / VIDEO_PAGE_SIZE)]?.[i % VIDEO_PAGE_SIZE] ?? 0;
}

/** Store a pixel; copy on write (pages are shared with earlier steps' states and with undo history) */
function videoWrite(comp: CircuitComponentInstance, i: number, rgb: number): void {
  const k = String(Math.floor(i / VIDEO_PAGE_SIZE));
  const pages = comp.state.videoPages ?? {};
  if ((pages[k]?.[i % VIDEO_PAGE_SIZE] ?? 0) === rgb) return;
  const page = pages[k] ? [...pages[k]] : new Array<number>(VIDEO_PAGE_SIZE).fill(0);
  page[i % VIDEO_PAGE_SIZE] = rgb;
  comp.state.videoPages = { ...pages, [k]: page };
}

/**
 * New RGB video settings; pins keep their ids, X / Y / DATA take the new widths. A new size starts a new image the
 * way evolution's getState does (black, the old image drawn at the top-left corner, so pixels inside both sizes
 * stay) and forgets the previous clock level (the new State's lastClock is null: its next run counts as an edge).
 * Colour, reset, cursor and scale leave the image alone (pixels are stored as colours).
 */
export function configureVideo(comp: CircuitComponentInstance, patch: Partial<VideoConfig>): CircuitComponentInstance {
  const old = getVideoConfig(comp);
  const cfg: VideoConfig = { ...old, ...patch };
  cfg.width = clampRange(cfg.width, VIDEO_SIZE_MIN, VIDEO_SIZE_MAX);
  cfg.height = clampRange(cfg.height, VIDEO_SIZE_MIN, VIDEO_SIZE_MAX);
  cfg.scale = clampRange(cfg.scale, 1, VIDEO_SCALE_MAX);
  let state: CircuitComponentInstance['state'] = {
    ...comp.state,
    videoColor: cfg.color,
    videoReset: cfg.reset === 'sync' ? 'sync' : undefined,
    videoNoCursor: cfg.cursor ? undefined : true,
    videoWidth: cfg.width,
    videoHeight: cfg.height,
    videoScale: cfg.scale,
  };
  if (cfg.width !== old.width || cfg.height !== old.height) {
    const pages: Record<string, number[]> = {};
    for (const [k, page] of Object.entries(comp.state.videoPages ?? {})) {
      page.forEach((rgb, j) => {
        if (!rgb) return;
        const i = Number(k) * VIDEO_PAGE_SIZE + j;
        const x = i % old.width;
        const y = Math.floor(i / old.width);
        if (x >= cfg.width || y >= cfg.height) return;
        const ni = y * cfg.width + x;
        const nk = String(Math.floor(ni / VIDEO_PAGE_SIZE));
        (pages[nk] ??= new Array<number>(VIDEO_PAGE_SIZE).fill(0))[ni % VIDEO_PAGE_SIZE] = rgb;
      });
    }
    state = { ...state, videoPages: Object.keys(pages).length ? pages : undefined, lastClk: undefined, videoX: undefined, videoY: undefined, videoData: undefined };
  }
  const oldPins = new Map<string, CircuitPin>();
  for (const p of comp.inputs) oldPins.set(pinKey(comp, p), p);
  const inputs = VIDEO_PIN_KEYS.map((key) => {
    const prev = oldPins.get(key);
    const base = prev ?? newPin(comp, key, VIDEO_PIN_LABELS[key], 'input');
    return { ...pinWithWidth(base, videoPinWidth(key, cfg)), name: VIDEO_PIN_LABELS[key] };
  });
  return updatePinPositions({ ...comp, inputs, outputs: [], state });
}

// ---- Logisim-evolution Base library Image of Aşama 5e -------------------------------------------------------
// image = 'Image' (std/base/Image.java + ImageAttributes): a picture in a frame whose top-left corner is the part's
// location; no pins, no logic, not in HDL. The picture is kept as evolution keeps it: the source string itself
// (normally a "data:image/...;base64," URL, else a file path), so the .circ attribute goes back byte for byte.
// Evolution decodes it with ImageIO (PNG, JPEG, GIF, BMP) and scales a picture above 2048 px down for drawing;
// the frame size follows the picture until the user sets it (userSetDimensions).

export const IMAGE_DEFAULT_SIZE = 64;
/** evolution ImageUtil.MAX_IMAGE_DIMENSION */
export const IMAGE_MAX_DIMENSION = 2048;
export type ImageScale = 'fit' | 'stretch' | 'cover';
export const IMAGE_SCALES: ImageScale[] = ['fit', 'stretch', 'cover'];
/** evolution's licence options (their .circ value), in its order */
export const IMAGE_LICENSES = [
  'Unspecified',
  'Public Domain / CC0',
  'CC BY (Attribution)',
  'CC BY-SA (Attribution-ShareAlike)',
  'CC BY-NC (NonCommercial)',
  'CC BY-ND (NoDerivatives)',
  'Fair Use / Educational',
  'Proprietary / Copyrighted',
  'Other',
];

export interface ImageConfig {
  src: string;
  width: number;
  height: number;
  scale: ImageScale;
  license: string;
  attribution: string;
  sized: boolean;
}

export function getImageConfig(comp: Pick<CircuitComponentInstance, 'state'>): ImageConfig {
  const s = comp.state;
  return {
    src: s.imageSrc ?? '',
    width: Math.max(1, Math.round(s.imageWidth ?? IMAGE_DEFAULT_SIZE)),
    height: Math.max(1, Math.round(s.imageHeight ?? IMAGE_DEFAULT_SIZE)),
    scale: s.imageScale && IMAGE_SCALES.includes(s.imageScale) ? s.imageScale : 'fit',
    license: s.imageLicense && IMAGE_LICENSES.includes(s.imageLicense) ? s.imageLicense : 'Unspecified',
    attribution: s.imageAttribution ?? '',
    sized: s.imageSized === true,
  };
}

/** The image's settings as given (defaults stay unset in the state); an image has no pins */
export function configureImage(comp: CircuitComponentInstance, patch: Partial<ImageConfig>): CircuitComponentInstance {
  const cfg = { ...getImageConfig(comp), ...patch };
  const state = {
    ...comp.state,
    imageSrc: cfg.src || undefined,
    imageWidth: cfg.width === IMAGE_DEFAULT_SIZE ? undefined : Math.max(1, Math.round(cfg.width)),
    imageHeight: cfg.height === IMAGE_DEFAULT_SIZE ? undefined : Math.max(1, Math.round(cfg.height)),
    imageScale: cfg.scale === 'fit' ? undefined : cfg.scale,
    imageLicense: cfg.license === 'Unspecified' ? undefined : cfg.license,
    imageAttribution: cfg.attribution || undefined,
    imageSized: cfg.sized || undefined,
  };
  return { ...comp, inputs: [], outputs: [], state };
}

/** evolution ImageUtil.formatBytes: "0 B", "512 B", "12.3 KB", ... (1024 steps, one decimal) */
export function formatImageBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const g = Math.min(Math.trunc(Math.log10(bytes) / Math.log10(1024)), units.length - 1);
  if (g === 0) return `${bytes} B`;
  return `${(bytes / 1024 ** g).toFixed(1)} ${units[g]}`;
}

/** evolution formatDataSize: the UTF-8 size of the source string (the data URL text, not the decoded file) */
export function imageDataSize(src: string): string {
  return formatImageBytes(new TextEncoder().encode(src).length);
}

/** Bytes of a data URL's base64 payload from its start (all of it when maxChars is undefined) */
function dataUrlBytes(src: string, maxChars?: number): Uint8Array | null {
  if (!src.startsWith('data:image/')) return null;
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  let b64 = src.slice(comma + 1, maxChars === undefined ? undefined : comma + 1 + maxChars).replace(/\s+/g, '');
  b64 = b64.slice(0, b64.length - (b64.length % 4));
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Picture size from the PNG / GIF / JPEG / BMP header (the formats evolution's ImageIO reads), null otherwise */
function headerSize(b: Uint8Array): { width: number; height: number } | null | 'more' {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const i32le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32be(16), height: u32be(20) };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    // ImageIO reads the first frame, sized by its image descriptor
    let i = 13;
    if (b.length < 13) return 'more';
    if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
    while (i < b.length) {
      if (b[i] === 0x2c) return i + 9 <= b.length ? { width: u16le(i + 5), height: u16le(i + 7) } : 'more';
      if (b[i] !== 0x21) return null;
      i += 2;
      while (i < b.length && b[i] !== 0) i += b[i] + 1;
      i++;
    }
    return 'more';
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return i + 9 <= b.length ? { width: u16be(i + 7), height: u16be(i + 5) } : 'more';
      if (m === 0xd9 || m === 0xda) return null;
      i += 2 + u16be(i + 2);
    }
    return 'more';
  }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { width: Math.abs(i32le(18)), height: Math.abs(i32le(22)) };
  return null;
}

const imageSizeCache = new Map<string, { width: number; height: number } | null>();

/** The picture's own size in pixels, or null when it is not a data URL evolution could decode */
export function imageNaturalSize(src: string): { width: number; height: number } | null {
  if (imageSizeCache.has(src)) return imageSizeCache.get(src)!;
  let r = (() => {
    const head = dataUrlBytes(src, 1 << 16);
    if (!head) return null;
    const first = headerSize(head);
    if (first !== 'more') return first;
    const all = dataUrlBytes(src);
    const full = all ? headerSize(all) : null;
    return full === 'more' ? null : full;
  })();
  if (r && (r.width <= 0 || r.height <= 0)) r = null;
  if (imageSizeCache.size > 64) imageSizeCache.clear();
  imageSizeCache.set(src, r);
  return r;
}

/** Size evolution draws the picture at: its own size, scaled down to fit 2048 x 2048 (enforceMaxDimensions) */
export function imageShownSize(src: string): { width: number; height: number } | null {
  const n = imageNaturalSize(src);
  if (!n || (n.width <= IMAGE_MAX_DIMENSION && n.height <= IMAGE_MAX_DIMENSION)) return n;
  const scale = Math.min(IMAGE_MAX_DIMENSION / n.width, IMAGE_MAX_DIMENSION / n.height);
  return { width: Math.max(1, Math.trunc(n.width * scale)), height: Math.max(1, Math.trunc(n.height * scale)) };
}

/** A new picture (evolution setValue(ATTR_IMAGE)): the frame takes its size unless the user has set the size */
export function imageWithSource(comp: CircuitComponentInstance, src: string): CircuitComponentInstance {
  const cfg = getImageConfig(comp);
  const shown = imageShownSize(src);
  return configureImage(comp, shown && !cfg.sized ? { src, width: shown.width, height: shown.height } : { src });
}

/** A new frame width or height (evolution setValue(ATTR_WIDTH / ATTR_HEIGHT)): 0 or less takes the picture's size
 * on both sides when there is a picture, else 1; afterwards a new picture keeps the frame */
export function imageWithSize(comp: CircuitComponentInstance, key: 'width' | 'height', value: number): CircuitComponentInstance {
  const shown = imageShownSize(getImageConfig(comp).src);
  const v = Math.round(value);
  if (v <= 0 && shown) return configureImage(comp, { width: shown.width, height: shown.height, sized: true });
  return configureImage(comp, { [key]: Math.max(1, v), sized: true });
}

/** Where evolution draws the picture inside the frame (paintGhost), relative to the frame's top-left corner;
 * 'cover' may reach outside the frame (it is clipped). null: no decodable picture */
export function imageDrawRect(cfg: ImageConfig): { x: number; y: number; width: number; height: number } | null {
  const img = imageShownSize(cfg.src);
  if (!img) return null;
  const { width: w, height: h } = cfg;
  if (cfg.scale === 'stretch') return { x: 0, y: 0, width: w, height: h };
  const scale = cfg.scale === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
  const tw = Math.max(1, Math.trunc(img.width * scale));
  const th = Math.max(1, Math.trunc(img.height * scale));
  return { x: Math.trunc((w - tw) / 2), y: Math.trunc((h - th) / 2), width: tw, height: th };
}

/** evolution ImageUtil.getOptimizedTargetDimensions: the picture size "Optimize" scales to */
export function imageOptimizedSize(img: { width: number; height: number }, frameW: number, frameH: number, scale: ImageScale): { width: number; height: number } {
  if (frameW <= 0 || frameH <= 0) return { width: 0, height: 0 };
  if (scale === 'stretch' || scale === 'cover') return { width: frameW, height: frameH };
  const s = Math.min(frameW / img.width, frameH / img.height);
  if (s >= 1) return { ...img };
  return { width: Math.max(1, Math.trunc(img.width * s)), height: Math.max(1, Math.trunc(img.height * s)) };
}

/** evolution ImageUtil.makeWhiteTransparent on RGBA pixels: the near-white (r, g, b > 235, not fully transparent)
 * area joined to the border, 4-connected, becomes fully transparent (its colour is kept); a new array */
export function whiteToTransparent(px: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px);
  const visited = new Uint8Array(w * h);
  const white = (i: number) => px[4 * i + 3] > 0 && px[4 * i] > 235 && px[4 * i + 1] > 235 && px[4 * i + 2] > 235;
  const queue: number[] = [];
  const seed = (x: number, y: number) => {
    const i = y * w + x;
    if (!visited[i] && white(i)) {
      visited[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    out[4 * i + 3] = 0;
    const x = i % w;
    const y = (i - x) / w;
    if (y + 1 < h) seed(x, y + 1);
    if (y > 0) seed(x, y - 1);
    if (x + 1 < w) seed(x + 1, y);
    if (x > 0) seed(x - 1, y);
  }
  return out;
}

// ---- 7400-series TTL chips (Logisim-evolution std/ttl, Aşama 4): the chip table lives in ttlChips.ts ----------

function ttlMeta(chip: TtlChip): ComponentMetadata {
  const size = ttlSize(chip);
  const pin = (p: { pin: number; key: string; name: string; dir: string }, type: 'input' | 'output') => {
    const at = ttlPinPoint(chip, p.pin);
    return { id: type === 'input' && p.dir === 'inout' ? ttlInKey(p.pin) : p.key, name: `${p.name} (${p.pin})`, type, relX: at.x, relY: at.y };
  };
  const ports = ttlPorts(chip, false);
  return {
    type: `ttl${chip.id}` as TtlType,
    name: `${chip.id} ${chip.title}`,
    category: 'ttl',
    width: size.width,
    height: size.height,
    inputs: ports.filter((p) => p.dir !== 'output').map((p) => pin(p, 'input')),
    outputs: ports.filter((p) => p.dir !== 'input').map((p) => pin(p, 'output')),
    description: `${chip.pins} bacaklı DIP, VCC ${chip.vcc} / GND ${chip.gnd}. ${chip.description}`,
  };
}

function ttlCatalog(): Record<TtlType, ComponentMetadata> {
  return Object.fromEntries(Object.values(TTL_CHIPS).map((c) => [`ttl${c.id}`, ttlMeta(c)])) as Record<TtlType, ComponentMetadata>;
}

export const COMPONENT_CATALOG: Record<ComponentType, ComponentMetadata> = {
  switch: {
    type: 'switch',
    name: 'Giriş Anahtarı',
    category: 'inputs',
    width: 70,
    height: 60,
    inputs: [],
    outputs: [{ id: 'out', name: 'Q', type: 'output', relX: 70, relY: 30 }],
    description: '0 veya 1 mantık seviyesi sağlayan açma/kapama anahtarı',
  },
  pushbutton: {
    type: 'pushbutton',
    name: 'Anlık Buton (Push Button)',
    category: 'inputs',
    width: 60,
    height: 52,
    inputs: [],
    outputs: [{ id: 'out', name: 'OUT', type: 'output', relX: 60, relY: 30 }],
    description: 'Basılı tutulduğunda 1, bırakıldığında otomatik 0 olan yaylı anlık bas-bırak buton',
  },
  clock: {
    type: 'clock',
    name: 'Saat Darbesi (Clock)',
    category: 'inputs',
    width: 60,
    height: 44,
    inputs: [],
    outputs: [{ id: 'out', name: 'CLK', type: 'output', relX: 60, relY: 30 }],
    description: 'Periyodik 0-1 kare dalga darbe üreteci',
  },
  vcc: {
    type: 'vcc',
    name: 'Sabit 1 (VCC)',
    category: 'inputs',
    width: 50,
    height: 38,
    inputs: [],
    outputs: [{ id: 'out', name: '1', type: 'output', relX: 50, relY: 20 }],
    description: 'Sürekli Lojik 1 seviyesi',
  },
  gnd: {
    type: 'gnd',
    name: 'Sabit 0 (GND)',
    category: 'inputs',
    width: 50,
    height: 38,
    inputs: [],
    outputs: [{ id: 'out', name: '0', type: 'output', relX: 50, relY: 20 }],
    description: 'Sürekli Lojik 0 seviyesi',
  },
  constant: {
    type: 'constant',
    name: 'Sabit (Constant)',
    category: 'inputs',
    width: 30,
    height: 20,
    inputs: [],
    outputs: [{ id: 'out', name: 'K', type: 'output', relX: 30, relY: 10 }],
    description: 'Seçilen bit genişliğinde sabit bir değer sürer (Logisim Constant)',
  },
  tunnel: {
    type: 'tunnel',
    name: 'Tünel (Kablosuz Hat)',
    category: 'inputs',
    width: 64,
    height: 32,
    inputs: [{ id: 'in', name: 'T', type: 'input', relX: 0, relY: 20 }],
    outputs: [{ id: 'out', name: 'T', type: 'output', relX: 64, relY: 20 }],
    description: 'Aynı ada sahip diğer tünellerle havadan elektriksel bağlantı kurar (Kablo kalabalığını önler)',
  },
  pullResistor: {
    type: 'pullResistor',
    name: 'Pull Direnci (Pull Resistor)',
    category: 'inputs',
    width: 30,
    height: 56,
    inputs: [{ id: 'in', name: 'P', type: 'input', relX: 15, relY: 0 }],
    outputs: [],
    description: 'Bağlı olduğu hat hiçbir parça tarafından sürülmüyorsa (Hi-Z / x) hattı 0 (pull-down) ya da 1 (pull-up) seviyesine çeker',
  },
  dipSwitch: ioMeta('dipSwitch', 'DIP Anahtar', 'Tek pakette 1-32 açma/kapama anahtarı (Logisim-evolution DipSwitch); her anahtarın kendi 1 bitlik çıkışı var, anahtara tıklayınca değişir'),
  joystick: io5Meta('joystick', 'Joystick', 'Fareyle sürüklenen kumanda kolu (Logisim Joystick): X ve Y çıkışları 2-5 bit; kol ortadayken yaklaşık yarı değer, bırakınca ortaya döner'),
  matrixKeypad: io5Meta('matrixKeypad', 'Matris Tuş Takımı', '4x4 tuş takımı (Logisim-evolution MatrixKeypad): basılı tuş, alttaki satır girişinin değerini sağdaki sütun çıkışına geçirir (ham mod; basılı tuş yokken sütun boşta). PmodKYPD modunda sütunlar 1, basılı tuşun satırı 0 ise 0'),
  portIo: io5Meta('portIo', 'Port G/Ç', '1-32 bacaklı G/Ç portu (Logisim-evolution PortIO): yalnız giriş (bacaklara tıklayarak boşta/0/1), yalnız çıkış (devrenin değerini gösterir) ya da tek / bacak başı etkinleştirmeli giriş-çıkış'),
  binToBcd: bfhMeta('binToBcd', 'İkili → BCD Dönüştürücü', 'İkili sayıyı (4-13 bit) ondalık basamaklarına ayırır (Logisim-evolution BinToBcd): her basamak 4 bitlik BCD çıkışı (1, 10, 100, 1000); giriş tanımsızsa birler basamağı 1111, diğerleri 0'),
  bcdToSevenSegment: bfhMeta('bcdToSevenSegment', 'BCD → 7-Segment Kod Çözücü', '4 bitlik BCD girişi (0-9) 7-segment göstergenin a-g segment sinyallerine (aktif-yüksek) çevirir (Logisim-evolution BcdToSevenSegmentDisplay); 10-15 ya da tanımsız girişte bütün segmentler x'),
  rgbVideo: videoMeta(),
  keyboard: io5cMeta('keyboard', 'Klavye', 'Yazılan karakterleri 1-256 karakterlik bir tamponda biriktirir (Logisim-evolution Keyboard): OUT tamponun ilk karakterinin 7 bitlik ASCII kodu, AV tampon boş değilken 1; RE açıkken saat kenarı ilk karakteri tampondan alır, CLR tamponu boşaltır. Parçayı seçip yazın (← → Home End Delete ile düzenlenir)'),
  tty: io5cMeta('tty', 'Metin Terminali', 'Satır x sütun metin ekranı (Logisim-evolution TTY): WE açıkken her saat kenarında IN girişindeki 7 bitlik ASCII karakteri yazar; satır sonu (10/13) yeni satıra geçer, geri silme (8) son karakteri siler, form besleme (12) ve CLR ekranı temizler, en altta satırlar yukarı kayar'),
  telnet: io5cMeta('telnet', 'Telnet', 'Devre ile bir Telnet istemcisi arasında bayt alıp verir (Logisim-evolution Telnet): istemciden gelen baytlar tamponda bekler, AV doluyken 1; RD = 1 iken OUT ilk baytı gösterir ve yükselen saat kenarı onu tampondan alır, WR = 1 iken saat kenarı IN baytını istemciye gönderir'),
  realTimeClock: io5Meta('realTimeClock', 'Gerçek Zamanlı Saat', 'Bilgisayarın saatini veren 32 bitlik çıkış (Logisim-evolution RealTimeClock): 1970 yılından beri geçen milisaniye ya da saniye (evolution 64 bit verir, burada alt 32 biti)'),
  asciiKeyboard: {
    type: 'asciiKeyboard',
    name: 'ASCII Klavye Giriş Matrisi',
    category: 'inputs',
    width: 140,
    height: 96,
    inputs: [
      { id: 'inClr', name: 'CLR', type: 'input', relX: 0, relY: 50 },
    ],
    outputs: [
      { id: 'outD0', name: 'D0', type: 'output', relX: 140, relY: 20 },
      { id: 'outD1', name: 'D1', type: 'output', relX: 140, relY: 30 },
      { id: 'outD2', name: 'D2', type: 'output', relX: 140, relY: 40 },
      { id: 'outD3', name: 'D3', type: 'output', relX: 140, relY: 50 },
      { id: 'outD4', name: 'D4', type: 'output', relX: 140, relY: 60 },
      { id: 'outD5', name: 'D5', type: 'output', relX: 140, relY: 70 },
      { id: 'outD6', name: 'D6', type: 'output', relX: 140, relY: 80 },
      { id: 'outStrobe', name: 'ST', type: 'output', relX: 70, relY: 96 },
    ],
    description: 'Klavyeden basılan tuşun 7-bit standart ASCII kodunu (D0-D6) ve veri hazır (ST) sinyalini üretir',
  },
  not: {
    type: 'not',
    name: 'NOT Kapısı (Değil)',
    category: 'gates',
    width: 70,
    height: 60,
    inputs: [{ id: 'in', name: 'A', type: 'input', relX: 0, relY: 30 }],
    outputs: [{ id: 'out', name: "A'", type: 'output', relX: 70, relY: 30 }],
    description: "Girişin tersini alır: 0 ise 1, 1 ise 0 (A')",
  },
  buffer: {
    type: 'buffer',
    name: 'Tampon (Buffer)',
    category: 'gates',
    width: 70,
    height: 60,
    inputs: [{ id: 'in', name: 'A', type: 'input', relX: 0, relY: 30 }],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 70, relY: 30 }],
    description: 'Girişi değiştirmeden çıkışa aktarır (Y = A); tanımsız giriş x olarak geçer',
  },
  and: {
    type: 'and',
    name: 'AND Kapısı (VE)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: 'Her iki giriş 1 olduğunda çıkışı 1 verir (A · B)',
  },
  or: {
    type: 'or',
    name: 'OR Kapısı (VEYA)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: 'En az bir giriş 1 olduğunda çıkışı 1 verir (A + B)',
  },
  nand: {
    type: 'nand',
    name: 'NAND Kapısı (VE DEĞİL)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: "AND kapısının değili: (A · B)'",
  },
  nor: {
    type: 'nor',
    name: 'NOR Kapısı (VEYA DEĞİL)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: "OR kapısının değili: (A + B)'",
  },
  xor: {
    type: 'xor',
    name: 'XOR Kapısı (Özel VEYA)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: 'Girişler birbirinden farklı olduğunda 1 verir (A ⊕ B)',
  },
  xnor: {
    type: 'xnor',
    name: 'XNOR Kapısı (Özel VEYA DEĞİL)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: 'Girişler birbirine eşit olduğunda 1 verir (Eşitlik kapısı)',
  },
  triState: {
    type: 'triState',
    name: '3 Durumlu Tampon (Tri-State)',
    category: 'gates',
    width: 70,
    height: 48,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 30 },
      { id: 'inEN', name: 'EN', type: 'input', relX: 40, relY: 50 },
    ],
    outputs: [{ id: 'outY', name: 'Y', type: 'output', relX: 70, relY: 30 }],
    description: 'EN=1 iken A girişini çıkışa aktarır; EN=0 iken yüksek empedans (Hi-Z) verir',
  },
  controlledInverter: {
    type: 'controlledInverter',
    name: 'Kontrollü Evirici',
    category: 'gates',
    width: 70,
    height: 48,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 30 },
      { id: 'inEN', name: 'EN', type: 'input', relX: 40, relY: 50 },
    ],
    outputs: [{ id: 'outY', name: "A'", type: 'output', relX: 70, relY: 30 }],
    description: "EN=1 iken A girişinin tersini çıkışa verir (A'); EN=0 iken yüksek empedans (Hi-Z) verir",
  },
  led: {
    type: 'led',
    name: 'Işıklı Gösterge (LED)',
    category: 'outputs',
    width: 48,
    height: 62,
    inputs: [{ id: 'in', name: 'D', type: 'input', relX: 0, relY: 30 }],
    outputs: [],
    description: 'Giriş 1 olduğunda parlayan dikey gerçekçi 5mm LED',
  },
  probe: {
    type: 'probe',
    name: 'Mantık Probu (0/1 Gösterge)',
    category: 'outputs',
    width: 50,
    height: 40,
    inputs: [{ id: 'in', name: 'IN', type: 'input', relX: 0, relY: 30 }],
    outputs: [],
    description: 'Sinyalin anlık 0 veya 1 değerini sayısal olarak gösterir',
  },
  buzzer: {
    type: 'buzzer',
    name: 'Sesli Uyarıcı & Müzik Buzzerı',
    category: 'outputs',
    width: 68,
    height: 72,
    inputs: [
      { id: 'in', name: 'EN', type: 'input', relX: 0, relY: 20 },
      { id: 'pitch0', name: 'N0', type: 'input', relX: 0, relY: 30 },
      { id: 'pitch1', name: 'N1', type: 'input', relX: 0, relY: 40 },
      { id: 'pitch2', name: 'N2', type: 'input', relX: 0, relY: 50 },
      { id: 'pitch3', name: 'N3', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [],
    description: 'EN girişi 1 iken ses çalar. N0-N3 (4-Bit) nota girişleriyle 16 farklı müzik notası/şarkı çalabilir',
  },
  hexDigit: ioMeta('hexDigit', 'Hex Gösterge', '4 bitlik D girişini 0-F onaltılık rakamı olarak gösterir (Logisim Hex Digit Display); tanımsız bitli girişte tire. DP girişi ondalık noktayı yakar, ayardan kaldırılabilir'),
  ledBar: ioMeta('ledBar', 'LED Çubuk', '1-32 segmentli LED çubuk (Logisim-evolution LedBar): her segmente ayrı 1 bitlik giriş ya da tüm segmentlere tek geniş giriş (bit 0 en sağdaki segment)'),
  dotMatrix: ioMeta('dotMatrix', 'Nokta Matris', 'Satır ve sütunları 1-32 olan LED nokta matris (Logisim DotMatrix). Sütun girişi: her sütuna bir giriş (bit 0 en alt nokta); satır girişi: her satıra bir giriş (bit 0 en sağ nokta); seçim: satır vektörü 1 olan satırlar sütun vektörünü gösterir (tarama)'),
  rgbLed: io5Meta('rgbLed', 'RGB LED', 'Kırmızı, yeşil ve mavi girişli LED (Logisim-evolution RgbLed): her renk girişi 1 iken yanar, karışımlar ara renkleri verir; ortak anotta (aktif düşük) 0 iken yanar'),
  textLabel: {
    type: 'textLabel',
    name: 'Metin / Açıklama Notu (Text Note)',
    category: 'outputs',
    width: 140,
    height: 44,
    inputs: [],
    outputs: [],
    description: 'Tuvale devre şeması için özel notlar ve başlıklar eklemek için kullanılır',
  },
  image: {
    type: 'image',
    name: 'Resim',
    category: 'outputs',
    width: IMAGE_DEFAULT_SIZE,
    height: IMAGE_DEFAULT_SIZE,
    inputs: [],
    outputs: [],
    description:
      'Devreye süs ya da açıklama için resim koyar (Logisim-evolution Image): PNG, JPEG, GIF ya da BMP dosyası devrenin içine gömülür. Bacağı ve mantığı yok; çerçeve boyutu, sığdır / uzat / kapla, lisans ve atıf ayarlanır. Ctrl+V panodaki resmi yeni bir Resim olarak yapıştırır',
  },
  sevenSegment: {
    type: 'sevenSegment',
    name: '7-Segment LED Ekran',
    category: 'outputs',
    // 80 x 100 (drawing 72 x 96): rotated about its centre the pins stay on the 10px grid and on the body edge
    width: 80,
    height: 100,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 10 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 20 },
      { id: 'inC', name: 'C', type: 'input', relX: 0, relY: 30 },
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 40 },
      { id: 'inE', name: 'E', type: 'input', relX: 0, relY: 50 },
      { id: 'inF', name: 'F', type: 'input', relX: 0, relY: 60 },
      { id: 'inG', name: 'G', type: 'input', relX: 0, relY: 70 },
      { id: 'inDP', name: 'DP', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [],
    description: 'A-G ve DP girişleriyle kontrol edilen klasik 7-segment LED göstergesi',
  },
  srLatch: {
    type: 'srLatch',
    name: 'SR Mandalı (SR Latch)',
    category: 'sequential',
    width: 84,
    height: 74,
    inputs: [
      { id: 'inS', name: 'S', type: 'input', relX: 0, relY: 20 },
      { id: 'inR', name: 'R', type: 'input', relX: 0, relY: 50 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 84, relY: 20 },
      { id: 'outQBar', name: "Q'", type: 'output', relX: 84, relY: 50 },
    ],
    description: 'Temel asenkron bellek hücresi: S (Set) kurar, R (Reset) sıfırlar',
  },
  halfAdder: {
    type: 'halfAdder',
    name: '1-Bit Yarım Toplayıcı (HA)',
    category: 'arithmetic',
    width: 90,
    height: 64,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [
      { id: 'outS', name: 'S', type: 'output', relX: 90, relY: 20 },
      { id: 'outC', name: 'C', type: 'output', relX: 90, relY: 40 },
    ],
    description: 'İki biti toplar: Toplam S (XOR) ve Elde C (AND)',
  },
  fullAdder: {
    type: 'fullAdder',
    name: '1-Bit Tam Toplayıcı (FA)',
    category: 'arithmetic',
    width: 96,
    height: 76,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
      { id: 'inCin', name: 'Cin', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'outS', name: 'S', type: 'output', relX: 96, relY: 20 },
      { id: 'outCout', name: 'Cout', type: 'output', relX: 96, relY: 50 },
    ],
    description: 'Elde girişi (Cin) ile 3 biti toplayarak S ve Cout üretir',
  },
  halfSubtractor: {
    type: 'halfSubtractor',
    name: '1-Bit Yarım Çıkarıcı (HS)',
    category: 'arithmetic',
    width: 90,
    height: 64,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [
      { id: 'outD', name: 'D', type: 'output', relX: 90, relY: 20 },
      { id: 'outB', name: 'B', type: 'output', relX: 90, relY: 40 },
    ],
    description: 'İki biti çıkarır: Fark D (A ⊕ B) ve Borç B (A\' · B)',
  },
  fullSubtractor: {
    type: 'fullSubtractor',
    name: '1-Bit Tam Çıkarıcı (FS)',
    category: 'arithmetic',
    width: 96,
    height: 76,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
      { id: 'inBin', name: 'Bin', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'outD', name: 'D', type: 'output', relX: 96, relY: 20 },
      { id: 'outBout', name: 'Bout', type: 'output', relX: 96, relY: 50 },
    ],
    description: 'Borç girişi (Bin) ile 3 biti çıkararak Fark D ve Borç Çıkışı Bout üretir',
  },
  bcdTo7Seg: {
    type: 'bcdTo7Seg',
    name: 'Hex → 7-Segment Kod Çözücü (aktif-yüksek)',
    category: 'combinational',
    width: 96,
    height: 104,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
      { id: 'inC', name: 'C', type: 'input', relX: 0, relY: 60 },
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [
      { id: 'outA', name: 'a', type: 'output', relX: 96, relY: 20 },
      { id: 'outB', name: 'b', type: 'output', relX: 96, relY: 30 },
      { id: 'outC', name: 'c', type: 'output', relX: 96, relY: 40 },
      { id: 'outD', name: 'd', type: 'output', relX: 96, relY: 50 },
      { id: 'outE', name: 'e', type: 'output', relX: 96, relY: 60 },
      { id: 'outF', name: 'f', type: 'output', relX: 96, relY: 70 },
      { id: 'outG', name: 'g', type: 'output', relX: 96, relY: 80 },
    ],
    description: '4-bit sayıyı (A-D, 0-F) ortak katotlu 7-segment göstergenin segment sinyallerine (a-g, aktif-yüksek) dönüştürür; 10-15 için A-F harflerini gösterir (yalnız 0-9 çözen Logisim-evolution parçası: BCD → 7-Segment). Gerçek 74LS47 aktif-düşüktür (ortak anot) ve yalnızca 0-9 içindir',
  },
  splitter4: {
    type: 'splitter4',
    name: "4'lü Paralel Geçiş (D0-D3 → Y0-Y3)",
    category: 'combinational',
    width: 84,
    height: 72,
    inputs: [
      { id: 'in0', name: 'D0', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'D1', type: 'input', relX: 0, relY: 30 },
      { id: 'in2', name: 'D2', type: 'input', relX: 0, relY: 50 },
      { id: 'in3', name: 'D3', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'out0', name: 'Y0', type: 'output', relX: 84, relY: 20 },
      { id: 'out1', name: 'Y1', type: 'output', relX: 84, relY: 30 },
      { id: 'out2', name: 'Y2', type: 'output', relX: 84, relY: 50 },
      { id: 'out3', name: 'Y3', type: 'output', relX: 84, relY: 60 },
    ],
    description: '4-Bit paralel veri yolu hatlarını ayırır ve dağıtır (D0-D3 -> Y0-Y3)',
  },
  splitter: {
    type: 'splitter',
    name: 'Splitter (Ayırıcı)',
    category: 'combinational',
    width: 20,
    height: 20,
    // Pins are rebuilt by configureSplitter: in0 = combined end, out<i> = end i+1
    inputs: [{ id: 'in0', name: 'Σ', type: 'input', relX: 0, relY: 20, width: 2 }],
    outputs: [
      { id: 'out0', name: '1', type: 'output', relX: 20, relY: 0 },
      { id: 'out1', name: '2', type: 'output', relX: 20, relY: 10 },
    ],
    description: 'Çok bitli bir veri yolunu uçlara ayırır ya da uçları birleştirir (iki yönlü, Logisim Splitter)',
  },
  bitExtender: {
    type: 'bitExtender',
    name: 'Bit Genişletici (Bit Extender)',
    category: 'combinational',
    width: 40,
    height: 40,
    // Logisim Bit Extender (facing east): input on the left, output on the right, the extension
    // input (type 'input' only; configureBitExtender drops it otherwise) on top
    inputs: [
      { id: 'in0', name: 'in', type: 'input', relX: 0, relY: 20, width: 8 },
      { id: 'in1', name: 'ext', type: 'input', relX: 20, relY: 0 },
    ],
    outputs: [{ id: 'out0', name: 'out', type: 'output', relX: 40, relY: 20, width: 16 }],
    description: 'Veri yolunu genişletir ya da daraltır; üst bitler 0, 1, işaret biti ya da ek girişle doldurulur (Logisim Bit Extender)',
  },
  bitSelector: {
    type: 'bitSelector',
    name: 'Bit Seçici (Bit Selector)',
    category: 'combinational',
    width: 40,
    height: 40,
    // Logisim BitSelector (facing east): data on the left, the selected group on the right, select below
    inputs: [
      { id: 'in0', name: 'D', type: 'input', relX: 0, relY: 20, width: 8 },
      { id: 'in1', name: 'S', type: 'input', relX: 30, relY: 40, width: 3 },
    ],
    outputs: [{ id: 'out0', name: 'Q', type: 'output', relX: 40, relY: 20 }],
    description: 'Veri yolundan seçme girişinin gösterdiği bit grubunu çıkışa verir (Logisim Bit Selector)',
  },
  // Parametric plexers (Logisim std/plexers). configurePlexer rebuilds the pins; the ids below are the keys
  // plexerLayout places, so a pin keeps its id (and its wires) when the select or data width changes
  multiplexer: {
    type: 'multiplexer',
    name: 'Çoklayıcı (MUX)',
    category: 'combinational',
    width: 60,
    height: 60,
    inputs: [
      { id: 'in0', name: '0', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: '1', type: 'input', relX: 0, relY: 40 },
      { id: 'sel', name: 'S', type: 'input', relX: 30, relY: 60 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 60, relY: 30 }],
    description: 'Seçme girişinin değerindeki veri girişini çıkışa aktarır; seçme 1-5 bit, veri 1-32 bit, isteğe bağlı enable (Logisim Multiplexer)',
  },
  demultiplexer: {
    type: 'demultiplexer',
    name: 'Çoklayıcı Çözücü (DEMUX)',
    category: 'combinational',
    width: 60,
    height: 60,
    inputs: [
      { id: 'in', name: 'D', type: 'input', relX: 0, relY: 30 },
      { id: 'sel', name: 'S', type: 'input', relX: 30, relY: 60 },
    ],
    outputs: [
      { id: 'out0', name: '0', type: 'output', relX: 60, relY: 20 },
      { id: 'out1', name: '1', type: 'output', relX: 60, relY: 40 },
    ],
    description: 'Veri girişini seçme girişinin gösterdiği çıkışa yönlendirir, öbür çıkışlar 0 (ya da yüzer); seçme 1-5 bit, veri 1-32 bit (Logisim Demultiplexer)',
  },
  decoder: {
    type: 'decoder',
    name: 'Kod Çözücü (Decoder)',
    category: 'combinational',
    width: 40,
    height: 60,
    inputs: [
      { id: 'sel', name: 'S', type: 'input', relX: 20, relY: 60 },
      { id: 'en', name: 'EN', type: 'input', relX: 10, relY: 60 },
    ],
    outputs: [
      { id: 'out0', name: '0', type: 'output', relX: 40, relY: 20 },
      { id: 'out1', name: '1', type: 'output', relX: 40, relY: 40 },
    ],
    description: 'Seçme girişinin değerindeki çıkışı 1 yapar, öbürleri 0 (ya da yüzer); seçme 1-5 bit, isteğe bağlı enable (Logisim Decoder)',
  },
  priorityEncoder: {
    type: 'priorityEncoder',
    name: 'Öncelikli Kodlayıcı (Priority Encoder)',
    category: 'combinational',
    width: 60,
    height: 180,
    inputs: [{ id: 'in0', name: '0', type: 'input', relX: 0, relY: 20 }],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 60, relY: 90 }],
    description: '1 olan en yüksek numaralı girişin numarasını verir; GS bir giriş aktifken 1, EO hiçbiri aktif değilken 1 (Logisim Priority Encoder, 2-32 giriş)',
  },
  // Parametric arithmetic (Logisim std/arith). configureArith rebuilds the pins and arithLayout places them
  // by key with Logisim's geometry (a 40x40 body, the main output in the middle of the right side)
  adder: arithMeta('adder', 'Toplayıcı (Adder)', [['a', 'A'], ['b', 'B'], ['cin', 'Cin']], [['out', 'S'], ['cout', 'Cout']],
    'A + B + elde girişi; elde çıkışı toplamın taşan biti. Veri 1-32 bit, açık ya da x elde girişi 0 sayılır (Logisim Adder)'),
  subtractor: arithMeta('subtractor', 'Çıkarıcı (Subtractor)', [['a', 'A'], ['b', 'B'], ['bin', 'Bin']], [['out', 'D'], ['bout', 'Bout']],
    'A - B - borç girişi; borç çıkışı sonuç eksiye düştüğünde 1. Veri 1-32 bit (Logisim Subtractor)'),
  multiplier: arithMeta('multiplier', 'Çarpıcı (Multiplier)', [['a', 'A'], ['b', 'B'], ['cin', 'Cin']], [['out', 'P'], ['cout', 'Cout']],
    'A × B + elde girişi (veri genişliğinde); alt yarı P, üst yarı Cout. İşaretsiz, işaretli ya da işaretli×işaretsiz (Logisim Multiplier)'),
  divider: arithMeta('divider', 'Bölücü (Divider)', [['a', 'A'], ['b', 'B'], ['upper', 'Üst']], [['out', 'Q'], ['rem', 'R']],
    '(Üst:A) / B; bölüm Q, kalan R. Sıfıra bölmede bölen 1 sayılır. İşaretsiz ya da işaretli (Logisim Divider)'),
  negator: arithMeta('negator', 'Negatif Alıcı (Negator)', [['in', 'X']], [['out', '-X']],
    'Girişin ikiye tümleyenini (−X) verir; veri 1-32 bit (Logisim Negator)'),
  absolute: arithMeta('absolute', 'Mutlak Değer (Absolute)', [['in', 'X']], [['out', '|X|'], ['ovf', 'OV']],
    'İşaretli girişin mutlak değeri; en küçük negatif sayıda taşma (OV) 1 olur (Logisim-evolution Absolute)'),
  comparator: arithMeta('comparator', 'Karşılaştırıcı (Comparator)', [['a', 'A'], ['b', 'B']], [['gt', '>'], ['eq', '='], ['lt', '<']],
    'A ile B’yi karşılaştırır: A>B, A=B, A<B. İşaretli (varsayılan) ya da işaretsiz, veri 1-32 bit (Logisim Comparator)'),
  minMax: arithMeta('minMax', 'En Küçük / En Büyük (Min/Max)', [['a', 'A'], ['b', 'B']], [['min', 'Min'], ['max', 'Max']],
    'A ve B’den küçüğünü ve büyüğünü verir; işaretsiz ya da işaretli (Logisim-evolution Min/Max)'),
  shifter: arithMeta('shifter', 'Kaydırıcı (Shifter)', [['a', 'X'], ['dist', 'D']], [['out', 'Y']],
    'Veriyi D bit kaydırır ya da döndürür: mantıksal sola/sağa, aritmetik sağa, sola/sağa döndürme (Logisim Shifter)'),
  squareRoot: arithMeta('squareRoot', 'Karekök (Square Root)', [['in', 'X'], ['upper', 'Üst']], [['out', '√'], ['rem', 'R']],
    '(Üst:X) sayısının tam karekökü ve kalanı (Logisim-evolution Square Root)'),
  exponentiator: arithMeta('exponentiator', 'Üs Alıcı (Exponentiator)', [['a', 'A'], ['b', 'B']], [['out', 'Alt'], ['upper', 'Üst']],
    'A üzeri B; sonucun alt yarısı ve üst yarısı. İşaretsiz ya da işaretli (Logisim-evolution Exponentiator)'),
  bitAdder: arithMeta('bitAdder', 'Bit Sayıcı (Bit Adder)', [['in0', '']], [['out', '#']],
    'Girişlerdeki 1 bitlerini sayar; 1-32 giriş, her biri 1-32 bit (Logisim Bit Adder)'),
  bitFinder: arithMeta('bitFinder', 'Bit Bulucu (Bit Finder)', [['in', 'X']], [['out', 'i'], ['present', '?']],
    'En düşük ya da en yüksek 1 (veya 0) bitinin numarasını verir; bulunduysa ? çıkışı 1 (Logisim Bit Finder)'),
  alu: arithMeta('alu', 'Aritmetik Mantık Birimi (ALU)', [['a', 'A'], ['b', 'B'], ['op', 'OP'], ['cin', 'Cin']],
    [['out', 'Y'], ['z', 'Z'], ['n', 'N'], ['c', 'C'], ['v', 'V']],
    '3 bitlik OP ile 8 işlem: 000 ADD (A+B+Cin), 001 SUB (A−B−Cin), 010 AND, 011 OR, 100 XOR, 101 NOR, 110 SLT (işaretli A<B), 111 PASS-B. Bayraklar: Z sıfır, N işaret, C elde/borç, V işaretli taşma (C ve V yalnız ADD/SUB). Veri 1-32 bit'),
  flipFlopD: memMeta('flipFlopD', 'D Flip-Flop', 'Saat tetiklendiğinde D girişini saklar. Tetikleme: yükselen / düşen kenar ya da yüksek / düşük seviye (seviyede D mandalı gibi saydamdır). CLR (0) ve PRE (1) asenkron, yalnız 1 iken etkili; EN yalnız 0 iken engeller'),
  flipFlopT: memMeta('flipFlopT', 'T Flip-Flop', 'Saat kenarında T = 1 ise durumunu tersler, aksi halde korur. Yükselen veya düşen kenar; CLR / PRE asenkron, EN yalnız 0 iken engeller'),
  flipFlopJK: memMeta('flipFlopJK', 'J-K Flip-Flop', 'Saat kenarında J=1 K=0 kurar, J=0 K=1 sıfırlar, J=K=1 tersler, J=K=0 korur. Yükselen veya düşen kenar; CLR / PRE asenkron, EN yalnız 0 iken engeller'),
  flipFlopSR: memMeta('flipFlopSR', 'S-R Flip-Flop', 'Saat tetiklendiğinde S=1 R=0 kurar, S=0 R=1 sıfırlar; S=R=1 ya da tanımsız giriş durumu değiştirmez. Kenar veya seviye tetikleme; CLR / PRE asenkron, EN yalnız 0 iken engeller'),
  register: memMeta('register', 'Yazmaç (Register)', 'Saat tetiklendiğinde ve EN 0 değilken D verisini saklar (x / E bitleri de saklanır). CLR asenkron sıfırlar. Genişlik 1-32 bit, kenar veya seviye tetikleme'),
  counter: memMeta('counter', 'Sayaç (Counter)', 'Saat kenarında LD = 1 ise D yüklenir, değilse CT 0 değilken UD yönünde (açık / 1 yukarı, 0 aşağı) sayar. Üst sınır ve sınırda davranış (başa dön / dur / devam / yükle) ayarlanır; C çıkışı değer hedefteyken 1 (yukarı: üst sınır, aşağı: 0). CLR asenkron sıfırlar. 1-32 bit'),
  ram: ramMeta('ram', 'RAM', 'Rastgele erişimli bellek: adres 2-24 bit, veri 1-32 bit. Logisim 2.7.1 kuralları (sel seçme bacağı; ortak, asenkron ya da ayrı veri yolu; yükselen kenarda yazma) ya da Logisim-evolution kuralları (WE bacağı; tetikleme seçimi; saatli ya da asenkron okuma; bayt etkinleştirme; CLR bacağı)'),
  rom: ramMeta('rom', 'ROM', 'Salt okunur bellek: adres 2-24 bit, veri 1-32 bit; adresteki kelimeyi D çıkışına verir. Logisim 2.7.1 kurallarında sel = 0 iken çıkış yüzer'),
  dualRam: ramMeta('dualRam', 'Çift Portlu RAM', "İki bağımsız portlu bellek (Logisim-evolution 5): her portun kendi adresi, veri girişi/çıkışı, OE, WE ve saati var; iki port aynı içeriği paylaşır, aynı anda okunup yazılabilir. Adres 2-24 bit, veri 1-32 bit; tetikleme, saatli ya da asenkron okuma, bayt etkinleştirme ve ortak CLR bacağı Logisim-evolution RAM'i gibi. Aynı adrese aynı anda iki yazmada port 1 kazanır"),
  random: ramMeta('random', 'Rastgele Sayı Üreteci', 'Saat kenarında NXT 0 değilken bir sonraki sayıya geçer (Logisim 2.7.1 dizisi, tohum ayarlı; tohum 0 = zamandan). RST = 1 başa döndürür. Genişlik 1-32 bit'),
  shiftRegister: memMeta('shiftRegister','Kaydırmalı Yazmaç (Shift Register)', 'Saat kenarında SH 0 değilken IN verisi ilk aşamaya girer, her aşama bir sonrakine kayar, OUT son aşamadır. Paralel yükleme açıkken LD = 1 tüm aşamaları üstteki girişlerden yükler, aşamalar alttan çıkar. CLR asenkron sıfırlar. Genişlik 1-32 bit, 1-32 aşama'),
  subcircuit: {
    type: 'subcircuit',
    name: 'Özel Alt Devre (IC)',
    category: 'custom',
    width: 120,
    height: 80,
    inputs: [],
    outputs: [],
    description: 'Kullanıcı tarafından paketlenmiş modüler alt devre / entegre modülü.',
  },
  ...ttlCatalog(),
};

let componentCounter = 1;

const COMPONENT_TYPE_ALIASES: Record<string, ComponentType> = {
  busSplitter: 'splitter4',
  constantHigh: 'vcc',
  constantLow: 'gnd',
  sevenSeg: 'sevenSegment',
};

export function createComponentInstance(
  rawType: ComponentType,
  x: number,
  y: number,
  customLabel?: string,
  customId?: string
): CircuitComponentInstance {
  const type: ComponentType = COMPONENT_CATALOG[rawType]
    ? rawType
    : COMPONENT_TYPE_ALIASES[rawType as string] || 'and';
  const meta = COMPONENT_CATALOG[type];
  const compId = customId || `comp_${type}_${Date.now()}_${componentCounter++}`;

  const inputs: CircuitPin[] = meta.inputs.map((pin) => ({
    id: `${compId}_${pin.id}`,
    name: pin.name,
    type: 'input',
    value: 0,
    ...(pin.width && pin.width > 1 ? { width: pin.width } : {}),
    x: x + pin.relX,
    y: y + pin.relY,
  }));

  const outputs: CircuitPin[] = meta.outputs.map((pin) => ({
    id: `${compId}_${pin.id}`,
    name: pin.name,
    type: 'output',
    // Q' starts at 1 like the flip-flop state (q = 0, qBar = 1); a 0 there rose to 1 on the first step and
    // clocked whatever it drives
    value: POWER_UP_X_TYPES.has(type) ? 'X' : type === 'vcc' || pin.id === 'outQBar' || pin.id === 'qn' ? 1 : 0,
    ...(pin.width && pin.width > 1 ? { width: pin.width } : {}),
    x: x + pin.relX,
    y: y + pin.relY,
  }));

  const inst: CircuitComponentInstance = {
    id: compId,
    type,
    // evolution's Image has no label
    label: customLabel || (type === 'image' ? '' : meta.name),
    x,
    y,
    inputs,
    outputs,
    state: {
      on: type === 'vcc' ? true : false,
      frequencyHz: 1,
      q: 0,
      qBar: 1,
      // No previous clock yet: the first evaluation never counts as an edge (like Logisim, whose signals
      // power up unknown), so a flip-flop clocked by a high signal does not toggle when the circuit starts
      lastClk: undefined,
      asciiChar: type === 'asciiKeyboard' ? 'A' : undefined,
      asciiCode: type === 'asciiKeyboard' ? 65 : undefined,
      strobe: type === 'asciiKeyboard' ? false : undefined,
      constValue: type === 'constant' ? 1 : undefined,
    },
  };
  // A new bit extender is type zero (Logisim default), which has no extension input
  if (type === 'bitExtender') return configureBitExtender(inst, {});
  // New plexers take Logisim-evolution's defaults: 1 select bit (priority encoder 3), MUX/DEMUX without enable
  if (PLEXER_TYPES.has(type)) {
    return configurePlexer(inst, { select: type === 'priorityEncoder' ? 3 : 1, width: 1, enable: type === 'decoder' });
  }
  if (ARITH_TYPES.has(type)) return configureArith(inst, {});
  if (MEM_TYPES.has(type)) return configureMem(inst, {});
  if (RAM_TYPES.has(type)) return configureRam(inst, {});
  if (IO_TYPES.has(type)) return configureIo(inst, {});
  if (IO5_TYPES.has(type)) return configureIo5(inst, {});
  if (BFH_TYPES.has(type)) return configureBfh(inst, {});
  if (IO5C_TYPES.has(type)) return configureIo5c(inst, {});
  if (type === 'rgbVideo') return configureVideo(inst, {});
  if (isTtlType(type)) return configureTtl(inst, {});
  return inst;
}

// Logic gates whose inputs Logisim can negate one by one (AbstractGate), and that ignore open inputs
export const MULTI_INPUT_GATE_TYPES: ComponentType[] = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'];

// Parts whose single pin can be wider than 1 bit (Logisim Pin and Constant); the pin's width is the part's width
const WIDE_PIN_TYPES = new Set<ComponentType>(['switch', 'led', 'constant']);

export function getBitWidth(comp: CircuitComponentInstance): number {
  if (!WIDE_PIN_TYPES.has(comp.type)) return 1;
  return (comp.type === 'led' ? comp.inputs[0]?.width : comp.outputs[0]?.width) ?? 1;
}

// Body size of a part: a pin wider than 1 bit is drawn like Logisim's, one 10px cell per bit, 8 bits a row;
// a constant is as wide as its hex digits
export function getComponentSize(comp: CircuitComponentInstance): { width: number; height: number } {
  if (comp.type === 'subcircuit') {
    const maxPins = Math.max(comp.inputs.length, comp.outputs.length);
    return { width: 120, height: Math.max(60, (maxPins + 1) * 20) };
  }
  const meta = COMPONENT_CATALOG[comp.type];
  const w = getBitWidth(comp);
  if (MULTI_INPUT_GATE_TYPES.includes(comp.type)) return { width: meta.width, height: multiInputGateHeight(comp.inputs.length) };
  if (comp.type === 'splitter') return { width: 20, height: Math.max(20, Math.ceil(comp.outputs.length / 2) * 20) };
  if (PLEXER_TYPES.has(comp.type)) {
    const l = plexerLayout(comp);
    return { width: l.width, height: l.height };
  }
  if (ARITH_TYPES.has(comp.type)) {
    const g = arithLayout(comp);
    return { width: g.width, height: g.height };
  }
  if (MEM_TYPES.has(comp.type)) {
    const g = memLayout(comp);
    return { width: g.width, height: g.height };
  }
  if (RAM_TYPES.has(comp.type)) {
    const g = ramGeometry(comp.type, getRamConfig(comp));
    return { width: g.width, height: g.height };
  }
  if (IO_TYPES.has(comp.type)) {
    const g = ioGeometry(comp.type, getIoConfig(comp));
    return { width: g.width, height: g.height };
  }
  if (IO5_TYPES.has(comp.type)) {
    const g = io5Geometry(comp.type, getIo5Config(comp));
    return { width: g.width, height: g.height };
  }
  if (BFH_TYPES.has(comp.type)) {
    const g = bfhGeometry(comp.type, binToBcdBits(comp));
    return { width: g.width, height: g.height };
  }
  if (IO5C_TYPES.has(comp.type)) {
    const g = io5cGeometry(comp.type, getIo5cConfig(comp));
    return { width: g.width, height: g.height };
  }
  if (comp.type === 'rgbVideo') {
    const g = videoGeometry(getVideoConfig(comp));
    return { width: g.width, height: g.height };
  }
  if (comp.type === 'image') {
    const cfg = getImageConfig(comp);
    return { width: cfg.width, height: cfg.height };
  }
  const ttl = ttlChipOf(comp.type);
  if (ttl) return ttlSize(ttl);
  if (comp.type === 'constant') return { width: Math.max(30, Math.ceil((Math.ceil(w / 4) * 8 + 14) / 10) * 10), height: 20 };
  if (w > 1) return { width: Math.min(w, 8) * 10 + 20, height: Math.ceil(w / 8) * 20 + 20 };
  return { width: meta?.width ?? 60, height: meta?.height ?? 50 };
}

// Give a switch/LED/constant a new bit width: the pin gets the width (and moves with the body), the
// stored value keeps only the bits that still exist
export function setBitWidth(comp: CircuitComponentInstance, width: number): CircuitComponentInstance {
  const w = Math.max(1, Math.min(MAX_BIT_WIDTH, Math.round(width)));
  const mask = (n: number | undefined) => (n === undefined ? undefined : n % 2 ** w);
  const pinW = (p: CircuitPin): CircuitPin => {
    const { bits: _bits, width: _width, ...rest } = p;
    return w > 1 ? { ...rest, width: w } : rest;
  };
  const next: CircuitComponentInstance = {
    ...comp,
    inputs: comp.type === 'led' ? comp.inputs.map(pinW) : comp.inputs,
    outputs: comp.type === 'led' ? comp.outputs : comp.outputs.map(pinW),
    state: {
      ...comp.state,
      inputValue: comp.type === 'switch' && w > 1 ? (mask(comp.state.inputValue) ?? (comp.state.on ? 1 : 0)) : undefined,
      constValue: mask(comp.state.constValue),
    },
  };
  if (comp.type === 'switch' && w === 1) next.state.on = (comp.state.inputValue ?? (comp.state.on ? 1 : 0)) % 2 === 1;
  if (comp.type === 'switch' && comp.state.pinTristate) {
    delete next.state.portValue;
    delete next.state.portBits;
    Object.assign(next.state, floatingSwitchState(w));
  }
  return updatePinPositions(next);
}

// ---- Three-state input pin (Logisim Pin 'tristate', evolution behavior="tristate") ----------------
// It starts floating and a click cycles a bit 0 → 1 → Z → 0, like Logisim's poke. Floating bits live in
// portValue (1 bit) / portBits (wide), the fields an outside driver of an IC port uses as well.

/** The bits a switch drives now, LSB first */
export function switchBits(c: CircuitComponentInstance): SignalValue[] {
  const w = c.outputs[0]?.width ?? 1;
  if (w > 1) return c.state.portBits && c.state.portBits.length === w ? [...c.state.portBits] : numberToBits(c.state.inputValue ?? 0, w);
  return [c.state.portValue ?? (c.state.on ? 1 : 0)];
}

/** State fields that make a switch drive these bits (LSB first) */
export function switchStateFor(bits: SignalValue[]): Partial<CircuitComponentInstance['state']> {
  const known = bits.every((b) => b === 0 || b === 1);
  if (bits.length > 1) return known ? { inputValue: bitsToNumber(bits), portBits: undefined } : { portBits: [...bits] };
  return known ? { on: bits[0] === 1, portValue: undefined } : { portValue: bits[0] };
}

/** A switch of this width with every bit floating (three-state start and reset) */
export function floatingSwitchState(width: number): Partial<CircuitComponentInstance['state']> {
  return width > 1 ? { portBits: Array<SignalValue>(width).fill('Z') } : { portValue: 'Z' };
}

/** One click on a switch bit: 0 → 1, 1 → Z (three-state) or 0, anything else → 0 */
export function nextSwitchBit(b: SignalValue, tristate: boolean): SignalValue {
  return b === 0 ? 1 : b === 1 ? (tristate ? 'Z' : 0) : 0;
}

// ---- Splitter (Logisim circuit/Splitter*) ----------------------------------------------------------

export type SplitterAppear = 'left' | 'right' | 'center';
export const SPLITTER_MAX_FANOUT = 32;

/**
 * Logisim SplitterAttributes.computeDistribution: end (1..fanout) of each bit, LSB first. Ascending
 * gives the low bits to end 1; with fewer ends than bits the first `bits % fanout` ends take one extra.
 */
export function splitterDistribution(fanout: number, bits: number, ascending = true): number[] {
  const ret = new Array<number>(bits).fill(0);
  if (fanout >= bits) {
    for (let i = 0; i < bits; i++) ret[i] = ascending ? i + 1 : fanout - i;
    return ret;
  }
  const perEnd = Math.floor(bits / fanout);
  let extra = bits % fanout;
  let curEnd = -1;
  let left = 0;
  for (let k = 0; k < bits; k++) {
    const i = ascending ? k : bits - 1 - k;
    if (left === 0) {
      curEnd++;
      left = perEnd;
      if (extra > 0) {
        left++;
        extra--;
      }
    }
    ret[i] = curEnd + 1;
    left--;
  }
  return ret;
}

export function getSplitterConfig(comp: CircuitComponentInstance): { fanout: number; bitEnd: number[]; appear: SplitterAppear } {
  const fanout = Math.max(1, comp.outputs.length);
  return {
    fanout,
    bitEnd: comp.state.splitBitEnd ?? splitterDistribution(fanout, 2),
    appear: comp.state.splitAppear ?? 'left',
  };
}

// Index of each bit inside its end (Logisim Splitter.bit_thread), and the width of every end
export function splitterThreads(bitEnd: number[], fanout: number): { thread: number[]; endWidth: number[] } {
  const endWidth = new Array<number>(fanout).fill(0);
  const thread = bitEnd.map((e) => (e > 0 && e <= fanout ? endWidth[e - 1]++ : -1));
  return { thread, endWidth };
}

// Logisim splitter end labels: runs of consecutive bits per end, e.g. "0-3", "0,2"
export function splitterEndLabels(bitEnd: number[], fanout: number): string[] {
  const labels: string[] = new Array<string>(fanout).fill('');
  let cur = -1;
  let start = 0;
  for (let i = 0; i <= bitEnd.length; i++) {
    const e = i === bitEnd.length ? -1 : bitEnd[i];
    if (e !== cur) {
      if (cur > 0 && cur <= fanout) {
        const run = start === i - 1 ? `${start}` : `${start}-${i - 1}`;
        labels[cur - 1] = labels[cur - 1] ? `${labels[cur - 1]},${run}` : run;
      }
      cur = e;
      start = i;
    }
  }
  return labels;
}

/**
 * New splitter settings. Like Logisim, changing the incoming width or the fan out resets the bit
 * distribution to the default spread; pins keep their ids so attached wires can follow them.
 */
export function configureSplitter(
  comp: CircuitComponentInstance,
  patch: { incoming?: number; fanout?: number; appear?: SplitterAppear; bitEnd?: number[] }
): CircuitComponentInstance {
  const cur = getSplitterConfig(comp);
  const incoming = Math.max(1, Math.min(MAX_BIT_WIDTH, Math.round(patch.incoming ?? cur.bitEnd.length)));
  const fanout = Math.max(1, Math.min(SPLITTER_MAX_FANOUT, Math.round(patch.fanout ?? cur.fanout)));
  let bitEnd = cur.bitEnd;
  if (incoming !== cur.bitEnd.length || fanout !== cur.fanout) bitEnd = splitterDistribution(fanout, incoming);
  if (patch.bitEnd && patch.bitEnd.length === incoming) bitEnd = patch.bitEnd.map((e) => (e >= 0 && e <= fanout ? e : 0));
  const { endWidth } = splitterThreads(bitEnd, fanout);
  const strip = (p: CircuitPin): CircuitPin => {
    const { bits: _bits, width: _width, ...rest } = p;
    return rest;
  };
  const combined = strip(comp.inputs[0] ?? { id: `${comp.id}_in0`, name: 'Σ', type: 'input', value: 0, x: 0, y: 0 });
  const outputs: CircuitPin[] = [];
  for (let i = 0; i < fanout; i++) {
    const p = strip(comp.outputs[i] ?? { id: `${comp.id}_out${i}`, name: `${i + 1}`, type: 'output', value: 0, x: 0, y: 0 });
    outputs.push(endWidth[i] === 1 ? p : { ...p, width: endWidth[i] });
  }
  return updatePinPositions({
    ...comp,
    inputs: [incoming > 1 ? { ...combined, width: incoming } : combined],
    outputs,
    state: { ...comp.state, splitBitEnd: bitEnd, splitAppear: patch.appear ?? cur.appear },
  });
}

// ---- Bit extender / bit selector (Logisim wiring/BitExtender, plexers/BitSelector) -----------------

export type ExtendType = 'zero' | 'one' | 'sign' | 'input';

const clampWidth = (n: number) => Math.max(1, Math.min(MAX_BIT_WIDTH, Math.round(n)));

// A pin with a new width (no stale bits); width 1 is stored as no width
const pinWithWidth = (p: CircuitPin, w: number): CircuitPin => {
  const { bits: _bits, width: _width, ...rest } = p;
  return w > 1 ? { ...rest, width: w } : rest;
};

const newPin = (comp: CircuitComponentInstance, id: string, name: string, type: 'input' | 'output'): CircuitPin => ({
  id: `${comp.id}_${id}`,
  name,
  type,
  value: 'X',
  x: comp.x,
  y: comp.y,
});

/** New bit extender settings; the extension input exists only for type 'input' (pin ids are kept). */
export function configureBitExtender(
  comp: CircuitComponentInstance,
  patch: { inWidth?: number; outWidth?: number; type?: ExtendType }
): CircuitComponentInstance {
  const inW = clampWidth(patch.inWidth ?? comp.inputs[0]?.width ?? 1);
  const outW = clampWidth(patch.outWidth ?? comp.outputs[0]?.width ?? 1);
  const type = patch.type ?? comp.state.extendType ?? 'zero';
  const inputs = [pinWithWidth(comp.inputs[0] ?? newPin(comp, 'in0', 'in', 'input'), inW)];
  if (type === 'input') inputs.push(pinWithWidth(comp.inputs[1] ?? newPin(comp, 'in1', 'ext', 'input'), 1));
  return updatePinPositions({
    ...comp,
    inputs,
    outputs: [pinWithWidth(comp.outputs[0] ?? newPin(comp, 'out0', 'out', 'output'), outW)],
    state: { ...comp.state, extendType: type },
  });
}

/** Logisim BitSelector.updatePorts: enough select bits to number every group (at least 1). */
export function bitSelectorSelectWidth(dataWidth: number, groupWidth: number): number {
  let groups = Math.ceil(dataWidth / groupWidth) - 1;
  let bits = 1;
  if (groups > 0) {
    while (groups !== 1) {
      groups >>= 1;
      bits++;
    }
  }
  return bits;
}

/** New bit selector settings: data width and output group width; the select width follows. */
export function configureBitSelector(
  comp: CircuitComponentInstance,
  patch: { dataWidth?: number; groupWidth?: number }
): CircuitComponentInstance {
  const dW = clampWidth(patch.dataWidth ?? comp.inputs[0]?.width ?? 1);
  const gW = clampWidth(patch.groupWidth ?? comp.outputs[0]?.width ?? 1);
  return updatePinPositions({
    ...comp,
    inputs: [
      pinWithWidth(comp.inputs[0] ?? newPin(comp, 'in0', 'D', 'input'), dW),
      pinWithWidth(comp.inputs[1] ?? newPin(comp, 'in1', 'S', 'input'), bitSelectorSelectWidth(dW, gW)),
    ],
    outputs: [pinWithWidth(comp.outputs[0] ?? newPin(comp, 'out0', 'Q', 'output'), gW)],
  });
}

// ---- Parametric plexers (Logisim std/plexers: Multiplexer, Demultiplexer, Decoder, PriorityEncoder) -------

export const PLEXER_TYPES = new Set<ComponentType>(['multiplexer', 'demultiplexer', 'decoder', 'priorityEncoder']);

export const PLEXER_MAX_SELECT = 5;

/** Key of a pin inside its part ('in3', 'sel', 'out', ...): the pin id without the part id prefix */
export const pinKey = (comp: CircuitComponentInstance, pin: CircuitPin): string =>
  pin.id.startsWith(`${comp.id}_`) ? pin.id.slice(comp.id.length + 1) : pin.id;

export interface PlexerConfig {
  /** Select bits (priority encoder: output code bits); the part has 2^select data inputs / outputs */
  select: number;
  /** Data width (MUX / DEMUX; 1 for the others) */
  width: number;
  /** Has an enable input (always on a priority encoder) */
  enable: boolean;
}

export function getPlexerConfig(comp: CircuitComponentInstance): PlexerConfig {
  const find = (pins: CircuitPin[], key: string) => pins.find((p) => pinKey(comp, p) === key);
  const selPin = comp.type === 'priorityEncoder' ? find(comp.outputs, 'out') : find(comp.inputs, 'sel');
  const dataPin = comp.type === 'multiplexer' ? find(comp.outputs, 'out') : comp.type === 'demultiplexer' ? find(comp.inputs, 'in') : undefined;
  return {
    select: selPin?.width ?? 1,
    width: dataPin?.width ?? 1,
    enable: comp.type === 'priorityEncoder' || !!find(comp.inputs, 'en'),
  };
}

/**
 * Pins of a plexer in a fixed order the simulator relies on:
 *  - multiplexer:     inputs in0..in(n-1), sel, [en];  outputs out
 *  - demultiplexer:   inputs in, sel, [en];            outputs out0..out(n-1)
 *  - decoder:         inputs sel, [en];                outputs out0..out(n-1)
 *  - priority encoder: inputs in0..in(n-1), en (EN_IN); outputs out (code), eo (EN_OUT), gs
 * Pins keep their ids (and wires) when the settings change; pins that are no longer needed are dropped.
 */
export function configurePlexer(comp: CircuitComponentInstance, patch: Partial<PlexerConfig>): CircuitComponentInstance {
  const cur = getPlexerConfig(comp);
  const s = Math.max(1, Math.min(PLEXER_MAX_SELECT, Math.round(patch.select ?? cur.select)));
  const w = comp.type === 'multiplexer' || comp.type === 'demultiplexer' ? clampWidth(patch.width ?? cur.width) : 1;
  const en = comp.type === 'priorityEncoder' ? true : patch.enable ?? cur.enable;
  const n = 1 << s;
  const old = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(pinKey(comp, p), p);
  const pin = (key: string, name: string, type: 'input' | 'output', width: number): CircuitPin => ({
    ...pinWithWidth(old.get(key) ?? newPin(comp, key, name, type), width),
    name,
  });
  const many = (prefix: string, type: 'input' | 'output', width: number) =>
    Array.from({ length: n }, (_, i) => pin(`${prefix}${i}`, String(i), type, width));
  let inputs: CircuitPin[];
  let outputs: CircuitPin[];
  const enPin = en ? [pin('en', comp.type === 'priorityEncoder' ? 'EI' : 'EN', 'input', 1)] : [];
  if (comp.type === 'multiplexer') {
    inputs = [...many('in', 'input', w), pin('sel', 'S', 'input', s), ...enPin];
    outputs = [pin('out', 'Y', 'output', w)];
  } else if (comp.type === 'demultiplexer') {
    inputs = [pin('in', 'D', 'input', w), pin('sel', 'S', 'input', s), ...enPin];
    outputs = many('out', 'output', w);
  } else if (comp.type === 'decoder') {
    inputs = [pin('sel', 'S', 'input', s), ...enPin];
    outputs = many('out', 'output', 1);
  } else {
    inputs = [...many('in', 'input', 1), ...enPin];
    outputs = [pin('out', 'Y', 'output', s), pin('eo', 'EO', 'output', 1), pin('gs', 'GS', 'output', 1)];
  }
  return updatePinPositions({ ...comp, inputs, outputs });
}

/**
 * Unrotated layout of a plexer (facing east). Data pins sit 20px apart up to 8 of them, 10px apart for 16
 * and 32. MUX: data on the left, output in the middle of the right side; DEMUX the mirror image; decoder:
 * outputs on the right; select (and the enable next to it) on the bottom side, or the top with selectLoc
 * 'tr'. Priority encoder: inputs on the left, code output mid-right with GS below it, EN_IN on the bottom
 * and EN_OUT on the top (like Logisim).
 */
export function plexerLayout(comp: CircuitComponentInstance): { width: number; height: number; pins: Record<string, { x: number; y: number }>; n: number; spacing: number } {
  const { select } = getPlexerConfig(comp);
  const n = 1 << select;
  const sp = n <= 8 ? 20 : 10;
  const height = sp === 20 ? 20 * n + 20 : 10 * n + 20;
  const mid = height / 2;
  // Like Logisim, whatever the facing: pins are numbered top to bottom / left to right, and the select
  // location means the bottom or left side ('bl') or the top or right side ('tr') on screen. This layout is
  // rotated with the part, so turned 90 / 180 degrees the numbering runs the other way locally, and turned
  // 180 / 270 the select side swaps
  const rot = comp.rotation || 0;
  const dataFlip = rot === 90 || rot === 180;
  const selFlip = rot === 180 || rot === 270;
  const row = (i: number) => (sp === 20 ? 20 : 10) + (dataFlip ? n - 1 - i : i) * sp;
  const edge = (comp.state.selectLoc === 'tr') !== selFlip ? 0 : height;
  const pins: Record<string, { x: number; y: number }> = {};
  let width = 60;
  if (comp.type === 'multiplexer') {
    for (let i = 0; i < n; i++) pins[`in${i}`] = { x: 0, y: row(i) };
    pins.sel = { x: 30, y: edge };
    pins.en = { x: 40, y: edge };
    pins.out = { x: 60, y: mid };
  } else if (comp.type === 'demultiplexer') {
    pins.in = { x: 0, y: mid };
    for (let i = 0; i < n; i++) pins[`out${i}`] = { x: 60, y: row(i) };
    pins.sel = { x: 30, y: edge };
    pins.en = { x: 20, y: edge };
  } else if (comp.type === 'decoder') {
    width = 40;
    for (let i = 0; i < n; i++) pins[`out${i}`] = { x: 40, y: row(i) };
    pins.sel = { x: 20, y: edge };
    pins.en = { x: 10, y: edge };
  } else {
    // EN_IN follows the last input, EN_OUT sits before the first one, GS just after the code output
    for (let i = 0; i < n; i++) pins[`in${i}`] = { x: 0, y: row(i) };
    pins.en = { x: 30, y: dataFlip ? 0 : height };
    pins.eo = { x: 30, y: dataFlip ? height : 0 };
    pins.out = { x: 60, y: mid };
    pins.gs = { x: 60, y: dataFlip ? mid - sp : mid + sp };
  }
  return { width, height, pins, n, spacing: sp };
}

// ---- Parametric arithmetic (Logisim std/arith; Absolute, Min/Max, Square Root, Exponentiator from evolution) --

export const ARITH_TYPES = new Set<ComponentType>([
  'adder', 'subtractor', 'multiplier', 'divider', 'negator', 'absolute', 'comparator', 'minMax', 'shifter',
  'squareRoot', 'exponentiator', 'bitAdder', 'bitFinder', 'alu',
]);
export const BIT_ADDER_MAX_INPUTS = 32;
/** ALU operation codes (op value -> operation) */
export const ALU_OPS = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'NOR', 'SLT', 'PASS-B'] as const;

/** Pin keys of each arithmetic part in the order the simulator relies on (bit adder inputs: in0..in(n-1)) */
export const ARITH_PINS: Partial<Record<ComponentType, { inputs: string[]; outputs: string[] }>> = {
  adder: { inputs: ['a', 'b', 'cin'], outputs: ['out', 'cout'] },
  subtractor: { inputs: ['a', 'b', 'bin'], outputs: ['out', 'bout'] },
  multiplier: { inputs: ['a', 'b', 'cin'], outputs: ['out', 'cout'] },
  divider: { inputs: ['a', 'b', 'upper'], outputs: ['out', 'rem'] },
  negator: { inputs: ['in'], outputs: ['out'] },
  absolute: { inputs: ['in'], outputs: ['out', 'ovf'] },
  comparator: { inputs: ['a', 'b'], outputs: ['gt', 'eq', 'lt'] },
  minMax: { inputs: ['a', 'b'], outputs: ['min', 'max'] },
  shifter: { inputs: ['a', 'dist'], outputs: ['out'] },
  squareRoot: { inputs: ['in', 'upper'], outputs: ['out', 'rem'] },
  exponentiator: { inputs: ['a', 'b'], outputs: ['out', 'upper'] },
  bitAdder: { inputs: [], outputs: ['out'] },
  bitFinder: { inputs: ['in'], outputs: ['out', 'present'] },
  alu: { inputs: ['a', 'b', 'op', 'cin'], outputs: ['out', 'z', 'n', 'c', 'v'] },
};

export interface ArithConfig {
  /** Data width (1-32) */
  width: number;
  /** Bit adder: number of inputs (1-32); 1 for the others */
  inputs: number;
}

export function getArithConfig(comp: CircuitComponentInstance): ArithConfig {
  return { width: comp.inputs[0]?.width ?? 1, inputs: comp.type === 'bitAdder' ? Math.max(1, comp.inputs.length) : 1 };
}

/** Operand reading of an arithmetic part (Logisim 'mode'): the comparator is signed unless set, the others unsigned */
export function getArithMode(comp: CircuitComponentInstance): 'signed' | 'signedUnsigned' | 'unsigned' {
  const m = comp.state.arithMode;
  if (m === 'signedUnsigned' && comp.type !== 'multiplier') return 'signed';
  return m ?? (comp.type === 'comparator' ? 'signed' : 'unsigned');
}

export function arithLayout(comp: CircuitComponentInstance) {
  return arithGeometry(comp.type, getArithConfig(comp).inputs);
}

/** New data width / bit adder input count; pins keep their ids (and wires), widths follow the data width. */
export function configureArith(comp: CircuitComponentInstance, patch: Partial<ArithConfig>): CircuitComponentInstance {
  const cur = comp.inputs.length ? getArithConfig(comp) : { width: comp.type === 'exponentiator' ? 32 : 8, inputs: 1 };
  const w = clampWidth(patch.width ?? cur.width);
  const n = comp.type === 'bitAdder' ? Math.max(1, Math.min(BIT_ADDER_MAX_INPUTS, Math.round(patch.inputs ?? cur.inputs))) : 1;
  const spec = ARITH_PINS[comp.type]!;
  const meta = COMPONENT_CATALOG[comp.type];
  const old = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(pinKey(comp, p), p);
  const pin = (key: string, type: 'input' | 'output'): CircuitPin => {
    const name = [...meta.inputs, ...meta.outputs].find((d) => d.id === key)?.name ?? '';
    return { ...pinWithWidth(old.get(key) ?? newPin(comp, key, name, type), arithPinWidth(comp.type, key, w, n)), name };
  };
  const inKeys = comp.type === 'bitAdder' ? Array.from({ length: n }, (_, i) => `in${i}`) : spec.inputs;
  return updatePinPositions({
    ...comp,
    inputs: inKeys.map((k) => pin(k, 'input')),
    outputs: spec.outputs.map((k) => pin(k, 'output')),
  });
}

// BigInt views of fully defined bits (LSB first)
const bitsToBig = (b: SignalValue[]): bigint => b.reduce<bigint>((acc, v, i) => (v === 1 ? acc | (1n << BigInt(i)) : acc), 0n);
const bitsToSignedBig = (b: SignalValue[]): bigint => (b[b.length - 1] === 1 ? bitsToBig(b) - (1n << BigInt(b.length)) : bitsToBig(b));
const bigToBits = (n: bigint, w: number): SignalValue[] => {
  const m = 1n << BigInt(w);
  const v = ((n % m) + m) % m;
  return Array.from({ length: w }, (_, i) => ((v >> BigInt(i)) & 1n ? 1 : 0));
};
const isqrtBig = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
};
const powModBig = (base: bigint, exp: bigint, mod: bigint): bigint => {
  let r = 1n % mod;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    e >>= 1n;
    if (e > 0n) b = (b * b) % mod;
  }
  return r;
};

/**
 * Outputs of an arithmetic part (bits LSB first, in ARITH_PINS output order) from its input bits (open or
 * undriven bits are x). Rules of Logisim 2.7.1 and evolution (std/arith), checked against the 2.7.1 jar;
 * the multiplier / divider modes and the four extra parts are evolution's.
 */
export function computeArith(comp: CircuitComponentInstance, ins: SignalValue[][]): SignalValue[][] {
  const { width: w } = getArithConfig(comp);
  const fill = (n: number, v: SignalValue): SignalValue[] => new Array<SignalValue>(n).fill(v);
  const defined = (b: SignalValue[]) => b.every(isLevel);
  const allX = (b: SignalValue[]) => b.every((v) => v === 'X');
  const mode = getArithMode(comp);
  switch (comp.type) {
    case 'adder': {
      // A carry-in that is x or open counts as 0; an E / x bit makes that sum bit E / x and the carry spreads it
      const { sum, carry } = logisimSum(ins[0], ins[1], ins[2][0]);
      return [sum, [carry]];
    }
    case 'subtractor': {
      const { diff, borrow } = logisimDiff(ins[0], ins[1], ins[2][0]);
      return [diff, [borrow]];
    }
    case 'multiplier': {
      // Carry-in x or open (every bit) = 0. Undefined operands: the product bits below the first undefined
      // operand bit are still known, then x up to the first E bit, then E; the upper half is all x (or E)
      const [a, b] = ins;
      const c = allX(ins[2]) ? fill(w, 0) : ins[2];
      if (defined(a) && defined(b) && defined(c)) {
        const ua = mode === 'unsigned';
        const ub = mode !== 'signed';
        const r = (ua ? bitsToBig(a) : bitsToSignedBig(a)) * (ub ? bitsToBig(b) : bitsToSignedBig(b)) + (ua && ub ? bitsToBig(c) : bitsToSignedBig(c));
        return [bigToBits(r, w), bigToBits(r >> BigInt(w), w)];
      }
      const firstBad = (pred: (v: SignalValue) => boolean) =>
        Math.min(...[a, b, c].map((v) => {
          const i = v.findIndex(pred);
          return i < 0 ? w : i;
        }));
      const known = firstBad((v) => !isLevel(v));
      const err = firstBad((v) => v === 'E');
      const low = (v: SignalValue[]) => bitsToBig(v.slice(0, known));
      const r = low(a) * low(b) + low(c);
      const out = Array.from({ length: w }, (_, i): SignalValue => (i < known ? ((r >> BigInt(i)) & 1n ? 1 : 0) : i < err ? 'X' : 'E'));
      return [out, fill(w, err < w ? 'E' : 'X')];
    }
    case 'divider': {
      // (upper:A) / B, an open or all-x upper half counts as 0, a divisor of 0 counts as 1; any undefined
      // operand bit makes both outputs all E (an E bit somewhere) or all x
      const [a, b] = ins;
      const hasUpper = !allX(ins[2]);
      const up = hasUpper ? ins[2] : fill(w, 0);
      if (defined(a) && defined(b) && defined(up)) {
        const W = BigInt(w);
        let q: bigint;
        let r: bigint;
        if (mode === 'unsigned') {
          const den = bitsToBig(b) || 1n;
          const num = hasUpper ? (bitsToBig(up) << W) | bitsToBig(a) : bitsToBig(a);
          q = num / den;
          r = num % den;
        } else {
          const bb = bitsToSignedBig(b);
          const den = bb === 0n ? 1n : bb;
          const num = hasUpper ? (bitsToSignedBig(up) << W) | bitsToBig(a) : bitsToSignedBig(a);
          q = num / den;
          r = num % den;
        }
        return [bigToBits(q, w), bigToBits(r, w)];
      }
      const bad: SignalValue = [a, b, up].some((v) => v.includes('E')) ? 'E' : 'X';
      return [fill(w, bad), fill(w, bad)];
    }
    case 'negator':
    case 'absolute': {
      const x = ins[0];
      if (defined(x)) {
        if (comp.type === 'negator') return [bigToBits(-bitsToBig(x), w)];
        const v = bitsToSignedBig(x);
        const out = bigToBits(v < 0n ? -v : v, w);
        return [out, [out[w - 1] === 1 ? 1 : 0]];
      }
      // Logisim's bitwise two's complement: low 0 bits stay 0 up to the first 1 (an x / E on the way spreads
      // to the bits after it), every bit above that first 1 is inverted (x and E stay). Evolution's Absolute
      // stops after the first phase (no inversion) and reports an E overflow
      const bits = [...x];
      let f: SignalValue = 0;
      let pos = 0;
      while (pos < w) {
        const v = bits[pos];
        if (v === 0) bits[pos] = f;
        else if (v === 1) {
          if (f !== 0) bits[pos] = f;
          pos++;
          break;
        } else if (v === 'E') f = 'E';
        else if (f === 0) f = v;
        else bits[pos] = f;
        pos++;
      }
      if (comp.type === 'absolute') return [bits, ['E']];
      for (; pos < w; pos++) {
        if (bits[pos] === 1) bits[pos] = 0;
        else if (bits[pos] === 0) bits[pos] = 1;
      }
      return [bits];
    }
    case 'comparator': {
      // From the MSB down, the first differing pair decides (signed: the sign bits count the other way
      // round); an E or undefined bit met first gives E or x on all three outputs
      let res: SignalValue[] = [0, 1, 0];
      for (let pos = w - 1; pos >= 0; pos--) {
        let ab = ins[0][pos];
        let bb = ins[1][pos];
        if (pos === w - 1 && ab !== bb && mode !== 'unsigned') [ab, bb] = [bb, ab];
        if (ab === 'E' || bb === 'E') {
          res = ['E', 'E', 'E'];
          break;
        }
        if (!isLevel(ab) || !isLevel(bb)) {
          res = ['X', 'X', 'X'];
          break;
        }
        if (ab !== bb) {
          res = ab === 1 ? [1, 0, 0] : [0, 0, 1];
          break;
        }
      }
      return res.map((v) => [v]);
    }
    case 'minMax': {
      const [a, b] = ins;
      if (!defined(a) || !defined(b)) return [fill(w, 'E'), fill(w, 'E')];
      const av = mode === 'unsigned' ? bitsToBig(a) : bitsToSignedBig(a);
      const bv = mode === 'unsigned' ? bitsToBig(b) : bitsToSignedBig(b);
      return av <= bv ? [a, b] : [b, a];
    }
    case 'shifter': {
      // A distance with any undefined bit gives all E. Logical shifts fill 0, arithmetic right fills the top
      // bit, rotations move bits round (a distance past the width wraps once); undefined data bits move along
      const x = ins[0];
      const dv = bitsToNumber(ins[1]);
      if (dv === undefined) return [fill(w, 'E')];
      let d = dv;
      if (d === 0) return [x];
      const t = comp.state.shiftType ?? 'll';
      const y = new Array<SignalValue>(w);
      if (t === 'lr' || t === 'll' || t === 'ar') {
        if (d >= w) d = w;
        for (let i = 0; i < w; i++) {
          if (t === 'll') y[i] = i < d ? 0 : x[i - d];
          else y[i] = i < w - d ? x[i + d] : t === 'ar' ? x[w - 1] : 0;
        }
      } else {
        if (d >= w) d -= w;
        for (let i = 0; i < w; i++) y[i] = t === 'rr' ? x[(i + d) % w] : x[(i - d + w) % w];
      }
      return [y];
    }
    case 'squareRoot': {
      const a = ins[0];
      const up = allX(ins[1]) ? fill(w, 0) : ins[1];
      if (defined(a) && defined(up)) {
        const num = (bitsToBig(up) << BigInt(w)) | bitsToBig(a);
        const root = isqrtBig(num);
        return [bigToBits(root, w), bigToBits(num - root * root, w)];
      }
      const bad: SignalValue = a.includes('E') || up.includes('E') ? 'E' : 'X';
      return [fill(w, bad), fill(w, bad)];
    }
    case 'exponentiator': {
      // A^B, low half and high half of the (wrapped) result; signed: a negative exponent gives 0. An undefined
      // operand gives E / x (evolution outputs all ones there, a bug not copied)
      const [a, b] = ins;
      if (!defined(a) || !defined(b)) {
        const bad: SignalValue = a.includes('E') || b.includes('E') ? 'E' : 'X';
        return [fill(w, bad), fill(w, bad)];
      }
      const signed = mode !== 'unsigned';
      const base = signed ? bitsToSignedBig(a) : bitsToBig(a);
      const exp = signed ? bitsToSignedBig(b) : bitsToBig(b);
      const r = bitsToBig(a) === 1n ? 1n : exp < 0n ? 0n : powModBig(base, exp, 1n << BigInt(2 * w));
      return [bigToBits(r, w), bigToBits(r >> BigInt(w), w)];
    }
    case 'bitAdder': {
      // Counts the 1 bits; every bit that is x or E could be either, so output bits that could differ are E
      let min = 0;
      let max = 0;
      for (const v of ins) {
        for (const bit of v) {
          if (bit === 1) min++;
          if (bit !== 0) max++;
        }
      }
      let mask = 0;
      for (let i = min + 1; i <= max; i++) mask |= min ^ i;
      const ow = bitAdderOutBits(w, ins.length);
      return [Array.from({ length: ow }, (_, i): SignalValue => ((mask >> i) & 1 ? 'E' : (min >> i) & 1 ? 1 : 0))];
    }
    case 'bitFinder': {
      // Scans from the low (or high) end past the bits that are not wanted; the first other bit is the
      // wanted one (index, present 1), x or E (both outputs E), or none left (index 0, present 0)
      const x = ins[0];
      const t = comp.state.findType ?? 'low1';
      const want: SignalValue = t === 'low1' || t === 'high1' ? 1 : 0;
      const skip: SignalValue = want === 1 ? 0 : 1;
      const high = t === 'high1' || t === 'high0';
      let i = high ? w - 1 : 0;
      while (i >= 0 && i < w && x[i] === skip) i += high ? -1 : 1;
      const ow = bitFinderOutBits(w);
      if (i < 0 || i >= w) return [fill(ow, 0), [0]];
      if (x[i] === want) return [bigToBits(BigInt(i), ow), [1]];
      return [fill(ow, 'E'), ['E']];
    }
    case 'alu': {
      // No Logisim counterpart. An E bit in the operation select makes every output E, an x / open bit x.
      // ADD / SUB follow Logisim's adder / subtractor (an open or x carry-in is 0, C = carry / borrow), the
      // logic operations go bit by bit like the gates (0 AND x = 0), SLT is a signed A < B (any undefined
      // operand bit leaves its bit 0 undefined), PASS-B copies B. Z and N always describe Y; C and V are 0
      // outside ADD / SUB
      const [a, b, opBits, cinBits] = ins;
      const op = bitsToNumber(opBits);
      if (op === undefined) {
        const bad: SignalValue = opBits.includes('E') ? 'E' : 'X';
        return [fill(w, bad), [bad], [bad], [bad], [bad]];
      }
      const lvl = (v: SignalValue): SignalValue => (v === 'Z' ? 'X' : v);
      let y: SignalValue[];
      let c: SignalValue = 0;
      let v: SignalValue = 0;
      // Signed overflow from the sign bits: ADD when A and B agree and Y differs, SUB when A and B differ
      // and Y differs from A
      const overflow = (sub: boolean): SignalValue => {
        const sa = a[w - 1];
        const sb = b[w - 1];
        const sy = y[w - 1];
        if ([sa, sb, sy].includes('E')) return 'E';
        if (!isLevel(sa) || !isLevel(sb) || !isLevel(sy)) return 'X';
        return (sub ? sa !== sb : sa === sb) && sy !== sa ? 1 : 0;
      };
      switch (op) {
        case 0: {
          const r = logisimSum(a, b, cinBits[0]);
          y = r.sum;
          c = r.carry;
          v = overflow(false);
          break;
        }
        case 1: {
          const r = logisimDiff(a, b, cinBits[0]);
          y = r.diff;
          c = r.borrow;
          v = overflow(true);
          break;
        }
        case 2:
          y = a.map((ai, i) => sigAnd(ai, b[i]));
          break;
        case 3:
          y = a.map((ai, i) => sigOr(ai, b[i]));
          break;
        case 4:
          y = a.map((ai, i) => sigXor(ai, b[i]));
          break;
        case 5:
          y = a.map((ai, i) => sigNot(sigOr(ai, b[i])));
          break;
        case 6: {
          y = fill(w, 0);
          if (defined(a) && defined(b)) y[0] = bitsToSignedBig(a) < bitsToSignedBig(b) ? 1 : 0;
          else y[0] = a.includes('E') || b.includes('E') ? 'E' : 'X';
          break;
        }
        default:
          y = b.map(lvl);
          break;
      }
      y = y.map(lvl);
      const z: SignalValue = y.includes(1) ? 0 : y.every((bit) => bit === 0) ? 1 : y.includes('E') ? 'E' : 'X';
      return [y, [z], [y[w - 1]], [lvl(c)], [lvl(v)]];
    }
    default:
      return [];
  }
}

// ---- Parametric memory (Logisim std/memory: flip-flops, register, counter, shift register) ------------------

export const FLIP_FLOP_TYPES = new Set<ComponentType>(['flipFlopD', 'flipFlopT', 'flipFlopJK', 'flipFlopSR']);
export const MEM_TYPES = new Set<ComponentType>([...FLIP_FLOP_TYPES, 'register', 'counter', 'shiftRegister']);
/** Parts whose clock can also act on a level (Logisim StdAttr.TRIGGER); the others take edges only */
export const LEVEL_TRIGGER_TYPES = new Set<ComponentType>(['flipFlopD', 'flipFlopSR', 'register']);
export const SHIFT_REGISTER_MAX_LENGTH = 32;
export type TriggerMode = 'rising' | 'falling' | 'high' | 'low';

export interface MemConfig {
  /** Data width (1-32; flip-flops 1) */
  width: number;
  /** Shift register stages (1-32); 1 for the others */
  length: number;
  /** Shift register parallel load / outputs; true for the others */
  parallel: boolean;
}

export function getMemConfig(comp: CircuitComponentInstance): MemConfig {
  const find = (key: string) => [...comp.inputs, ...comp.outputs].find((p) => pinKey(comp, p) === key);
  if (comp.type === 'shiftRegister') {
    const parallel = comp.state.shiftParallel ?? true;
    const length = parallel
      ? Math.max(1, comp.outputs.length - 1)
      : Math.max(1, comp.state.shiftLength ?? comp.state.shiftStages?.length ?? 8);
    return { width: find('in')?.width ?? 1, length, parallel };
  }
  return { width: comp.type === 'register' || comp.type === 'counter' ? find('d')?.width ?? 1 : 1, length: 1, parallel: true };
}

export function memLayout(comp: CircuitComponentInstance) {
  const { length, parallel } = getMemConfig(comp);
  return memGeometry(comp.type, length, parallel);
}

/** A part's trigger, limited to what it supports (edge-only parts read a level setting as rising) */
export function getTrigger(comp: CircuitComponentInstance): TriggerMode {
  const t = comp.state.trigger ?? 'rising';
  if (!LEVEL_TRIGGER_TYPES.has(comp.type) && (t === 'high' || t === 'low')) return 'rising';
  return t;
}

const memMask = (w: number): number => (w >= 32 ? 0xffffffff : 2 ** w - 1);

/** Counter's largest value (unset = all bits 1), kept within the width */
export function getCounterMax(comp: CircuitComponentInstance): number {
  const w = getMemConfig(comp).width;
  const m = comp.state.counterMax;
  return m === undefined ? memMask(w) : (m >>> 0) % 2 ** w;
}

// Stored value at a new width: extra high bits 0, cut ones dropped (Logisim Value.extendWidth with 0)
const fitBits = (bits: SignalValue[] | undefined, w: number): SignalValue[] =>
  Array.from({ length: w }, (_, i) => bits?.[i] ?? 0);

/**
 * New data width / shift register length / parallel setting; pins keep their ids (and wires), widths follow
 * the data width. The stored value follows like Logisim: bits cut or 0-extended; a counter growing wider
 * goes back to the full maximum, narrower keeps its maximum's low bits (CounterAttributes); a shift register
 * keeps the stages nearest its output (ShiftRegisterData.setDimensions).
 */
export function configureMem(comp: CircuitComponentInstance, patch: Partial<MemConfig>): CircuitComponentInstance {
  const isShift = comp.type === 'shiftRegister';
  const wide = comp.type === 'register' || comp.type === 'counter' || isShift;
  const cur = comp.inputs.length ? getMemConfig(comp) : { width: isShift ? 1 : wide ? 8 : 1, length: isShift ? 8 : 1, parallel: true };
  const w = wide ? clampWidth(patch.width ?? cur.width) : 1;
  const len = isShift ? Math.max(1, Math.min(SHIFT_REGISTER_MAX_LENGTH, Math.round(patch.length ?? cur.length))) : 1;
  const parallel = isShift ? patch.parallel ?? cur.parallel : true;
  const keys = memPinKeys(comp.type, len, parallel);
  const old = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(pinKey(comp, p), p);
  const pin = (key: string, type: 'input' | 'output'): CircuitPin => {
    const name = memPinLabel(key);
    return { ...pinWithWidth(old.get(key) ?? newPin(comp, key, name, type), memPinWidth(comp.type, key, w)), name };
  };
  const state = { ...comp.state };
  if (comp.type === 'register' || comp.type === 'counter') {
    if (state.seqBits) state.seqBits = fitBits(state.seqBits, w);
    if (comp.type === 'counter' && w !== cur.width && state.counterMax !== undefined) {
      if (w > cur.width) delete state.counterMax;
      else state.counterMax = (state.counterMax >>> 0) % 2 ** w;
    }
  }
  if (isShift) {
    const s = state.shiftStages ?? [];
    const oldLen = s.length;
    state.shiftStages = Array.from({ length: len }, (_, i) => {
      const from = oldLen - len + i; // aligned on the output end
      return fitBits(from >= 0 ? s[from] : undefined, w);
    });
    state.shiftParallel = parallel;
    state.shiftLength = len;
  }
  return updatePinPositions({
    ...comp,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    state,
  });
}

/** Whether the clock acts now (Logisim ClockState.updateClock); edges need a clean 0/1 step, the first evaluation has no previous level */
const clockActs = (comp: CircuitComponentInstance, clk: SignalValue, mode: TriggerMode, key: 'lastClk' | 'lastClkB' = 'lastClk'): boolean => {
  const prev = comp.state[key] ?? clk;
  comp.state[key] = clk;
  if (mode === 'falling') return prev === 1 && clk === 0;
  if (mode === 'high') return clk === 1;
  if (mode === 'low') return clk === 0;
  return prev === 0 && clk === 1;
};

const bitsBig = (b: SignalValue[]): number => b.reduce<number>((acc, v, i) => (v === 1 ? acc + 2 ** i : acc), 0);
const numBits = (n: number, w: number): SignalValue[] => {
  const m = 2 ** w;
  const v = ((n % m) + m) % m;
  return Array.from({ length: w }, (_, i) => (Math.floor(v / 2 ** i) % 2 === 1 ? 1 : 0));
};
const defined = (b: SignalValue[]): boolean => b.every((v) => v === 0 || v === 1);

/**
 * One evaluation of a memory part: reads its inputs (bits LSB first, in memPinKeys order; open bits x), updates
 * its stored state and returns its outputs. Rules of Logisim 2.7.1 and evolution (std/memory):
 * - clear (reset 0) and preset (1) act only at 1, at any time, clear first; enable / count / shift block only at 0
 * - flip-flops store only a 0/1 next value (J-K or S-R inputs that are not 0/1, S = R = 1: no change); the enable
 *   pin is 2.7.1's (evolution dropped it)
 * - register stores D as it is, x / E bits included (evolution; 2.7.1 skips an undefined D)
 * - counter: evolution's up/down pin (open = up) and load before count (2.7.1 counts down on load + count);
 *   loading an undefined D stores it as it is (evolution would store the maximum), counting from an undefined
 *   value gives E, carry = value at the goal (max up, 0 down), E while the value is undefined
 * - shift register: stage values move as they are (x included); load needs 1, shift is on unless 0
 */
export function stepMem(comp: CircuitComponentInstance, ins: SignalValue[][]): SignalValue[][] {
  const { width: w, length: len, parallel } = getMemConfig(comp);
  const trig = getTrigger(comp);
  const one = (i: number): SignalValue => ins[i]?.[0] ?? 'X';
  if (FLIP_FLOP_TYPES.has(comp.type)) {
    const n = flipFlopDataKeys(comp.type).length;
    const acts = clockActs(comp, one(n), trig);
    let q: SignalValue = comp.state.q === 1 ? 1 : 0;
    if (one(n + 1) === 1) q = 0;
    else if (one(n + 2) === 1) q = 1;
    else if (acts && one(n + 3) !== 0) {
      const a = one(0);
      const b = one(1);
      let next: SignalValue = 'X';
      if (comp.type === 'flipFlopD') next = a;
      else if (comp.type === 'flipFlopT') next = a === 1 ? (q === 1 ? 0 : 1) : q;
      else if (a === 0 && b === 0) next = q;
      else if (a === 0 && b === 1) next = 0;
      else if (a === 1 && b === 0) next = 1;
      else if (a === 1 && b === 1 && comp.type === 'flipFlopJK') next = q === 1 ? 0 : 1;
      if (next === 0 || next === 1) q = next;
    }
    comp.state.q = q;
    comp.state.qBar = q === 1 ? 0 : 1;
    return [[q], [q === 1 ? 0 : 1]];
  }
  if (comp.type === 'register') {
    const acts = clockActs(comp, one(1), trig);
    let v = fitBits(comp.state.seqBits, w);
    if (one(2) === 1) v = fitBits(undefined, w);
    else if (acts && one(3) !== 0) v = fitBits(ins[0], w);
    comp.state.seqBits = v;
    return [v];
  }
  if (comp.type === 'counter') {
    const acts = clockActs(comp, one(1), trig);
    const max = getCounterMax(comp);
    const up = one(5) !== 0;
    const old = fitBits(comp.state.seqBits, w);
    let v = old;
    if (one(2) === 1) {
      comp.state.seqBits = fitBits(undefined, w);
      return [comp.state.seqBits, [0]];
    }
    const load = (): SignalValue[] => {
      const d = fitBits(ins[0], w);
      if (!defined(d)) return d;
      const n = bitsBig(d);
      return numBits(n > max ? (n & max) >>> 0 : n, w);
    };
    if (acts) {
      if (one(3) === 1) v = load();
      else if (!defined(old)) v = new Array<SignalValue>(w).fill('E');
      else if (one(4) !== 0) {
        const o = bitsBig(old);
        const step = (): SignalValue[] => numBits(up ? o + 1 : o - 1, w);
        if (o === (up ? max : 0)) {
          const goal = comp.state.counterGoal ?? 'wrap';
          v = goal === 'wrap' ? numBits(up ? 0 : max, w) : goal === 'stay' ? old : goal === 'load' ? load() : step();
        } else v = step();
      }
    }
    comp.state.seqBits = v;
    const carry: SignalValue = defined(v) ? (bitsBig(v) === (up ? max : 0) ? 1 : 0) : 'E';
    return [v, [carry]];
  }
  // shift register
  const acts = clockActs(comp, one(2), trig);
  let s = Array.from({ length: len }, (_, i) => fitBits(comp.state.shiftStages?.[i], w));
  if (one(3) === 1) s = s.map(() => fitBits(undefined, w));
  else if (acts) {
    if (parallel && one(4) === 1) s = s.map((_, i) => fitBits(ins[5 + i], w));
    else if (one(0) !== 0) s = [fitBits(ins[1], w), ...s.slice(0, len - 1)];
  }
  comp.state.shiftStages = s;
  return [s[len - 1], ...(parallel ? s : [])];
}

// ---- Parametric RAM / ROM / random generator (Logisim std/memory Ram, Rom, Random) --------------------------

export const RAM_TYPES = new Set<ComponentType>(['ram', 'rom', 'random', 'dualRam']);
export const RAM_ADDR_MIN = 2;
export const RAM_ADDR_MAX = 24;
/** Words per contents page (memPages) */
export const MEM_PAGE_SIZE = 256;

export function getRamConfig(comp: CircuitComponentInstance): RamConfig {
  const d = defaultRamConfig();
  const find = (key: string) => [...comp.inputs, ...comp.outputs].find((p) => pinKey(comp, p) === key);
  const st = comp.state;
  if (comp.type === 'random') return { ...d, dataWidth: find('out')?.width ?? 1 };
  return {
    addrWidth: find('a')?.width ?? d.addrWidth,
    dataWidth: find('d')?.width ?? 1,
    flavor: comp.type === 'dualRam' ? 'evolution' : st.memFlavor ?? 'logisim',
    bus: st.ramBus ?? 'combined',
    dataBus: st.ramDataBus ?? 'separate',
    trigger: st.trigger ?? 'rising',
    byteEnables: st.ramByteEnables ?? false,
    clearPin: st.ramClearPin ?? false,
  };
}

/** Stored word (0 where nothing was written) */
export function memRead(comp: CircuitComponentInstance, addr: number): number {
  if (addr < 0) return 0;
  return comp.state.memPages?.[Math.floor(addr / MEM_PAGE_SIZE)]?.[addr % MEM_PAGE_SIZE] ?? 0;
}

/** Store a word; copy on write (the pages are shared with earlier steps' states and with undo history) */
export function memWrite(comp: CircuitComponentInstance, addr: number, value: number): void {
  const k = String(Math.floor(addr / MEM_PAGE_SIZE));
  const pages = { ...(comp.state.memPages ?? {}) };
  const page = pages[k] ? [...pages[k]] : new Array<number>(MEM_PAGE_SIZE).fill(0);
  page[addr % MEM_PAGE_SIZE] = value;
  pages[k] = page;
  comp.state.memPages = pages;
}

/**
 * New RAM / ROM / random generator settings; pins keep their ids (and wires), widths follow the settings. Like
 * Logisim's MemContents.setDimensions, words past a smaller address range go and stored words keep only the
 * bits that still exist.
 */
export function configureRam(comp: CircuitComponentInstance, patch: Partial<RamConfig>): CircuitComponentInstance {
  const cur = comp.inputs.length ? getRamConfig(comp) : defaultRamConfig();
  const cfg: RamConfig = { ...cur, ...patch };
  // the dual-port RAM exists only in Logisim-evolution
  if (comp.type === 'dualRam') cfg.flavor = 'evolution';
  cfg.dataWidth = clampWidth(cfg.dataWidth);
  cfg.addrWidth = Math.max(RAM_ADDR_MIN, Math.min(RAM_ADDR_MAX, Math.round(cfg.addrWidth)));
  const keys = ramPinKeys(comp.type, cfg);
  const old = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(pinKey(comp, p), p);
  const pin = (key: string, type: 'input' | 'output'): CircuitPin => {
    const name = ramPinLabel(key, comp.type);
    return { ...pinWithWidth(old.get(key) ?? newPin(comp, key, name, type), ramPinWidth(comp.type, key, cfg)), name };
  };
  const state = { ...comp.state };
  if (comp.type !== 'random') {
    state.memFlavor = cfg.flavor;
    if (comp.type === 'ram' || comp.type === 'dualRam') {
      state.ramBus = cfg.bus;
      state.ramDataBus = cfg.dataBus;
      state.trigger = cfg.trigger;
      state.ramByteEnables = cfg.byteEnables;
      state.ramClearPin = cfg.clearPin;
    }
    if (state.memPages && (cfg.addrWidth < cur.addrWidth || cfg.dataWidth < cur.dataWidth)) {
      const size = 2 ** cfg.addrWidth;
      const mask = memMask(cfg.dataWidth);
      const pages: Record<string, number[]> = {};
      for (const [k, page] of Object.entries(state.memPages)) {
        const base = Number(k) * MEM_PAGE_SIZE;
        if (base >= size) continue;
        pages[k] = page.map((v, i) => (base + i < size ? (v & mask) >>> 0 : 0));
      }
      state.memPages = pages;
    }
    delete state.memOut;
  } else if (state.randomValue !== undefined) {
    delete state.memOut;
  }
  return updatePinPositions({
    ...comp,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    state,
  });
}

// Logisim 2.7.1 Random: java.util.Random's 48-bit linear congruential generator
const RND_MULT = 0x5deece66dn;
const RND_ADD = 0xbn;
const RND_MASK = (1n << 48n) - 1n;

/** Start (or restart) the random generator from its seed (Random.StateData.reset; seed 0 = from the time) */
function randomReset(comp: CircuitComponentInstance): void {
  const st = comp.state;
  let start = BigInt((st.randomSeed ?? 0) | 0);
  if (start === 0n) {
    start = (BigInt(Date.now()) ^ RND_MULT) & RND_MASK;
    if (st.randomInit !== undefined && start === BigInt(st.randomInit)) start = (start + RND_MULT) & RND_MASK;
  }
  st.randomInit = start.toString();
  st.randomCur = start.toString();
  st.randomValue = Number(BigInt.asUintN(32, start));
}

function randomStep(comp: CircuitComponentInstance): void {
  const v = (BigInt(comp.state.randomCur ?? '0') * RND_MULT + RND_ADD) & RND_MASK;
  comp.state.randomCur = v.toString();
  comp.state.randomValue = Number(BigInt.asUintN(32, v >> 12n));
}

const fillBits = (w: number, v: SignalValue): SignalValue[] => new Array<SignalValue>(w).fill(v);

/**
 * One evaluation of a RAM / ROM / random generator: reads its inputs (bits LSB first, in ramPinKeys order) and
 * returns its outputs; an output it does not drive this time keeps its last value, like a Logisim port nobody
 * sets. A floating output (Logisim's unknown value) is Z.
 *
 * Logisim 2.7.1 (Ram / Rom.propagate): CLR = 1 clears (any time); sel = 0 floats the data; an address that is not
 * fully defined changes nothing; otherwise a rising edge (2.7.1 asynch bus: always) stores when OE = 0
 * (combined / asynch, from the bus) or WE is not 0 (separate, from DIN), not while clearing; the data shows the
 * word unless OE = 0 (floats). Clock, select and OE act unless 0, open counts as 1.
 *
 * evolution (Ram.propagateByteEnables, Rom.propagate): CLR pin = 1 clears and drives 0 (separate) or floats (bidir),
 * without looking at the clock; the write needs WE = 1 at the edge, or WE at the level of a high / low trigger
 * (no clock then); byte enables at 1 pick the bytes written. Reading: OE = 0 floats a bidir / controlled bus and
 * leaves a plain separate one as it is; an address with an E bit gives E, an undefined one x; asynchronous read
 * (or a level trigger) shows the word at once, a clocked read only at the edge (the word after the write, or
 * before it with 'war'). ROM: E address -> E, undefined -> x.
 *
 * An undefined data word is stored as all ones in both (Value.toIntValue / toLongValue = -1).
 *
 * Random (2.7.1): RST = 1 restarts from the seed, else the clock edge with NXT not 0 steps the generator; the
 * output is the low bits of the 32-bit value.
 */
export function stepRam(comp: CircuitComponentInstance, ins: SignalValue[][]): SignalValue[][] {
  const cfg = getRamConfig(comp);
  const keys = ramPinKeys(comp.type, cfg).inputs;
  const st = comp.state;
  const at = (k: string): SignalValue[] | undefined => {
    const i = keys.indexOf(k);
    return i < 0 ? undefined : ins[i];
  };
  const one = (k: string): SignalValue => at(k)?.[0] ?? 'X';
  if (comp.type === 'random') {
    if (st.randomCur === undefined) randomReset(comp);
    const acts = clockActs(comp, one('ck'), getTrigger(comp));
    if (one('rst') === 1) randomReset(comp);
    else if (acts && one('nxt') !== 0) randomStep(comp);
    return [numBits(st.randomValue ?? 0, cfg.dataWidth)];
  }
  if (comp.type === 'dualRam') return stepDualRam(comp, cfg, at);
  const w = cfg.dataWidth;
  const mask = memMask(w);
  const evo = cfg.flavor === 'evolution';
  let out: SignalValue[] = st.memOut?.[0]?.length === w ? st.memOut[0] : fillBits(w, 'Z');
  const finish = (bits: SignalValue[]): SignalValue[][] => {
    st.memOut = [bits];
    return [bits];
  };
  const word = (k: string): number => {
    const b = fitBits(at(k), w);
    return defined(b) ? bitsBig(b) : mask;
  };
  const aBits = fitBits(at('a'), cfg.addrWidth);
  const addr = defined(aBits) ? bitsBig(aBits) : -1;
  const show = (n: number): SignalValue[] => numBits(n, w);

  if (comp.type === 'rom') {
    if (!evo) {
      if (one('cs') === 0) {
        st.memCurrent = -1;
        return finish(fillBits(w, 'Z'));
      }
      if (addr < 0) return finish(out);
      st.memCurrent = addr;
      return finish(show(memRead(comp, addr)));
    }
    if (aBits.includes('E')) return finish(fillBits(w, 'E'));
    if (addr < 0) return finish(fillBits(w, 'Z'));
    st.memCurrent = addr;
    return finish(show(memRead(comp, addr)));
  }

  if (!evo) {
    const triggered = cfg.bus === 'asynch' || clockActs(comp, one('clk'), 'rising');
    const oe = one('oe') !== 0;
    const clear = one('clr') === 1;
    if (clear) st.memPages = {};
    if (one('cs') === 0) {
      st.memCurrent = -1;
      return finish(fillBits(w, 'Z'));
    }
    if (addr < 0) return finish(out);
    st.memCurrent = addr;
    if (!clear && triggered) {
      const sep = cfg.bus === 'separate';
      if (sep ? one('we') !== 0 : !oe) memWrite(comp, addr, word(sep ? 'din' : 'dio'));
    }
    return finish(oe ? show(memRead(comp, addr)) : fillBits(w, 'Z'));
  }

  // evolution RAM
  const sep = cfg.dataBus !== 'bidir';
  if (cfg.clearPin && one('clr') === 1) {
    st.memPages = {};
    return finish(sep ? show(0) : fillBits(w, 'Z'));
  }
  if (addr >= 0) st.memCurrent = addr;
  const cur = st.memCurrent ?? -1;
  const oldVal = memRead(comp, cur);
  let newVal = oldVal;
  const trig = cfg.trigger;
  const async = trig === 'high' || trig === 'low';
  const edge = !async && clockActs(comp, one('clk'), trig);
  const we = one('we');
  const weTriggered = (async && ((trig === 'high' && we === 1) || (trig === 'low' && we === 0))) || (edge && we === 1);
  if (addr >= 0 && weTriggered) {
    const din = word(sep ? 'din' : 'dio');
    const nBE = ramByteEnableCount(cfg);
    if (nBE === 0) newVal = din;
    else {
      for (let i = 0; i < nBE; i++) {
        if (one(`be${i}`) !== 1) continue;
        const unit = 2 ** (8 * i);
        const byteOf = (n: number) => Math.floor(n / unit) % 256;
        newVal += (byteOf(din) - byteOf(newVal)) * unit;
      }
      newVal = newVal % 2 ** w;
    }
    memWrite(comp, addr, newVal);
  }
  if (one('oe') === 0) {
    if (!sep || cfg.dataBus === 'controlled') out = fillBits(w, 'Z');
    return finish(out);
  }
  if (aBits.includes('E')) return finish(fillBits(w, 'E'));
  if (addr < 0) return finish(fillBits(w, 'Z'));
  if (async || st.ramAsyncRead) return finish(show(newVal));
  if (edge) return finish(show(st.ramReadBehavior === 'war' ? oldVal : newVal));
  return finish(out);
}

/**
 * Dual-port RAM (Logisim-evolution 5 DualRam.propagate): two evolution RAM ports on one contents. CLR = 1 clears
 * and drives both data outputs like the single RAM, without looking at the clocks. Each port writes with WE = 1
 * at its own clock's edge (a level trigger: WE at the active level, no clocks) and reads like the single RAM
 * (OE, E / undefined address, asynchronous or clocked read with raw / war).
 *
 * Where the two ports meet, the part behaves like a real dual-port SRAM rather than copying evolution's
 * evaluation order: both writes happen first (port 0, then port 1, so port 1 wins on the same word, byte enables
 * merge), then both ports read the contents after the writes (war: the word before this evaluation's writes).
 * evolution instead reads port 0 before port 1 writes and does not update an asynchronous read when only the other
 * port wrote, and its low-level trigger never writes (it asks for WE = 1 and WE = 0 at once); here a low trigger
 * writes at WE = 0 like the single RAM.
 */
function stepDualRam(comp: CircuitComponentInstance, cfg: RamConfig, at: (k: string) => SignalValue[] | undefined): SignalValue[][] {
  const st = comp.state;
  const w = cfg.dataWidth;
  const mask = memMask(w);
  const one = (k: string): SignalValue => at(k)?.[0] ?? 'X';
  const sep = cfg.dataBus !== 'bidir';
  const prev = st.memOut?.length === 2 && st.memOut[0].length === w ? st.memOut : [fillBits(w, 'Z'), fillBits(w, 'Z')];
  const finish = (outs: SignalValue[][]): SignalValue[][] => {
    st.memOut = outs;
    return outs;
  };
  if (cfg.clearPin && one('clr') === 1) {
    st.memPages = {};
    const v = sep ? numBits(0, w) : fillBits(w, 'Z');
    return finish([v, [...v]]);
  }
  const trig = cfg.trigger;
  const async = trig === 'high' || trig === 'low';
  const nBE = ramByteEnableCount(cfg);
  const ports = (['', '1'] as const).map((sfx, p) => {
    const aBits = fitBits(at('a' + sfx), cfg.addrWidth);
    const addr = defined(aBits) ? bitsBig(aBits) : -1;
    if (addr >= 0) {
      if (p === 0) st.memCurrent = addr;
      else st.memCurrentB = addr;
    }
    const we = one('we' + sfx);
    const edge = !async && clockActs(comp, one('clk' + sfx), trig, p === 0 ? 'lastClk' : 'lastClkB');
    const write = addr >= 0 && ((async && we === (trig === 'high' ? 1 : 0)) || (edge && we === 1));
    const din = fitBits(at((sep ? 'din' : 'dio') + sfx), w);
    return { sfx, p, aBits, addr, edge, write, din: defined(din) ? bitsBig(din) : mask, old: memRead(comp, addr) };
  });
  for (const q of ports) {
    if (!q.write) continue;
    let val = memRead(comp, q.addr);
    if (nBE === 0) val = q.din;
    else {
      for (let i = 0; i < nBE; i++) {
        if (one(`be${q.p * nBE + i}`) !== 1) continue;
        const unit = 2 ** (8 * i);
        const byteOf = (n: number) => Math.floor(n / unit) % 256;
        val += (byteOf(q.din) - byteOf(val)) * unit;
      }
      val = val % 2 ** w;
    }
    memWrite(comp, q.addr, val);
  }
  return finish(
    ports.map((q) => {
      const kept = prev[q.p];
      if (one('oe' + q.sfx) === 0) return !sep || cfg.dataBus === 'controlled' ? fillBits(w, 'Z') : kept;
      if (q.aBits.includes('E')) return fillBits(w, 'E');
      if (q.addr < 0) return fillBits(w, 'Z');
      if (async || st.ramAsyncRead) return numBits(memRead(comp, q.addr), w);
      if (q.edge) return numBits(st.ramReadBehavior === 'war' ? q.old : memRead(comp, q.addr), w);
      return kept;
    })
  );
}

/**
 * Unrotated (local frame) Y offset of input pin `idx` on a multi-input gate with `count` inputs.
 * Shared by updatePinPositions and the gate renderer so the drawn input leads match the pins.
 */
// ---- Parametric I/O parts: settings and what the displays show (Aşama 3g) -----------------------------

export const IO_TYPES = new Set<ComponentType>(['dipSwitch', 'ledBar', 'dotMatrix', 'hexDigit']);
export const IO_MAX_SIZE = 32;

const clampIo = (n: number) => Math.max(1, Math.min(IO_MAX_SIZE, Math.round(n)));

export function getIoConfig(comp: CircuitComponentInstance): IoConfig {
  const d = defaultIoConfig();
  const st = comp.state;
  return {
    size: clampIo(st.ioSize ?? d.size),
    ledBarMode: st.ledBarMode ?? d.ledBarMode,
    cols: clampIo(st.matrixCols ?? d.cols),
    rows: clampIo(st.matrixRows ?? d.rows),
    matrixInput: st.matrixInput ?? d.matrixInput,
    selectLoc: st.selectLoc ?? d.selectLoc,
    dp: st.ioDp ?? d.dp,
  };
}

/**
 * New settings of a DIP switch / LED bar / dot matrix / hex digit / 7-segment display; pins keep their ids
 * (and wires), widths follow the settings. A DIP switch keeps the positions of the switches that still exist.
 */
export function configureIo(comp: CircuitComponentInstance, patch: Partial<IoConfig>): CircuitComponentInstance {
  const cfg: IoConfig = { ...getIoConfig(comp), ...patch };
  cfg.size = clampIo(cfg.size);
  cfg.cols = clampIo(cfg.cols);
  cfg.rows = clampIo(cfg.rows);
  const state = { ...comp.state };
  if (comp.type === 'sevenSegment') {
    // Logisim-evolution 'decimalPoint': without it the part has the 7 segment inputs only
    state.ioDp = cfg.dp;
    const meta = COMPONENT_CATALOG.sevenSegment;
    const has = new Map(comp.inputs.map((p) => [pinKey(comp, p), p]));
    const inputs = meta.inputs
      .filter((p) => cfg.dp || p.id !== 'inDP')
      .map((p) => has.get(p.id) ?? newPin(comp, p.id, p.name, 'input'));
    return updatePinPositions({ ...comp, inputs, state });
  }
  const keys = ioPinKeys(comp.type, cfg);
  const old = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(pinKey(comp, p), p);
  const pin = (key: string, type: 'input' | 'output'): CircuitPin => {
    const name = ioPinLabel(comp.type, key);
    const fresh = newPin(comp, key, name, type);
    return { ...pinWithWidth(old.get(key) ?? (type === 'output' ? { ...fresh, value: 0 } : fresh), ioPinWidth(comp.type, key, cfg)), name };
  };
  if (comp.type === 'dipSwitch') {
    state.ioSize = cfg.size;
    state.dipBits = cfg.size >= 32 ? (state.dipBits ?? 0) >>> 0 : ((state.dipBits ?? 0) % 2 ** cfg.size) >>> 0;
  } else if (comp.type === 'ledBar') {
    state.ioSize = cfg.size;
    state.ledBarMode = cfg.ledBarMode;
    state.selectLoc = cfg.selectLoc;
  } else if (comp.type === 'dotMatrix') {
    state.matrixCols = cfg.cols;
    state.matrixRows = cfg.rows;
    state.matrixInput = cfg.matrixInput;
    state.selectLoc = cfg.selectLoc;
  } else if (comp.type === 'hexDigit') {
    state.ioDp = cfg.dp;
  }
  return updatePinPositions({
    ...comp,
    inputs: keys.inputs.map((k) => pin(k, 'input')),
    outputs: keys.outputs.map((k) => pin(k, 'output')),
    state,
  });
}

// ---- TTL chips: settings (Aşama 4) -------------------------------------------------------------------------

export interface TtlConfig {
  /** VCC and GND are pins (evolution 'VccGndPorts') */
  vccGnd: boolean;
}

export function getTtlConfig(comp: CircuitComponentInstance): TtlConfig {
  return { vccGnd: comp.state.ttlVccGnd === true };
}

/** New TTL settings: the VCC / GND pins come and go, every other pin keeps its id (and wires) */
export function configureTtl(comp: CircuitComponentInstance, patch: Partial<TtlConfig>): CircuitComponentInstance {
  const chip = ttlChipOf(comp.type);
  if (!chip) return comp;
  const cfg: TtlConfig = { ...getTtlConfig(comp), ...patch };
  const old = new Map<string, CircuitPin>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(pinKey(comp, p), p);
  const ports = ttlPorts(chip, cfg.vccGnd);
  // An in/out pin is an output (p<n>, powers up floating) plus an input (p<n>in) on the same point
  const pin = (p: { key: string; name: string; pin: number; dir: string }, type: 'input' | 'output'): CircuitPin => {
    const name = `${p.name} (${p.pin})`;
    const key = p.dir === 'inout' && type === 'input' ? ttlInKey(p.pin) : p.key;
    const fresh = newPin(comp, key, name, type);
    const start: SignalValue = p.dir === 'inout' ? 'Z' : 0;
    return { ...(old.get(key) ?? (type === 'output' ? { ...fresh, value: start } : fresh)), name };
  };
  const state = { ...comp.state };
  if (cfg.vccGnd) state.ttlVccGnd = true;
  else delete state.ttlVccGnd;
  return updatePinPositions({
    ...comp,
    inputs: ports.filter((p) => p.dir !== 'output').map((p) => pin(p, 'input')),
    outputs: ports.filter((p) => p.dir !== 'input').map((p) => pin(p, 'output')),
    state,
  });
}

/** DIP switch: flip switch i (0-based); the outputs follow on the next simulation step */
export function toggleDipSwitch(comp: CircuitComponentInstance, i: number): CircuitComponentInstance {
  const n = getIoConfig(comp).size;
  if (i < 0 || i >= n) return comp;
  return { ...comp, state: { ...comp.state, dipBits: ((comp.state.dipBits ?? 0) ^ (1 << i)) >>> 0 } };
}

// A display dot / segment: 1 lit, 0 dark, 'E' Logisim's error colour (an input that is neither 0 nor 1)
export type IoDot = 1 | 0 | 'E';
const dotOf = (v: SignalValue): IoDot => (v === 1 ? 1 : v === 0 ? 0 : 'E');

/**
 * Dots of a dot matrix (or LED bar = 1 row), row-major from the top-left corner, as Logisim's DotMatrix
 * State.setColumn / setRow / setSelect leave them (persistence 0):
 * - column input i: bit k lights row rows-1-k of column i (bit 0 = bottom)
 * - row input i: bit k lights column cols-1-k of row i (bit 0 = rightmost)
 * - select: row r is on when row bit rows-1-r is 1, then column c shows column bit c (bit 0 = leftmost);
 *   a 0 row is dark, any other row value shows the error colour
 */
export function matrixDots(comp: CircuitComponentInstance): IoDot[] {
  const cfg = getIoConfig(comp);
  const bar = comp.type === 'ledBar';
  const cols = bar ? cfg.size : cfg.cols;
  const rows = bar ? 1 : cfg.rows;
  const mode = bar ? (cfg.ledBarMode === 'oneWire' ? 'row' : 'column') : cfg.matrixInput;
  const dots: IoDot[] = new Array<IoDot>(rows * cols).fill('E');
  const at = (key: string, w: number) => readBits(comp.inputs.find((p) => pinKey(comp, p) === key), w);
  if (mode === 'column') {
    for (let c = 0; c < cols; c++) {
      const v = at(bar ? `in${c}` : `c${c}`, rows);
      for (let k = 0; k < rows; k++) dots[(rows - 1 - k) * cols + c] = dotOf(v[k]);
    }
  } else if (mode === 'row') {
    for (let r = 0; r < rows; r++) {
      const v = at(bar ? 'in' : `r${r}`, cols);
      for (let k = 0; k < cols; k++) dots[r * cols + (cols - 1 - k)] = dotOf(v[k]);
    }
  } else {
    const colV = at('col', cols);
    const rowV = at('row', rows);
    for (let r = 0; r < rows; r++) {
      const whole = rowV[rows - 1 - r];
      for (let c = 0; c < cols; c++) dots[r * cols + c] = whole === 1 ? dotOf(colV[c]) : whole === 0 ? 0 : 'E';
    }
  }
  return dots;
}

// Logisim HexDigit: the segments of each value, a..g (a dash for an input with any x / E bit, Logisim 2.7.1)
const HEX_SEGMENTS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x67, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

/**
 * Lit segments of a 7-segment display or hex digit: a, b, c, d, e, f, g, dp. A 7-segment input lights its
 * segment when it is 1 (active high) or when it is anything but 1 (active low, like Logisim: an open input
 * is lit then); a hex digit lights the DP on a 1.
 */
export function segmentsLit(comp: CircuitComponentInstance): boolean[] {
  const dp = comp.state.ioDp ?? true;
  if (comp.type === 'hexDigit') {
    const v = bitsToNumber(readBits(comp.inputs.find((p) => pinKey(comp, p) === 'in'), 4));
    const segs = v === undefined ? 0x40 : HEX_SEGMENTS[v & 15];
    const dpIn = comp.inputs.find((p) => pinKey(comp, p) === 'dp');
    return [...Array.from({ length: 7 }, (_, i) => ((segs >> i) & 1) === 1), dp && dpIn?.value === 1];
  }
  const low = comp.state.ioActiveLow === true;
  const keys = ['inA', 'inB', 'inC', 'inD', 'inE', 'inF', 'inG', 'inDP'];
  return keys.map((k, i) => {
    if (i === 7 && !dp) return false;
    const p = comp.inputs.find((q) => pinKey(comp, q) === k);
    const one = p?.value === 1;
    return low ? !one : one;
  });
}

export function getMultiInputGatePinRelY(count: number, idx: number, height: number): number {
  if (count === 2) return idx === 0 ? 20 : 40;
  if (count === 3) return idx === 0 ? 10 : idx === 1 ? 30 : 50;
  if (count === 4) return idx === 0 ? 10 : idx === 1 ? 20 : idx === 2 ? 40 : 50;
  if (count === 5) return (idx + 1) * 10;
  // More than 5 inputs: 10px apart around the output like Logisim (an even count skips the middle point)
  const mid = multiInputGateHeight(count) / 2;
  void height;
  if (count % 2 === 1) return mid + 10 * (idx - (count - 1) / 2);
  return mid + 10 * (idx - count / 2) + (idx >= count / 2 ? 10 : 0);
}

/** Body height of a logic gate with `count` inputs: 60 up to 5 inputs, then 10px per input (output stays mid-height on the grid) */
export function multiInputGateHeight(count: number): number {
  if (count <= 5) return 60;
  return (count % 2 === 1 ? count + 1 : count + 2) * 10;
}

export function updatePinPositions(comp: CircuitComponentInstance): CircuitComponentInstance {
  if (comp.type === 'subcircuit') {
    const width = 120;
    const maxPins = Math.max(comp.inputs.length, comp.outputs.length);
    const height = Math.max(60, (maxPins + 1) * 20);
    const rot = comp.rotation || 0;
    const cx = width / 2;
    const cy = height / 2;
    const rotatePoint = (relX: number, relY: number) => {
      if (rot === 0) return { x: Math.round(relX / 10) * 10, y: Math.round(relY / 10) * 10 };
      const rad = (rot * Math.PI) / 180;
      const cos = Math.round(Math.cos(rad));
      const sin = Math.round(Math.sin(rad));
      const dx = relX - cx;
      const dy = relY - cy;
      const rx = cx + (dx * cos - dy * sin);
      const ry = cy + (dx * sin + dy * cos);
      return { x: Math.round(rx / 10) * 10, y: Math.round(ry / 10) * 10 };
    };

    const newInputs = comp.inputs.map((pin, idx) => {
      const relY = 20 * (idx + 1);
      const pt = rotatePoint(0, relY);
      return { ...pin, x: comp.x + pt.x, y: comp.y + pt.y };
    });
    const newOutputs = comp.outputs.map((pin, idx) => {
      const relY = 20 * (idx + 1);
      const pt = rotatePoint(width, relY);
      return { ...pin, x: comp.x + pt.x, y: comp.y + pt.y };
    });
    return { ...comp, inputs: newInputs, outputs: newOutputs };
  }

  const meta = COMPONENT_CATALOG[comp.type];
  const rot = comp.rotation || 0;
  const size = getComponentSize(comp);
  const cx = size.width / 2;
  const cy = size.height / 2;
  // A wide switch/LED/constant keeps its pin on the middle of its side
  const sizedPin = WIDE_PIN_TYPES.has(comp.type) && (comp.type === 'constant' || getBitWidth(comp) > 1)
    ? { relX: comp.type === 'led' ? 0 : size.width, relY: Math.round(size.height / 2 / 10) * 10 }
    : undefined;

  const rotatePoint = (relX: number, relY: number) => {
    if (rot === 0) return { x: Math.round(relX / 10) * 10, y: Math.round(relY / 10) * 10 };
    const rad = (rot * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const dx = relX - cx;
    const dy = relY - cy;
    return {
      x: Math.round((cx + (dx * cos - dy * sin)) / 10) * 10,
      y: Math.round((cy + (dx * sin + dy * cos)) / 10) * 10,
    };
  };

  // Splitter (Logisim SplitterParameters, facing east): the combined end on the left, the ends 20px to
  // the right and 10px apart, above it (left-handed), below it (right-handed) or around it (centered)
  if (comp.type === 'splitter') {
    const n = comp.outputs.length;
    const appear = comp.state.splitAppear ?? 'left';
    const combinedY = appear === 'right' ? 0 : appear === 'center' ? 10 * Math.floor(n / 2) : 10 * n;
    const endY0 = appear === 'right' ? 10 : 0;
    const cp = rotatePoint(0, combinedY);
    return {
      ...comp,
      inputs: comp.inputs.map((pin) => ({ ...pin, x: comp.x + cp.x, y: comp.y + cp.y })),
      outputs: comp.outputs.map((pin, i) => {
        const p = rotatePoint(20, endY0 + 10 * i);
        return { ...pin, x: comp.x + p.x, y: comp.y + p.y };
      }),
    };
  }

  if (PLEXER_TYPES.has(comp.type)) {
    const l = plexerLayout(comp);
    const place = (pin: CircuitPin) => {
      const at = l.pins[pinKey(comp, pin)] ?? { x: 0, y: 0 };
      const p = rotatePoint(at.x, at.y);
      return { ...pin, x: comp.x + p.x, y: comp.y + p.y };
    };
    return { ...comp, inputs: comp.inputs.map(place), outputs: comp.outputs.map(place) };
  }

  if (ARITH_TYPES.has(comp.type)) {
    const g = arithLayout(comp);
    const place = (pin: CircuitPin) => {
      const at = g.pins[pinKey(comp, pin)] ?? { x: 0, y: 0 };
      const p = rotatePoint(at.x, at.y);
      return { ...pin, x: comp.x + p.x, y: comp.y + p.y };
    };
    return { ...comp, inputs: comp.inputs.map(place), outputs: comp.outputs.map(place) };
  }
  const ttlChip = ttlChipOf(comp.type);
  if (ttlChip) {
    const place = (pin: CircuitPin) => {
      const n = ttlPinOfKey(pinKey(comp, pin));
      const at = n >= 1 && n <= ttlChip.pins ? ttlPinPoint(ttlChip, n) : { x: 0, y: 0 };
      const p = rotatePoint(at.x, at.y);
      return { ...pin, x: comp.x + p.x, y: comp.y + p.y };
    };
    return { ...comp, inputs: comp.inputs.map(place), outputs: comp.outputs.map(place) };
  }
  if (MEM_TYPES.has(comp.type) || RAM_TYPES.has(comp.type) || IO_TYPES.has(comp.type) || IO5_TYPES.has(comp.type) || BFH_TYPES.has(comp.type) || IO5C_TYPES.has(comp.type) || comp.type === 'rgbVideo') {
    const g = MEM_TYPES.has(comp.type)
      ? memLayout(comp)
      : RAM_TYPES.has(comp.type)
        ? ramGeometry(comp.type, getRamConfig(comp))
        : IO5_TYPES.has(comp.type)
          ? io5Geometry(comp.type, getIo5Config(comp))
          : BFH_TYPES.has(comp.type)
            ? bfhGeometry(comp.type, binToBcdBits(comp))
            : IO5C_TYPES.has(comp.type)
              ? io5cGeometry(comp.type, getIo5cConfig(comp))
              : comp.type === 'rgbVideo'
                ? videoGeometry(getVideoConfig(comp))
                : ioGeometry(comp.type, getIoConfig(comp));
    const place = (pin: CircuitPin) => {
      const at = g.pins[pinKey(comp, pin)] ?? { x: 0, y: 0 };
      const p = rotatePoint(at.x, at.y);
      return { ...pin, x: comp.x + p.x, y: comp.y + p.y };
    };
    return { ...comp, inputs: comp.inputs.map(place), outputs: comp.outputs.map(place) };
  }

  const isMultiInputGate = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'].includes(comp.type);

  const newInputs = comp.inputs.map((pin, idx) => {
    let relX = 0;
    let relY = 0;
    let pinSuffix = `in${idx}`;
    if (isMultiInputGate) {
      relX = 0;
      relY = getMultiInputGatePinRelY(comp.inputs.length, idx, size.height);
      pinSuffix = meta.inputs[idx]?.id || `in${idx}`;
    } else {
      const pinDef = meta.inputs[idx] || { relX: 0, relY: 0, id: `in${idx}` };
      relX = sizedPin?.relX ?? pinDef.relX;
      relY = sizedPin?.relY ?? pinDef.relY;
      pinSuffix = pinDef.id || `in${idx}`;
    }
    const p = rotatePoint(relX, relY);
    const canonicalId = `${comp.id}_${pinSuffix}`;
    const pinId = isMultiInputGate ? canonicalId : (pin.id.startsWith(`${comp.id}_`) ? pin.id : canonicalId);
    return { ...pin, id: pinId, x: comp.x + p.x, y: comp.y + p.y };
  });

  const newOutputs = comp.outputs.map((pin, idx) => {
    const defaultRelY = Math.round((meta.height / 2) / 10) * 10;
    const pinDef = meta.outputs[idx] || { relX: meta.width, relY: defaultRelY, id: idx === 0 ? 'out' : `out${idx}` };
    // A tall gate keeps its output in the middle of its side
    const rawRelY = isMultiInputGate && size.height !== meta.height ? size.height / 2 : pinDef.relY !== undefined ? pinDef.relY : defaultRelY;
    const p = rotatePoint(sizedPin?.relX ?? pinDef.relX, sizedPin?.relY ?? rawRelY);
    const pinSuffix = pinDef.id || (idx === 0 ? 'out' : `out${idx}`);
    const canonicalId = `${comp.id}_${pinSuffix}`;
    const pinId = isMultiInputGate ? canonicalId : (pin.id.startsWith(`${comp.id}_`) ? pin.id : canonicalId);
    return { ...pin, id: pinId, x: comp.x + p.x, y: comp.y + p.y };
  });

  return {
    ...comp,
    inputs: newInputs,
    outputs: newOutputs,
  };
}

// Body sizes for the wire auto-router (same geometry updatePinPositions uses)
setComponentBodySizeResolver((comp) => (comp.type === 'subcircuit' || COMPONENT_CATALOG[comp.type] ? getComponentSize(comp) : null));

/**
 * Propagate logic values across wires and components
 */
// Logisim value algebra for gates: a floating or unknown input is not a valid level, so it
// turns into E unless a controlling value (0 for AND, 1 for OR) decides the output anyway
const isLevel = (v: SignalValue): v is 0 | 1 => v === 0 || v === 1;
const sigNot = (a: SignalValue): SignalValue => (isLevel(a) ? (a === 1 ? 0 : 1) : 'E');
const sigAnd = (a: SignalValue, b: SignalValue): SignalValue =>
  a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : 'E';
const sigOr = (a: SignalValue, b: SignalValue): SignalValue =>
  a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : 'E';
const sigXor = (a: SignalValue, b: SignalValue): SignalValue =>
  isLevel(a) && isLevel(b) ? ((a ^ b) as 0 | 1) : 'E';

// Bits an input pin reads (LSB first): undriven or open bits are x, like Logisim's unknown value
const readBits = (pin: CircuitPin | undefined, w: number): SignalValue[] => {
  const raw = pin?.bits && pin.bits.length === w ? pin.bits : w === 1 && pin ? [pin.value] : new Array<SignalValue>(w).fill('X');
  return raw.map((b) => (b === 'Z' ? 'X' : b));
};


// Parts whose pins take the width of the net they sit on instead of setting it
const WIDTH_FOLLOWERS = new Set<ComponentType>(['tunnel', 'probe', 'pullResistor']);

// Same bit arrays (both absent counts as same)
export const sameBits = (a: SignalValue[] | undefined, b: SignalValue[] | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// Logisim reads separate select/address pins as one bus: any E bit makes it an error, any other
// undefined bit (x or floating) makes it unknown
const busValue = (vals: SignalValue[]): number | 'X' | 'E' => {
  if (vals.some((v) => v === 'E')) return 'E';
  if (!vals.every(isLevel)) return 'X';
  return vals.reduce<number>((acc, v, i) => acc | ((v as number) << i), 0);
};

// Logisim's adder (Adder.computeSum): a carry-in that is x or floating counts as 0; an E or
// undefined bit makes that sum bit E or x, and the carry spreads it to every higher bit
const logisimSum = (a: SignalValue[], b: SignalValue[], cin: SignalValue): { sum: SignalValue[]; carry: SignalValue } => {
  let carry: SignalValue = cin === 'X' || cin === 'Z' ? 0 : cin;
  const sum: SignalValue[] = [];
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (carry === 'E' || carry === 'X') {
      sum.push(carry);
    } else if (ai === 'E' || bi === 'E') {
      sum.push('E');
      carry = 'E';
    } else if (!isLevel(ai) || !isLevel(bi) || !isLevel(carry)) {
      sum.push('X');
      carry = 'X';
    } else {
      const s: number = ai + bi + carry;
      sum.push((s & 1) as 0 | 1);
      carry = s >= 2 ? 1 : 0;
    }
  }
  return { sum, carry };
};

// Logisim's subtractor: A + NOT B + NOT Bin, borrow = NOT carry (NOT of a non-level is E,
// so an undefined B gives E); a borrow-in that is x or floating counts as 0
const logisimDiff = (a: SignalValue[], b: SignalValue[], bin: SignalValue): { diff: SignalValue[]; borrow: SignalValue } => {
  const { sum, carry } = logisimSum(a, b.map(sigNot), sigNot(bin === 'X' || bin === 'Z' ? 0 : bin));
  return { diff: sum, borrow: sigNot(carry) };
};

// Gates power up unknown like in Logisim, so feedback loops such as a NAND latch only settle
// once something drives them; combinational logic overwrites the X on the first step
// Parts with Logisim's "Output Value" attribute
export const OUTPUT_MODE_TYPES = ['not', 'buffer', 'and', 'or', 'nand', 'nor', 'xor', 'xnor'];
// 0/floating leaves the net on a 1, floating/1 on a 0; x and E pass unchanged (Logisim pullOutput)
const gateOutput = (comp: CircuitComponentInstance, v: SignalValue): SignalValue =>
  (comp.state.outputMode === '0Z' && v === 1) || (comp.state.outputMode === 'Z1' && v === 0) ? 'Z' : v;

const POWER_UP_X_TYPES = new Set<string>(['not', 'buffer', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'triState', 'controlledInverter']);


// Gate outputs Logisim computes bit by bit with the 1-bit rules (Value.and/or/xor/not on each bit)
const logicGateBits = (comp: CircuitComponentInstance, connected: CircuitPin[], w: number): SignalValue[] => {
  // No connected input: Logisim gives an error value of the gate's width
  if (connected.length === 0) return new Array<SignalValue>(w).fill('E');
  const negated = comp.state.negated;
  const ins = connected.map((p) => {
    const bits = readBits(p, w);
    return negated?.includes(comp.inputs.indexOf(p)) ? bits.map(sigNot) : bits;
  });
  const t = comp.type;
  const invert = t === 'nand' || t === 'nor' || t === 'xnor';
  const one = (t === 'xor' || t === 'xnor') && comp.state.xorMode === 'one';
  const out: SignalValue[] = [];
  for (let b = 0; b < w; b++) {
    const col = ins.map((bits) => bits[b]);
    let v: SignalValue;
    if (t === 'and' || t === 'nand') v = col.reduce((acc, x) => sigAnd(acc, x));
    else if (t === 'or' || t === 'nor') v = col.reduce((acc, x) => sigOr(acc, x));
    else if (one) {
      // Exactly one 1 (GateFunctions.computeExactlyOne): any undefined bit makes it E
      v = col.every(isLevel) ? (col.filter((x) => x === 1).length === 1 ? 1 : 0) : 'E';
    } else {
      // Odd parity; a single input passes as it is (x stays x) like Logisim's computeOddParity
      v = col.reduce((acc, x) => sigXor(acc, x));
    }
    out.push(gateOutput(comp, invert ? sigNot(v) : v));
  }
  return out;
};

// ---- Gate width (Logisim 'Data Bits' of the gates library) -----------------------------------------------
export const GATE_WIDTH_TYPES: ComponentType[] = ['not', 'buffer', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'triState', 'controlledInverter'];
// Controlled buffer / inverter: the data pin and the output take the width, the control pin stays 1 bit
const isGateDataPin = (comp: CircuitComponentInstance, inputIdx: number) =>
  (comp.type !== 'triState' && comp.type !== 'controlledInverter') || inputIdx === 0;

export function getGateWidth(comp: CircuitComponentInstance): number {
  return comp.outputs[0]?.width ?? 1;
}

// New gate width: pins keep their place and id, only their width changes (values restart unknown)
export function setGateWidth(comp: CircuitComponentInstance, width: number): CircuitComponentInstance {
  const w = Math.max(1, Math.min(MAX_BIT_WIDTH, Math.round(width)));
  const pinW = (p: CircuitPin, value: SignalValue): CircuitPin => {
    const { bits: _bits, width: _width, ...rest } = p;
    return w > 1 ? { ...rest, width: w, value } : { ...rest, value };
  };
  return {
    ...comp,
    inputs: comp.inputs.map((p, i) => (isGateDataPin(comp, i) ? pinW(p, 0) : p)),
    outputs: comp.outputs.map((p) => pinW(p, 'X')),
  };
}

export function simulateCircuitStep(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): {
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  hasChanged: boolean;
} {
  let hasChanged = false;

  // Clone components and wires for pure evaluation
  const newComps: CircuitComponentInstance[] = components.map((c) => ({
    ...c,
    inputs: c.inputs.map((p) => ({ ...p })),
    outputs: c.outputs.map((p) => ({ ...p })),
    state: { ...c.state },
  }));

  const newWires: CircuitWire[] = wires.map((w) => ({ ...w }));

  // Helper map to quickly lookup pins
  const pinMap = new Map<string, CircuitPin>();
  const pinOwner = new Map<string, CircuitComponentInstance>();
  newComps.forEach((c) => {
    c.inputs.forEach((p) => {
      pinMap.set(p.id, p);
      pinOwner.set(p.id, c);
    });
    c.outputs.forEach((p) => {
      pinMap.set(p.id, p);
      pinOwner.set(p.id, c);
    });
  });

  // A wide source drives its number as bits
  const driveNumber = (comp: CircuitComponentInstance, n: number) => {
    const out = comp.outputs[0];
    if (!out) return;
    const w = out.width ?? 1;
    if (w === 1) {
      const v: SignalValue = n % 2 === 1 ? 1 : 0;
      if (out.value !== v) {
        out.value = v;
        hasChanged = true;
      }
      return;
    }
    const bits = numberToBits(n, w);
    if (!sameBits(out.bits, bits)) {
      out.bits = bits;
      out.value = summarizeBits(bits);
      hasChanged = true;
    }
  };

  // Step 1: Update source components outputs (switch, vcc, gnd, clock)
  newComps.forEach((comp) => {
    const portBits = comp.state.portBits;
    if (comp.type === 'switch' && portBits && portBits.length > 1 && comp.outputs[0]) {
      // A wide IC port inside: the outside bits as they are (x/E/Z included)
      const out = comp.outputs[0];
      if (!sameBits(out.bits, portBits)) {
        out.bits = [...portBits];
        out.value = summarizeBits(portBits);
        hasChanged = true;
      }
    } else if (comp.type === 'switch' && (comp.outputs[0]?.width ?? 1) > 1) {
      driveNumber(comp, comp.state.inputValue ?? 0);
    } else if (comp.type === 'constant') {
      driveNumber(comp, comp.state.constValue ?? 1);
    } else if (comp.type === 'switch') {
      const targetVal: SignalValue = comp.state.portValue ?? (comp.state.on ? 1 : 0);
      if (comp.outputs[0] && comp.outputs[0].value !== targetVal) {
        comp.outputs[0].value = targetVal;
        hasChanged = true;
      }
    } else if (comp.type === 'pushbutton') {
      const targetVal: SignalValue = comp.state.portValue ?? (comp.state.on ? 1 : 0);
      if (comp.outputs[0] && comp.outputs[0].value !== targetVal) {
        comp.outputs[0].value = targetVal;
        hasChanged = true;
      }
    } else if (comp.type === 'clock') {
      const targetVal: SignalValue = comp.state.portValue ?? (comp.state.on ? 1 : 0);
      if (comp.outputs[0] && comp.outputs[0].value !== targetVal) {
        comp.outputs[0].value = targetVal;
        hasChanged = true;
      }
    } else if (comp.type === 'vcc') {
      if (comp.outputs[0] && comp.outputs[0].value !== 1) {
        comp.outputs[0].value = 1;
        hasChanged = true;
      }
    } else if (comp.type === 'gnd') {
      if (comp.outputs[0] && comp.outputs[0].value !== 0) {
        comp.outputs[0].value = 0;
        hasChanged = true;
      }
    } else if (comp.type === 'dipSwitch') {
      const bits = comp.state.dipBits ?? 0;
      comp.outputs.forEach((p, i) => {
        const targetVal: SignalValue = (bits >>> i) & 1 ? 1 : 0;
        if (p.value !== targetVal) {
          p.value = targetVal;
          hasChanged = true;
        }
      });
    } else if (comp.type === 'asciiKeyboard') {
      const code = comp.state.asciiCode ?? 65;
      const strobeVal: SignalValue = comp.state.strobe ? 1 : 0;
      for (let i = 0; i < 7; i++) {
        const targetBit: SignalValue = (code & (1 << i)) ? 1 : 0;
        if (comp.outputs[i] && comp.outputs[i].value !== targetBit) {
          comp.outputs[i].value = targetBit;
          hasChanged = true;
        }
      }
      if (comp.outputs[7] && comp.outputs[7].value !== strobeVal) {
        comp.outputs[7].value = strobeVal;
        hasChanged = true;
      }
    }
  });

  // Step 2: Propagate output values into connected input pins via electrical nets & detect bus contention (Electrical Net Conflict)
  const parent = new Map<string, string>();
  function findRoot(pinId: string): string {
    if (!parent.has(pinId)) parent.set(pinId, pinId);
    let curr = pinId;
    while (curr !== parent.get(curr)) {
      const p = parent.get(curr)!;
      parent.set(curr, parent.get(p)!);
      curr = p;
    }
    return curr;
  }
  function unionPins(a: string, b: string) {
    const rootA = findRoot(a);
    const rootB = findRoot(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  }

  // Connect pins to their 10px snapped grid locations (Logisim CircuitWires coordinate connectivity)
  pinMap.forEach((pin, pinId) => {
    const gx = Math.round(pin.x / 10) * 10;
    const gy = Math.round(pin.y / 10) * 10;
    unionPins(pinId, `loc_${gx}_${gy}`);
  });

  // Connect pins and grid locations via wires
  newWires.forEach((w) => {
    if (w.startPoint && w.endPoint) {
      const sx = Math.round(w.startPoint.x / 10) * 10;
      const sy = Math.round(w.startPoint.y / 10) * 10;
      const ex = Math.round(w.endPoint.x / 10) * 10;
      const ey = Math.round(w.endPoint.y / 10) * 10;
      const ks = `loc_${sx}_${sy}`;
      const ke = `loc_${ex}_${ey}`;
      unionPins(ks, ke);
    } else {
      if (w.fromPinId && w.toPinId) {
        unionPins(w.fromPinId, w.toPinId);
      }
      if (w.branchPoint && w.toPinId) {
        const bx = Math.round(w.branchPoint.x / 10) * 10;
        const by = Math.round(w.branchPoint.y / 10) * 10;
        unionPins(`loc_${bx}_${by}`, w.toPinId);
      }
    }
  });

  // Connect matching Tunnels wirelessly into the same electrical net (Global Net Wireless Bus)
  const tunnelsByLabel = new Map<string, string[]>();
  newComps
    .filter((c) => c.type === 'tunnel')
    .forEach((t) => {
      const lbl = (t.label || 'Tünel').trim();
      if (!tunnelsByLabel.has(lbl)) tunnelsByLabel.set(lbl, []);
      const inPin = t.inputs[0]?.id;
      const outPin = t.outputs[0]?.id;
      if (inPin && outPin) unionPins(inPin, outPin);
      if (inPin) tunnelsByLabel.get(lbl)!.push(inPin);
    });
  tunnelsByLabel.forEach((pinIds) => {
    for (let i = 1; i < pinIds.length; i++) {
      if (pinIds[0] && pinIds[i]) unionPins(pinIds[0], pinIds[i]);
    }
  });

  // Group pins and wires by root net
  const netPins = new Map<string, string[]>();
  pinMap.forEach((_, pinId) => {
    const root = findRoot(pinId);
    if (!netPins.has(root)) netPins.set(root, []);
    netPins.get(root)!.push(pinId);
  });

  const netWires = new Map<string, CircuitWire[]>();
  newWires.forEach((w) => {
    const key = w.startPoint
      ? `loc_${Math.round(w.startPoint.x / 10) * 10}_${Math.round(w.startPoint.y / 10) * 10}`
      : w.fromPinId || w.id;
    const root = findRoot(key);
    if (!netWires.has(root)) netWires.set(root, []);
    netWires.get(root)!.push(w);
    if (!netPins.has(root)) netPins.set(root, []);
  });

  // Active driving output pins: a high-impedance tri-state buffer and the passive tunnel conduits don't drive
  const isDriver = (pinId: string): boolean => {
    const pin = pinMap.get(pinId);
    if (!pin || pin.type !== 'output') return false;
    const ownerComp = pinOwner.get(pinId);
    if ((ownerComp?.type === 'triState' || ownerComp?.type === 'controlledInverter') && ownerComp.state.hiZ) return false;
    // Tunnels and splitters are passive: a splitter only joins bit threads (bitLinks below)
    return ownerComp?.type !== 'tunnel' && ownerComp?.type !== 'splitter';
  };
  // Logisim pull resistors only act on a net nothing drives to a defined value: one level pulls
  // it there, differing pulls (or an X pull) make it E
  const netPulls = (pinsInNet: string[]): Set<SignalValue> => {
    const pulls = new Set<SignalValue>();
    pinsInNet.forEach((pinId) => {
      const owner = pinOwner.get(pinId);
      if (owner?.type === 'pullResistor') pulls.add(owner.state.pullValue === 1 ? 1 : owner.state.pullValue === 'X' ? 'E' : 0);
      // TTL pins with a built-in pull-up (evolution setPullPorts, 7447 BI/RBO)
      const chip = owner ? ttlChipOf(owner.type) : undefined;
      if (chip?.pullUp && owner) {
        const pin = [...owner.inputs, ...owner.outputs].find((q) => q.id === pinId);
        if (pin && chip.pullUp.includes(ttlPinOfKey(pinKey(owner, pin)))) pulls.add(1);
      }
    });
    return pulls;
  };
  const applyPulls = (v: SignalValue, pulls: Set<SignalValue>): SignalValue =>
    (v === 'Z' || v === 'X') && pulls.size > 0 ? (pulls.size === 1 ? pulls.values().next().value! : 'E') : v;
  // Differing driven values (x/z don't count) short each other out
  const isConflict = (vals: SignalValue[]): boolean => new Set(vals.filter((v) => v !== 'Z' && v !== 'X')).size > 1;

  // Width of each net from the pins on it (Logisim CircuitWires bundle widths); tunnels, probes and
  // pull resistors take the width of the net they sit on. 0 = pins of different widths meet (Logisim
  // "Incompatible widths": the whole net reads x)
  const netWidth = new Map<string, number>();
  const netWidthList = new Map<string, number[]>();
  netPins.forEach((pinsInNet, root) => {
    const widths = new Set<number>();
    pinsInNet.forEach((pinId) => {
      const owner = pinOwner.get(pinId);
      if (owner && WIDTH_FOLLOWERS.has(owner.type)) return;
      const w = pinMap.get(pinId)!.width ?? 1;
      // A splitter end with no bits mapped to it carries nothing (Logisim width-0 end)
      if (w > 0) widths.add(w);
    });
    if (widths.size > 1) {
      netWidth.set(root, 0);
      netWidthList.set(root, [...widths].sort((a, b) => a - b));
    } else {
      netWidth.set(root, widths.size === 1 ? [...widths][0] : 1);
    }
  });

  // Bit links between nets, [netA, bitA, netB, bitB] (Logisim splitters unite the threads of their
  // ends); nets on a link, and every net wider than 1, are resolved bit by bit below
  const bitLinks: [string, number, string, number][] = [];
  newComps.forEach((c) => {
    if (c.type !== 'splitter' || !c.inputs[0]) return;
    const { fanout, bitEnd } = getSplitterConfig(c);
    const { thread } = splitterThreads(bitEnd, fanout);
    const combined = findRoot(c.inputs[0].id);
    bitEnd.forEach((e, i) => {
      const end = e > 0 ? c.outputs[e - 1] : undefined;
      if (end) bitLinks.push([combined, i, findRoot(end.id), thread[i]]);
    });
  });
  const linkedNets = new Set<string>();
  bitLinks.forEach(([a, , b]) => {
    linkedNets.add(a);
    linkedNets.add(b);
  });

  // Write a net's resolved value to its wires and to the pins reading it (inputs and passive tunnel pins)
  const assignNet = (root: string, value: SignalValue, bits: SignalValue[] | undefined, hasConflict: boolean, widthError: boolean) => {
    (netWires.get(root) || []).forEach((w) => {
      if (w.hasConflict !== hasConflict) {
        w.hasConflict = hasConflict;
        hasChanged = true;
      }
      if (w.value !== value) {
        w.value = value;
        hasChanged = true;
      }
      if (!sameBits(w.bits, bits)) {
        w.bits = bits;
        w.width = bits ? bits.length : undefined;
        hasChanged = true;
      }
      if (!!w.widthError !== widthError) {
        w.widthError = widthError || undefined;
        hasChanged = true;
      }
      const widthList = widthError ? netWidthList.get(root) : undefined;
      if (String(w.widthList ?? '') !== String(widthList ?? '')) {
        w.widthList = widthList;
        hasChanged = true;
      }
    });
    netPins.get(root)!.forEach((pinId) => {
      const pin = pinMap.get(pinId);
      if (!pin) return;
      const ownerComp = pinOwner.get(pinId);
      if (pin.type === 'input' || ownerComp?.type === 'tunnel') {
        if (pin.value !== value) {
          pin.value = value;
          hasChanged = true;
        }
        // A wide pin on a net of the wrong width reads all bits x
        const pinBits = bits ?? (widthError && (pin.width ?? 1) > 1 ? new Array<SignalValue>(pin.width!).fill('X') : undefined);
        if (!sameBits(pin.bits, pinBits)) {
          pin.bits = pinBits;
          hasChanged = true;
        }
      }
    });
  };

  // Evaluate each 1-bit electrical net (nets of the wrong width read x)
  netPins.forEach((pinsInNet, root) => {
    const width = netWidth.get(root)!;
    if (width === 0) {
      assignNet(root, 'X', undefined, false, true);
      return;
    }
    if (width > 1 || linkedNets.has(root)) return;

    const driverVals = pinsInNet.filter(isDriver).map((id) => pinMap.get(id)!.value);
    // Logisim value model: floating and unknown drivers don't count (x combined with 1 is 1),
    // an undriven net floats (Z) or stays unknown (X), and differing driven values short each other out (E)
    const resolvedValue = applyPulls(resolveDrivers(driverVals), netPulls(pinsInNet));
    assignNet(root, resolvedValue, undefined, isConflict(driverVals), false);
  });

  // Multi-bit and linked nets: each bit is its own net (a Logisim wire thread), joined across links
  const bitParent = new Map<string, string>();
  const bitFind = (k: string): string => {
    let r = k;
    while (bitParent.has(r) && bitParent.get(r) !== r) r = bitParent.get(r)!;
    if (r !== k) bitParent.set(k, r);
    return r;
  };
  bitLinks.forEach(([a, ba, b, bb]) => {
    // Links into a net of the wrong width (or past its width) are dropped, as Logisim skips invalid bundles
    if (netWidth.get(a)! <= ba || netWidth.get(b)! <= bb) return;
    const ra = bitFind(`${a}#${ba}`);
    const rb = bitFind(`${b}#${bb}`);
    if (ra !== rb) bitParent.set(ra, rb);
  });
  const bitNets: string[] = [];
  netPins.forEach((_, root) => {
    const width = netWidth.get(root)!;
    if (width > 1 || (width === 1 && linkedNets.has(root))) bitNets.push(root);
  });
  if (bitNets.length > 0) {
    const threads = new Map<string, [string, number][]>();
    bitNets.forEach((root) => {
      for (let b = 0; b < netWidth.get(root)!; b++) {
        const key = bitFind(`${root}#${b}`);
        if (!threads.has(key)) threads.set(key, []);
        threads.get(key)!.push([root, b]);
      }
    });
    const threadValue = new Map<string, { value: SignalValue; conflict: boolean }>();
    threads.forEach((members, key) => {
      const driverVals: SignalValue[] = [];
      const pulls = new Set<SignalValue>();
      members.forEach(([root, b]) => {
        const pinsInNet = netPins.get(root)!;
        pinsInNet.forEach((id) => {
          if (isDriver(id)) {
            const pin = pinMap.get(id)!;
            driverVals.push(pin.bits?.[b] ?? pin.value);
          }
        });
        netPulls(pinsInNet).forEach((p) => pulls.add(p));
      });
      threadValue.set(key, { value: applyPulls(resolveDrivers(driverVals), pulls), conflict: isConflict(driverVals) });
    });
    bitNets.forEach((root) => {
      const width = netWidth.get(root)!;
      const bits: SignalValue[] = [];
      let conflict = false;
      for (let b = 0; b < width; b++) {
        const t = threadValue.get(bitFind(`${root}#${b}`))!;
        bits.push(t.value);
        conflict = conflict || t.conflict;
      }
      if (width === 1) assignNet(root, bits[0], undefined, conflict, false);
      else assignNet(root, summarizeBits(bits), bits, conflict, false);
    });
  }

  // Helper to determine if a pin is electrically connected to a wire or other pin
  const isPinConnected = (pinId: string): boolean => {
    const root = findRoot(pinId);
    const wiresCount = netWires.get(root)?.length || 0;
    if (wiresCount > 0) return true;
    const pins = netPins.get(root);
    if (pins && pins.length > 1) return true;
    return false;
  };

  // Step 3: Compute gate/block outputs based on their current inputs
  newComps.forEach((comp) => {
    const inVals = comp.inputs.map((p) => (p.value === 1 ? 1 : 0));
    const raw = comp.inputs.map((p) => p.value);
    const setOut = (idx: number, val: SignalValue) => {
      if (comp.outputs[idx] && comp.outputs[idx].value !== val) {
        comp.outputs[idx].value = val;
        hasChanged = true;
      }
    };
    // A multi-bit output takes its bits (a 1-bit one just its value)
    const setBitsOut = (idx: number, bits: SignalValue[]) => {
      const out = comp.outputs[idx];
      if (!out) return;
      if (bits.length === 1) {
        setOut(idx, bits[0]);
        return;
      }
      if (!sameBits(out.bits, bits)) {
        out.bits = bits;
        out.value = summarizeBits(bits);
        hasChanged = true;
      }
    };
    // In Logisim, multi-input logic gates ignore unconnected (floating) input pins
    const connectedInputs = comp.inputs.filter((p) => isPinConnected(p.id));

    const ttlChip = ttlChipOf(comp.type);
    if (ttlChip) {
      // Evolution AbstractTtlGate.propagate: inputs read as Logisim values (an open pin is x)
      const byKey = new Map(comp.inputs.map((p) => [pinKey(comp, p), p]));
      // A sequential chip works on a copy of its stored state (the previous step's part may share the old object)
      const prev = comp.state.ttlSeq;
      const st = ttlChip.seq ? (prev ? ttlSeqCopy(prev) : ttlSeqInit(ttlChip)) : undefined;
      const outs = evalTtl(ttlChip, comp.state.ttlVccGnd === true, (key) => readBits(byKey.get(key), 1)[0], st, {
        ...ttlRcOf(comp.state),
        now: ttlNow(),
      });
      if (st) comp.state.ttlSeq = st;
      comp.outputs.forEach((p, i) => {
        const v = outs.get(pinKey(comp, p));
        if (v !== undefined) setOut(i, v);
      });
      return;
    }

    switch (comp.type) {
      case 'joystick': {
        const bits = getIo5Config(comp).joyBits;
        setBitsOut(0, numberToBits(joystickValue(comp.state.joyX ?? 0, bits), bits));
        setBitsOut(1, numberToBits(joystickValue(comp.state.joyY ?? 0, bits), bits));
        break;
      }
      case 'matrixKeypad': {
        const cols = keypadColumns(comp.state.keypadPressed ?? 0, getIo5Config(comp).keypadMode, comp.inputs.map((p) => readBits(p, 1)[0]));
        cols.forEach((v, i) => setOut(i, v));
        break;
      }
      case 'portIo': {
        const pinOf = (k: string) => comp.inputs.find((p) => pinKey(comp, p) === k);
        const isOpen = (k: string) => {
          const p = pinOf(k);
          return !!p && !isPinConnected(p.id);
        };
        const open = (isOpen('en') ? 1 : 0) | (isOpen('in') ? 2 : 0);
        if ((comp.state.portOpen ?? 0) !== open) comp.state = { ...comp.state, portOpen: open || undefined };
        if (comp.outputs.length) setBitsOut(0, portIoPins(comp));
        break;
      }
      case 'realTimeClock':
        setBitsOut(0, numberToBits(rtcValue(getIo5Config(comp).rtcType), 32));
        break;
      case 'keyboard': {
        // Keyboard.propagate: the clock level is always recorded; CLR = 1 empties the buffer, otherwise an edge
        // (RE not 0) takes the first character; OUT = its low 7 bits, AV = 1 unless it is NUL (or the buffer is empty)
        const pinOf = (k: string) => comp.inputs.find((p) => pinKey(comp, p) === k);
        const clk = readBits(pinOf('clk'), 1)[0];
        const prev = comp.state.lastClk;
        comp.state.lastClk = clk;
        let buf = comp.state.kbdBuf ?? '';
        if (readBits(pinOf('clr'), 1)[0] === 1) {
          if (buf !== '' || comp.state.kbdCursor) {
            comp.state.kbdBuf = '';
            comp.state.kbdCursor = 0;
          }
          buf = '';
        } else if (readBits(pinOf('en'), 1)[0] !== 0 && buf !== '') {
          const go = comp.state.trigger === 'falling' ? prev === 1 && clk === 0 : prev === 0 && clk === 1;
          if (go) {
            buf = buf.slice(1);
            comp.state.kbdBuf = buf;
            if ((comp.state.kbdCursor ?? 0) > 0) comp.state.kbdCursor = (comp.state.kbdCursor ?? 0) - 1;
          }
        }
        const c = buf === '' ? 0 : buf.charCodeAt(0);
        comp.outputs.forEach((p, i) => {
          if (pinKey(comp, p) === 'avl') setOut(i, c !== 0 ? 1 : 0);
          else setBitsOut(i, numberToBits(c & 0x7f, 7));
        });
        break;
      }
      case 'tty': {
        // Tty.propagate: CLR = 1 clears the screen, otherwise an edge (WE not 0) writes the input character, '?'
        // when the input is not fully defined
        const pinOf = (k: string) => comp.inputs.find((p) => pinKey(comp, p) === k);
        const cfg = getIo5cConfig(comp);
        const clk = readBits(pinOf('clk'), 1)[0];
        const prev = comp.state.lastClk;
        comp.state.lastClk = clk;
        if (readBits(pinOf('clr'), 1)[0] === 1) {
          const t = ttyStateOf(comp.state, cfg);
          if (t.ttyRow !== 0 || t.ttyLast !== '' || t.ttyLines.some((l) => l !== '')) {
            comp.state.ttyLines = t.ttyLines.map(() => '');
            comp.state.ttyRow = 0;
            comp.state.ttyLast = '';
          }
        } else if (readBits(pinOf('we'), 1)[0] !== 0) {
          const go = comp.state.trigger === 'falling' ? prev === 1 && clk === 0 : prev === 0 && clk === 1;
          if (go) {
            const code = bitsToNumber(readBits(pinOf('in'), 7)) ?? 63;
            const t = ttyAdd(ttyStateOf(comp.state, cfg), cfg.ttyCols, code);
            comp.state.ttyLines = t.ttyLines;
            comp.state.ttyRow = t.ttyRow;
            comp.state.ttyLast = t.ttyLast;
          }
        }
        break;
      }
      case 'telnet': {
        // Telnet.propagate. Evolution runs it only when an input changes, a byte arrives or a setting changes, and
        // sets the outputs from the buffer BEFORE the clock edge acts, so after an edge they stay as they were until
        // the next such event (here: the input signature or telnetDirty). It reads its trigger from StdAttr.TRIGGER,
        // which its attribute set does not have (it has EDGE_TRIGGER), so it always acts on the rising edge.
        // OUT is x while RD is not 1 (evolution sets a 1-bit unknown on the 8-bit port: a pin shows it unknown,
        // while a splitter would read bits 1-7 as errors). Sent: the input byte; 0 for an input wired to nothing
        // (NIL), 255 for an undefined one (toLongValue() = -1).
        const pinOf = (k: string) => comp.inputs.find((p) => pinKey(comp, p) === k);
        const inPin = pinOf('in');
        const inBits = readBits(inPin, 8);
        const open = !inPin || !isPinConnected(inPin.id);
        const clk = readBits(pinOf('clk'), 1)[0];
        const wr = readBits(pinOf('wr'), 1)[0];
        const rd = readBits(pinOf('rd'), 1)[0];
        const sig = `${open ? 'N' : inBits.join('')}|${clk}|${wr}|${rd}`;
        if (sig === comp.state.telnetSig && !comp.state.telnetDirty) break;
        comp.state.telnetSig = sig;
        comp.state.telnetDirty = undefined;
        const prev = comp.state.lastClk;
        comp.state.lastClk = clk;
        const rx = comp.state.telnetRx ?? '';
        comp.outputs.forEach((p, i) => {
          if (pinKey(comp, p) === 'av') setOut(i, rx !== '' ? 1 : 0);
          else setBitsOut(i, rd === 1 ? numberToBits(rx === '' ? 0xff : rx.charCodeAt(0), 8) : new Array<SignalValue>(8).fill('X'));
        });
        if (prev === 0 && clk === 1) {
          if (wr === 1) {
            const v = open ? 0 : (bitsToNumber(inBits) ?? 0xff);
            const tx = (comp.state.telnetTx ?? '') + String.fromCharCode(v);
            comp.state.telnetTx = tx.length > TELNET_TX_KEEP ? tx.slice(tx.length - TELNET_TX_KEEP) : tx;
            comp.state.telnetTxCount = (comp.state.telnetTxCount ?? 0) + 1;
          }
          if (rd === 1 && rx !== '') comp.state.telnetRx = rx.slice(1);
        }
        break;
      }
      case 'rgbVideo': {
        // Video.propagate: X, Y and DATA are read every run (an undefined value is -1, an unwired end reads NIL = 0)
        // and kept for the cursor. State.tick counts a run as a rising edge when there is no previous clock level
        // (a new State: first run, new size) or the clock went 0 -> 1; on it, WE = 1 paints the pixel (outside the
        // screen nothing happens), and with synchronous reset RST = 1 then blackens the screen. Asynchronous reset:
        // RST = 1 blackens it on every run.
        const pinOf = (k: string) => comp.inputs.find((p) => pinKey(comp, p) === k);
        const cfg = getVideoConfig(comp);
        const value = (k: string) => {
          const p = pinOf(k);
          if (!p || !isPinConnected(p.id)) return 0;
          return bitsToNumber(readBits(p, p.width ?? 1)) ?? -1;
        };
        const level = (k: string) => {
          const p = pinOf(k);
          return p && isPinConnected(p.id) ? readBits(p, 1)[0] : undefined;
        };
        const x = value('x');
        const y = value('y');
        const data = value('data');
        if (comp.state.videoX !== x) comp.state.videoX = x;
        if (comp.state.videoY !== y) comp.state.videoY = y;
        if (comp.state.videoData !== data) comp.state.videoData = data;
        const clk = readBits(pinOf('clk'), 1)[0];
        const prev = comp.state.lastClk;
        comp.state.lastClk = clk;
        const tick = prev === undefined || (prev === 0 && clk === 1);
        const rst = level('rst') === 1;
        if (tick && level('we') === 1) {
          if (x >= 0 && x < cfg.width && y >= 0 && y < cfg.height) videoWrite(comp, y * cfg.width + x, videoRgb(cfg.color, data));
          if (cfg.reset === 'sync' && rst) comp.state.videoPages = undefined;
        }
        if (cfg.reset === 'async' && rst && comp.state.videoPages) comp.state.videoPages = undefined;
        break;
      }
      case 'binToBcd': {
        const bits = binToBcdBits(comp);
        binToBcdValues(readBits(comp.inputs[0], bits), comp.outputs.length).forEach((v, i) => setBitsOut(i, numberToBits(v, 4)));
        break;
      }
      case 'bcdToSevenSegment':
        bcdSegmentValues(readBits(comp.inputs[0], 4)).forEach((v, i) => setOut(i, v));
        break;
      case 'not': {
        // Logisim NOT: each bit inverted, an undefined bit (or an open input) gives E
        const w = getGateWidth(comp);
        setBitsOut(0, readBits(comp.inputs[0], w).map((v) => gateOutput(comp, sigNot(v))));
        break;
      }
      case 'buffer': {
        // Logisim buffer: passes 0/1/E unchanged, an undriven or open input comes out as x
        const w = getGateWidth(comp);
        setBitsOut(0, readBits(comp.inputs[0], w).map((v) => gateOutput(comp, v)));
        break;
      }
      case 'and':
      case 'or':
      case 'nand':
      case 'nor':
      case 'xor':
      case 'xnor':
        setBitsOut(0, logicGateBits(comp, connectedInputs, getGateWidth(comp)));
        break;
      case 'triState':
      case 'controlledInverter': {
        // Logisim controlled buffer / inverter: enable 1 passes the data (inverted: undefined bits -> E),
        // 0 floats, anything else is an error on every bit (Logisim 2.7.1; evolution floats on x/open enable)
        const w = getGateWidth(comp);
        const en = comp.inputs[1]?.value ?? 'Z';
        const isHiZ = en === 0;
        comp.state.hiZ = isHiZ;
        const data = readBits(comp.inputs[0], w);
        setBitsOut(
          0,
          isHiZ
            ? new Array<SignalValue>(w).fill('Z')
            : en === 1
              ? comp.type === 'controlledInverter'
                ? data.map(sigNot)
                : data
              : new Array<SignalValue>(w).fill('E')
        );
        break;
      }
      case 'bitExtender': {
        // Logisim Value.extendWidth: the low bits pass as they are (x/E included, extra ones cut off),
        // new high bits are 0, 1, the top input bit (sign) or the extension input (x when open)
        const inW = comp.inputs[0]?.width ?? 1;
        const src = readBits(comp.inputs[0], inW);
        const t = comp.state.extendType ?? 'zero';
        const ext: SignalValue = t === 'one' ? 1 : t === 'sign' ? src[inW - 1] : t === 'input' ? readBits(comp.inputs[1], 1)[0] : 0;
        const outW = comp.outputs[0]?.width ?? 1;
        setBitsOut(0, Array.from({ length: outW }, (_, i) => (i < inW ? src[i] : ext)));
        break;
      }
      case 'multiplexer':
      case 'demultiplexer':
      case 'decoder': {
        // Logisim Multiplexer / Demultiplexer / Decoder (2.7.1 and evolution alike): enable 0 gives the
        // 'disabled' value (0 or x) on every output, an E enable (when wired) E; otherwise a fully defined
        // select picks the input (MUX) or the output that gets the data / 1 (DEMUX / decoder; the others are 0,
        // or x when three-state), a select with an E bit gives E and any other undefined select x
        const { select: s, width: w, enable } = getPlexerConfig(comp);
        const n = 1 << s;
        const isMux = comp.type === 'multiplexer';
        const selIdx = isMux ? n : comp.type === 'demultiplexer' ? 1 : 0;
        const enPin = enable ? comp.inputs[selIdx + 1] : undefined;
        const fill = (v: SignalValue): SignalValue[] => new Array<SignalValue>(w).fill(v);
        const en = enPin ? readBits(enPin, 1)[0] : 1;
        let blocked: SignalValue[] | null = null;
        if (en === 0) blocked = fill(comp.state.plexDisabled === 'Z' ? 'X' : 0);
        else if (en === 'E' && enPin && isPinConnected(enPin.id)) blocked = fill('E');
        const selBits = readBits(comp.inputs[selIdx], s);
        const sel = bitsToNumber(selBits);
        const bad: SignalValue[] | null = blocked ?? (sel === undefined ? fill(selBits.includes('E') ? 'E' : 'X') : null);
        if (isMux) {
          setBitsOut(0, bad ?? readBits(comp.inputs[sel!], w));
          break;
        }
        const others = bad ?? fill(comp.state.plexTristate ? 'X' : 0);
        const hit = bad ? -1 : sel!;
        const data: SignalValue[] = comp.type === 'decoder' ? [1] : readBits(comp.inputs[0], w);
        for (let i = 0; i < n; i++) setBitsOut(i, i === hit ? data : others);
        break;
      }
      case 'priorityEncoder': {
        // Logisim PriorityEncoder: enabled unless EN_IN is 0; the highest input at 1 gives its number, GS 1 and
        // EN_OUT 0; with none the code is x (disabled: the 'disabled' value), GS 0 and EN_OUT = enabled
        const { select: s } = getPlexerConfig(comp);
        const n = 1 << s;
        const enabled = readBits(comp.inputs[n], 1)[0] !== 0;
        let hi = -1;
        if (enabled) {
          for (let i = n - 1; i >= 0; i--) {
            if (readBits(comp.inputs[i], 1)[0] === 1) {
              hi = i;
              break;
            }
          }
        }
        const none: SignalValue = enabled ? 'X' : comp.state.plexDisabled === 'Z' ? 'X' : 0;
        setBitsOut(0, hi < 0 ? new Array<SignalValue>(s).fill(none) : numberToBits(hi, s));
        setOut(1, hi < 0 && enabled ? 1 : 0);
        setOut(2, hi < 0 ? 0 : 1);
        break;
      }
      case 'adder':
      case 'subtractor':
      case 'multiplier':
      case 'divider':
      case 'negator':
      case 'absolute':
      case 'comparator':
      case 'minMax':
      case 'shifter':
      case 'squareRoot':
      case 'exponentiator':
      case 'bitAdder':
      case 'bitFinder':
      case 'alu':
        computeArith(comp, comp.inputs.map((p) => readBits(p, p.width ?? 1))).forEach((bits, i) => setBitsOut(i, bits));
        break;
      case 'flipFlopD':
      case 'flipFlopT':
      case 'flipFlopJK':
      case 'flipFlopSR':
      case 'register':
      case 'counter':
      case 'shiftRegister':
        stepMem(comp, comp.inputs.map((p) => readBits(p, p.width ?? 1))).forEach((bits, i) => setBitsOut(i, bits));
        break;
      case 'ram':
      case 'rom':
      case 'random':
      case 'dualRam':
        stepRam(comp, comp.inputs.map((p) => readBits(p, p.width ?? 1))).forEach((bits, i) => setBitsOut(i, bits));
        break;
      case 'bitSelector': {
        // Logisim BitSelector: group `select` of the data (bits past the data end are 0); a select
        // with any x/E bit gives all x
        const dW = comp.inputs[0]?.width ?? 1;
        const gW = comp.outputs[0]?.width ?? 1;
        const data = readBits(comp.inputs[0], dW);
        const sel = bitsToNumber(readBits(comp.inputs[1], comp.inputs[1]?.width ?? 1));
        setBitsOut(0, Array.from({ length: gW }, (_, i): SignalValue => {
          if (sel === undefined) return 'X';
          const b = sel * gW + i;
          return b < dW ? data[b] : 0;
        }));
        break;
      }
      case 'splitter4': {
        // Like a Logisim splitter, every bit passes through unchanged (x/E included)
        for (let i = 0; i < 4; i++) setOut(i, raw[i] ?? 'Z');
        break;
      }
      case 'halfAdder':
      case 'fullAdder': {
        // Logisim 1-bit adder; the half adder is one with its carry-in left open
        const { sum, carry } = logisimSum([raw[0]], [raw[1]], raw[2] ?? 'Z');
        setOut(0, sum[0]);
        setOut(1, carry);
        break;
      }
      case 'halfSubtractor':
      case 'fullSubtractor': {
        const { diff, borrow } = logisimDiff([raw[0]], [raw[1]], raw[2] ?? 'Z');
        setOut(0, diff[0]);
        setOut(1, borrow);
        break;
      }
      case 'bcdTo7Seg': {
        // No Logisim counterpart: an E input makes every segment output E, any other undefined one x
        const code = busValue(raw.slice(0, 4));
        if (typeof code !== 'number') {
          for (let i = 0; i < 7; i++) setOut(i, code);
          break;
        }
        const a = inVals[0] ?? 0;
        const b = inVals[1] ?? 0;
        const c = inVals[2] ?? 0;
        const d = inVals[3] ?? 0;
        const num = (a === 1 ? 1 : 0) | ((b === 1 ? 1 : 0) << 1) | ((c === 1 ? 1 : 0) << 2) | ((d === 1 ? 1 : 0) << 3);
        const map = HEX_7SEG_MAP[num % 16] || HEX_7SEG_MAP[0];
        const segs: SignalValue[] = [
          map.a ? 1 : 0,
          map.b ? 1 : 0,
          map.c ? 1 : 0,
          map.d ? 1 : 0,
          map.e ? 1 : 0,
          map.f ? 1 : 0,
          map.g ? 1 : 0,
        ];
        for (let i = 0; i < 7; i++) {
          if (comp.outputs[i] && comp.outputs[i].value !== segs[i]) {
            comp.outputs[i].value = segs[i];
            hasChanged = true;
          }
        }
        break;
      }
      case 'sevenSegment': {
        // Direct segment mapping handled in renderer
        break;
      }
      case 'buzzer': {
        const en = inVals[0] === 1;
        const n0 = inVals[1] === 1 ? 1 : 0;
        const n1 = inVals[2] === 1 ? 2 : 0;
        const n2 = inVals[3] === 1 ? 4 : 0;
        const n3 = inVals[4] === 1 ? 8 : 0;
        const note = inVals.length > 1 ? n0 + n1 + n2 + n3 : 9;
        if (comp.state.on !== en || comp.state.buzzerNote !== note) {
          comp.state.on = en;
          comp.state.buzzerNote = note;
          hasChanged = true;
        }
        break;
      }
      case 'asciiKeyboard': {
        const clr = inVals[0] === 1;
        if (clr && comp.state.strobe) {
          comp.state.strobe = false;
          if (comp.outputs[7] && comp.outputs[7].value !== 0) {
            comp.outputs[7].value = 0;
            hasChanged = true;
          }
        }
        break;
      }
      case 'srLatch': {
        // Like Logisim's S-R flip-flop: an x or E on S or R holds the state (as S = R = 1 does)
        const s = raw[0];
        const r = raw[1];
        if (s === 1 && r === 0) {
          if (comp.state.q !== 1) {
            comp.state.q = 1;
            comp.state.qBar = 0;
            hasChanged = true;
          }
        } else if (s === 0 && r === 1) {
          if (comp.state.q !== 0) {
            comp.state.q = 0;
            comp.state.qBar = 1;
            hasChanged = true;
          }
        }
        const qVal = comp.state.q ?? 0;
        const qBarVal = comp.state.qBar ?? 1;
        if (comp.outputs[0] && comp.outputs[0].value !== qVal) {
          comp.outputs[0].value = qVal;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== qBarVal) {
          comp.outputs[1].value = qBarVal;
          hasChanged = true;
        }
        break;
      }
      case 'subcircuit': {
        const subId = comp.state.subcircuitId;
        if (subId) {
          const subDef = getSubcircuitDefinition(subId);
          if (subDef) {
            // Every port passes its bits as they are (Logisim SubcircuitFactory.propagate); a wide pin
            // the net gave no bits floats inside
            const inPorts = subDef.ports.filter((p) => p.type === 'input');
            const inBits = comp.inputs.map((pin, i): SignalValue[] => {
              const w = inPorts[i] ? subcircuitPortWidth(subDef, inPorts[i]) : 1;
              if (w === 1) return [pin.value];
              return pin.bits && pin.bits.length === w ? pin.bits : new Array<SignalValue>(w).fill('Z');
            });
            const { outputs: outVals, internal, oscillating } = evaluateSubcircuitStateful(
              subDef,
              inBits,
              comp.state.subcircuitInternal
            );
            comp.state.subcircuitInternal = internal;
            if (oscillating) comp.state.oscillating = true;
            else delete comp.state.oscillating;
            outVals.forEach((bits, oIdx) => setBitsOut(oIdx, bits));
          }
        }
        break;
      }
      case 'led':
      case 'probe':
      case 'buzzer':
      case 'textLabel':
      case 'image':
      case 'tunnel': {
        // Output displays & wireless tunnels reflect network resolution
        break;
      }
    }
  });

  return { components: newComps, wires: newWires, hasChanged };
}

/**
 * Run simulation to convergence or up to maxIterations
 */
export function simulateCircuit(
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  maxIterations?: number
): {
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  oscillating?: boolean;
  oscillatingWireIds?: string[];
  oscillatingCompIds?: string[];
} {
  // Each step moves signals through one level of logic, and an acyclic path cannot be longer than
  // the number of parts, so that many steps always settle it. Only feedback that keeps
  // oscillating (e.g. NAND(clock, q) after a clock edge) runs into the limit.
  if (maxIterations === undefined) maxIterations = components.length + 10;
  // Real-time clocks read one time for the whole run (an IC's inner run keeps its caller's)
  const ownsRtc = rtcFrozen === null;
  if (ownsRtc) rtcFrozen = rtcClock();
  try {
    return simulateCircuitRun(components, wires, maxIterations);
  } finally {
    if (ownsRtc) rtcFrozen = null;
  }
}

function simulateCircuitRun(
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  maxIterations: number
): {
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  oscillating?: boolean;
  oscillatingWireIds?: string[];
  oscillatingCompIds?: string[];
} {
  let curComps = components;
  let curWires = wires;
  // Like Logisim's Propagator: what still changes in the last quarter of the steps is reported as oscillating
  const logFrom = Math.floor((3 * maxIterations) / 4);
  const oscWires = new Set<string>();
  const oscComps = new Set<string>();
  let settled = false;

  for (let i = 0; i < maxIterations; i++) {
    const step = simulateCircuitStep(curComps, curWires);
    if (!step.hasChanged) {
      curComps = step.components;
      curWires = step.wires;
      settled = true;
      break;
    }
    if (i >= logFrom) {
      step.wires.forEach((w, k) => {
        const old = curWires[k];
        if (old && (old.value !== w.value || !sameBits(old.bits, w.bits))) oscWires.add(w.id);
      });
      // A subcircuit that keeps changing inside is drawn with a frame, as in Logisim
      step.components.forEach((c) => {
        if (c.state.oscillating) oscComps.add(c.id);
      });
    }
    curComps = step.components;
    curWires = step.wires;
  }

  if (settled) {
    // The outer circuit can settle while an IC keeps oscillating inside with steady outputs
    oscWires.clear();
    oscComps.clear();
    curComps.forEach((c) => {
      if (c.state.oscillating) oscComps.add(c.id);
    });
  }
  // Mark the wires that kept changing for the canvas; clear the marks of an earlier oscillation
  if (oscWires.size > 0 || curWires.some((w) => w.oscillating)) {
    curWires = curWires.map((w) => {
      const osc = oscWires.has(w.id);
      if (!!w.oscillating === osc) return w;
      const { oscillating: _old, ...rest } = w;
      return osc ? { ...rest, oscillating: true } : rest;
    });
  }
  if ((settled || maxIterations === 0) && oscComps.size === 0) return { components: curComps, wires: curWires };
  return {
    components: curComps,
    wires: curWires,
    oscillating: true,
    oscillatingWireIds: [...oscWires],
    oscillatingCompIds: [...oscComps],
  };
}

/**
 * Preset builder: a part by type, position, label and id with its width / splitter / extender / selector /
 * parametric settings (multi-bit bus demos since Aşama 2l, every preset with a parametric part since 3h).
 */
type BusPartOptions = {
  width?: number;
  state?: Partial<CircuitComponentInstance['state']>;
  rotation?: CircuitComponentInstance['rotation'];
  splitter?: Parameters<typeof configureSplitter>[1];
  extender?: Parameters<typeof configureBitExtender>[1];
  selector?: Parameters<typeof configureBitSelector>[1];
  /** Parametric part settings (configureMem / configureRam / configurePlexer / ...) */
  configure?: (c: CircuitComponentInstance) => CircuitComponentInstance;
};

function busPart(
  type: ComponentType,
  x: number,
  y: number,
  label: string,
  id: string,
  opt: BusPartOptions = {}
): CircuitComponentInstance {
  let c = createComponentInstance(type, x, y, label, id);
  if (opt.rotation) c = { ...c, rotation: opt.rotation };
  if (opt.width && opt.width > 1) c = setBitWidth(c, opt.width);
  if (opt.splitter) c = configureSplitter(c, opt.splitter);
  if (opt.extender) c = configureBitExtender(c, opt.extender);
  if (opt.selector) c = configureBitSelector(c, opt.selector);
  if (opt.configure) c = opt.configure(c);
  if (opt.state) c = { ...c, state: { ...c.state, ...opt.state } };
  return updatePinPositions(c);
}

// Wire list builder: link(fromPart, fromPin, toPart, toPin) with pins as objects of the parts
function busWires() {
  const wires: CircuitWire[] = [];
  const link = (a: CircuitComponentInstance, ap: CircuitPin, b: CircuitComponentInstance, bp: CircuitPin) => {
    wires.push({ id: `w${wires.length + 1}`, fromCompId: a.id, fromPinId: ap.id, toCompId: b.id, toPinId: bp.id, value: 0 });
  };
  return { wires, link };
}

function busSplitJoinPreset(): CircuitPreset {
  const sw = busPart('switch', 40, 150, 'Veri (8 bit)', 'bsj_sw', { width: 8, state: { inputValue: 0xa5 } });
  const pIn = busPart('probe', 160, 60, 'Giriş (hex)', 'bsj_pin', { state: { radix: '16' } });
  // 8 bits -> two 4-bit halves (end 1 = b3..b0, end 2 = b7..b4)
  const nib = busPart('splitter', 200, 150, 'Yarımlara Ayır', 'bsj_nib', { splitter: { incoming: 8, fanout: 2 } });
  // each 4-bit half straight into its hex digit
  const hexHi = hexDigitPart(320, 30, 'Üst Hane (b7..b4)', 'bsj_hexhi');
  const hexLo = hexDigitPart(460, 30, 'Alt Hane (b3..b0)', 'bsj_hexlo');
  // the halves crossed over into a west-facing joining splitter: they swap places
  const join = busPart('splitter', 380, 250, 'Birleştir', 'bsj_join', { splitter: { incoming: 8, fanout: 2 }, rotation: 180 });
  const led = busPart('led', 450, 230, 'Yer Değişmiş (8 bit)', 'bsj_led', { width: 8 });
  const pOut = busPart('probe', 450, 300, 'Çıkış (hex)', 'bsj_pout', { state: { radix: '16' } });
  const { wires, link } = busWires();
  link(sw, sw.outputs[0], pIn, pIn.inputs[0]);
  link(sw, sw.outputs[0], nib, nib.inputs[0]);
  link(nib, nib.outputs[1], hexHi, pk(hexHi, 'in'));
  link(nib, nib.outputs[0], hexLo, pk(hexLo, 'in'));
  link(nib, nib.outputs[0], join, join.outputs[1]);
  link(nib, nib.outputs[1], join, join.outputs[0]);
  link(join, join.inputs[0], led, led.inputs[0]);
  link(join, join.inputs[0], pOut, pOut.inputs[0]);
  return {
    id: 'bus_split_join',
    name: 'Çok Bitli: 8-Bit Veri Yolunu Bölme ve Birleştirme (Splitter)',
    category: 'bus',
    description:
      '8 bitlik bir veri yolu splitter ile iki 4 bitlik yarıma bölünür; her yarım 4 bitlik tek telle kendi Hex ekranına gider. Aynı yarımlar, batıya bakan bir splitter ile yer değiştirerek yeniden 8 bite birleştirilir (A5 → 5A). Splitter iki yönlüdür: aynı parça hem ayırır hem birleştirir.',
    components: [sw, pIn, nib, hexHi, hexLo, join, led, pOut],
    wires,
  };
}

function busSignExtendPreset(): CircuitPreset {
  const x = busPart('switch', 40, 170, 'X (4 bit)', 'bse_x', { width: 4, state: { inputValue: 0xa } });
  const pu = busPart('probe', 40, 60, 'X işaretsiz', 'bse_pu', { state: { radix: '10u' } });
  const ps = busPart('probe', 40, 260, 'X işaretli', 'bse_ps', { state: { radix: '10s' } });
  const ez = busPart('bitExtender', 240, 90, 'Sıfırla Genişlet', 'bse_ez', { extender: { inWidth: 4, outWidth: 8, type: 'zero' } });
  const es = busPart('bitExtender', 240, 250, 'İşaretle Genişlet', 'bse_es', { extender: { inWidth: 4, outWidth: 8, type: 'sign' } });
  const lz = busPart('led', 380, 80, 'Sıfır dolgulu (8 bit)', 'bse_lz', { width: 8 });
  const pz = busPart('probe', 380, 150, 'İşaretsiz ondalık', 'bse_pz', { state: { radix: '10u' } });
  const ls = busPart('led', 380, 240, 'İşaret dolgulu (8 bit)', 'bse_ls', { width: 8 });
  const pss = busPart('probe', 380, 310, 'İşaretli ondalık', 'bse_pss', { state: { radix: '10s' } });
  const { wires, link } = busWires();
  link(x, x.outputs[0], pu, pu.inputs[0]);
  link(x, x.outputs[0], ps, ps.inputs[0]);
  link(x, x.outputs[0], ez, ez.inputs[0]);
  link(x, x.outputs[0], es, es.inputs[0]);
  link(ez, ez.outputs[0], lz, lz.inputs[0]);
  link(ez, ez.outputs[0], pz, pz.inputs[0]);
  link(es, es.outputs[0], ls, ls.inputs[0]);
  link(es, es.outputs[0], pss, pss.inputs[0]);
  return {
    id: 'bus_sign_extend',
    name: 'Çok Bitli: İşaretli ve İşaretsiz Genişletme (Bit Extender)',
    category: 'bus',
    description:
      "Aynı 4 bitlik sayı iki bit genişleticiyle 8 bite çıkarılır. Sıfırla genişletme üst bitlere 0 koyar ve işaretsiz değeri korur (1010 = 10 → 0000 1010). İşaretle genişletme en üst biti kopyalar ve ikiye tümleyen değeri korur (1010 = −6 → 1111 1010 = −6).",
    components: [x, pu, ps, ez, es, lz, pz, ls, pss],
    wires,
  };
}

function busBitSelectorPreset(): CircuitPreset {
  const d = busPart('switch', 40, 180, 'Veri (8 bit)', 'bbs_d', { width: 8, state: { inputValue: 0x3c } });
  const pd = busPart('probe', 40, 90, 'Veri (hex)', 'bbs_pd', { state: { radix: '16' } });
  const half = busPart('switch', 180, 240, 'Yarım Seç (0 alt, 1 üst)', 'bbs_half');
  const selN = busPart('bitSelector', 220, 180, 'Yarım Bayt Seçici', 'bbs_seln', { selector: { dataWidth: 8, groupWidth: 4 } });
  const hex = hexDigitPart(380, 170, 'Seçilen Yarım Bayt', 'bbs_hex');
  const pn = busPart('probe', 300, 100, 'Seçilen (ikili)', 'bbs_pn');
  const idx = busPart('switch', 200, 460, 'Bit No (0-7)', 'bbs_idx', { width: 3, state: { inputValue: 2 } });
  const selB = busPart('bitSelector', 220, 380, 'Tek Bit Seçici (8:1 MUX)', 'bbs_selb', { selector: { dataWidth: 8, groupWidth: 1 } });
  const lb = busPart('led', 330, 370, 'Seçilen Bit', 'bbs_lb');
  const { wires, link } = busWires();
  link(d, d.outputs[0], pd, pd.inputs[0]);
  link(d, d.outputs[0], selN, selN.inputs[0]);
  link(half, half.outputs[0], selN, selN.inputs[1]);
  link(selN, selN.outputs[0], hex, pk(hex, 'in'));
  link(selN, selN.outputs[0], pn, pn.inputs[0]);
  link(d, d.outputs[0], selB, selB.inputs[0]);
  link(idx, idx.outputs[0], selB, selB.inputs[1]);
  link(selB, selB.outputs[0], lb, lb.inputs[0]);
  return {
    id: 'bus_bit_selector',
    name: 'Çok Bitli: Bit Seçici ile Çoklayıcı (MUX)',
    category: 'bus',
    description:
      'Bit seçici, veri yolunu eşit gruplara böler ve seçme girişinin gösterdiği grubu çıkışa verir; yani bir çoklayıcıdır. Üstteki 4 bitlik gruplarla çalışır (1 bit seçme: alt ya da üst yarım bayt), alttaki 1 bitlik gruplarla 8:1 MUX gibi davranır (3 bit seçme). Veri 3C: alt yarım C, üst yarım 3; bit 2 = 1.',
    components: [d, pd, half, selN, hex, pn, idx, selB, lb],
    wires,
  };
}

function busTriStatePreset(): CircuitPreset {
  const parts: CircuitComponentInstance[] = [];
  const { wires, link } = busWires();
  const side = (key: 'a' | 'b', y: number, value: number, enabled: boolean) => {
    const name = key.toUpperCase();
    const src = busPart('switch', 40, y + 30, `Kaynak ${name} (4 bit)`, `bts_${key}`, { width: 4, state: { inputValue: value } });
    const en = busPart('switch', 40, y + 130, `${name} Yola Yazsın (EN${name})`, `bts_en${key}`, { state: { on: enabled } });
    const sp = busPart('splitter', 160, y + 30, `${name} bitleri`, `bts_s${key}`, { splitter: { incoming: 4, fanout: 4 } });
    const bufs = [0, 1, 2, 3].map((i) => busPart('triState', 240, y + i * 50 - 20, `Tampon ${name}${i}`, `bts_t${key}${i}`));
    const jn = busPart('splitter', 400, y + 30, `${name} → yol`, `bts_j${key}`, { splitter: { incoming: 4, fanout: 4 }, rotation: 180 });
    const tun = busPart('tunnel', 450, y + 20, 'VERİ YOLU', `bts_tun${key}`);
    link(src, src.outputs[0], sp, sp.inputs[0]);
    bufs.forEach((t, i) => {
      link(sp, sp.outputs[i], t, t.inputs[0]);
      link(en, en.outputs[0], t, t.inputs[1]);
      link(t, t.outputs[0], jn, jn.outputs[i]);
    });
    link(jn, jn.inputs[0], tun, tun.inputs[0]);
    parts.push(src, en, sp, ...bufs, jn, tun);
  };
  side('a', 40, 0x3, true);
  side('b', 290, 0x5, false);
  const tunOut = busPart('tunnel', 600, 220, 'VERİ YOLU', 'bts_tunout');
  const led = busPart('led', 720, 210, 'Ortak Yol (4 bit)', 'bts_led', { width: 4 });
  const probe = busPart('probe', 720, 280, 'Ortak Yol (ikili)', 'bts_probe');
  link(tunOut, tunOut.outputs[0], led, led.inputs[0]);
  link(tunOut, tunOut.outputs[0], probe, probe.inputs[0]);
  parts.push(tunOut, led, probe);
  return {
    id: 'bus_tristate_shared',
    name: 'Çok Bitli: Tri-State Tamponlarla Ortak 4-Bit Veri Yolu',
    category: 'bus',
    description:
      "İki 4 bitlik kaynak, bit başına birer tri-state tamponla aynı veri yoluna bağlanır; yol tünellerle (VERİ YOLU) taşınır. Aynı anda yalnız bir EN açık olmalı. İkisi birden açılırsa farklı olan bitler çakışır (0011 + 0101 = 0EE1, kırmızı), ikisi de kapalıysa yol sürülmez (xxxx, gri).",
    components: parts,
    wires,
  };
}

// ---- Presets rebuilt with the parametric parts and multi-bit wires (Aşama 3h) --------------------------------

/** A part's pin by its key ('d', 'clk', 'out3', ...) */
function pk(c: CircuitComponentInstance, key: string): CircuitPin {
  const p = [...c.inputs, ...c.outputs].find((q) => pinKey(c, q) === key);
  if (!p) throw new Error(`preset pin ${c.id}.${key}`);
  return p;
}

type PresetLink = ReturnType<typeof busWires>['link'];

/** West-facing splitter that joins single lines (bit 0 first) into one bus; read the bus from inputs[0] */
function joinBits(
  link: PresetLink,
  id: string,
  label: string,
  x: number,
  y: number,
  sources: [CircuitComponentInstance, CircuitPin][]
): CircuitComponentInstance {
  const n = sources.length;
  const j = busPart('splitter', x, y, label, id, { splitter: { incoming: n, fanout: n }, rotation: 180 });
  sources.forEach(([c, p], i) => link(c, p, j, j.outputs[i]));
  return j;
}

/** Splitter that opens a bus into single lines (outputs[i] = bit i) */
function splitBits(
  link: PresetLink,
  id: string,
  label: string,
  x: number,
  y: number,
  n: number,
  source: [CircuitComponentInstance, CircuitPin]
): CircuitComponentInstance {
  const s = busPart('splitter', x, y, label, id, { splitter: { incoming: n, fanout: n, appear: 'right' } });
  link(source[0], source[1], s, s.inputs[0]);
  return s;
}

/** Contents for a RAM / ROM: the words from address 0 */
const memContents = (words: number[]): CircuitComponentInstance['state']['memPages'] => ({
  '0': Array.from({ length: MEM_PAGE_SIZE }, (_, i) => words[i] ?? 0),
});

/** Hex digit without the decimal point input */
const hexDigitPart = (x: number, y: number, label: string, id: string) =>
  busPart('hexDigit', x, y, label, id, { configure: (c) => configureIo(c, { dp: false }) });

function dFlipFlopPreset(): CircuitPreset {
  const d = busPart('switch', 60, 100, 'Veri Girişi (D)', 'sw_d');
  const clk = busPart('clock', 60, 220, 'Saat Darbesi (CLK)', 'clk_1');
  const ff = busPart('flipFlopD', 280, 140, 'D Flip-Flop', 'dff_1');
  const q = busPart('led', 480, 100, 'Kayıtlı Çıkış (Q)', 'led_q');
  const qn = busPart('led', 480, 220, "Ters Çıkış (Q')", 'led_q_bar');
  const { wires, link } = busWires();
  link(d, d.outputs[0], ff, pk(ff, 'd'));
  link(clk, clk.outputs[0], ff, pk(ff, 'clk'));
  link(ff, pk(ff, 'q'), q, q.inputs[0]);
  link(ff, pk(ff, 'qn'), qn, qn.inputs[0]);
  return {
    id: 'd_flip_flop_memory',
    name: 'D Flip-Flop ile 1-Bit Bellek (Kayıtçı)',
    category: 'sequential',
    description:
      "Saat darbesinin (CLK) yükselen kenarında Giriş D verisini saklayan ve Q ile Q' çıkışlarına aktaran temel ardışıl bellek devresi. CLR (sıfırla), PRE (kur) ve EN (yetki) bacakları boş bırakıldığında flip-flop normal çalışır.",
    components: [d, clk, ff, q, qn],
    wires,
  };
}

function tFlipFlopCounterPreset(): CircuitPreset {
  const vcc = busPart('vcc', 50, 70, '1 (High)', 'vcc_tff');
  const clk = busPart('clock', 50, 170, 'Saat (CLK)', 'clk_tff');
  const t0 = busPart('flipFlopT', 190, 110, 'T-FF 0 (Bit 0)', 'tff_0');
  const t1 = busPart('flipFlopT', 370, 110, 'T-FF 1 (Bit 1)', 'tff_1');
  const l0 = busPart('led', 290, 260, 'Q0 (1ler Biti)', 'led_tff_q0');
  const l1 = busPart('led', 470, 260, 'Q1 (2ler Biti)', 'led_tff_q1');
  const { wires, link } = busWires();
  link(vcc, vcc.outputs[0], t0, pk(t0, 't'));
  link(clk, clk.outputs[0], t0, pk(t0, 'clk'));
  link(vcc, vcc.outputs[0], t1, pk(t1, 't'));
  // Rising-edge flip-flops: Q0' clocks bit 1 (Q0 there would make it count down 00, 11, 10, 01)
  link(t0, pk(t0, 'qn'), t1, pk(t1, 'clk'));
  link(t0, pk(t0, 'q'), l0, l0.inputs[0]);
  link(t1, pk(t1, 'q'), l1, l1.inputs[0]);
  return {
    id: 't_flip_flop_counter',
    name: 'T-FF ile 2-Bit Asenkron İkili Sayaç (Ripple Counter)',
    category: 'sequential',
    description:
      "T Flip-Flop elemanlarının kaskat bağlanmasıyla saat darbelerini sayan ve 00, 01, 10, 11 sayma dizisini üreten 2-bit sayaç. Flip-flop'lar yükselen kenarda tetiklendiği için ikinci flip-flop'un saatine Q0' bağlıdır.",
    components: [vcc, clk, t0, t1, l0, l1],
    wires,
  };
}

function decoder2to4Preset(): CircuitPreset {
  const en = busPart('vcc', 120, 300, 'EN (Yetki=1)', 'vcc_dec');
  const a = busPart('switch', 50, 180, 'Adres (A1 A0)', 'sw_dec_a', { width: 2 });
  const dec = busPart('decoder', 230, 110, '2:4 Kod Çözücü', 'dec_1', {
    configure: (c) => configurePlexer(c, { select: 2, enable: true }),
  });
  const leds = [0, 1, 2, 3].map((i) => busPart('led', 380, 40 + i * 80, `Hat ${i} (Y${i})`, `led_dec_${i}`));
  const { wires, link } = busWires();
  link(a, a.outputs[0], dec, pk(dec, 'sel'));
  link(en, en.outputs[0], dec, pk(dec, 'en'));
  leds.forEach((l, i) => link(dec, pk(dec, `out${i}`), l, l.inputs[0]));
  return {
    id: 'decoder_demo',
    name: '2:4 Kod Çözücü (1-of-4 Decoder Seçici)',
    category: 'bus',
    description:
      '2 bitlik adresi (A1 A0) tek bir çok bitli telden alıp çözerek 4 çıkış hattından tam olarak birini aktif (1) yapan adres çözücü devre. EN girişi 0 olursa hiçbir hat seçilmez.',
    components: [en, a, dec, ...leds],
    wires,
  };
}

function hexDisplayPreset(): CircuitPreset {
  const v = busPart('switch', 60, 180, 'Sayı (4 bit)', 'hex_sw', { width: 4 });
  const p = busPart('probe', 60, 70, 'Sayı (ikili)', 'hex_probe');
  const hex = hexDigitPart(300, 140, 'Hex 7-Segment Ekran', 'hex_disp');
  const { wires, link } = busWires();
  link(v, v.outputs[0], hex, pk(hex, 'in'));
  link(v, v.outputs[0], p, p.inputs[0]);
  return {
    id: 'hex_display_demo',
    name: '4-Bit Hex 7-Segment Sayı Göstergesi',
    category: 'bus',
    description:
      "4 bitlik anahtarın değerini (0000 - 1111) onaltılık rakam (0-F) olarak gerçekçi LED ekranda gösteren devre. Anahtar ile ekran arasında tek bir 4 bitlik tel vardır; bitlere tek tek tıklayarak sayıyı değiştirin.",
    components: [v, p, hex],
    wires,
  };
}

function aluConstantsPreset(): CircuitPreset {
  const a = busPart('constant', 80, 100, 'A = 3', 'alu_const_a', { width: 4, state: { constValue: 3 } });
  const b = busPart('constant', 80, 160, 'B = 1', 'alu_const_b', { width: 4, state: { constValue: 1 } });
  const op = busPart('constant', 80, 220, 'İşlem = 0 (ADD)', 'alu_const_op', { width: 3, state: { constValue: 0 } });
  const cin = busPart('gnd', 80, 280, 'Elde Girişi = 0', 'gnd_1');
  const alu = busPart('alu', 220, 120, '4-Bit ALU', 'alu_core', { configure: (c) => configureArith(c, { width: 4 }) });
  const hex = hexDigitPart(420, 100, 'Sonuç (Hex)', 'alu_hex');
  const { wires, link } = busWires();
  link(a, a.outputs[0], alu, pk(alu, 'a'));
  link(b, b.outputs[0], alu, pk(alu, 'b'));
  link(op, op.outputs[0], alu, pk(alu, 'op'));
  link(cin, cin.outputs[0], alu, pk(alu, 'cin'));
  link(alu, pk(alu, 'out'), hex, pk(hex, 'in'));
  return {
    id: 'alu_bus_splitter',
    name: '4-Bit ALU, Sabitler ve Hex Gösterge',
    category: 'arithmetic',
    description:
      "4 bitlik ALU'nun A ve B girişlerini sabit (Constant) parçaları sürer: A = 3, B = 1, işlem kodu 0 (toplama). Sonuç 4 bitlik tek telle hex göstergeye gider ve 4 görünür. Sabitlerin değeri ve ALU işlemi ayar panelinden değiştirilebilir (0 ADD, 1 SUB, 2 AND, 3 OR, 4 XOR, 5 NOR, 6 SLT, 7 B'yi geçir).",
    components: [a, b, op, cin, alu, hex],
    wires,
  };
}

function counterHexPreset(): CircuitPreset {
  const clk = busPart('clock', 60, 100, 'Saat Darbesi (CLK)', 'cnt_clk');
  const rst = busPart('pushbutton', 60, 180, 'Sıfırla (CLR)', 'cnt_rst');
  const cnt = busPart('counter', 200, 100, '4-Bit Senkron Sayaç', 'cnt_core', { configure: (c) => configureMem(c, { width: 4 }) });
  const hex = hexDigitPart(380, 80, 'Hex Ekran (0-F)', 'cnt_hex');
  const led = busPart('led', 380, 230, 'Q (4 bit)', 'cnt_led', { width: 4 });
  const { wires, link } = busWires();
  link(clk, clk.outputs[0], cnt, pk(cnt, 'clk'));
  link(rst, rst.outputs[0], cnt, pk(cnt, 'clr'));
  link(cnt, pk(cnt, 'q'), hex, pk(hex, 'in'));
  link(cnt, pk(cnt, 'q'), led, led.inputs[0]);
  return {
    id: 'counter_hex_demo',
    name: '4-Bit Senkron Sayaç ve 7-Segment Hex Gösterge (0-F)',
    category: 'sequential',
    description:
      "Saat darbesi (CLK) ve Sıfırla (CLR) butonu ile kontrol edilen 4 bitlik sayaç; 4 bitlik Q çıkışı tek telle hex ekrana ve 4 bitlik LED'e gider, 0'dan F'ye canlı sayar. Sayacın yükleme (LD), sayma izni (CT) ve yön (U/D) bacakları boş bırakıldığında yukarı sayar.",
    components: [clk, rst, cnt, hex, led],
    wires,
  };
}

function comparatorPreset(): CircuitPreset {
  // 7485 pins: A3 15, A2 13, A1 12, A0 10 / B3 1, B2 14, B1 11, B0 9 / I(A<B) 2, I(A=B) 3, I(A>B) 4 / A>B 5, A=B 6, A<B 7
  const a = busPart('switch', 40, 40, 'A (4 bit)', 'cmp_sw_a', { width: 4, state: { inputValue: 9 } });
  const b = busPart('switch', 40, 400, 'B (4 bit)', 'cmp_sw_b', { width: 4, state: { inputValue: 5 } });
  const sa = busPart('splitter', 160, 40, 'A bitleri', 'cmp_split_a', { splitter: { incoming: 4, fanout: 4 } });
  const sb = busPart('splitter', 160, 400, 'B bitleri', 'cmp_split_b', { splitter: { incoming: 4, fanout: 4 } });
  const pa = busPart('probe', 40, 140, 'A', 'cmp_probe_a', { state: { radix: '10u' } });
  const pb = busPart('probe', 40, 500, 'B', 'cmp_probe_b', { state: { radix: '10u' } });
  const cmp = busPart('ttl7485', 320, 230, '7485', 'cmp_core', { state: { ttlInternal: true } });
  const one = busPart('vcc', 200, 330, 'I(A=B)', 'cmp_vcc');
  const zero = busPart('gnd', 200, 160, 'I(A<B), I(A>B)', 'cmp_gnd');
  const gt = busPart('led', 620, 140, 'A > B', 'led_gt');
  const eq = busPart('led', 620, 250, 'A = B', 'led_eq');
  const lt = busPart('led', 620, 360, 'A < B', 'led_lt');
  const { wires, link } = busWires();
  link(a, a.outputs[0], sa, pk(sa, 'in0'));
  link(b, b.outputs[0], sb, pk(sb, 'in0'));
  link(a, a.outputs[0], pa, pa.inputs[0]);
  link(b, b.outputs[0], pb, pb.inputs[0]);
  [10, 12, 13, 15].forEach((pin, i) => link(sa, pk(sa, `out${i}`), cmp, pk(cmp, `p${pin}`)));
  [9, 11, 14, 1].forEach((pin, i) => link(sb, pk(sb, `out${i}`), cmp, pk(cmp, `p${pin}`)));
  link(one, one.outputs[0], cmp, pk(cmp, 'p3'));
  link(zero, zero.outputs[0], cmp, pk(cmp, 'p2'));
  link(zero, zero.outputs[0], cmp, pk(cmp, 'p4'));
  link(cmp, pk(cmp, 'p5'), gt, gt.inputs[0]);
  link(cmp, pk(cmp, 'p6'), eq, eq.inputs[0]);
  link(cmp, pk(cmp, 'p7'), lt, lt.inputs[0]);
  return {
    id: 'magnitude_comparator',
    name: '4-Bit Büyüklük Karşılaştırıcı (7485)',
    category: 'arithmetic',
    description:
      'Gerçek 7485 çipi iki adet 4 bitlik işaretsiz sayıyı (A ve B) karşılaştırır ve A>B, A=B, A<B çıkışlarından birini 1 yapar. 4 bitlik anahtarlar ayırıcılarla tek tek bacaklara dağıtılır. '
      + 'Tek çip kullanıldığı için kademe girişlerinden I(A=B) 1\'e, I(A<B) ve I(A>B) 0\'a bağlıdır; daha geniş sayılar için alt çipin çıkışları üst çipin kademe girişlerine bağlanır.',
    components: [a, b, sa, sb, pa, pb, cmp, one, zero, gt, eq, lt],
    wires,
  };
}

function priorityEncoderPreset(): CircuitPreset {
  // 74148 pins: I0'..I3' 10-13, I4'..I7' 1-4, EI' 5 / A2' 6, A1' 7, A0' 9, GS' 14, EO' 15 (all active-low)
  const inPins = [10, 11, 12, 13, 1, 2, 3, 4];
  const sws = inPins.map((_, i) =>
    busPart('switch', 40, 20 + i * 90, `I${i}'`, `pri_sw${i}`, {
      state: { on: i !== 2 && i !== 5 },
    })
  );
  const en = busPart('gnd', 240, 480, "EI' = 0", 'pri_en');
  const enc = busPart('ttl74148', 320, 330, '74148', 'pri_core', { state: { ttlInternal: true } });
  const outs: [number, string, string][] = [
    [6, "A2'", 'pri_led_a2'],
    [7, "A1'", 'pri_led_a1'],
    [9, "A0'", 'pri_led_a0'],
    [14, "GS'", 'pri_led_gs'],
    [15, "EO'", 'pri_led_eo'],
  ];
  const leds = outs.map(([, label, id], i) => busPart('led', 640, 100 + i * 110, label, id));
  const { wires, link } = busWires();
  sws.forEach((s, i) => link(s, s.outputs[0], enc, pk(enc, `p${inPins[i]}`)));
  link(en, en.outputs[0], enc, pk(enc, 'p5'));
  outs.forEach(([pin], i) => link(enc, pk(enc, `p${pin}`), leds[i], leds[i].inputs[0]));
  return {
    id: 'priority_encoder_demo',
    name: '8:3 Öncelikli Kodlayıcı (74148)',
    category: 'basic',
    description:
      "Gerçek 74148 çipi: girişler ve çıkışlar aktif-düşüktür. 0 olan girişlerden numarası en büyük olanın numarası A2' A1' A0' çıkışlarına TERS olarak yazılır (başlangıçta I2' ve I5' = 0, yani 5 = 101 seçilir ve çıkışlar 010 olur). "
      + "GS' = 0 en az bir girişin etkin olduğunu, EO' = 0 ise çip etkinken hiçbir girişin etkin olmadığını gösterir (EO' bir sonraki 74148'in EI' girişine bağlanarak 16:4 kodlayıcı yapılır).",
    components: [...sws, en, enc, ...leds],
    wires,
  };
}

function universalShiftRegisterPreset(): CircuitPreset {
  // 74194 pins: MR' 1, DSR 2, D0..D3 3-6, DSL 7 / S0 9, S1 10, CLK 11 / Q3 12, Q2 13, Q1 14, Q0 15
  const clk = busPart('clock', 640, 20, 'Saat Darbesi (CLK)', 'sh_clk');
  const mode = busPart('switch', 640, 120, 'Mod (S1 S0)', 'sh_mode', { width: 2, state: { inputValue: 1 } });
  const mr = busPart('switch', 200, 420, "MR' (0 = Sıfırla)", 'sh_clr', { state: { on: true } });
  const sr = busPart('switch', 200, 520, 'DSR (Sağa Kaydırma Girişi)', 'sh_sr', { state: { on: true } });
  const d = busPart('switch', 360, 520, 'Paralel Veri (D3..D0)', 'sh_d', { width: 4, state: { inputValue: 0xa } });
  const sl = busPart('switch', 600, 420, 'DSL (Sola Kaydırma Girişi)', 'sh_sl');
  const reg = busPart('ttl74194', 360, 240, '74194', 'sh_core', { state: { ttlInternal: true } });
  const led = busPart('led', 120, 100, 'Q (Q3..Q0)', 'sh_led', { width: 4 });
  const pq = busPart('probe', 120, 190, 'Q (ikili)', 'sh_probe');
  const { wires, link } = busWires();
  const m = splitBits(link, 'sh_modebits', 'S1 S0', 580, 160, 2, [mode, mode.outputs[0]]);
  const db = splitBits(link, 'sh_dbits', 'D bitleri', 400, 420, 4, [d, d.outputs[0]]);
  link(clk, clk.outputs[0], reg, pk(reg, 'p11'));
  link(m, m.outputs[0], reg, pk(reg, 'p9'));
  link(m, m.outputs[1], reg, pk(reg, 'p10'));
  link(mr, mr.outputs[0], reg, pk(reg, 'p1'));
  link(sr, sr.outputs[0], reg, pk(reg, 'p2'));
  [3, 4, 5, 6].forEach((pin, i) => link(db, db.outputs[i], reg, pk(reg, `p${pin}`)));
  link(sl, sl.outputs[0], reg, pk(reg, 'p7'));
  const q = busPart('splitter', 380, 110, 'Q bitleri', 'sh_qbits', { splitter: { incoming: 4, fanout: 4 }, rotation: 90 });
  [15, 14, 13, 12].forEach((pin, i) => link(reg, pk(reg, `p${pin}`), q, q.outputs[i]));
  link(q, q.inputs[0], led, led.inputs[0]);
  link(q, q.inputs[0], pq, pq.inputs[0]);
  return {
    id: 'universal_shift_register_demo',
    name: '4-Bit Çift Yönlü Kaydırmalı Yazmaç (74194)',
    category: 'sequential',
    description:
      "Gerçek 74194 çipi: mod girişi (S1 S0) her yükselen saat kenarında ne yapılacağını seçer: 00 tut, 01 sağa kaydır (DSR → Q0 → Q1 → Q2 → Q3), 10 sola kaydır (DSL → Q3 → Q2 → Q1 → Q0), 11 paralel veriyi (D3..D0) yükle. "
      + "Başlangıçta mod 01 ve DSR = 1 olduğu için yazmaç Q0'dan başlayarak 1'lerle dolar. MR' anahtarı 0 yapılınca yazmaç saatten bağımsız sıfırlanır.",
    components: [clk, mode, m, mr, sr, d, db, sl, reg, q, led, pq],
    wires,
  };
}

function ramMemoryPreset(): CircuitPreset {
  const a = busPart('switch', 60, 80, 'Adres (A3..A0)', 'ram_sw_a', { width: 4 });
  const din = busPart('switch', 60, 180, 'Veri (D3..D0)', 'ram_sw_d', { width: 4 });
  const clk = busPart('clock', 60, 280, 'CLK (Yazma Saati)', 'ram_clk');
  const we = busPart('switch', 60, 360, 'WE (Yazma İzni)', 'ram_sw_we');
  const vcc = busPart('vcc', 140, 440, 'Seçili / Okuma (1)', 'ram_vcc');
  const ram = busPart('ram', 240, 80, '16x4 RAM', 'ram_chip', {
    configure: (c) => configureRam(c, { addrWidth: 4, dataWidth: 4, bus: 'separate' }),
  });
  const hex = hexDigitPart(560, 100, 'Okunan Veri (Hex)', 'ram_disp');
  const { wires, link } = busWires();
  link(a, a.outputs[0], ram, pk(ram, 'a'));
  link(din, din.outputs[0], ram, pk(ram, 'din'));
  link(clk, clk.outputs[0], ram, pk(ram, 'clk'));
  link(we, we.outputs[0], ram, pk(ram, 'we'));
  link(vcc, vcc.outputs[0], ram, pk(ram, 'cs'));
  link(vcc, vcc.outputs[0], ram, pk(ram, 'oe'));
  link(ram, pk(ram, 'd'), hex, pk(hex, 'in'));
  return {
    id: 'ram_memory_demo',
    name: '16x4-Bit RAM Bellek ve Hex Gösterge',
    category: 'sequential',
    description:
      "16 adresli 4 bitlik RAM (4 bit adres, 4 bit veri, ayrı veri girişi ve çıkışı): adresi ve veriyi 4 bitlik anahtarlardan ayarlayın, WE=1 iken CLK'nın yükselen kenarında veri belleğe yazılır. Seçilen adresteki veri doğrudan hex ekranda okunur.",
    components: [a, din, clk, we, vcc, ram, hex],
    wires,
  };
}

function decoder3to8Preset(): CircuitPreset {
  // 74138 pins: A0 1, A1 2, A2 3, E1' 4, E2' 5, E3 6 / Y0'..Y6' 15-9, Y7' 7 (active-low outputs)
  const a = busPart('switch', 40, 330, 'Adres (A2 A1 A0)', 'dec_sw_a', { width: 3 });
  const split = busPart('splitter', 160, 330, 'Adres bitleri', 'dec_split', { splitter: { incoming: 3, fanout: 3 } });
  const en = busPart('switch', 40, 440, 'E3 (yetki = 1)', 'dec_sw_en', { state: { on: true } });
  const low = busPart('gnd', 200, 440, "E1' = E2' = 0", 'dec_gnd');
  const dec = busPart('ttl74138', 320, 220, '74138', 'dec_chip', { state: { ttlInternal: true } });
  const yPins = [15, 14, 13, 12, 11, 10, 9, 7];
  const leds = yPins.map((_, i) =>
    busPart('led', i < 4 ? 620 : 780, 30 + (i % 4) * 120, `Y${i}' (${i.toString(2).padStart(3, '0')})`, `dec_led_${i}`)
  );
  const { wires, link } = busWires();
  link(a, a.outputs[0], split, pk(split, 'in0'));
  [1, 2, 3].forEach((pin, i) => link(split, pk(split, `out${i}`), dec, pk(dec, `p${pin}`)));
  link(en, en.outputs[0], dec, pk(dec, 'p6'));
  link(low, low.outputs[0], dec, pk(dec, 'p4'));
  link(low, low.outputs[0], dec, pk(dec, 'p5'));
  yPins.forEach((pin, i) => link(dec, pk(dec, `p${pin}`), leds[i], leds[i].inputs[0]));
  return {
    id: 'decoder_3to8_minterm_demo',
    name: '3:8 Kod Çözücü ile Minterm Seçimi (74138)',
    category: 'basic',
    description:
      "Gerçek 74138 çipi 3 bitlik adresi (A2 A1 A0) çözer. Çıkışlar aktif-düşüktür: adresin gösterdiği Yi' çıkışı 0 olur (LED'i söner), diğer yedisi 1 kalır; yani her çıkış bir mintermin tersidir (Yi' = mi'). "
      + "Çip yalnız E3 = 1, E1' = 0, E2' = 0 iken çalışır; E3 anahtarı 0 yapılırsa bütün çıkışlar 1 olur.",
    components: [a, split, en, low, dec, ...leds],
    wires,
  };
}

function sap1Preset(): CircuitPreset {
  const clk = busPart('clock', 60, 60, 'Ana Saat (CLK)', 'cpu_clk');
  const rst = busPart('switch', 60, 140, 'Sıfırla (Reset=0)', 'cpu_rst');
  const pc = busPart('counter', 180, 60, 'Program Sayacı (PC)', 'cpu_pc', { configure: (c) => configureMem(c, { width: 4 }) });
  const ram = busPart('ram', 340, 60, '16x4 Program Belleği (RAM)', 'cpu_ram', {
    configure: (c) => configureRam(c, { addrWidth: 4, dataWidth: 4, bus: 'separate' }),
    state: { memPages: memContents([3, 7, 2, 9, 12, 5, 1, 14, 0, 4, 8, 11, 15, 6, 10, 13]) },
  });
  const we = busPart('switch', 200, 260, 'RAM Yazma (WE=0)', 'cpu_we');
  const vcc = busPart('vcc', 260, 330, 'Seçili / Okuma (1)', 'cpu_vcc');
  const regA = busPart('register', 620, 60, 'A Yazmacı (Akümülatör)', 'cpu_reg_a', { configure: (c) => configureMem(c, { width: 4 }) });
  const regEn = busPart('switch', 500, 170, 'A-Yazmaç İzni (EN=1)', 'cpu_reg_we', { state: { on: true } });
  const disp = hexDigitPart(780, 60, 'Çıkış Portu (Display)', 'cpu_disp');
  const alu = busPart('alu', 680, 260, '4-Bit ALU', 'cpu_alu', { configure: (c) => configureArith(c, { width: 4 }) });
  const zero = busPart('constant', 480, 300, 'B = 0', 'cpu_alu_b', { width: 4, state: { constValue: 0 } });
  const op = busPart('constant', 480, 360, 'İşlem = 0 (ADD)', 'cpu_alu_op', { width: 3, state: { constValue: 0 } });
  const gnd = busPart('gnd', 480, 420, 'Elde = 0', 'cpu_alu_gnd');
  const { wires, link } = busWires();
  link(clk, clk.outputs[0], pc, pk(pc, 'clk'));
  link(rst, rst.outputs[0], pc, pk(pc, 'clr'));
  link(pc, pk(pc, 'q'), ram, pk(ram, 'a'));
  link(clk, clk.outputs[0], ram, pk(ram, 'clk'));
  link(we, we.outputs[0], ram, pk(ram, 'we'));
  link(vcc, vcc.outputs[0], ram, pk(ram, 'cs'));
  link(vcc, vcc.outputs[0], ram, pk(ram, 'oe'));
  link(ram, pk(ram, 'd'), regA, pk(regA, 'd'));
  link(clk, clk.outputs[0], regA, pk(regA, 'clk'));
  link(regEn, regEn.outputs[0], regA, pk(regA, 'en'));
  link(regA, pk(regA, 'q'), disp, pk(disp, 'in'));
  link(regA, pk(regA, 'q'), alu, pk(alu, 'a'));
  link(zero, zero.outputs[0], alu, pk(alu, 'b'));
  link(op, op.outputs[0], alu, pk(alu, 'op'));
  link(gnd, gnd.outputs[0], alu, pk(alu, 'cin'));
  return {
    id: 'sap1_micro_cpu_demo',
    name: 'SAP-1 Basit İşlemci (Simple As Possible CPU) Mimarisi',
    category: 'sequential',
    description:
      'Sıfırdan İşlemciye yolculuğunun zirvesi: Program Sayacı (PC), 16x4 Program Belleği (RAM), A Yazmacı (Akümülatör), 4-Bit ALU ve Çıkış Göstergesinden oluşan gerçek zamanlı çalışan eğitim işlemcisi. Parçalar arasındaki adres ve veri yolları 4 bitlik tek tellerdir; her saat darbesinde PC bir artar ve bellekteki sözcük A yazmacına yüklenir.',
    components: [clk, rst, pc, ram, we, vcc, regA, regEn, disp, alu, zero, op, gnd],
    wires,
  };
}

/** Clock -> 4-bit counter -> 16x4 ROM; returns the parts and the ROM, the wires so far and the link */
function melodyCore(prefix: string, romLabel: string, notes: number[], cntLabel: string, vccLabel: string) {
  const vcc = busPart('vcc', 50, 40, vccLabel, `vcc_${prefix}`);
  const clk = busPart('clock', 50, 110, prefix === 'mario' ? 'Tempo Saati (CLK)' : 'Tempo Saati', `clk_${prefix}`, {
    state: { frequencyHz: 4 },
  });
  const rst = busPart('pushbutton', 50, 180, prefix === 'mario' ? 'Başa Sar (CLR)' : 'Sıfırla / Başa Al', `rst_${prefix}`);
  const cnt = busPart('counter', 180, 100, cntLabel, `cnt_${prefix}`, { configure: (c) => configureMem(c, { width: 4 }) });
  const rom = busPart('rom', 340, 100, romLabel, `rom_${prefix}`, {
    configure: (c) => configureRam(c, { addrWidth: 4, dataWidth: 4 }),
    state: { memPages: memContents(notes) },
  });
  const { wires, link } = busWires();
  link(clk, clk.outputs[0], cnt, pk(cnt, 'clk'));
  link(rst, rst.outputs[0], cnt, pk(cnt, 'clr'));
  link(cnt, pk(cnt, 'q'), rom, pk(rom, 'a'));
  link(vcc, vcc.outputs[0], rom, pk(rom, 'cs'));
  return { vcc, clk, rst, cnt, rom, wires, link };
}

function chiptuneMusicBoxPreset(): CircuitPreset {
  const m = melodyCore('mario', 'Melodi ROM (Super Mario)', [9, 9, 15, 9, 15, 7, 9, 15, 11, 15, 15, 15, 4, 15, 15, 15], 'Melodi Sayacı (PC)', 'Ses İzni (EN=1)');
  const s = splitBits(m.link, 'split_mario', 'Nota Bitleri', 520, 110, 4, [m.rom, pk(m.rom, 'd')]);
  const buzz = busPart('buzzer', 600, 100, 'Chiptune Piezo Buzzer', 'buzz_mario');
  for (let i = 0; i < 4; i++) m.link(s, s.outputs[i], buzz, pk(buzz, `pitch${i}`));
  m.link(m.vcc, m.vcc.outputs[0], buzz, pk(buzz, 'in'));
  return {
    id: 'chiptune_music_box',
    name: '8-Bit Chiptune Müzik Kutusu (Super Mario Melodisi)',
    category: 'music_graphics',
    description:
      'Saat darbesi (CLK), 4 bitlik sayaç ve notaların yazılı olduğu 16x4 ROM belleğiyle piezo buzzer üzerinden Super Mario temasını 8-bit chiptune ses olarak çalan müzik devresi. Sayaç ROM adresini 4 bitlik tek telle sürer; ROM çıkışı bir splitter ile buzzer\'ın 4 nota bacağına dağıtılır.',
    components: [m.vcc, m.clk, m.rst, m.cnt, m.rom, s, buzz],
    wires: m.wires,
  };
}

function chiptuneSynthPreset(): CircuitPreset {
  const m = melodyCore('ps', 'Melodi ROM (Star Wars Fanfare)', [4, 4, 4, 7, 7, 11, 11, 10, 9, 8, 14, 14, 11, 11, 15, 15], 'Melodi Sayacı', 'Güç (VCC)');
  const hex = hexDigitPart(540, 220, 'Nota Göstergesi (0-F)', 'hex_note');
  const s = splitBits(m.link, 'split_ps', 'Nota Bitleri', 540, 90, 4, [m.rom, pk(m.rom, 'd')]);
  const buzz = busPart('buzzer', 640, 80, 'Chiptune Synthesizer', 'buzz_ps');
  const led = busPart('led', 680, 220, 'Sinyal Aktif LED', 'led_ps');
  m.link(m.rom, pk(m.rom, 'd'), hex, pk(hex, 'in'));
  for (let i = 0; i < 4; i++) m.link(s, s.outputs[i], buzz, pk(buzz, `pitch${i}`));
  m.link(m.vcc, m.vcc.outputs[0], buzz, pk(buzz, 'in'));
  m.link(m.vcc, m.vcc.outputs[0], led, led.inputs[0]);
  return {
    id: 'chiptune_synth_station',
    name: '8-Bit Retro Ses Synthesizer & Müzik İstasyonu Kiti',
    category: 'music_graphics',
    description:
      'Saat jeneratörü, 4 bitlik melodi sayacı, 16x4 melodi ROM belleği, 7-segment nota göstergesi ve piezo synthesizer içeren ses üretim kiti. ROM\'un 4 bitlik çıkışı hex göstergeye doğrudan, buzzer\'a bir splitter üzerinden gider.',
    components: [m.vcc, m.clk, m.rst, m.cnt, m.rom, hex, s, buzz, led],
    wires: m.wires,
  };
}

function dotMatrixPreset(): CircuitPreset {
  const vcc = busPart('vcc', 50, 40, 'VCC (1)', 'vcc_mat');
  const gnd = busPart('gnd', 50, 330, 'GND (0)', 'gnd_mat');
  const colSw = busPart('switch', 50, 120, 'Sütun 2 ve 5', 'sw_eye', { state: { on: true } });
  const rowSw = busPart('switch', 50, 220, 'Satır 5 ve 6', 'sw_smile', { state: { on: true } });
  const mat = busPart('dotMatrix', 360, 60, '8x8 Nokta Matris', 'disp_mat', {
    configure: (c) => configureIo(c, { cols: 8, rows: 8, matrixInput: 'select' }),
  });
  const { wires, link } = busWires();
  const V: [CircuitComponentInstance, CircuitPin] = [vcc, vcc.outputs[0]];
  const G: [CircuitComponentInstance, CircuitPin] = [gnd, gnd.outputs[0]];
  const C: [CircuitComponentInstance, CircuitPin] = [colSw, colSw.outputs[0]];
  const R: [CircuitComponentInstance, CircuitPin] = [rowSw, rowSw.outputs[0]];
  const cols = joinBits(link, 'mat_cols', 'Sütun Yolu (8 bit)', 220, 80, [G, G, C, V, V, C, G, G]);
  const rows = joinBits(link, 'mat_rows', 'Satır Yolu (8 bit)', 220, 240, [G, V, V, G, G, R, R, G]);
  link(cols, cols.inputs[0], mat, pk(mat, 'col'));
  link(rows, rows.inputs[0], mat, pk(mat, 'row'));
  return {
    id: 'dot_matrix_demo',
    name: '8x8 LED Nokta Matris: Satır × Sütun Kesişimi',
    category: 'music_graphics',
    description:
      "Matris 'satır/sütun seç' modundadır: bir piksel, satır yolundaki ve sütun yolundaki biti aynı anda 1 olduğunda yanar. İki 8 bitlik yol splitter'larla tek tek hatlardan kurulur (sayılar 0'dan başlar). VCC satır 1-2 ile sütun 3-4'ü sürekli sürer; iki anahtar satır 5-6'yı ve sütun 2 ile 5'i açıp kapatarak yanan bloğun nasıl büyüyüp küçüldüğünü gösterir.",
    components: [vcc, gnd, colSw, rowSw, cols, rows, mat],
    wires,
  };
}

function asciiKeyboardPreset(): CircuitPreset {
  // Logisim-evolution Keyboard -> TTY: on each clock edge with a character waiting (AV = 1) the keyboard gives up its
  // first character (RE) and the terminal writes the one on OUT (WE); the button clears both
  const kbd = busPart('keyboard', 60, 60, 'Klavye', 'kbd_unit', { state: { kbdBuf: 'Merhaba!\n', kbdCursor: 9 } });
  const clk = busPart('clock', 60, 180, 'Saat (CLK)', 'kbd_clk');
  const clr = busPart('pushbutton', 60, 270, 'Temizle (CLR)', 'kbd_clr');
  const av = busPart('led', 200, 180, 'Karakter Var (AV)', 'kbd_av');
  const tty = busPart('tty', 440, 40, 'Metin Terminali', 'kbd_tty');
  const { wires, link } = busWires();
  link(clk, clk.outputs[0], kbd, pk(kbd, 'clk'));
  link(clk, clk.outputs[0], tty, pk(tty, 'clk'));
  link(kbd, pk(kbd, 'avl'), kbd, pk(kbd, 'en'));
  link(kbd, pk(kbd, 'avl'), tty, pk(tty, 'we'));
  link(kbd, pk(kbd, 'avl'), av, av.inputs[0]);
  link(kbd, pk(kbd, 'out'), tty, pk(tty, 'in'));
  link(clr, clr.outputs[0], kbd, pk(kbd, 'clr'));
  link(clr, clr.outputs[0], tty, pk(tty, 'clr'));
  return {
    id: 'ascii_keyboard_terminal',
    name: 'Klavye ve Metin Terminali',
    category: 'music_graphics',
    description:
      "Klavyeye yazılan karakterler tamponda bekler; AV = 1 iken her saat kenarında klavye ilk karakteri tampondan çıkarır (RE) ve terminal OUT'taki 7 bitlik ASCII kodunu ekrana yazar (WE). Simülasyonu başlatınca tampondaki 'Merhaba!' ekrana akar; sonra klavyeyi seçip yazın (Enter yeni satır, Backspace siler, Ctrl+L ekranı temizler). Düğme ikisini de temizler.",
    components: [kbd, clk, clr, av, tty],
    wires,
  };
}

function rgbMatrixPreset(): CircuitPreset {
  // Logisim-evolution RGB Video, 16 x 16 pixels at scale 8 in the 8-colour model (DATA bit 2 = R, 1 = G, 0 = B):
  // the X / Y counters drive the 4-bit X / Y inputs directly and every clock edge paints (X, Y) in the switch colour
  const clk = busPart('clock', 40, 60, 'Piksel Saati (CLK)', 'clk_gpu', { state: { frequencyHz: 8 } });
  const cx = busPart('counter', 180, 60, 'X-Koordinat Sayacı', 'cnt_x', { configure: (c) => configureMem(c, { width: 4 }) });
  const cy = busPart('counter', 180, 240, 'Y-Koordinat Sayacı', 'cnt_y', { configure: (c) => configureMem(c, { width: 4 }) });
  const we = busPart('vcc', 40, 340, 'Yazma İzni (WE=1)', 'vcc_we');
  const rst = busPart('pushbutton', 40, 640, 'Ekranı Temizle (RST)', 'btn_rst');
  const r = busPart('switch', 40, 410, 'Kırmızı Renk (R)', 'sw_r', { state: { on: true } });
  const g = busPart('switch', 40, 480, 'Yeşil Renk (G)', 'sw_g');
  const b = busPart('switch', 40, 550, 'Mavi Renk (B)', 'sw_b', { state: { on: true } });
  const scr = busPart('rgbVideo', 500, 40, '16x16 RGB Video Ekranı', 'gpu_screen', {
    configure: (c) => configureVideo(c, { width: 16, height: 16, scale: 8, color: 'rgb111' }),
    // the pins and their wires leave along the bottom edge
    state: { labelPos: 'top' },
  });
  const { wires, link } = busWires();
  link(clk, clk.outputs[0], cx, pk(cx, 'clk'));
  link(clk, clk.outputs[0], cy, pk(cy, 'clk'));
  link(clk, clk.outputs[0], scr, pk(scr, 'clk'));
  // Y counts once per line: only on the clock edge where X wraps from 15 to 0 (X's carry = 1 at 15)
  link(cx, pk(cx, 'carry'), cy, pk(cy, 'ct'));
  link(cx, pk(cx, 'q'), scr, pk(scr, 'x'));
  link(cy, pk(cy, 'q'), scr, pk(scr, 'y'));
  const rgb = joinBits(link, 'join_rgb', 'Renk (R G B)', 300, 480, [
    [b, b.outputs[0]],
    [g, g.outputs[0]],
    [r, r.outputs[0]],
  ]);
  link(rgb, rgb.inputs[0], scr, pk(scr, 'data'));
  link(we, we.outputs[0], scr, pk(scr, 'we'));
  link(rst, rst.outputs[0], scr, pk(scr, 'rst'));
  return {
    id: 'rgb_matrix_gpu_painter',
    name: '16x16 RGB Video Ekranı Kiti',
    category: 'music_graphics',
    description:
      "X ve Y koordinat sayaçları, RGB renk anahtarları ve Yazma İzni (WE) ile 16x16 piksellik RGB Video ekranına çizim yapan devre. Ekran 8 renk modelindedir: üç anahtar bir splitter'la 3 bitlik DATA'yı kurar (bit 2 kırmızı, bit 1 yeşil, bit 0 mavi). Her saat kenarında (X, Y) pikseli seçilen renge boyanır; X'in elde çıkışı (X = 15) Y'nin sayma iznine bağlı olduğu için Y her satır sonunda bir artar (senkron sayaç zinciri). Anahtarları değiştirip ekranı yeni renkle yeniden boyatın; düğme ekranı siyaha döndürür.",
    components: [clk, cx, cy, we, rst, r, g, b, rgb, scr],
    wires,
  };
}

function busAluPreset(): CircuitPreset {
  const a = busPart('switch', 60, 120, 'A (4 bit)', 'bal_a', { width: 4, state: { inputValue: 7 } });
  const b = busPart('switch', 60, 220, 'B (4 bit)', 'bal_b', { width: 4, state: { inputValue: 5 } });
  const op = busPart('switch', 200, 40, 'İşlem (3 bit)', 'bal_op', { width: 3, state: { inputValue: 0 } });
  const cin = busPart('switch', 60, 320, 'Elde Girişi (Cin)', 'bal_cin');
  const alu = busPart('alu', 240, 140, '4-Bit ALU', 'bal_alu', { configure: (c) => configureArith(c, { width: 4 }) });
  const ledF = busPart('led', 460, 120, 'F (4 bit)', 'bal_ledf', { width: 4 });
  const pF = busPart('probe', 460, 40, 'F (ondalık)', 'bal_pf', { state: { radix: '10u' } });
  const ledZ = busPart('led', 300, 300, 'Sıfır (Z)', 'bal_ledz');
  const ledN = busPart('led', 400, 300, 'Negatif (N)', 'bal_ledn');
  const ledC = busPart('led', 500, 300, 'Elde Çıkışı (C)', 'bal_ledc');
  const ledV = busPart('led', 600, 300, 'Taşma (V)', 'bal_ledv');
  const { wires, link } = busWires();
  link(a, a.outputs[0], alu, pk(alu, 'a'));
  link(b, b.outputs[0], alu, pk(alu, 'b'));
  link(op, op.outputs[0], alu, pk(alu, 'op'));
  link(cin, cin.outputs[0], alu, pk(alu, 'cin'));
  link(alu, pk(alu, 'out'), ledF, ledF.inputs[0]);
  link(alu, pk(alu, 'out'), pF, pF.inputs[0]);
  link(alu, pk(alu, 'z'), ledZ, ledZ.inputs[0]);
  link(alu, pk(alu, 'n'), ledN, ledN.inputs[0]);
  link(alu, pk(alu, 'c'), ledC, ledC.inputs[0]);
  link(alu, pk(alu, 'v'), ledV, ledV.inputs[0]);
  return {
    id: 'bus_alu4',
    name: "Çok Bitli: 4-Bit ALU'yu Veri Yollarıyla Sürmek",
    category: 'bus',
    description:
      "A ve B 4 bitlik, işlem seçimi 3 bitlik veri yollarından doğrudan ALU'ya girer; sonuç F 4 bitlik tek teldir, yanında Z N C V bayrakları. Başlangıç: 7 + 5 = 12. İşlem: 0 ADD, 1 SUB, 2 AND, 3 OR, 4 XOR, 5 NOR, 6 SLT (A < B ise 1), 7 B'yi geçir. Çıkarmada C ödünç (borrow) bayrağıdır: A < B ise 1.",
    components: [a, b, op, cin, alu, ledF, pF, ledZ, ledN, ledC, ledV],
    wires,
  };
}

/**
 * Standard Circuit Presets from "Sıfırdan İşlemciye"
 */
const RAW_CIRCUIT_PRESETS: CircuitPreset[] = [
  {
    id: 'half_adder',
    name: '1-Bit Yarım Toplayıcı (Half Adder)',
    category: 'arithmetic',
    description: 'XOR ve AND kapılarıyla kurulan, A ve B bitlerini toplayan temel kombinasyonel devre (S = A ⊕ B, C = A · B).',
    components: [
      {
        ...createComponentInstance('switch', 60, 100, 'Giriş A'),
        id: 'sw_A',
      },
      {
        ...createComponentInstance('switch', 60, 220, 'Giriş B'),
        id: 'sw_B',
      },
      {
        ...createComponentInstance('xor', 260, 90, 'XOR (Toplam S)'),
        id: 'gate_xor',
      },
      {
        ...createComponentInstance('and', 260, 210, 'AND (Elde C)'),
        id: 'gate_and',
      },
      {
        ...createComponentInstance('led', 460, 90, 'Toplam (S)'),
        id: 'led_S',
      },
      {
        ...createComponentInstance('led', 460, 210, 'Elde (C)'),
        id: 'led_C',
      },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sw_A', fromPinId: 'sw_A_out', toCompId: 'gate_xor', toPinId: 'gate_xor_in0', value: 0 },
      { id: 'w2', fromCompId: 'sw_B', fromPinId: 'sw_B_out', toCompId: 'gate_xor', toPinId: 'gate_xor_in1', value: 0 },
      { id: 'w3', fromCompId: 'sw_A', fromPinId: 'sw_A_out', toCompId: 'gate_and', toPinId: 'gate_and_in0', value: 0 },
      { id: 'w4', fromCompId: 'sw_B', fromPinId: 'sw_B_out', toCompId: 'gate_and', toPinId: 'gate_and_in1', value: 0 },
      { id: 'w5', fromCompId: 'gate_xor', fromPinId: 'gate_xor_out', toCompId: 'led_S', toPinId: 'led_S_in', value: 0 },
      { id: 'w6', fromCompId: 'gate_and', fromPinId: 'gate_and_out', toCompId: 'led_C', toPinId: 'led_C_in', value: 0 },
    ],
  },
  {
    id: 'full_adder',
    name: '1-Bit Tam Toplayıcı (Full Adder)',
    category: 'arithmetic',
    description: 'A, B ve Elde Girişi (Cin) bitlerini toplayarak Toplam (S) ve Elde Çıkışı (Cout) üreten temel toplayıcı.',
    components: [
      { ...createComponentInstance('switch', 50, 80, 'Giriş A'), id: 'sw_fa_a', state: { on: true } },
      { ...createComponentInstance('switch', 50, 180, 'Giriş B'), id: 'sw_fa_b', state: { on: true } },
      { ...createComponentInstance('switch', 50, 280, 'Elde Girişi (Cin)'), id: 'sw_fa_cin', state: { on: false } },
      { ...createComponentInstance('fullAdder', 260, 150, '1-Bit Tam Toplayıcı'), id: 'fa_1' },
      { ...createComponentInstance('led', 480, 110, 'Toplam (S)'), id: 'led_fa_s' },
      { ...createComponentInstance('led', 480, 230, 'Elde Çıkışı (Cout)'), id: 'led_fa_cout' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sw_fa_a', fromPinId: 'sw_fa_a_out', toCompId: 'fa_1', toPinId: 'fa_1_inA', value: 1 },
      { id: 'w2', fromCompId: 'sw_fa_b', fromPinId: 'sw_fa_b_out', toCompId: 'fa_1', toPinId: 'fa_1_inB', value: 1 },
      { id: 'w3', fromCompId: 'sw_fa_cin', fromPinId: 'sw_fa_cin_out', toCompId: 'fa_1', toPinId: 'fa_1_inCin', value: 0 },
      { id: 'w4', fromCompId: 'fa_1', fromPinId: 'fa_1_outS', toCompId: 'led_fa_s', toPinId: 'led_fa_s_in', value: 0 },
      { id: 'w5', fromCompId: 'fa_1', fromPinId: 'fa_1_outCout', toCompId: 'led_fa_cout', toPinId: 'led_fa_cout_in', value: 1 },
    ],
  },
  {
    id: 'xor_gate_internal',
    name: "XOR Kapısının İç Yapısı (A'B + AB')",
    category: 'basic',
    description: "İki AND, iki NOT ve bir OR kapısı kullanılarak oluşturulan denk XOR mantık devresi.",
    components: [
      { ...createComponentInstance('switch', 50, 100, 'Giriş A'), id: 'in_a' },
      { ...createComponentInstance('switch', 50, 260, 'Giriş B'), id: 'in_b' },
      { ...createComponentInstance('not', 200, 70, "NOT A (A')"), id: 'not_a' },
      { ...createComponentInstance('not', 200, 290, "NOT B (B')"), id: 'not_b' },
      { ...createComponentInstance('and', 340, 100, "AND (A'B)"), id: 'and_1' },
      { ...createComponentInstance('and', 340, 250, "AND (AB')"), id: 'and_2' },
      { ...createComponentInstance('or', 490, 180, 'OR Çıkışı'), id: 'or_1' },
      { ...createComponentInstance('led', 630, 180, 'XOR LED'), id: 'led_out' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'in_a', fromPinId: 'in_a_out', toCompId: 'not_a', toPinId: 'not_a_in', value: 0 },
      { id: 'w2', fromCompId: 'in_a', fromPinId: 'in_a_out', toCompId: 'and_2', toPinId: 'and_2_in0', value: 0 },
      { id: 'w3', fromCompId: 'in_b', fromPinId: 'in_b_out', toCompId: 'not_b', toPinId: 'not_b_in', value: 0 },
      { id: 'w4', fromCompId: 'in_b', fromPinId: 'in_b_out', toCompId: 'and_1', toPinId: 'and_1_in1', value: 0 },
      { id: 'w5', fromCompId: 'not_a', fromPinId: 'not_a_out', toCompId: 'and_1', toPinId: 'and_1_in0', value: 0 },
      { id: 'w6', fromCompId: 'not_b', fromPinId: 'not_b_out', toCompId: 'and_2', toPinId: 'and_2_in1', value: 0 },
      { id: 'w7', fromCompId: 'and_1', fromPinId: 'and_1_out', toCompId: 'or_1', toPinId: 'or_1_in0', value: 0 },
      { id: 'w8', fromCompId: 'and_2', fromPinId: 'and_2_out', toCompId: 'or_1', toPinId: 'or_1_in1', value: 0 },
      { id: 'w9', fromCompId: 'or_1', fromPinId: 'or_1_out', toCompId: 'led_out', toPinId: 'led_out_in', value: 0 },
    ],
  },
  {
    id: 'mux_2to1',
    name: '2:1 Çoklayıcı (Multiplexer - MUX)',
    category: 'basic',
    description: "S = 0 iken D0 girişini, S = 1 iken D1 girişini çıkışa ileten kombinasyonel veri seçici devre.",
    components: [
      { ...createComponentInstance('switch', 50, 80, 'Veri D0'), id: 'in_d0' },
      { ...createComponentInstance('switch', 50, 220, 'Veri D1'), id: 'in_d1' },
      { ...createComponentInstance('switch', 50, 340, 'Seçici S'), id: 'in_s' },
      { ...createComponentInstance('not', 200, 340, "NOT S (S')"), id: 'not_s' },
      { ...createComponentInstance('and', 340, 100, "AND (D0·S')"), id: 'and_0' },
      { ...createComponentInstance('and', 340, 240, 'AND (D1·S)'), id: 'and_1' },
      { ...createComponentInstance('or', 480, 170, 'OR Çıkışı (Y)'), id: 'or_out' },
      { ...createComponentInstance('led', 620, 170, 'Çıkış LED (Y)'), id: 'led_y' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'in_d0', fromPinId: 'in_d0_out', toCompId: 'and_0', toPinId: 'and_0_in0', value: 0 },
      { id: 'w2', fromCompId: 'in_d1', fromPinId: 'in_d1_out', toCompId: 'and_1', toPinId: 'and_1_in0', value: 0 },
      { id: 'w3', fromCompId: 'in_s', fromPinId: 'in_s_out', toCompId: 'not_s', toPinId: 'not_s_in', value: 0 },
      { id: 'w4', fromCompId: 'in_s', fromPinId: 'in_s_out', toCompId: 'and_1', toPinId: 'and_1_in1', value: 0 },
      { id: 'w5', fromCompId: 'not_s', fromPinId: 'not_s_out', toCompId: 'and_0', toPinId: 'and_0_in1', value: 0 },
      { id: 'w6', fromCompId: 'and_0', fromPinId: 'and_0_out', toCompId: 'or_out', toPinId: 'or_out_in0', value: 0 },
      { id: 'w7', fromCompId: 'and_1', fromPinId: 'and_1_out', toCompId: 'or_out', toPinId: 'or_out_in1', value: 0 },
      { id: 'w8', fromCompId: 'or_out', fromPinId: 'or_out_out', toCompId: 'led_y', toPinId: 'led_y_in', value: 0 },
    ],
  },
  dFlipFlopPreset(),
  tFlipFlopCounterPreset(),
  {
    id: 'sr_latch_memory',
    name: 'SR Mandalı (Set-Reset Bistable Latch)',
    category: 'sequential',
    description: 'Anlık SET ve RESET butonlarıyla kontrol edilen, 1 bit veriyi kalıcı olarak hafızasında tutan asenkron bellek hücresi.',
    components: [
      { ...createComponentInstance('pushbutton', 50, 80, 'SET Butonu (S)'), id: 'btn_s' },
      { ...createComponentInstance('pushbutton', 50, 220, 'RESET Butonu (R)'), id: 'btn_r' },
      { ...createComponentInstance('srLatch', 220, 130, 'SR Mandalı'), id: 'sr_latch_1' },
      { ...createComponentInstance('led', 430, 90, 'Q (Çıkış)'), id: 'led_sr_q' },
      { ...createComponentInstance('led', 430, 210, "Q' (Ters Çıkış)"), id: 'led_sr_qbar' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'btn_s', fromPinId: 'btn_s_out', toCompId: 'sr_latch_1', toPinId: 'sr_latch_1_inS', value: 0 },
      { id: 'w2', fromCompId: 'btn_r', fromPinId: 'btn_r_out', toCompId: 'sr_latch_1', toPinId: 'sr_latch_1_inR', value: 0 },
      { id: 'w3', fromCompId: 'sr_latch_1', fromPinId: 'sr_latch_1_outQ', toCompId: 'led_sr_q', toPinId: 'led_sr_q_in', value: 0 },
      { id: 'w4', fromCompId: 'sr_latch_1', fromPinId: 'sr_latch_1_outQBar', toCompId: 'led_sr_qbar', toPinId: 'led_sr_qbar_in', value: 1 },
    ],
  },
  decoder2to4Preset(),
  hexDisplayPreset(),
  {
    id: 'tristate_bus',
    name: '3 Durumlu Tampon & Ortak Veri Yolu (Tri-State Bus)',
    category: 'bus',
    description: 'Ortak bir veri yolu hattını iki farklı kaynağın çakışma (contention) olmadan paylaşmasını sağlayan 3 Durumlu Tampon (Tri-State) mimarisi.',
    components: [
      { ...createComponentInstance('switch', 50, 70, 'Kaynak 1 (Veri A)'), id: 'sw_data_a', state: { on: true } },
      { ...createComponentInstance('switch', 50, 190, 'Veri Yolu Seçici (SEL)'), id: 'sw_sel', state: { on: false } },
      { ...createComponentInstance('not', 190, 130, 'NOT SEL'), id: 'not_sel' },
      { ...createComponentInstance('switch', 50, 310, 'Kaynak 2 (Veri B)'), id: 'sw_data_b', state: { on: false } },
      { ...createComponentInstance('triState', 310, 70, 'Tampon A'), id: 'buf_a' },
      { ...createComponentInstance('triState', 310, 250, 'Tampon B'), id: 'buf_b' },
      { ...createComponentInstance('led', 530, 160, 'Ortak Veri Yolu LED'), id: 'bus_led' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sw_data_a', fromPinId: 'sw_data_a_out', toCompId: 'buf_a', toPinId: 'buf_a_inA', value: 1 },
      { id: 'w2', fromCompId: 'sw_sel', fromPinId: 'sw_sel_out', toCompId: 'not_sel', toPinId: 'not_sel_in', value: 0 },
      { id: 'w3', fromCompId: 'not_sel', fromPinId: 'not_sel_out', toCompId: 'buf_a', toPinId: 'buf_a_inEN', value: 1 },
      { id: 'w4', fromCompId: 'sw_sel', fromPinId: 'sw_sel_out', toCompId: 'buf_b', toPinId: 'buf_b_inEN', value: 0 },
      { id: 'w5', fromCompId: 'sw_data_b', fromPinId: 'sw_data_b_out', toCompId: 'buf_b', toPinId: 'buf_b_inA', value: 0 },
      { id: 'w6', fromCompId: 'buf_a', fromPinId: 'buf_a_outY', toCompId: 'bus_led', toPinId: 'bus_led_in', value: 1 },
      { id: 'w7', fromCompId: 'buf_b', fromPinId: 'buf_b_outY', toCompId: 'bus_led', toPinId: 'bus_led_in', value: 1 },
    ],
  },
  aluConstantsPreset(),
  counterHexPreset(),
  comparatorPreset(),
  priorityEncoderPreset(),
  universalShiftRegisterPreset(),
  ramMemoryPreset(),
  {
    id: 'full_subtractor_demo',
    name: '1-Bit Tam Çıkarıcı (Full Subtractor)',
    category: 'arithmetic',
    description: 'Eksilen (A), Çıkan (B) ve Borç Girişi (Bin) mantık anahtarlarıyla Fark (Diff) ve Borç Çıkışı (Bout) hesaplayan tam çıkarıcı devresi.',
    components: [
      { ...createComponentInstance('switch', 80, 50, 'A (Eksilen)'), id: 'fs_sw_a' },
      { ...createComponentInstance('switch', 80, 110, 'B (Çıkan)'), id: 'fs_sw_b' },
      { ...createComponentInstance('switch', 80, 170, 'Bin (Borç Girişi)'), id: 'fs_sw_bin' },
      { ...createComponentInstance('fullSubtractor', 230, 80, '1-Bit Tam Çıkarıcı'), id: 'fs_core' },
      { ...createComponentInstance('led', 390, 70, 'Fark (Diff = A⊕B⊕Bin)'), id: 'fs_led_diff' },
      { ...createComponentInstance('led', 390, 150, 'Borç Çıkışı (Bout)'), id: 'fs_led_bout' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'fs_sw_a', fromPinId: 'fs_sw_a_out', toCompId: 'fs_core', toPinId: 'fs_core_inA', value: 0 },
      { id: 'w2', fromCompId: 'fs_sw_b', fromPinId: 'fs_sw_b_out', toCompId: 'fs_core', toPinId: 'fs_core_inB', value: 0 },
      { id: 'w3', fromCompId: 'fs_sw_bin', fromPinId: 'fs_sw_bin_out', toCompId: 'fs_core', toPinId: 'fs_core_inBin', value: 0 },
      { id: 'w4', fromCompId: 'fs_core', fromPinId: 'fs_core_outD', toCompId: 'fs_led_diff', toPinId: 'fs_led_diff_in', value: 0 },
      { id: 'w5', fromCompId: 'fs_core', fromPinId: 'fs_core_outBout', toCompId: 'fs_led_bout', toPinId: 'fs_led_bout_in', value: 0 },
    ],
  },
  {
    id: 'bcd_to_7seg_display_demo',
    name: 'BCD/Hex → 7-Segment Kod Çözücü ve LED Ekran',
    category: 'basic',
    description: '4-Bit ikili kodu 7-segment LED göstergesi formatına (a-g) dönüştürerek 0-9 rakamlarını (10-15 için A-F harflerini) görüntüler. Çözücü aktif-yüksek çıkış verir (ortak katot ekran); gerçek 74LS47 aktif-düşüktür.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'A (Bit 0 LSB)'), id: 'bcd_sw_a' },
      { ...createComponentInstance('switch', 60, 100, 'B (Bit 1)'), id: 'bcd_sw_b' },
      { ...createComponentInstance('switch', 60, 150, 'C (Bit 2)'), id: 'bcd_sw_c' },
      { ...createComponentInstance('switch', 60, 200, 'D (Bit 3 MSB)'), id: 'bcd_sw_d' },
      { ...createComponentInstance('bcdTo7Seg', 210, 80, 'BCD/Hex → 7-Seg'), id: 'bcd_chip' },
      { ...createComponentInstance('sevenSegment', 380, 90, '7-Segment Ekran'), id: 'bcd_disp' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'bcd_sw_a', fromPinId: 'bcd_sw_a_out', toCompId: 'bcd_chip', toPinId: 'bcd_chip_inA', value: 0 },
      { id: 'w2', fromCompId: 'bcd_sw_b', fromPinId: 'bcd_sw_b_out', toCompId: 'bcd_chip', toPinId: 'bcd_chip_inB', value: 0 },
      { id: 'w3', fromCompId: 'bcd_sw_c', fromPinId: 'bcd_sw_c_out', toCompId: 'bcd_chip', toPinId: 'bcd_chip_inC', value: 0 },
      { id: 'w4', fromCompId: 'bcd_sw_d', fromPinId: 'bcd_sw_d_out', toCompId: 'bcd_chip', toPinId: 'bcd_chip_inD', value: 0 },
      { id: 'w5', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outA', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inA', value: 0 },
      { id: 'w6', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outB', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inB', value: 0 },
      { id: 'w7', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outC', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inC', value: 0 },
      { id: 'w8', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outD', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inD', value: 0 },
      { id: 'w9', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outE', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inE', value: 0 },
      { id: 'w10', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outF', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inF', value: 0 },
      { id: 'w11', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outG', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inG', value: 0 },
    ],
  },
  decoder3to8Preset(),
  sap1Preset(),
  chiptuneMusicBoxPreset(),
  chiptuneSynthPreset(),
  dotMatrixPreset(),
  asciiKeyboardPreset(),
  rgbMatrixPreset(),
  busSplitJoinPreset(),
  busAluPreset(),
  busSignExtendPreset(),
  busBitSelectorPreset(),
  busTriStatePreset(),
];

export const CIRCUIT_PRESETS: CircuitPreset[] = RAW_CIRCUIT_PRESETS.map((preset) => ({
  ...preset,
  components: preset.components.map((c) =>
    POWER_UP_X_TYPES.has(c.type) ? { ...c, outputs: c.outputs.map((p) => ({ ...p, value: 'X' as SignalValue })) } : c
  ),
  wires: repairWires(preset.wires, preset.components),
}));

/**
 * Standard 7-Segment Hex Truth Table Lookup
 */
export const HEX_7SEG_MAP: Record<number, { a: boolean; b: boolean; c: boolean; d: boolean; e: boolean; f: boolean; g: boolean }> = {
  0:  { a: true,  b: true,  c: true,  d: true,  e: true,  f: true,  g: false },
  1:  { a: false, b: true,  c: true,  d: false, e: false, f: false, g: false },
  2:  { a: true,  b: true,  c: false, d: true,  e: true,  f: false, g: true  },
  3:  { a: true,  b: true,  c: true,  d: true,  e: false, f: false, g: true  },
  4:  { a: false, b: true,  c: true,  d: false, e: false, f: true,  g: true  },
  5:  { a: true,  b: false, c: true,  d: true,  e: false, f: true,  g: true  },
  6:  { a: true,  b: false, c: true,  d: true,  e: true,  f: true,  g: true  },
  7:  { a: true,  b: true,  c: true,  d: false, e: false, f: false, g: false },
  8:  { a: true,  b: true,  c: true,  d: true,  e: true,  f: true,  g: true  },
  9:  { a: true,  b: true,  c: true,  d: true,  e: false, f: true,  g: true  },
  10: { a: true,  b: true,  c: true,  d: false, e: true,  f: true,  g: true  }, // A
  11: { a: false, b: false, c: true,  d: true,  e: true,  f: true,  g: true  }, // b
  12: { a: true,  b: false, c: false, d: true,  e: true,  f: true,  g: false }, // C
  13: { a: false, b: true,  c: true,  d: true,  e: true,  f: false, g: true  }, // d
  14: { a: true,  b: false, c: false, d: true,  e: true,  f: true,  g: true  }, // E
  15: { a: true,  b: false, c: false, d: false, e: true,  f: true,  g: true  }, // F
};

/**
 * 16-Tone Programmable Chiptune Musical Scale Table (Do-Re-Mi / Hz)
 */
export const CHIPTUNE_NOTE_FREQS: Record<number, number> = {
  0: 261.63,  // C4 (Do)
  1: 293.66,  // D4 (Re)
  2: 329.63,  // E4 (Mi)
  3: 349.23,  // F4 (Fa)
  4: 392.00,  // G4 (Sol)
  5: 440.00,  // A4 (La)
  6: 493.88,  // B4 (Si)
  7: 523.25,  // C5 (İnce Do)
  8: 587.33,  // D5 (İnce Re)
  9: 659.25,  // E5 (İnce Mi)
  10: 698.46, // F5 (İnce Fa)
  11: 783.99, // G5 (İnce Sol)
  12: 880.00, // A5 (İnce La)
  13: 987.77, // B5 (İnce Si)
  14: 1046.50,// C6 (Tiz Do)
  15: 0,      // Sessiz / Mute
};

export const CHIPTUNE_NOTE_NAMES: Record<number, string> = {
  0: 'C4 (Do)',
  1: 'D4 (Re)',
  2: 'E4 (Mi)',
  3: 'F4 (Fa)',
  4: 'G4 (Sol)',
  5: 'A4 (La)',
  6: 'B4 (Si)',
  7: 'C5 (Do)',
  8: 'D5 (Re)',
  9: 'E5 (Mi)',
  10: 'F5 (Fa)',
  11: 'G5 (Sol)',
  12: 'A5 (La)',
  13: 'B5 (Si)',
  14: 'C6',
  15: 'Sessiz',
};

/**
 * Recursively trace boolean algebraic expressions backwards from an output pin to input switches
 */
/**
 * Names of the input switches/buttons as they appear in formulas and truth tables. A part keeps its own
 * label when that label is unique and not the default one; the others become A, B, C ... (otherwise every
 * fresh switch is called "Giriş Anahtarı" and formulas read "Giriş Anahtarı · Giriş Anahtarı").
 */
export function getInputSignalNames(components: CircuitComponentInstance[]): Map<string, string> {
  const inputs = components.filter((c) => c.type === 'switch' || c.type === 'pushbutton');
  const defaults = new Set([COMPONENT_CATALOG.switch.name, COMPONENT_CATALOG.pushbutton.name, '']);
  const count = new Map<string, number>();
  for (const c of inputs) {
    const l = (c.label || '').trim();
    count.set(l, (count.get(l) || 0) + 1);
  }
  const keepsLabel = (c: CircuitComponentInstance) => {
    const l = (c.label || '').trim();
    return !defaults.has(l) && count.get(l) === 1;
  };
  const used = new Set(inputs.filter(keepsLabel).map((c) => (c.label || '').trim()));
  let letter = 0;
  const names = new Map<string, string>();
  for (const c of inputs) {
    if (keepsLabel(c)) {
      names.set(c.id, (c.label || '').trim());
      continue;
    }
    let name = '';
    do {
      name = letter < 26 ? String.fromCharCode(65 + letter) : `X${letter - 25}`;
      letter++;
    } while (used.has(name));
    used.add(name);
    names.set(c.id, name);
  }
  return names;
}

// Longest expression kept inline; deeper cones (e.g. a ripple carry built from gates, whose text doubles
// per stage) fall back to the driving part's name instead of growing without bound
const MAX_EXPR_LENGTH = 240;

// A cone that reaches a wide (multi-bit) signal has no single-bit formula: such an output gets no
// expression (the truth table still gives every bit its minimal SOP). Not '?', which the tri-state
// formula uses as its condition operator.
const OPAQUE_EXPR = '\u0000';
// A gate none of whose inputs has a driver has no formula at all (Logisim's ExpressionComputer leaves
// its output out); a gate reading it skips that input like an open one
const NO_EXPR = '\u0001';
// Gates that ignore inputs without a driver, like Logisim's analyzer
const SKIP_OPEN_INPUT_GATES = new Set(['and', 'or', 'nand', 'nor', 'xor', 'xnor']);
const isWidePin = (p: CircuitPin | undefined) => (p?.width ?? 1) > 1;
// Parts whose bits are only meaningful as a bus: their outputs are not single-bit formulas
const BUS_ONLY_TYPES = new Set(['splitter', 'bitExtender', 'bitSelector']);

interface BooleanExprContext {
  driverOf: (pinId: string) => { comp: CircuitComponentInstance; outIdx: number } | null;
  byId: Map<string, CircuitComponentInstance>;
  inputNames: Map<string, string>;
  memo: Map<string, string>;
}

// Net map built once per circuit: every pin's driving output (tunnels excluded, like the old per-call search)
function createBooleanExprContext(components: CircuitComponentInstance[], wires: CircuitWire[]): BooleanExprContext {
  const parent = new Map<string, string>();
  const findR = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let c = k;
    while (c !== parent.get(c)) {
      const p = parent.get(c)!;
      parent.set(c, parent.get(p)!);
      c = p;
    }
    return c;
  };
  const unite = (a: string, b: string) => {
    const ra = findR(a);
    const rb = findR(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  components.forEach((c) => {
    [...c.inputs, ...c.outputs].forEach((p) => {
      unite(p.id, `loc_${Math.round(p.x / 10) * 10}_${Math.round(p.y / 10) * 10}`);
    });
  });
  wires.forEach((w) => {
    if (w.fromPinId && w.toPinId) unite(w.fromPinId, w.toPinId);
    if (w.startPoint && w.endPoint) {
      const ks = `loc_${Math.round(w.startPoint.x / 10) * 10}_${Math.round(w.startPoint.y / 10) * 10}`;
      const ke = `loc_${Math.round(w.endPoint.x / 10) * 10}_${Math.round(w.endPoint.y / 10) * 10}`;
      unite(ks, ke);
      if (w.fromPinId) unite(w.fromPinId, ks);
      if (w.toPinId) unite(w.toPinId, ke);
    }
  });
  const driverByRoot = new Map<string, { comp: CircuitComponentInstance; outIdx: number }>();
  for (const c of components) {
    if (c.type === 'tunnel') continue;
    c.outputs.forEach((o, idx) => {
      const r = findR(o.id);
      if (!driverByRoot.has(r)) driverByRoot.set(r, { comp: c, outIdx: idx });
    });
  }
  return {
    driverOf: (pinId) => driverByRoot.get(findR(pinId)) || null,
    byId: new Map(components.map((c) => [c.id, c])),
    inputNames: getInputSignalNames(components),
    memo: new Map(),
  };
}

function booleanExprOf(
  compId: string,
  pinIndex: number | undefined,
  ctx: BooleanExprContext,
  visited: Set<string>
): string {
  const comp = ctx.byId.get(compId);
  if (!comp) return '?';

  if (comp.type === 'switch' || comp.type === 'pushbutton') {
    if (isWidePin(comp.outputs[0])) return OPAQUE_EXPR;
    return ctx.inputNames.get(comp.id) || (comp.type === 'switch' ? 'SW' : 'BTN');
  }
  if (comp.type === 'vcc') return '1';
  if (comp.type === 'gnd') return '0';
  if (comp.type === 'constant') return isWidePin(comp.outputs[0]) ? OPAQUE_EXPR : String((comp.state.constValue ?? 1) % 2);
  if (comp.type === 'clock') return 'CLK';

  if (comp.type === 'led' || comp.type === 'probe' || comp.type === 'buzzer') {
    const inPin = comp.inputs[0];
    if (!inPin) return '?';
    if (isWidePin(inPin)) return OPAQUE_EXPR;
    const driver = ctx.driverOf(inPin.id);
    if (!driver) return '0';
    if (visited.has(comp.id)) return '...';
    const nextVisited = new Set(visited);
    nextVisited.add(comp.id);
    return booleanExprOf(driver.comp.id, driver.outIdx, ctx, nextVisited);
  }

  if (visited.has(comp.id)) return '...';
  if (
    BUS_ONLY_TYPES.has(comp.type) ||
    (pinIndex !== undefined && isWidePin(comp.outputs[pinIndex])) ||
    comp.inputs.some(isWidePin)
  ) {
    return OPAQUE_EXPR;
  }
  // A cone without feedback has the same text whichever path reached it, so it is computed once
  const memoKey = `${comp.id}#${pinIndex ?? ''}`;
  const cached = ctx.memo.get(memoKey);
  if (cached !== undefined) return cached;
  const newVisited = new Set(visited);
  newVisited.add(comp.id);

  let hitLoop = false;
  // Formula of an input; null when nothing drives it (or its driver has no formula)
  const traceInput = (inputPinId: string): string | null => {
    const driver = ctx.driverOf(inputPinId);
    if (!driver) return null;
    const e = booleanExprOf(driver.comp.id, driver.outIdx, ctx, newVisited);
    if (e.includes('...')) hitLoop = true;
    return e === NO_EXPR ? null : e;
  };

  const negated = comp.state.negated ?? [];
  const traced = comp.inputs.map((p, i) => {
    const e = traceInput(p.id);
    return e !== null && negated.includes(i) ? (/^[A-Za-z0-9_]+$/.test(e) ? `${e}'` : `(${e})'`) : e;
  });
  let inputExprs: string[];
  if (SKIP_OPEN_INPUT_GATES.has(comp.type)) {
    // Like the simulator (and Logisim), a gate leaves inputs without a driver out
    inputExprs = traced.filter((e): e is string => e !== null);
    if (inputExprs.length === 0) return NO_EXPR;
    // "Exactly one 1" over three or more inputs is no XOR chain (Logisim's analyzer refuses it too)
    if ((comp.type === 'xor' || comp.type === 'xnor') && comp.state.xorMode === 'one' && inputExprs.length > 2) return OPAQUE_EXPR;
  } else if ((comp.type === 'not' || comp.type === 'buffer') && traced[0] === null) {
    return NO_EXPR;
  } else {
    // Other parts read a fixed level (or x) on an open input; a driver without a formula hides the cone
    if (traced.some((e, i) => e === null && ctx.driverOf(comp.inputs[i].id))) return OPAQUE_EXPR;
    inputExprs = traced.map((e) => e ?? '0');
  }
  if (inputExprs.some((e) => e.includes(OPAQUE_EXPR))) return OPAQUE_EXPR;

  let result: string;
  switch (comp.type) {
    case 'not':
      result = inputExprs[0].length === 1 ? `${inputExprs[0]}'` : `(${inputExprs[0]})'`;
      break;
    case 'buffer':
      result = inputExprs[0];
      break;
    case 'and':
      if (inputExprs.length === 0) result = '0';
      else if (inputExprs.length === 1) result = inputExprs[0];
      else result = inputExprs.map((e) => (e.includes('+') || e.includes('⊕') ? `(${e})` : e)).join(' · ');
      break;
    case 'or':
      result = inputExprs.join(' + ');
      break;
    case 'nand':
      result = `(${inputExprs.map((e) => (e.includes('+') || e.includes('⊕') ? `(${e})` : e)).join(' · ')})'`;
      break;
    case 'nor':
      result = `(${inputExprs.join(' + ')})'`;
      break;
    case 'xor':
      result = inputExprs.map((e) => (e.includes('+') ? `(${e})` : e)).join(' ⊕ ');
      break;
    case 'xnor':
      result = `(${inputExprs.map((e) => (e.includes('+') ? `(${e})` : e)).join(' ⊕ ')})'`;
      break;
    case 'halfAdder':
      result = pinIndex === 1 ? `(${inputExprs[0]} · ${inputExprs[1]})` : `(${inputExprs[0]} ⊕ ${inputExprs[1]})`;
      break;
    case 'fullAdder':
      result =
        pinIndex === 1
          ? `(${inputExprs[0]}·${inputExprs[1]} + ${inputExprs[2]}·(${inputExprs[0]}⊕${inputExprs[1]}))`
          : `(${inputExprs[0]} ⊕ ${inputExprs[1]} ⊕ ${inputExprs[2]})`;
      break;
    case 'halfSubtractor':
      result = pinIndex === 1 ? `(${inputExprs[0]}' · ${inputExprs[1]})` : `(${inputExprs[0]} ⊕ ${inputExprs[1]})`;
      break;
    case 'fullSubtractor':
      result =
        pinIndex === 1
          ? `(${inputExprs[0]}'·${inputExprs[1]} + (${inputExprs[0]}⊕${inputExprs[1]})'·${inputExprs[2]})`
          : `(${inputExprs[0]} ⊕ ${inputExprs[1]} ⊕ ${inputExprs[2]})`;
      break;
    case 'triState':
      result = `(${inputExprs[1]} ? ${inputExprs[0]} : Z)`;
      break;
    case 'controlledInverter':
      result = `(${inputExprs[1]} ? ${inputExprs[0].length === 1 ? `${inputExprs[0]}'` : `(${inputExprs[0]})'`} : Z)`;
      break;
    case 'multiplexer':
    case 'demultiplexer':
    case 'decoder': {
      // Only 1-bit select and data reach here (wider pins hide the cone). Floating outputs have no formula
      const { enable } = getPlexerConfig(comp);
      const selIdx = comp.type === 'multiplexer' ? 2 : comp.type === 'demultiplexer' ? 1 : 0;
      if ((enable && comp.state.plexDisabled === 'Z') || (comp.type !== 'multiplexer' && comp.state.plexTristate)) return OPAQUE_EXPR;
      const sel = inputExprs[selIdx];
      const nsel = /^[A-Za-z0-9_]+$/.test(sel) ? `${sel}'` : `(${sel})'`;
      const term = (e: string) => (e.includes('+') || e.includes('⊕') ? `(${e})` : e);
      let core: string;
      if (comp.type === 'multiplexer') core = `(${nsel}·${term(inputExprs[0])} + ${term(sel)}·${term(inputExprs[1])})`;
      else {
        const lit = pinIndex === 1 ? term(sel) : nsel;
        core = comp.type === 'decoder' ? lit : `(${term(inputExprs[0])} · ${lit})`;
      }
      // An open enable counts as enabled, like the simulator
      const en = enable && traced[selIdx + 1] !== null ? inputExprs[selIdx + 1] : null;
      result = en ? `(${term(en)} · ${core})` : core;
      break;
    }
    case 'priorityEncoder': {
      // GS = some input is 1, EO = enabled and none is; the code output itself is x when no input is 1
      const n = comp.inputs.length - 1;
      if (pinIndex === 0) return OPAQUE_EXPR;
      const any = `(${inputExprs.slice(0, n).join(' + ')})`;
      const en = traced[n] !== null ? inputExprs[n] : null;
      const enT = en && (en.includes('+') || en.includes('⊕')) ? `(${en})` : en;
      result = pinIndex === 2 ? (en ? `(${enT} · ${any})` : any) : en ? `(${enT} · ${any}')` : `${any}'`;
      break;
    }
    default:
      return `${comp.label || comp.type}`;
  }
  if (result.length > MAX_EXPR_LENGTH) result = `${comp.label || comp.type}`;
  // Text that cut a feedback loop depends on where the loop was entered, so it is not reused
  if (!hitLoop) ctx.memo.set(memoKey, result);
  return result;
}

export function generateBooleanExpression(
  compId: string,
  pinIndex: number | undefined,
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): string {
  const expr = booleanExprOf(compId, pinIndex, createBooleanExprContext(components, wires), new Set());
  return expr.includes(OPAQUE_EXPR) || expr === NO_EXPR ? '?' : expr;
}

// Observable outputs of a circuit: LEDs, probes, buzzers and every output pin of the logic parts
// (splitter ends and tunnels excluded: they only re-route bits that are already shown elsewhere)
function getObservableOutputs(components: CircuitComponentInstance[]) {
  const outputList: { id: string; name: string; compId: string; pinIndex?: number; width: number }[] = [];
  components.forEach((c) => {
    if (c.type === 'led' || c.type === 'probe' || c.type === 'buzzer') {
      outputList.push({
        id: c.id,
        name: c.label || (c.type === 'led' ? 'LED' : c.type === 'buzzer' ? 'Buzzer' : 'Prob'),
        compId: c.id,
        width: c.inputs[0]?.width ?? 1,
      });
    } else if (
      c.outputs.length > 0 &&
      c.type !== 'switch' &&
      c.type !== 'pushbutton' &&
      c.type !== 'clock' &&
      c.type !== 'vcc' &&
      c.type !== 'gnd' &&
      c.type !== 'constant' &&
      c.type !== 'dipSwitch' &&
      c.type !== 'asciiKeyboard' &&
      c.type !== 'joystick' &&
      c.type !== 'matrixKeypad' &&
      c.type !== 'portIo' &&
      c.type !== 'realTimeClock' &&
      c.type !== 'keyboard' &&
      c.type !== 'telnet' &&
      c.type !== 'textLabel' &&
      c.type !== 'image' &&
      c.type !== 'splitter' &&
      c.type !== 'tunnel'
    ) {
      c.outputs.forEach((pin, pIdx) => {
        outputList.push({
          id: pin.id,
          name: `${c.label || c.type}.${pin.name}`,
          compId: c.id,
          pinIndex: pIdx,
          width: pin.width ?? 1,
        });
      });
    }
  });
  // Names key the expression maps and label the table columns, so two LEDs both called "LED" get "LED (2)"
  const seen = new Map<string, number>();
  outputList.forEach((o) => {
    const k = (seen.get(o.name) || 0) + 1;
    seen.set(o.name, k);
    if (k > 1) o.name = `${o.name} (${k})`;
  });
  return outputList;
}

/**
 * Boolean expression of every observable output, keyed by output name. Needs no simulation, so the
 * canvas formula HUD can use it without building the whole truth table. Outputs wider than 1 bit, and
 * single bits whose cone reaches a bus, have no single formula and are left out.
 */
export function generateBooleanExpressions(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): { [outputName: string]: string } {
  const ctx = createBooleanExprContext(components, wires);
  const booleanExpressions: { [outputName: string]: string } = {};
  getObservableOutputs(components).forEach((out) => {
    if (out.width > 1) return;
    const expr = booleanExprOf(out.compId, out.pinIndex, ctx, new Set());
    if (expr && expr !== '?' && expr !== '0' && expr !== NO_EXPR && !expr.includes(OPAQUE_EXPR)) {
      booleanExpressions[out.name] = expr;
    }
  });
  return booleanExpressions;
}

// Input bits a truth table sweeps (2^8 = 256 rows; Logisim-evolution allows 20) and the most it minimises
export const MAX_TRUTH_TABLE_INPUT_BITS = 8;
export const MAX_MINIMIZE_INPUT_BITS = 6;

// Bit width of an input source as the truth table drives it (a push button is always 1 bit)
const truthInputWidth = (c: CircuitComponentInstance) => (c.type === 'switch' ? c.outputs[0]?.width ?? 1 : 1);

// Bit `bit` of an input source's current value
const truthInputBit = (c: CircuitComponentInstance, bit: number): 0 | 1 =>
  truthInputWidth(c) > 1 ? ((Math.floor((c.state.inputValue ?? 0) / 2 ** bit) % 2) as 0 | 1) : c.state.on ? 1 : 0;

/**
 * Sets input sources to the bits of one truth-table row. `values` follows `columns` (one entry per bit,
 * MSB first within a part); parts not in `columns` are left as they are.
 */
export function applyTruthTableInputs(
  components: CircuitComponentInstance[],
  columns: TruthTableData['inputs'],
  values: (SignalValue | number)[]
): CircuitComponentInstance[] {
  const byComp = new Map<string, { bit: number; v: 0 | 1 }[]>();
  columns.forEach((col, k) => {
    if (!col.compId || k >= values.length) return;
    const list = byComp.get(col.compId) || [];
    list.push({ bit: col.bit ?? 0, v: values[k] === 1 ? 1 : 0 });
    byComp.set(col.compId, list);
  });
  return components.map((c) => {
    const bits = byComp.get(c.id);
    if (!bits) return c;
    if (truthInputWidth(c) > 1) {
      let n = c.state.inputValue ?? 0;
      for (const { bit, v } of bits) n += (v - (Math.floor(n / 2 ** bit) % 2)) * 2 ** bit;
      return { ...c, state: { ...c.state, inputValue: n, portBits: undefined } };
    }
    return { ...c, state: { ...c.state, on: bits[0].v === 1, portValue: undefined } };
  });
}

/**
 * Automatically compute Truth Table (2^N combinations) for canvas circuit. Like Logisim-evolution's
 * Analyze.computeTable, a wide input or output is one column per bit, MSB first.
 */
export function generateTruthTable(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): TruthTableData | null {
  // 1. Identify input switches & buttons
  const switchComps = components.filter((c) => c.type === 'switch' || c.type === 'pushbutton');
  if (switchComps.length === 0) return null;

  // 2. Identify observable outputs (LEDs, Probes, Buzzer, or output pins of gates/blocks)
  const outputList = getObservableOutputs(components);

  if (outputList.length === 0) return null;

  const inputNames = getInputSignalNames(components);
  const nameOf = (s: CircuitComponentInstance) => inputNames.get(s.id) || 'Giriş';

  // Whole parts, in canvas order, while their bits fit; a part that does not fit and every part after
  // it keep their current value
  const activeSwitches: CircuitComponentInstance[] = [];
  let inputBits = 0;
  for (const s of switchComps) {
    const w = truthInputWidth(s);
    if (inputBits + w > MAX_TRUTH_TABLE_INPUT_BITS) break;
    activeSwitches.push(s);
    inputBits += w;
  }

  const inputColumns: TruthTableData['inputs'] = [];
  activeSwitches.forEach((s) => {
    const w = truthInputWidth(s);
    const name = nameOf(s);
    for (let b = w - 1; b >= 0; b--) {
      inputColumns.push(
        w > 1
          ? { id: `${s.id}#${b}`, name: `${name}[${b}]`, compId: s.id, bit: b, group: name, width: w }
          : { id: s.id, name, compId: s.id, bit: 0 }
      );
    }
  });
  const outputColumns: TruthTableData['outputs'] = [];
  outputList.forEach((o) => {
    for (let b = o.width - 1; b >= 0; b--) {
      outputColumns.push(
        o.width > 1
          ? { id: `${o.id}#${b}`, name: `${o.name}[${b}]`, compId: o.compId, bit: b, group: o.name, width: o.width }
          : { id: o.id, name: o.name, compId: o.compId, bit: 0 }
      );
    }
  });

  const notes: string[] = [];
  const restSwitches = switchComps.slice(activeSwitches.length);
  if (restSwitches.length > 0) {
    notes.push(
      `Tabloya en fazla ${MAX_TRUTH_TABLE_INPUT_BITS} giriş biti alınabilir; ${restSwitches
        .map((s) => (truthInputWidth(s) > 1 ? `${nameOf(s)} (${truthInputWidth(s)} bit)` : nameOf(s)))
        .join(', ')} şu anki değerinde sabit tutuldu.`
    );
  }
  if (inputColumns.length === 0) {
    return { inputs: [], outputs: outputColumns, rows: [], notes };
  }

  const numCombinations = Math.pow(2, inputColumns.length);
  const rows: TruthTableData['rows'] = [];

  // Determine current live inputs
  const switchById = new Map(activeSwitches.map((s) => [s.id, s]));
  const currentInputs = inputColumns.map((col) => truthInputBit(switchById.get(col.compId!)!, col.bit ?? 0));

  for (let i = 0; i < numCombinations; i++) {
    // Generate binary representation
    const inputVals: SignalValue[] = [];
    for (let bit = inputColumns.length - 1; bit >= 0; bit--) {
      inputVals.push(((i >> bit) & 1) as SignalValue);
    }

    // Clone components with new input switch states
    const testComps = applyTruthTableInputs(components, inputColumns, inputVals);

    const sim = simulateCircuit(testComps, wires);
    const simById = new Map(sim.components.map((c) => [c.id, c]));

    // Read outputs like Logisim-evolution's Analyze.computeTable: an oscillating row is '@' in
    // every column, E is a conflict, X / Z are don't cares
    const outputVals: TruthTableEntry[] = [];
    outputList.forEach((out) => {
      const found = simById.get(out.compId);
      let pin: CircuitPin | undefined;
      if (found && (found.type === 'led' || found.type === 'probe' || found.type === 'buzzer')) {
        pin = found.inputs[0];
      } else if (found && out.pinIndex !== undefined) {
        pin = found.outputs[out.pinIndex];
      }
      for (let b = out.width - 1; b >= 0; b--) {
        if (sim.oscillating) {
          outputVals.push('@');
          continue;
        }
        const v = out.width > 1 ? pin?.bits?.[b] : pin?.value;
        outputVals.push(v === 1 ? 1 : v === 0 ? 0 : v === 'E' ? 'E' : '-');
      }
    });

    const isCurrent = inputVals.every((v, idx) => v === currentInputs[idx]);

    rows.push({
      inputValues: inputVals,
      outputValues: outputVals,
      isCurrentState: isCurrent,
    });
  }

  // Extract Boolean algebraic expression for each output
  const booleanExpressions = generateBooleanExpressions(components, wires);

  // Extract minimal SOP expressions via Quine-McCluskey
  const minimalExpressions: {
    [outputName: string]: {
      expression: string;
      primeImplicants: string[];
      essentialImplicants: string[];
    };
  } = {};

  if (inputColumns.length <= MAX_MINIMIZE_INPUT_BITS) {
    const varNames = inputColumns.map((c) => c.name);
    outputColumns.forEach((out, outIdx) => {
      const { minterms, dontCares } = truthTableColumnTerms(rows, outIdx);
      minimalExpressions[out.name] = minimizeBooleanExpression(varNames, minterms, dontCares);
    });
  } else {
    notes.push(
      `Tabloda ${inputColumns.length} giriş biti var; en sade ifade (Quine-McCluskey) ve Karnaugh haritası en fazla ${MAX_MINIMIZE_INPUT_BITS} bit için hesaplanır.`
    );
  }

  const stateful = components.filter(
    (c) => COMPONENT_CATALOG[c.type]?.category === 'sequential'
  );
  if (stateful.length > 0) {
    notes.push(
      `Devrede bellek elemanı var (${stateful.map((c) => c.label || c.type).slice(0, 3).join(', ')}${
        stateful.length > 3 ? '…' : ''
      }): çıkışlar, elemanların şu anki iç durumu için hesaplandı.`
    );
  }

  return {
    inputs: inputColumns,
    outputs: outputColumns,
    booleanExpressions,
    minimalExpressions,
    rows,
    notes,
  };
}

/**
 * Minterms and don't cares of one truth-table output column. Like Logisim-evolution's
 * Implicant.computeMinimal, every cell that is not 0 or 1 ('-', 'E', '@') is a don't care.
 */
export function truthTableColumnTerms(
  rows: TruthTableData['rows'],
  outIdx: number
): { minterms: number[]; dontCares: number[] } {
  const minterms: number[] = [];
  const dontCares: number[] = [];
  rows.forEach((r, rIdx) => {
    const v = r.outputValues[outIdx];
    if (v === 1) minterms.push(rIdx);
    else if (v !== 0) dontCares.push(rIdx);
  });
  return { minterms, dontCares };
}

/**
 * Quine-McCluskey algorithmic minimization for up to 6 variables
 * Computes Prime Implicants, Essential Prime Implicants, and minimal Sum of Products (SOP).
 */
export function minimizeBooleanExpression(
  varNames: string[],
  minterms: number[],
  dontCares: number[] = []
): {
  expression: string;
  primeImplicants: string[];
  essentialImplicants: string[];
} {
  const n = varNames.length;
  if (n === 0) return { expression: '0', primeImplicants: [], essentialImplicants: [] };
  if (minterms.length === 0) return { expression: '0', primeImplicants: [], essentialImplicants: [] };
  const allTerms = Array.from(new Set([...minterms, ...dontCares]));
  if (allTerms.length === Math.pow(2, n)) {
    return { expression: '1', primeImplicants: ['1'], essentialImplicants: ['1'] };
  }

  let terms = allTerms.map((m) => ({
    mask: m.toString(2).padStart(n, '0'),
    minterms: [m],
    combined: false,
  }));

  const primeImplicants: { mask: string; minterms: number[] }[] = [];

  while (terms.length > 0) {
    const groups: { [weight: number]: typeof terms } = {};
    for (let i = 0; i <= n; i++) groups[i] = [];
    for (const t of terms) {
      const ones = (t.mask.match(/1/g) || []).length;
      groups[ones].push(t);
    }

    const nextTermsMap = new Map<string, { mask: string; minterms: number[]; combined: boolean }>();
    let anyCombined = false;

    for (let w = 0; w < n; w++) {
      const grp1 = groups[w] || [];
      const grp2 = groups[w + 1] || [];

      for (const t1 of grp1) {
        for (const t2 of grp2) {
          let diffCount = 0;
          let diffIdx = -1;
          for (let k = 0; k < n; k++) {
            if (t1.mask[k] !== t2.mask[k]) {
              if (t1.mask[k] === '-' || t2.mask[k] === '-') {
                diffCount = 999;
                break;
              }
              diffCount++;
              diffIdx = k;
            }
          }

          if (diffCount === 1) {
            t1.combined = true;
            t2.combined = true;
            anyCombined = true;
            const newMask = t1.mask.substring(0, diffIdx) + '-' + t1.mask.substring(diffIdx + 1);
            if (!nextTermsMap.has(newMask)) {
              const combinedMinterms = Array.from(new Set([...t1.minterms, ...t2.minterms])).sort(
                (a, b) => a - b
              );
              nextTermsMap.set(newMask, {
                mask: newMask,
                minterms: combinedMinterms,
                combined: false,
              });
            }
          }
        }
      }
    }

    for (const t of terms) {
      if (!t.combined) {
        if (!primeImplicants.some((pi) => pi.mask === t.mask)) {
          primeImplicants.push({ mask: t.mask, minterms: t.minterms });
        }
      }
    }

    if (!anyCombined) break;
    terms = Array.from(nextTermsMap.values());
  }

  const targetMinterms = minterms.slice().sort((a, b) => a - b);

  function covers(mask: string, minterm: number) {
    const bin = minterm.toString(2).padStart(n, '0');
    for (let i = 0; i < n; i++) {
      if (mask[i] !== '-' && mask[i] !== bin[i]) return false;
    }
    return true;
  }

  const essentialPIs: typeof primeImplicants = [];
  const coveredMinterms = new Set<number>();

  for (const m of targetMinterms) {
    const covering = primeImplicants.filter((pi) => covers(pi.mask, m));
    if (covering.length === 1) {
      const epi = covering[0];
      if (!essentialPIs.some((e) => e.mask === epi.mask)) {
        essentialPIs.push(epi);
        for (const cm of targetMinterms) {
          if (covers(epi.mask, cm)) coveredMinterms.add(cm);
        }
      }
    }
  }

  const remainingMinterms = targetMinterms.filter((m) => !coveredMinterms.has(m));
  const chosenPIs = [...essentialPIs];

  // Exact cover of what the essentials leave: branch on the uncovered minterm with the fewest candidate PIs,
  // prune by the best term count so far (ties: fewer literals). A greedy "covers most" pick is not minimal
  // (about 2% of random 4-variable functions got an extra term or literals).
  if (remainingMinterms.length > 0) {
    const nonEssentialPIs = primeImplicants.filter(
      (pi) => !essentialPIs.some((e) => e.mask === pi.mask) && remainingMinterms.some((m) => covers(pi.mask, m))
    );
    const literals = (pi: { mask: string }) => pi.mask.split('').filter((ch) => ch !== '-').length;
    const coverOf = new Map(nonEssentialPIs.map((pi) => [pi, new Set(remainingMinterms.filter((m) => covers(pi.mask, m)))]));
    const pisOf = new Map(remainingMinterms.map((m) => [m, nonEssentialPIs.filter((pi) => coverOf.get(pi)!.has(m))]));
    // Start from the greedy cover, so the search only has to beat it
    let best: typeof primeImplicants = [];
    {
      let left = [...remainingMinterms];
      while (left.length > 0) {
        let top = nonEssentialPIs[0];
        let topN = -1;
        for (const pi of nonEssentialPIs) {
          const k = left.filter((m) => coverOf.get(pi)!.has(m)).length;
          if (k > topN || (k === topN && literals(pi) < literals(top))) {
            top = pi;
            topN = k;
          }
        }
        best.push(top);
        left = left.filter((m) => !coverOf.get(top)!.has(m));
      }
    }
    let bestLits = best.reduce((sum, pi) => sum + literals(pi), 0);
    // Lower bound: minterms no single PI covers two of, each needs its own term
    const lowerBound = (uncovered: number[]) => {
      const chosen: number[] = [];
      for (const m of uncovered) {
        if (chosen.every((c) => !pisOf.get(m)!.some((pi) => coverOf.get(pi)!.has(c)))) chosen.push(m);
      }
      return chosen.length;
    };
    const pick: typeof primeImplicants = [];
    const search = (uncovered: number[], lits: number) => {
      if (uncovered.length === 0) {
        if (pick.length < best.length || (pick.length === best.length && lits < bestLits)) {
          best = [...pick];
          bestLits = lits;
        }
        return;
      }
      if (pick.length + lowerBound(uncovered) > best.length) return;
      let options = pisOf.get(uncovered[0])!;
      for (const m of uncovered) {
        const o = pisOf.get(m)!;
        if (o.length < options.length) options = o;
      }
      options = [...options].sort((x, y) => {
        const cx = uncovered.filter((m) => coverOf.get(x)!.has(m)).length;
        const cy = uncovered.filter((m) => coverOf.get(y)!.has(m)).length;
        return cy - cx || literals(x) - literals(y);
      });
      for (const pi of options) {
        pick.push(pi);
        search(
          uncovered.filter((m) => !coverOf.get(pi)!.has(m)),
          lits + literals(pi)
        );
        pick.pop();
      }
    };
    search(remainingMinterms, 0);
    chosenPIs.push(...best);
  }

  // Single letters are written side by side (AB'C); with longer input names ("Cin", "A0 (LSB)") that would be
  // unreadable, so the literals are joined with a dot
  const joiner = varNames.some((v) => v.length > 1) ? '·' : '';
  function maskToExpression(mask: string) {
    const lits: string[] = [];
    for (let i = 0; i < n; i++) {
      const bit = mask[i];
      const v = varNames[i] || `X${i}`;
      if (bit === '1') {
        lits.push(v);
      } else if (bit === '0') {
        lits.push(`${v}'`);
      }
    }
    return lits.length === 0 ? '1' : lits.join(joiner);
  }

  const termsExpr = chosenPIs.map((pi) => maskToExpression(pi.mask));
  const finalExpr = termsExpr.length > 0 ? termsExpr.join(' + ') : '0';

  return {
    expression: finalExpr,
    // A prime made only of don't cares covers no required 1, so it is not listed
    primeImplicants: primeImplicants
      .filter((pi) => targetMinterms.some((m) => covers(pi.mask, m)))
      .map((pi) => maskToExpression(pi.mask)),
    essentialImplicants: essentialPIs.map((pi) => maskToExpression(pi.mask)),
  };
}

export interface ASTNode {
  type: 'var' | 'not' | 'and' | 'or' | 'xor';
  name?: string;
  children?: ASTNode[];
  child?: ASTNode;
}

/**
 * Tokenize and parse a boolean algebraic expression into an AST
 * Supports:
 * - Literals / Variables: A, B, C, X1, etc.
 * - Infix OR: +, |
 * - Infix XOR: ^, ⊕
 * - Infix AND: *, ·, &, or adjacent terms (e.g. AB)
 * - Infix / Postfix NOT: A' or !A, ~A
 * - Parentheses: ( ... )
 */
export function parseBooleanExpression(rawExpr: string): ASTNode {
  let expr = rawExpr.trim();
  const eqIdx = expr.indexOf('=');
  if (eqIdx !== -1) {
    expr = expr.substring(eqIdx + 1).trim();
  }

  expr = expr
    .replace(/·/g, '*')
    .replace(/⊕/g, '^')
    .replace(/¬/g, '!')
    .replace(/\s+/g, ' ')
    .trim();

  type Token = { type: 'var' | 'op' | 'lparen' | 'rparen' | 'postnot'; value: string };
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
    } else if (ch === "'") {
      tokens.push({ type: 'postnot', value: "'" });
      i++;
    } else if (ch === '+' || ch === '^' || ch === '*' || ch === '&' || ch === '|' || ch === '!' || ch === '~') {
      tokens.push({ type: 'op', value: ch === '&' ? '*' : ch === '|' ? '+' : ch === '~' ? '!' : ch });
      i++;
    } else if (ch === '⊙') {
      tokens.push({ type: 'op', value: 'xnor' });
      i++;
    } else if (/[A-Za-z0-9_]/.test(ch)) {
      let word = '';
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) {
        word += expr[i];
        i++;
      }
      const kw = word.toUpperCase();
      if (kw === 'AND') tokens.push({ type: 'op', value: '*' });
      else if (kw === 'OR') tokens.push({ type: 'op', value: '+' });
      else if (kw === 'XOR') tokens.push({ type: 'op', value: '^' });
      else if (kw === 'XNOR') tokens.push({ type: 'op', value: 'xnor' });
      else if (kw === 'NOT') tokens.push({ type: 'op', value: '!' });
      else if (/^[A-Za-z]+$/.test(word)) {
        // Textbook notation: "AB'C" is A·B'·C (the K-map and truth table write their results this way);
        // names with digits/underscores (X1, IN_A) stay single variables
        for (const letter of word) tokens.push({ type: 'var', value: letter });
      } else if (/^[01]+$/.test(word)) {
        for (const digit of word) tokens.push({ type: 'var', value: digit });
      } else {
        tokens.push({ type: 'var', value: word });
      }
    } else {
      i++;
    }
  }

  const expandedTokens: Token[] = [];
  for (let j = 0; j < tokens.length; j++) {
    const cur = tokens[j];
    expandedTokens.push(cur);

    if (j < tokens.length - 1) {
      const next = tokens[j + 1];
      const curCanEnd = cur.type === 'var' || cur.type === 'rparen' || cur.type === 'postnot';
      const nextCanStart = next.type === 'var' || next.type === 'lparen' || (next.type === 'op' && next.value === '!');
      if (curCanEnd && nextCanStart) {
        expandedTokens.push({ type: 'op', value: '*' });
      }
    }
  }

  let pos = 0;

  function peek(): Token | undefined {
    return expandedTokens[pos];
  }

  function consume(expected?: string): Token {
    const t = expandedTokens[pos++];
    if (!t) throw new Error('Beklenmedik ifade sonu');
    if (expected && t.value !== expected) {
      throw new Error(`'${expected}' bekleniyordu, ancak '${t.value}' bulundu`);
    }
    return t;
  }

  function parseOr(): ASTNode {
    let node = parseXor();
    while (peek() && peek()!.type === 'op' && peek()!.value === '+') {
      consume('+');
      const right = parseXor();
      if (node.type === 'or' && node.children) {
        node.children.push(right);
      } else {
        node = { type: 'or', children: [node, right] };
      }
    }
    return node;
  }

  function parseXor(): ASTNode {
    let node = parseAnd();
    while (peek() && peek()!.type === 'op' && (peek()!.value === '^' || peek()!.value === 'xnor')) {
      const isXnor = consume().value === 'xnor';
      const right = parseAnd();
      if (isXnor) {
        node = { type: 'not', child: { type: 'xor', children: [node, right] } };
      } else if (node.type === 'xor' && node.children) {
        node.children.push(right);
      } else {
        node = { type: 'xor', children: [node, right] };
      }
    }
    return node;
  }

  function parseAnd(): ASTNode {
    let node = parseUnary();
    while (peek() && peek()!.type === 'op' && peek()!.value === '*') {
      consume('*');
      const right = parseUnary();
      if (node.type === 'and' && node.children) {
        node.children.push(right);
      } else {
        node = { type: 'and', children: [node, right] };
      }
    }
    return node;
  }

  function parseUnary(): ASTNode {
    if (peek() && peek()!.type === 'op' && peek()!.value === '!') {
      consume('!');
      const child = parseUnary();
      return { type: 'not', child };
    }
    return parsePostfix();
  }

  function parsePostfix(): ASTNode {
    let node = parsePrimary();
    while (peek() && peek()!.type === 'postnot') {
      consume("'");
      node = { type: 'not', child: node };
    }
    return node;
  }

  function parsePrimary(): ASTNode {
    const t = peek();
    if (!t) throw new Error('İfade bekleniyordu');

    if (t.type === 'var') {
      consume();
      return { type: 'var', name: t.value.toUpperCase() };
    }
    if (t.type === 'lparen') {
      consume('(');
      const inner = parseOr();
      consume(')');
      return inner;
    }
    throw new Error(`Geçersiz terim: '${t.value}'`);
  }

  return parseOr();
}

export interface SynthesisOptions {
  gateType?: 'standard' | 'nand' | 'nor';
  offsetX?: number;
  offsetY?: number;
  outputLabel?: string;
}

/**
 * Automatically layout and wire a digital circuit from a parsed Boolean AST.
 *
 * - standard: AND / OR / XOR / NOT gates (more than 5 operands are split over several gates)
 * - nand / nor: a real NAND-only / NOR-only network (NOT = NAND(a,a), OR = NAND(a',b'), XOR from 4 NANDs ...),
 *   not just the same gates renamed, which would change the function
 * The network is built first, then every gate is placed in the column of its logic level (inputs left,
 * output right) and stacked inside that column, so no two parts ever share a pin location.
 */
export function synthesizeCircuitFromBooleanExpression(
  rawExpr: string,
  options?: SynthesisOptions
): { components: CircuitComponentInstance[]; wires: CircuitWire[] } {
  const ast = parseBooleanExpression(rawExpr);
  const startX = options?.offsetX ?? 60;
  const startY = options?.offsetY ?? 60;
  const gateMode = options?.gateType ?? 'standard';
  const outLabel = options?.outputLabel ?? 'Çıkış F';

  // 1. Collect all unique variable names (0 / 1 are constants)
  const varSet = new Set<string>();
  let usesConst = false;
  function collectVars(node: ASTNode) {
    if (node.type === 'var' && node.name) {
      if (node.name === '0' || node.name === '1') usesConst = true;
      else varSet.add(node.name);
    }
    if (node.child) collectVars(node.child);
    if (node.children) node.children.forEach(collectVars);
  }
  collectVars(ast);
  const vars = Array.from(varSet).sort();
  if (vars.length === 0 && !usesConst) {
    throw new Error('İfadede en az 1 mantıksal değişken (A, B vb.) bulunmalıdır.');
  }

  // 2. Build the gate network (positions come later)
  const uid = `syn_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`;
  type Sig = { compId: string; pinId: string; level: number; key: string };
  interface GateSpec {
    id: string;
    type: ComponentType;
    inputs: Sig[];
    level: number;
  }
  const gates: GateSpec[] = [];
  const sources = new Map<string, { id: string; type: ComponentType; label: string }>();
  const sourceSig = (name: string): Sig => {
    if (!sources.has(name)) {
      const type: ComponentType = name === '0' ? 'gnd' : name === '1' ? 'vcc' : 'switch';
      const id = `${uid}_src_${sources.size}`;
      sources.set(name, { id, type, label: type === 'switch' ? `Giriş ${name}` : name === '1' ? 'Sabit 1' : 'Sabit 0' });
    }
    const s = sources.get(name)!;
    return { compId: s.id, pinId: `${s.id}_out`, level: 0, key: `src:${name}` };
  };
  // Identical gates on identical inputs are shared (e.g. one inverter per signal)
  const gateCache = new Map<string, Sig>();
  const gate = (type: ComponentType, inputs: Sig[]): Sig => {
    const cacheKey = `${type}(${inputs.map((i) => i.key).join(',')})`;
    const cached = gateCache.get(cacheKey);
    if (cached) return cached;
    const id = `${uid}_g${gates.length}`;
    const level = Math.max(...inputs.map((i) => i.level)) + 1;
    gates.push({ id, type, inputs, level });
    const sig = { compId: id, pinId: `${id}_out`, level, key: cacheKey };
    gateCache.set(cacheKey, sig);
    return sig;
  };
  // n-ary gate limited to 5 inputs: wider ones are split, keeping the function
  const wide = (type: 'and' | 'or' | 'xor', xs: Sig[]): Sig => {
    if (xs.length === 1) return xs[0];
    if (xs.length <= 5) return gate(type, xs);
    const chunks: Sig[] = [];
    for (let k = 0; k < xs.length; k += 5) chunks.push(wide(type, xs.slice(k, k + 5)));
    return wide(type, chunks);
  };

  const notOf = (a: Sig): Sig => {
    if (gateMode === 'nand') return gate('nand', [a, a]);
    if (gateMode === 'nor') return gate('nor', [a, a]);
    return gate('not', [a]);
  };
  const andOf = (xs: Sig[]): Sig => {
    if (xs.length === 1) return xs[0];
    if (gateMode === 'standard') return wide('and', xs);
    if (gateMode === 'nand') {
      if (xs.length > 5) return andOf([andOf(xs.slice(0, 5)), andOf(xs.slice(5))]);
      return notOf(gate('nand', xs));
    }
    // NOR-only: a·b = (a' + b')'
    if (xs.length > 5) return andOf([andOf(xs.slice(0, 5)), andOf(xs.slice(5))]);
    return gate('nor', xs.map(notOf));
  };
  const orOf = (xs: Sig[]): Sig => {
    if (xs.length === 1) return xs[0];
    if (gateMode === 'standard') return wide('or', xs);
    if (gateMode === 'nor') {
      if (xs.length > 5) return orOf([orOf(xs.slice(0, 5)), orOf(xs.slice(5))]);
      return notOf(gate('nor', xs));
    }
    // NAND-only: a + b = (a'·b')'
    if (xs.length > 5) return orOf([orOf(xs.slice(0, 5)), orOf(xs.slice(5))]);
    return gate('nand', xs.map(notOf));
  };
  const xor2 = (a: Sig, b: Sig): Sig => {
    if (gateMode === 'nand') {
      const t = gate('nand', [a, b]);
      return gate('nand', [gate('nand', [a, t]), gate('nand', [b, t])]);
    }
    if (gateMode === 'nor') {
      // 4 NORs give XNOR; one more inverts it
      const t = gate('nor', [a, b]);
      return notOf(gate('nor', [gate('nor', [a, t]), gate('nor', [b, t])]));
    }
    return gate('xor', [a, b]);
  };
  const xorOf = (xs: Sig[]): Sig => {
    if (xs.length === 1) return xs[0];
    if (gateMode === 'standard') return wide('xor', xs);
    return xs.slice(1).reduce((acc, x) => xor2(acc, x), xs[0]);
  };

  const build = (node: ASTNode): Sig => {
    if (node.type === 'var') return sourceSig(node.name!);
    if (node.type === 'not') {
      // Double negation needs no gates
      if (node.child!.type === 'not') return build(node.child!.child!);
      return notOf(build(node.child!));
    }
    const xs = (node.children || []).map(build);
    if (node.type === 'and') return andOf(xs);
    if (node.type === 'or') return orOf(xs);
    return xorOf(xs);
  };
  const root = build(ast);

  // 3. Layout: inputs in column 0, each gate in the column of its level, LED after the last level
  const COL_W = 160;
  const components: CircuitComponentInstance[] = [];
  const wires: CircuitWire[] = [];
  let srcRow = 0;
  for (const name of [...vars, ...(usesConst ? ['0', '1'] : [])]) {
    const s = sources.get(name);
    if (!s) continue;
    components.push(updatePinPositions(createComponentInstance(s.type, startX, startY + srcRow * 80, s.label, s.id)));
    srcRow++;
  }
  const colY = new Map<number, number>();
  let gateNo = 1;
  const placed = new Map<string, CircuitComponentInstance>();
  for (const g of gates) {
    const x = startX + g.level * COL_W;
    const y = colY.get(g.level) ?? startY;
    let comp = createComponentInstance(g.type, x, y, `${g.type.toUpperCase()}_${gateNo++}`, g.id);
    if (g.type !== 'not' && g.inputs.length !== comp.inputs.length) {
      comp.inputs = g.inputs.map((_, k) => ({
        id: `${g.id}_in${k}`,
        name: String.fromCharCode(65 + k),
        type: 'input' as const,
        value: 0 as SignalValue,
        x,
        y,
      }));
      comp.state = { ...comp.state, gateInputsCount: g.inputs.length };
    }
    comp = updatePinPositions(comp);
    colY.set(g.level, y + (COMPONENT_CATALOG[g.type]?.height || 60) + 40);
    placed.set(g.id, comp);
    components.push(comp);
  }
  let wireNo = 0;
  const wireTo = (from: Sig, toComp: CircuitComponentInstance, pinIdx: number) => {
    wires.push({
      id: `${uid}_w${wireNo++}`,
      fromCompId: from.compId,
      fromPinId: from.pinId,
      toCompId: toComp.id,
      toPinId: toComp.inputs[pinIdx].id,
      value: 0,
    });
  };
  for (const g of gates) {
    const comp = placed.get(g.id)!;
    g.inputs.forEach((sig, k) => wireTo(sig, comp, k));
  }

  const rootComp = placed.get(root.compId);
  const ledY = rootComp ? rootComp.y : startY;
  const led = updatePinPositions(createComponentInstance('led', startX + (root.level + 1) * COL_W, ledY, outLabel, `${uid}_out`));
  components.push(led);
  wireTo(root, led, 0);

  const normalizedWires = repairWires(wires, components);
  const sim = simulateCircuit(components, normalizedWires);
  return { components: sim.components, wires: sim.wires };
}
