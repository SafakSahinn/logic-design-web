import type { CircuitComponentInstance, CircuitWire, ComponentType, CustomSubcircuit, SubcircuitPortDefinition } from '../types/circuit';
import type { Radix } from '../types/logic';
import {
  ARITH_PINS,
  ARITH_TYPES,
  arithGeometry,
  configureArith,
  configureBitExtender,
  configureBitSelector,
  configureMem,
  configurePlexer,
  configureRam,
  configureIo,
  defaultIoConfig,
  IO_TYPES,
  type IoConfig,
  configureIo5,
  defaultIo5Config,
  BFH_TYPES,
  BIN_TO_BCD_DEFAULT_BITS,
  BIN_TO_BCD_MAX_BITS,
  BIN_TO_BCD_MIN_BITS,
  binToBcdDigits,
  configureBfh,
  configureIo5c,
  IO5C_TYPES,
  configureVideo,
  type VideoConfig,
  VIDEO_COLOR_MODELS,
  VIDEO_SCALE_MAX,
  VIDEO_SIZE_MAX,
  VIDEO_SIZE_MIN,
  configureImage,
  IMAGE_DEFAULT_SIZE,
  IMAGE_LICENSES,
  IMAGE_SCALES,
  imageShownSize,
  type ImageConfig,
  type ImageScale,
  type Io5cConfig,
  KEYBOARD_BUFFER_MAX,
  KEYBOARD_DEFAULT_BUFFER,
  TELNET_BUFFER_MAX,
  TELNET_DEFAULT_BUFFER,
  TELNET_DEFAULT_PORT,
  TTY_COLS_MAX,
  TTY_DEFAULT_BG,
  TTY_DEFAULT_COLOR,
  TTY_DEFAULT_COLS,
  TTY_DEFAULT_ROWS,
  TTY_ROWS_MAX,
  IO5_TYPES,
  PORT_IO_MAX,
  KEYPAD_DEFAULT_CUSTOM,
  type Io5Config,
  configureSplitter,
  configureTtl,
  createComponentInstance,
  defaultRamConfig,
  flipFlopDataKeys,
  MEM_TYPES,
  PLEXER_TYPES,
  RAM_ADDR_MAX,
  RAM_ADDR_MIN,
  RAM_TYPES,
  ramByteEnableCount,
  type RamConfig,
  pinKey,
  getComponentSize,
  setBitWidth,
  setGateWidth,
  splitterDistribution,
  updatePinPositions,
  floatingSwitchState,
} from './circuitEngine';
import { rawTextToMem } from './memImage';
import { createSubcircuitInstance } from './subcircuitManager';
import { repairWires } from './wiringEngine';
import { isTtlType, parseEng, ttlChipOf, ttlEvoOffset, ttlEvoPin, ttlEvoRemapped, ttlInKey, ttlPorts, ttlRcOf } from './ttlChips';

/**
 * Evolution TTL chip connection points relative to loc (east-facing), by our pin key; an in/out pin's input
 * half shares the point. 7476: evolution's pins are matched to ours by name (ttlEvoOffset).
 */
function ttlImportPorts(type: string, vccGnd: boolean): Array<{ key: string; off: Pt }> {
  const chip = ttlChipOf(type);
  if (!chip) return [];
  return ttlPorts(chip, vccGnd).flatMap((p) => {
    const off = ttlEvoOffset(chip, p.pin);
    return p.dir === 'inout' ? [{ key: p.key, off }, { key: ttlInKey(p.pin), off }] : [{ key: p.key, off }];
  });
}

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
  if (n.includes('hex digit') || n === 'hex display') return 'hexDigit';
  if (n.includes('buzzer') || n === 'speaker') return 'buzzer';
  if (n.includes('dot matrix') || n === 'dotmatrix') return 'dotMatrix';
  if (n === 'ledbar' || n === 'led bar') return 'ledBar';
  // Logisim-evolution std/io parts of Aşama 5a (Joystick is in 2.7.1 too)
  if (n === 'rgbled') return 'rgbLed';
  if (n === 'joystick') return 'joystick';
  if (n === 'matrixkeypad') return 'matrixKeypad';
  if (n === 'portio') return 'portIo';
  if (n === 'realtimeclock') return 'realTimeClock';
  // Logisim-evolution BFH library of Aşama 5b
  if (n === 'binary_to_bcd_converter') return 'binToBcd';
  if (n === 'bcd_to_7_segment_decoder') return 'bcdToSevenSegment';
  // Keyboard and TTY (Logisim 2.7.1 and evolution), Telnet (evolution only) of Aşama 5c
  if (n === 'keyboard') return 'keyboard';
  if (n === 'tty') return 'tty';
  if (n === 'telnet') return 'telnet';
  // Evolution's RGB Video of Aşama 5d (2.7.1 has none)
  if (n === 'rgb video') return 'rgbVideo';
  // Evolution's decorative Image of the Base library, Aşama 5e (2.7.1 has none)
  if (n === 'image') return 'image';
  if (n.includes('dip switch') || n === 'dipswitch') return 'dipSwitch';

  // Arithmetic (Logisim std/arith; Absolute, MinMax, SquareRoot, Exponentiator only in evolution)
  const arith = LOGISIM_ARITH_TYPE[n];
  if (arith) return arith;

  // Combinational
  if (n === 'multiplexer' || n === 'mux') return 'multiplexer';
  if (n === 'demultiplexer' || n === 'demux') return 'demultiplexer';
  if (n === 'decoder') return 'decoder';
  if (n === 'priority encoder') return 'priorityEncoder';

  // Memory (Logisim std/memory)
  const mem = LOGISIM_MEM_TYPE[n];
  if (mem) return mem;
  if (n === 'ram') return 'ram';
  if (n === 'rom') return 'rom';
  if (n === 'random') return 'random';
  if (n === 'dualram') return 'dualRam';

  return null;
}

// I/O parts placed on their exact Logisim connection points (Aşama 3g)
const IO_IMPORT = new Set<ComponentType>([...IO_TYPES, 'sevenSegment', ...IO5_TYPES]);

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

// Logisim memory element names (std/memory, library "#Memory")
const LOGISIM_MEM: Array<[ComponentType, string]> = [
  ['flipFlopD', 'D Flip-Flop'],
  ['flipFlopT', 'T Flip-Flop'],
  ['flipFlopJK', 'J-K Flip-Flop'],
  ['flipFlopSR', 'S-R Flip-Flop'],
  ['register', 'Register'],
  ['counter', 'Counter'],
  ['shiftRegister', 'Shift Register'],
];
const LOGISIM_MEM_TYPE: Record<string, ComponentType> = Object.fromEntries(LOGISIM_MEM.map(([t, n]) => [n.toLowerCase(), t]));
/** Logisim element name of each memory part */
export const LOGISIM_MEM_NAME = Object.fromEntries(LOGISIM_MEM) as Partial<Record<ComponentType, string>>;

/**
 * Connection points of a Logisim memory part relative to its loc, each with our pin key. Memory parts have no
 * facing. 'classic' is Logisim 2.7.1's look (and evolution's classic appearance); 'evolution' is the look
 * Logisim-evolution gives them otherwise ('evolution' / 'logisim_evolution'), with other pin places
 * (std/memory updatePorts). Logisim 2.7.1's flip-flop enable (evolution has none) and evolution's counter
 * up/down pin (2.7.1 has none) are listed on request (`hasEnable` / `hasUpDown`); evolution's look has no last stage output
 * (OUT is that stage), so q{len-1} is left out there.
 */
export function logisimMemPorts(
  type: ComponentType,
  o: { width: number; length: number; parallel: boolean; appearance: 'classic' | 'evolution'; hasEnable: boolean; hasUpDown: boolean }
): Array<{ key: string; off: Pt }> {
  const P = (key: string, x: number, y: number) => ({ key, off: { x, y } });
  const evo = o.appearance === 'evolution';
  if (type === 'register') {
    return evo
      ? [P('d', 0, 30), P('clk', 0, 70), P('clr', 30, 90), P('en', 0, 50), P('q', 60, 30)]
      : [P('d', -30, 0), P('clk', -20, 20), P('clr', -10, 20), P('en', -30, 10), P('q', 0, 0)];
  }
  if (type === 'counter') {
    let ps;
    if (evo) {
      // Counter.getSymbolWidth (Java int division truncates toward 0)
      const sw = 150 + Math.trunc((o.width - 8) / 5) * 10;
      const y = o.width === 1 ? 120 : 110;
      ps = [P('d', 0, y), P('clk', 0, 80), P('clr', 0, 20), P('ld', 0, 30), P('ct', 0, 70), P('ud', 0, 50), P('q', sw + 40, y), P('carry', sw + 40, 50)];
    } else {
      ps = [P('d', -30, 0), P('clk', -20, 20), P('clr', -10, 20), P('ld', -30, -10), P('ct', -30, 10), P('ud', -20, -20), P('q', 0, 0), P('carry', 0, 10)];
    }
    return o.hasUpDown ? ps : ps.filter((p) => p.key !== 'ud');
  }
  if (type === 'shiftRegister') {
    const len = o.length;
    if (evo) {
      const ps = [P('sh', 0, 40), P('in', 0, 80), P('clk', 0, 50), P('clr', 0, 20), P('out', 120, 70 + 20 * len)];
      if (o.parallel) {
        ps.push(P('ld', 0, 30));
        for (let i = 0; i < len; i++) ps.push(P(`d${i}`, 0, 90 + 20 * i));
        for (let i = 0; i < len - 1; i++) ps.push(P(`q${i}`, 120, 90 + 20 * i));
      }
      return ps;
    }
    const ps = [P('sh', 0, -10), P('in', 0, 0), P('clk', 0, 10), P('clr', 10, 20), P('out', o.parallel ? 20 + 10 * len : 30, 0)];
    if (o.parallel) {
      ps.push(P('ld', 10, -20));
      for (let i = 0; i < len; i++) ps.push(P(`d${i}`, 20 + 10 * i, -20));
      for (let i = 0; i < len; i++) ps.push(P(`q${i}`, 20 + 10 * i, 20));
    }
    return ps;
  }
  const two = type === 'flipFlopJK' || type === 'flipFlopSR';
  const [a, b = ''] = flipFlopDataKeys(type);
  if (evo) {
    return [
      ...(two ? [P(a, -10, 10), P(b, -10, 30)] : [P(a, -10, 10)]),
      P('clk', -10, 50),
      P('clr', 20, 60),
      P('pre', 20, 0),
      P('q', 50, 10),
      P('qn', 50, 50),
    ];
  }
  return [
    ...(two ? [P(a, -40, 0), P(b, -40, 20), P('clk', -40, 10)] : [P(a, -40, 20), P('clk', -40, 0)]),
    P('clr', -10, 30),
    P('pre', -30, 30),
    ...(o.hasEnable ? [P('en', -20, 30)] : []),
    P('q', 0, 0),
    P('qn', 0, 20),
  ];
}

/**
 * Settings of a Logisim memory part. Logisim leaves attributes at their default out of the file: register /
 * counter 8 bits, shift register 1 bit with 8 stages and parallel load, counter maximum 0xFF (the stored
 * default at any width; a width change writes the new maximum out) and goal 'wrap', trigger rising. A missing
 * appearance is classic in a Logisim 2.7.1 file and evolution's own look in an evolution file (XmlReader).
 */
export function logisimMemSettings(
  type: ComponentType,
  attr: Record<string, string>
): {
  width: number;
  /** Width as written (evolution's counter places its pins by it) */
  fileWidth: number;
  length: number;
  /** Stages as written (the pin places follow it) */
  fileLength: number;
  parallel: boolean;
  trigger: 'rising' | 'falling' | 'high' | 'low';
  max?: number;
  goal?: 'wrap' | 'stay' | 'continue' | 'load';
  appearance: 'classic' | 'evolution' | undefined;
  notes: string[];
} {
  const notes: string[] = [];
  const int = (v: string | undefined, dflt: number) => {
    const n = v === undefined ? NaN : parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const wide = type === 'register' || type === 'counter' || type === 'shiftRegister';
  const fileWidth = wide ? int(attr.width, type === 'shiftRegister' ? 1 : 8) : 1;
  let width = fileWidth;
  if (width > 32) {
    notes.push(`${width} bitlik, 32 bit olarak alındı.`);
    width = 32;
  }
  const fileLength = type === 'shiftRegister' ? int(attr.length, 8) : 1;
  let length = fileLength;
  if (length > 32) {
    notes.push(`${length} aşamalı, 32 aşama olarak alındı.`);
    length = 32;
  }
  const parallel = type === 'shiftRegister' ? attr.parallel !== 'false' : true;
  const trigger = (['rising', 'falling', 'high', 'low'] as const).find((t) => t === attr.trigger) ?? 'rising';
  let max: number | undefined;
  let goal: 'wrap' | 'stay' | 'continue' | 'load' | undefined;
  if (type === 'counter') {
    const mask = width >= 32 ? 0xffffffff : 2 ** width - 1;
    // Only the low 32 bits count (evolution writes up to 64 bit maxima, beyond a double's precision)
    const raw = attr.max === undefined ? 0xff : /^0x/i.test(attr.max) ? parseInt(attr.max.slice(2).slice(-8), 16) : parseInt(attr.max, 10);
    max = (Number.isFinite(raw) ? raw : 0xff) % 2 ** width;
    if (max === mask) max = undefined;
    goal = (['wrap', 'stay', 'continue', 'load'] as const).find((g) => g === attr.ongoal) ?? 'wrap';
  }
  const appearance = attr.appearance === undefined ? undefined : attr.appearance === 'classic' ? 'classic' : 'evolution';
  return { width, fileWidth, length, fileLength, parallel, trigger, max, goal, appearance, notes };
}

/** Logisim element names of the RAM, ROM and random generator (std/memory, library "#Memory") */
export const LOGISIM_RAM_NAME: Partial<Record<ComponentType, string>> = { ram: 'RAM', rom: 'ROM', random: 'Random', dualRam: 'DualRAM' };

/**
 * Which Logisim draws a RAM / ROM / random generator: 'logisim' = Logisim 2.7.1 (loc on the data pin, box to its
 * left), 'classic' / 'evolution' = Logisim-evolution's two appearances (loc at the top-left corner).
 */
export type LogisimRamLook = 'logisim' | 'classic' | 'evolution';

/**
 * Connection points of a RAM / ROM / random generator relative to its loc, with our pin keys. A bidirectional
 * data bus is 'd' and 'dio' on the same point. Logisim 2.7.1: Mem (D 0,0; A -140,0; CS -90,40), Ram (OE -50,40,
 * CLR -30,40, CLK -70,40 unless asynch, WE -110,40 and DIN -140,20 when separate), Random (Q 0,0, CK -30,-10,
 * NXT -30,10, RST -20,20). Logisim-evolution RamAppearance in byte-enable mode: A (0,10), WE (0,50), OE (0,60),
 * byte enables from (0,70) down to the first, clock below them, CLR (40,0); the data pins sit at the control
 * block's height (60, +20 for the trigger, +10 with a clock, +10 per byte enable; +10 more for one bit in the
 * evolution look), DIN on the left, D on the right edge (240, the evolution look: 240 separate / 250 bidir).
 * Its ROM has only A and D (control block 60); Random: classic Q (40,20) CK (10,40) NXT (0,30) RST (30,40),
 * evolution Q (80,80) CK (0,50) NXT (0,40) RST (0,30).
 */
export function logisimRamPorts(type: ComponentType, cfg: RamConfig, look: LogisimRamLook): Array<{ key: string; off: Pt }> {
  const P = (key: string, x: number, y: number) => ({ key, off: { x, y } });
  if (type === 'dualRam') return dualRamPorts(cfg, look);
  if (type === 'random') {
    if (look === 'logisim') return [P('out', 0, 0), P('ck', -30, -10), P('nxt', -30, 10), P('rst', -20, 20)];
    if (look === 'classic') return [P('out', 40, 20), P('ck', 10, 40), P('nxt', 0, 30), P('rst', 30, 40)];
    return [P('out', 80, 80), P('ck', 0, 50), P('nxt', 0, 40), P('rst', 0, 30)];
  }
  if (look === 'logisim') {
    const ps = [P('a', -140, 0), P('d', 0, 0), P('cs', -90, 40)];
    if (type === 'rom') return ps;
    ps.push(P('oe', -50, 40), P('clr', -30, 40));
    if (cfg.bus !== 'asynch') ps.push(P('clk', -70, 40));
    if (cfg.bus === 'separate') ps.push(P('we', -110, 40), P('din', -140, 20));
    else ps.push(P('dio', 0, 0));
    return ps;
  }
  const oneBit = look === 'evolution' && cfg.dataWidth === 1 ? 10 : 0;
  if (type === 'rom') return [P('a', 0, 10), P('d', 240, 60 + oneBit)];
  const evoCfg: RamConfig = { ...cfg, flavor: 'evolution' };
  const edge = cfg.trigger === 'rising' || cfg.trigger === 'falling';
  const nBE = ramByteEnableCount(evoCfg);
  const dataY = 80 + (edge ? 10 : 0) + nBE * 10 + oneBit;
  const sep = cfg.dataBus !== 'bidir';
  const right = look === 'classic' ? 240 : sep ? 240 : 250;
  const ps = [P('a', 0, 10), P('d', right, dataY), sep ? P('din', 0, dataY) : P('dio', right, dataY), P('oe', 0, 60), P('we', 0, 50)];
  if (edge) ps.push(P('clk', 0, 70 + nBE * 10));
  for (let i = 0; i < nBE; i++) ps.push(P(`be${i}`, 0, 70 + (nBE - i - 1) * 10));
  if (cfg.clearPin) ps.push(P('clr', 40, 0));
  return ps;
}

/**
 * Logisim-evolution 5 DualRamAppearance in byte-enable mode (loc at the top-left corner). The control block is
 * twice the single RAM's (C = 2 x (80, +10 with a clock, +10 per byte enable of a port)). Classic look: port 0
 * A (0,10), WE (0,50), OE (0,60), CLK (0,70), byte enables from (0,80) down to the first, DIN / D at C/2 on the
 * left / right edge (240); port 1 the same moved down by B = C/2 + 35 rounded to 10. Evolution look: port 0
 * A (0,20), WE (0,60), OE (0,70), byte enables from (0,80), CLK below them; port 1's controls C/2 - 10 lower;
 * data at C (+10 for one bit), port 1's 20 x min(8, bits) lower, D on the right edge (240, bidir 250).
 * CLR (40,0) in both.
 */
function dualRamPorts(cfg: RamConfig, look: LogisimRamLook): Array<{ key: string; off: Pt }> {
  const P = (key: string, x: number, y: number) => ({ key, off: { x, y } });
  const edge = cfg.trigger === 'rising' || cfg.trigger === 'falling';
  const nBE = ramByteEnableCount({ ...cfg, flavor: 'evolution' });
  const ctrl = (80 + (edge ? 10 : 0) + nBE * 10) * 2;
  const sep = cfg.dataBus !== 'bidir';
  const classic = look === 'classic';
  const ps: Array<{ key: string; off: Pt }> = [];
  for (const p of [0, 1]) {
    const sfx = p ? '1' : '';
    let addrY: number, ctlShift: number, dataY: number;
    if (classic) {
      const boff = Math.floor((Math.floor((ctrl + 70) / 2) + 5) / 10) * 10;
      addrY = 10 + p * boff;
      ctlShift = p * boff;
      dataY = ctrl / 2 + p * boff;
    } else {
      ctlShift = p * (ctrl / 2 - 10);
      addrY = 20 + ctlShift;
      dataY = ctrl + (cfg.dataWidth === 1 ? 10 : 0) + p * Math.min(8, cfg.dataWidth) * 20;
    }
    const right = classic || sep ? 240 : 250;
    ps.push(P('a' + sfx, 0, addrY), P('d' + sfx, right, dataY), sep ? P('din' + sfx, 0, dataY) : P('dio' + sfx, right, dataY));
    ps.push(P('we' + sfx, 0, (classic ? 50 : 60) + ctlShift), P('oe' + sfx, 0, (classic ? 60 : 70) + ctlShift));
    if (edge) ps.push(P('clk' + sfx, 0, (classic ? 70 : 80 + nBE * 10) + ctlShift));
    for (let i = 0; i < nBE; i++) ps.push(P(`be${p * nBE + i}`, 0, 80 + (nBE - i - 1) * 10 + ctlShift));
  }
  if (cfg.clearPin) ps.push(P('clr', 40, 0));
  return ps;
}

// RAM attributes only Logisim-evolution writes (a 2.7.1 RAM has only addrWidth, dataWidth and bus)
const EVO_RAM_ATTRS = ['appearance', 'databus', 'enables', 'trigger', 'clearpin', 'asyncread', 'readbehav', 'byteenables', 'type', 'line'];

/**
 * Settings of a Logisim RAM / ROM / random generator. Rules: a memory of a Logisim-evolution file is an evolution
 * one; in a 2.7.1 file it is too when it carries an attribute only evolution has (our export writes the
 * appearance with every evolution memory), else it follows 2.7.1. A missing appearance is evolution's own look
 * (XmlReader). Defaults left out of the file: 8 address / 8 data bits; 2.7.1 bus combined; evolution separate
 * data bus, rising trigger, clocked read, read after write, no byte enables, no clear pin; random 8 bits, seed 0.
 * ROM contents: "addr/data: A D" then the words in hex, runs written "count*value".
 */
export function logisimRamSettings(
  type: ComponentType,
  attr: Record<string, string>,
  evolutionFile: boolean
): {
  cfg: RamConfig;
  look: LogisimRamLook;
  asyncRead: boolean;
  readBehavior: 'raw' | 'war';
  seed: number;
  pages?: Record<string, number[]>;
  notes: string[];
} {
  const notes: string[] = [];
  const cfg = defaultRamConfig();
  const int = (v: string | undefined, dflt: number) => {
    const n = v === undefined ? NaN : parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const evoAppearance: LogisimRamLook = attr.appearance === 'classic' ? 'classic' : 'evolution';
  if (type === 'random') {
    let w = int(attr.width, 8);
    if (w > 32) {
      notes.push(`${w} bitlik, 32 bit olarak alındı.`);
      w = 32;
    }
    cfg.dataWidth = w;
    cfg.trigger = attr.trigger === 'falling' ? 'falling' : 'rising';
    const seed = parseInt(attr.seed ?? '0', 10);
    const look = evolutionFile || attr.appearance !== undefined ? evoAppearance : 'logisim';
    if (evolutionFile) notes.push(`Logisim-evolution'ın üreteci başka bir dizi verir (Xoshiro256++); burada Logisim 2.7.1'in dizisi kullanılıyor.`);
    return { cfg, look, asyncRead: false, readBehavior: 'raw', seed: Number.isFinite(seed) ? seed | 0 : 0, notes };
  }
  // the dual-port RAM exists only in evolution
  const evo = type === 'dualRam' || evolutionFile || (type === 'rom' ? attr.appearance !== undefined : EVO_RAM_ATTRS.some((k) => attr[k] !== undefined));
  cfg.flavor = evo ? 'evolution' : 'logisim';
  cfg.addrWidth = Math.max(RAM_ADDR_MIN, Math.min(RAM_ADDR_MAX, int(attr.addrWidth, 8)));
  cfg.dataWidth = int(attr.dataWidth, 8);
  if (cfg.dataWidth > 32) {
    notes.push(`${cfg.dataWidth} bitlik veri, 32 bit olarak alındı.`);
    cfg.dataWidth = 32;
  }
  let asyncRead = false;
  let readBehavior: 'raw' | 'war' = 'raw';
  if (type === 'ram' || type === 'dualRam') {
    if (!evo) cfg.bus = attr.bus === 'asynch' || attr.bus === 'separate' ? attr.bus : 'combined';
    else {
      cfg.dataBus = attr.databus === 'bidir' ? 'bidir' : attr.databus === 'bibusControlled' ? 'controlled' : 'separate';
      cfg.trigger = (['rising', 'falling', 'high', 'low'] as const).find((t) => t === attr.trigger) ?? 'rising';
      cfg.byteEnables = attr.byteenables === 'byteEnables';
      cfg.clearPin = attr.clearpin === 'true';
      asyncRead = attr.asyncread === 'true';
      readBehavior = attr.readbehav === 'war' ? 'war' : 'raw';
      if (attr.enables === 'line')
        notes.push(`satır kipi (line enables${attr.line ? `, ${attr.line}` : ''}) desteklenmiyor; bayt etkinleştirmeli RAM olarak alındı, bağlantıları kontrol edin.`);
    }
  } else if (attr.line && attr.line !== 'single') {
    notes.push(`çok kelimelik satır (${attr.line}) desteklenmiyor; tek kelimelik ROM olarak alındı, bağlantıları kontrol edin.`);
  }
  let pages: Record<string, number[]> | undefined;
  if (type === 'rom' && attr.contents !== undefined) {
    const text = attr.contents.replace(/\r/g, '');
    const nl = text.indexOf('\n');
    const head = (nl < 0 ? text : text.slice(0, nl)).trim();
    if (!/^addr\/data:\s+\d+\s+\d+$/.test(head)) notes.push('ROM içeriği okunamadı (addr/data başlığı yok), boş alındı.');
    else {
      const mask = cfg.dataWidth >= 32 ? 0xffffffff : 2 ** cfg.dataWidth - 1;
      const r = rawTextToMem(nl < 0 ? '' : text.slice(nl + 1), 2 ** cfg.addrWidth, mask);
      if (typeof r === 'string') notes.push(`ROM içeriği okunamadı (${r}), boş alındı.`);
      else pages = r.pages;
    }
  }
  return { cfg, look: evo ? evoAppearance : 'logisim', asyncRead, readBehavior, seed: 0, pages, notes };
}

/**
 * Logisim 2.7.1 DefaultAppearance: where each Pin of a circuit appears on its subcircuit box, relative to
 * the anchor (the instance's loc). A pin facing east sits on the west edge and so on; pins of an edge are
 * ordered by y (west / east) or x (north / south), 10 apart. The anchor is the first east port, else the
 * first north, west, south one.
 */
// ---- I/O parts (Logisim std/io 7-Segment Display, Hex Digit Display, DotMatrix; evolution DipSwitch, LedBar) ----

/** Logisim part name of each of our I/O parts */
export const LOGISIM_IO_NAME: Partial<Record<ComponentType, string>> = {
  sevenSegment: '7-Segment Display',
  hexDigit: 'Hex Digit Display',
  dotMatrix: 'DotMatrix',
  dipSwitch: 'DipSwitch',
  ledBar: 'LedBar',
  rgbLed: 'RGBLED',
  joystick: 'Joystick',
  matrixKeypad: 'MatrixKeypad',
  portIo: 'PortIO',
  realTimeClock: 'RealTimeClock',
};

/**
 * Connection points of an I/O part relative to its Logisim loc, with our pin keys:
 * - 7-segment: G (0,0) F (10,0) A (20,0) B (30,0) on top, E (0,60) D (10,60) C (20,60) DP (30,60) below
 * - hex digit: the 4-bit input at loc, DP at (10,0) in 2.7.1 and (20,0) in evolution
 * - dot matrix / LED bar (DotMatrixBase, LED bar 3 dots tall): column input i at (10i, 0), with evolution's
 *   select location top-right at (10i, -10*rows*scaleY); row input i at (0, 10i) or (10*cols, 10i); select:
 *   column vector at loc and row vector 10 below (evolution top-right: both 10*cols to the right); one row:
 *   evolution puts the row bit at (10*cols, 0), 2.7.1 has the column vector only (one column: the row vector)
 * - DIP switch: switch i+1 at (10(i+1), 0) facing north, (0, 10(i+1)) east, (0, -10(i+1)) west,
 *   (10(i-n), 0) south
 */
export function logisimIoPorts(
  type: ComponentType,
  cfg: IoConfig,
  opts: { evolution: boolean; facing?: string }
): Array<{ key: string; off: Pt }> {
  const P = (key: string, x: number, y: number) => ({ key, off: { x, y } });
  if (type === 'sevenSegment') {
    const ports = [P('inA', 20, 0), P('inB', 30, 0), P('inC', 20, 60), P('inD', 10, 60), P('inE', 0, 60), P('inF', 10, 0), P('inG', 0, 0)];
    if (cfg.dp) ports.push(P('inDP', 30, 60));
    return ports;
  }
  if (type === 'hexDigit') return cfg.dp ? [P('in', 0, 0), P('dp', opts.evolution ? 20 : 10, 0)] : [P('in', 0, 0)];
  if (type === 'dipSwitch') {
    const n = cfg.size;
    const f = opts.facing ?? 'north';
    return Array.from({ length: n }, (_, i) =>
      f === 'east' ? P(`out${i}`, 0, 10 * (i + 1)) : f === 'west' ? P(`out${i}`, 0, -10 * (i + 1)) : f === 'south' ? P(`out${i}`, 10 * (i - n), 0) : P(`out${i}`, 10 * (i + 1), 0)
    );
  }
  const bar = type === 'ledBar';
  const cols = bar ? cfg.size : cfg.cols;
  const rows = bar ? 1 : cfg.rows;
  const scaleY = bar ? 3 : 1;
  const tr = opts.evolution && cfg.selectLoc === 'tr';
  const mode = bar ? (cfg.ledBarMode === 'oneWire' ? 'row' : 'column') : cfg.matrixInput;
  if (mode === 'column') return Array.from({ length: cols }, (_, i) => P(bar ? `in${i}` : `c${i}`, 10 * i, tr ? -10 * rows * scaleY : 0));
  if (mode === 'row') return Array.from({ length: rows }, (_, i) => P(bar ? 'in' : `r${i}`, tr ? 10 * cols : 0, 10 * i));
  if (!opts.evolution) {
    if (rows <= 1) return [P('col', 0, 0)];
    if (cols <= 1) return [P('row', 0, 0)];
    return [P('col', 0, 0), P('row', 0, 10)];
  }
  if (rows <= 1) return [P('col', 0, 0), P('row', 10 * cols, 0)];
  const dx = tr ? 10 * cols : 0;
  return [P('col', dx, 0), P('row', dx, 10)];
}

const IO_SHAPE: Record<string, 'circle' | 'square' | 'padded'> = { circle: 'circle', square: 'square', clusterSegment: 'padded' };

/**
 * Settings of an I/O part from its Logisim attributes (missing = the writing program's default: 7-segment
 * active high with DP, hex digit with DP, dot matrix 5 x 7 column input square dots, LED bar 8 separated, DIP
 * switch 8 facing north; lit colour red for the 7-segment / hex digit, green otherwise).
 */
export function logisimIoSettings(
  type: ComponentType,
  attr: Record<string, string>,
  evolution: boolean
): { cfg: Partial<IoConfig>; state: Partial<CircuitComponentInstance['state']>; ports: Array<{ key: string; off: Pt }>; rot: 0 | 90 | 180 | 270; notes: string[] } {
  const notes: string[] = [];
  const int = (v: string | undefined, d: number) => {
    const n = parseInt(v ?? '', 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(32, n)) : d;
  };
  const cfg: Partial<IoConfig> = {};
  const state: Partial<CircuitComponentInstance['state']> = {};
  const color = /^#[0-9a-f]{6}$/i.test(attr.color ?? '') ? attr.color.toLowerCase() : undefined;
  if (color) state.ioOnColor = color;
  let facing: string | undefined;
  if (type === 'sevenSegment' || type === 'hexDigit') {
    cfg.dp = attr.decimalPoint !== 'false';
    if (type === 'sevenSegment' && attr.active === 'false') state.ioActiveLow = true;
  } else if (type === 'dipSwitch') {
    cfg.size = int(attr.number, 8);
    facing = attr.facing ?? 'north';
  } else {
    const bar = type === 'ledBar';
    if (bar) {
      cfg.size = int(attr.matrixcols, 8);
      cfg.ledBarMode = attr.inputtype === 'row' ? 'oneWire' : 'separated';
    } else {
      cfg.cols = int(attr.matrixcols, 5);
      cfg.rows = int(attr.matrixrows, 7);
      cfg.matrixInput = attr.inputtype === 'row' || attr.inputtype === 'select' ? attr.inputtype : 'column';
      const shape = IO_SHAPE[attr.dotshape ?? 'square'];
      if (shape && shape !== 'square') state.dotShape = shape;
      if (!evolution && cfg.matrixInput === 'select' && (cfg.rows === 1 || cfg.cols === 1))
        notes.push(`seçim girişli ${cfg.cols}x${cfg.rows} matrisin Logisim 2.7.1'de tek girişi var; buradaki satır/sütun vektörünün diğeri açık kaldı.`);
    }
    cfg.selectLoc = evolution && attr.selloc === 'tr' ? 'tr' : 'bl';
    const persist = parseInt(attr.persist ?? '0', 10);
    if (persist > 0) {
      state.ioPersist = persist;
      notes.push(`kalıcılık (persist ${persist}) saklandı, simülatörde tik sayacı olmadığından 0 gibi gösterilir.`);
    }
  }
  const full: IoConfig = { ...defaultIoConfig(), ...cfg };
  const rot = type === 'dipSwitch' ? FACING_ROTATION[facing ?? 'north'] ?? 270 : 0;
  return { cfg, state, ports: logisimIoPorts(type, full, { evolution, facing }), rot, notes };
}

// ---- Aşama 5a parts (evolution RGBLED, Joystick, MatrixKeypad, PortIO, RealTimeClock) ----

/** Evolution's default facing of each Aşama 5a part (our rotation 0); the keypad has no facing */
export const IO5_DEFAULT_FACING: Partial<Record<ComponentType, string>> = { rgbLed: 'west', joystick: 'east', portIo: 'east', realTimeClock: 'east' };

/** Our rotation of an Aşama 5a part from its evolution facing (rotation 0 = the default facing) */
export function io5RotationOf(type: ComponentType, facing: string | undefined): 0 | 90 | 180 | 270 {
  const def = IO5_DEFAULT_FACING[type];
  if (!def) return 0;
  const r = FACING_ROTATION[facing ?? def] ?? FACING_ROTATION[def];
  return ((((r - FACING_ROTATION[def]) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** Evolution facing of an Aşama 5a part from our rotation (undefined: the keypad, which has none) */
export function io5FacingOf(type: ComponentType, rotation: number | undefined): string | undefined {
  const def = IO5_DEFAULT_FACING[type];
  if (!def) return undefined;
  const r = (FACING_ROTATION[def] + (rotation ?? 0)) % 360;
  return (['east', 'south', 'west', 'north'] as const)[r / 90];
}

/**
 * Connection points of an Aşama 5a part relative to its evolution loc, with our pin keys (evolution 5.0.0):
 * - RGB LED: red at loc; facing west green (10,-10) blue (10,10), the pair turning with the facing
 * - joystick: X / Y at (0,0) / (0,10) facing east, (-30,0) / (-30,10) west, (-20,-10) / (-10,-10) north,
 *   (-20,20) / (-10,20) south; the body (-30,-10, 30 x 30) does not turn (Logisim 2.7.1: no facing, east's points)
 * - matrix keypad (loc = centre, no facing): row i at (-30 + 10(i+1), 30), column i at (30, -30 + 10(i+1));
 *   large size 60 instead of 30
 * - port I/O facing east: enable (0,10), then the bus pins along the top edge 10 apart from (10,0) (the part's
 *   input first); the other facings turn the points around loc. Evolution's widest bus is 64 bits, so the
 *   points do not depend on the pin count
 * - real-time clock: the output at loc
 */
export function logisimIo5Ports(type: ComponentType, cfg: Io5Config, facing?: string): Array<{ key: string; off: Pt }> {
  const P = (key: string, x: number, y: number) => ({ key, off: { x, y } });
  const f = facing ?? IO5_DEFAULT_FACING[type];
  if (type === 'rgbLed') {
    const [cx, cy, dx, dy] = f === 'north' ? [0, 10, 10, 0] : f === 'east' ? [-10, 0, 0, 10] : f === 'south' ? [0, -10, -10, 0] : [10, 0, 0, -10];
    return [P('r', 0, 0), P('g', cx + dx, cy + dy), P('b', cx - dx, cy - dy)];
  }
  if (type === 'joystick') {
    const [x0, y0, x1, y1] = f === 'north' ? [-20, -10, -10, -10] : f === 'south' ? [-20, 20, -10, 20] : f === 'west' ? [-30, 0, -30, 10] : [0, 0, 0, 10];
    return [P('x', x0, y0), P('y', x1, y1)];
  }
  if (type === 'matrixKeypad') {
    const e = cfg.keypadSize === 'large' ? 60 : 30;
    return [...[0, 1, 2, 3].map((i) => P(`r${i}`, -e + 10 * (i + 1), e)), ...[0, 1, 2, 3].map((i) => P(`c${i}`, e, -e + 10 * (i + 1)))];
  }
  if (type === 'portIo') {
    const [dx, dy] = f === 'north' ? [0, -10] : f === 'south' ? [0, 10] : f === 'west' ? [-10, 0] : [10, 0];
    if (cfg.portDir === 'input') return [P('out', dx, dy)];
    if (cfg.portDir === 'output') return [P('in', dx, dy)];
    return [P('en', -dy, dx), P('in', dx, dy), P('out', 2 * dx, 2 * dy)];
  }
  return [P('out', 0, 0)];
}

/**
 * Settings of an Aşama 5a part from its evolution attributes (missing = evolution's default: RGB LED active high
 * facing west, joystick 4 bits red, keypad raw normal, port I/O 8 pins single enable, clock milliseconds medium,
 * the others facing east).
 */
export function logisimIo5Settings(
  type: ComponentType,
  attr: Record<string, string>
): { cfg: Partial<Io5Config>; state: Partial<CircuitComponentInstance['state']>; ports: Array<{ key: string; off: Pt }>; rot: 0 | 90 | 180 | 270; notes: string[] } {
  const notes: string[] = [];
  const cfg: Partial<Io5Config> = {};
  const state: Partial<CircuitComponentInstance['state']> = {};
  const facing = type === 'matrixKeypad' ? undefined : attr.facing !== undefined && FACING_ROTATION[attr.facing] !== undefined ? attr.facing : IO5_DEFAULT_FACING[type];
  if (type === 'rgbLed') {
    if (attr.active === 'false') state.ioActiveLow = true;
  } else if (type === 'joystick') {
    const n = parseInt(attr.bits ?? '', 10);
    cfg.joyBits = Number.isFinite(n) ? Math.max(2, Math.min(5, n)) : 4;
    const color = /^#[0-9a-f]{6}$/i.test(attr.color ?? '') ? attr.color.toLowerCase() : undefined;
    // evolution's default ball is Color.RED (#ff0000): our default red (#f00000, the red swatch) stands for it
    if (color && color !== '#ff0000' && color !== '#f00000') state.ioOnColor = color;
  } else if (type === 'matrixKeypad') {
    cfg.keypadMode = attr.mode === 'pmod_kypd' ? 'pmod' : 'raw';
    cfg.keypadSize = attr.size === 'large' ? 'large' : 'normal';
    const names = ['keyALabel', 'keyBLabel', 'keyCLabel', 'keyDLabel', 'keyStarLabel', 'keyHashLabel'];
    const keys = names.map((k, i) => {
      const chars = [...(attr[k] ?? '').trim()];
      if (chars.length > 1) notes.push(`"${KEYPAD_DEFAULT_CUSTOM[i]}" tuşunun etiketi "${attr[k]}" ilk karakteriyle ("${chars[0]}") alındı; burada tuş etiketi tek karakter.`);
      const ch = chars[0] ?? '';
      return ch === KEYPAD_DEFAULT_CUSTOM[i] ? '' : ch;
    });
    if (keys.some((k) => k !== '')) state.keypadKeys = keys;
  } else if (type === 'portIo') {
    const n = parseInt(attr.number ?? '', 10);
    const size = Number.isFinite(n) ? Math.max(1, n) : 8;
    if (size > PORT_IO_MAX)
      notes.push(`${size} bacaklı; burada en çok ${PORT_IO_MAX} bacak olduğundan ${PORT_IO_MAX} bacak olarak alındı (bağlı ${size} bitlik teller genişlik uyuşmazlığı verir).`);
    cfg.portSize = Math.min(size, PORT_IO_MAX);
    cfg.portDir = attr.direction === 'onlyinput' ? 'input' : attr.direction === 'onlyOutput' ? 'output' : attr.direction === 'IOMultiEnable' ? 'inoutMulti' : 'inoutSingle';
  } else if (type === 'realTimeClock') {
    cfg.rtcType = attr.timeType === '2' ? 's' : 'ms';
    cfg.rtcSize = attr.porsize === '2' ? 'narrow' : 'medium';
    notes.push("Logisim-evolution'da çıkış 64 bit; burada zamanın alt 32 biti (64 bitlik bağlantılar genişlik uyuşmazlığı verir).");
  }
  const full: Io5Config = { ...defaultIo5Config(), ...cfg };
  return { cfg, state, ports: logisimIo5Ports(type, full, facing), rot: io5RotationOf(type, facing), notes };
}

// ---- Aşama 5b parts (evolution BFH library "#BFH-Praktika": Binary_to_BCD_converter, BCD_to_7_Segment_decoder) ----

/** Evolution part name of each Aşama 5b part */
export const LOGISIM_BFH_NAME: Partial<Record<ComponentType, string>> = {
  binToBcd: 'Binary_to_BCD_converter',
  bcdToSevenSegment: 'BCD_to_7_Segment_decoder',
};

/**
 * Connection points of an Aşama 5b part relative to its evolution loc, with our pin keys (neither part has a facing):
 * - binary to BCD converter (n digits): the input at (-30, 0), digit 10^k on the top edge at ((n - 1 - k) * 60, -20)
 * - BCD to 7-segment decoder: g f a b at (0..30, 0), e d c at (0..20, 60), the BCD input at (10, 80)
 */
export function logisimBfhPorts(type: ComponentType, bits: number): Array<{ key: string; off: Pt }> {
  const P = (key: string, x: number, y: number) => ({ key, off: { x, y } });
  if (type === 'binToBcd') {
    const n = binToBcdDigits(bits);
    return [P('bin', -30, 0), ...Array.from({ length: n }, (_, k) => P(`d${k}`, (n - 1 - k) * 60, -20))];
  }
  return [P('a', 20, 0), P('b', 30, 0), P('c', 20, 60), P('d', 10, 60), P('e', 0, 60), P('f', 10, 0), P('g', 0, 0), P('bcd', 10, 80)];
}

/** Settings of an Aşama 5b part from its evolution attributes (missing binvalue = evolution's default 9) */
export function logisimBfhSettings(type: ComponentType, attr: Record<string, string>): { bits: number; ports: Array<{ key: string; off: Pt }>; notes: string[] } {
  const notes: string[] = [];
  let bits = BIN_TO_BCD_DEFAULT_BITS;
  if (type === 'binToBcd' && attr.binvalue !== undefined) {
    const n = parseInt(attr.binvalue, 10);
    if (!Number.isFinite(n)) notes.push(`giriş genişliği "${attr.binvalue}" okunamadı, varsayılan ${bits} bit alındı.`);
    else {
      bits = Math.max(BIN_TO_BCD_MIN_BITS, Math.min(BIN_TO_BCD_MAX_BITS, n));
      if (bits !== n) notes.push(`giriş ${n} bitlik; dönüştürücü ${BIN_TO_BCD_MIN_BITS}-${BIN_TO_BCD_MAX_BITS} bit alır, ${bits} bit olarak alındı.`);
    }
  }
  return { bits, ports: logisimBfhPorts(type, bits), notes };
}

// ---- Aşama 5c parts (std/io Keyboard and TTY, in Logisim 2.7.1 too; evolution's Telnet) ----

/** Logisim part name of each Aşama 5c part (all three in the I/O library) */
export const LOGISIM_IO5C_NAME: Partial<Record<ComponentType, string>> = {
  keyboard: 'Keyboard',
  tty: 'TTY',
  telnet: 'Telnet',
};

/**
 * Connection points of an Aşama 5c part relative to its Logisim loc, with our pin keys. None of them has a facing
 * and the points do not depend on the settings (Logisim 2.7.1 and evolution agree for the keyboard and the TTY):
 * - keyboard: clock at loc, RE (10, 10), CLR (20, 10), available (130, 10), 7-bit data (140, 10)
 * - TTY: clock at loc, WE (10, 10), CLR (20, 10), 7-bit data (0, -10)
 * - Telnet: in (-30, 10), clock (-30, 20), write (-30, 30) on the left; out (10, 10), available (10, 20), read (10, 30)
 */
export function logisimIo5cPorts(type: ComponentType): Array<{ key: string; off: Pt }> {
  const P = (key: string, x: number, y: number) => ({ key, off: { x, y } });
  if (type === 'keyboard') return [P('clk', 0, 0), P('en', 10, 10), P('clr', 20, 10), P('avl', 130, 10), P('out', 140, 10)];
  if (type === 'tty') return [P('clk', 0, 0), P('we', 10, 10), P('clr', 20, 10), P('in', 0, -10)];
  return [P('in', -30, 10), P('clk', -30, 20), P('wr', -30, 30), P('out', 10, 10), P('av', 10, 20), P('rd', 10, 30)];
}

/** A Logisim colour attribute as ours stores it: '#rrggbb', or '#rrggbbaa' when not opaque (undefined: unreadable) */
export function logisimColor(v: string | undefined): string | undefined {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec((v ?? '').trim());
  if (!m) return undefined;
  const a = (m[2] ?? 'ff').toLowerCase();
  return `#${m[1].toLowerCase()}${a === 'ff' ? '' : a}`;
}

/**
 * Settings of an Aşama 5c part from its Logisim attributes. A missing attribute is Logisim's default (Logisim leaves
 * defaults out of the file): keyboard buffer 32, rising edge; terminal 8 rows x 32 columns, black text on
 * #00000040; Telnet port 8000, buffer 1024, telnet mode off. Evolution's Telnet ignores its trigger (always rising).
 */
export function logisimIo5cSettings(
  type: ComponentType,
  attr: Record<string, string>
): { cfg: Partial<Io5cConfig>; state: Partial<CircuitComponentInstance['state']>; ports: Array<{ key: string; off: Pt }>; notes: string[] } {
  const notes: string[] = [];
  const cfg: Partial<Io5cConfig> = {};
  const state: Partial<CircuitComponentInstance['state']> = {};
  const int = (name: string, what: string, dflt: number, min: number, max: number): number => {
    const v = attr[name];
    if (v === undefined) return dflt;
    const n = /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) {
      notes.push(`${what} "${v}" okunamadı, varsayılan ${dflt} alındı.`);
      return dflt;
    }
    const c = Math.max(min, Math.min(max, n));
    if (c !== n) notes.push(`${what} ${n}; ${min}-${max} aralığında olmalı, ${c} alındı.`);
    return c;
  };
  const trigger = () => {
    if (attr.trigger === undefined || attr.trigger === 'rising') return;
    if (attr.trigger === 'falling') state.trigger = 'falling';
    else notes.push(`tetikleme "${attr.trigger}" tanınmadı, yükselen kenar alındı.`);
  };
  const color = (name: string, what: string, dflt: string, key: 'ttyColor' | 'ttyBg') => {
    const v = attr[name];
    if (v === undefined) return;
    const c = logisimColor(v);
    if (!c) notes.push(`${what} "${v}" okunamadı, varsayılan renk alındı.`);
    else if (c !== dflt) state[key] = c;
  };
  if (type === 'keyboard') {
    cfg.kbdBufLen = int('buflen', 'tampon uzunluğu', KEYBOARD_DEFAULT_BUFFER, 1, KEYBOARD_BUFFER_MAX);
    trigger();
  } else if (type === 'tty') {
    cfg.ttyRows = int('rows', 'satır sayısı', TTY_DEFAULT_ROWS, 1, TTY_ROWS_MAX);
    cfg.ttyCols = int('cols', 'sütun sayısı', TTY_DEFAULT_COLS, 1, TTY_COLS_MAX);
    trigger();
    color('color', 'yazı rengi', TTY_DEFAULT_COLOR, 'ttyColor');
    color('bg', 'arka plan rengi', TTY_DEFAULT_BG, 'ttyBg');
  } else {
    cfg.telnetPort = int('port', 'port', TELNET_DEFAULT_PORT, 1, 65535);
    cfg.telnetBufLen = int('buflen', 'tampon uzunluğu', TELNET_DEFAULT_BUFFER, 1, TELNET_BUFFER_MAX);
    cfg.telnetMode = attr.telnetMode === 'true';
  }
  return { cfg, state, ports: logisimIo5cPorts(type), notes };
}

// ---- Aşama 5d part (evolution's std/io RGB Video) ----

/** Logisim-evolution part name of the RGB video screen (I/O library) */
export const LOGISIM_VIDEO_NAME = 'RGB Video';

/**
 * Connection points of evolution's RGB Video relative to its loc (= RST), with our pin keys: RST, CLK, WE, X, Y, DATA
 * along the bottom edge at x = 0, 10, 20, 40, 50, 60. No facing; the points do not depend on the settings.
 */
export function logisimVideoPorts(): Array<{ key: string; off: Pt }> {
  return [
    { key: 'rst', off: { x: 0, y: 0 } },
    { key: 'clk', off: { x: 10, y: 0 } },
    { key: 'we', off: { x: 20, y: 0 } },
    { key: 'x', off: { x: 40, y: 0 } },
    { key: 'y', off: { x: 50, y: 0 } },
    { key: 'data', off: { x: 60, y: 0 } },
  ];
}

/** Evolution's RGB Video body relative to its loc: bounds (-30, -bh, bw, bh), bw = max(scale * width + 14, 100), bh = max(scale * height + 14, 20) */
export function logisimVideoBounds(cfg: Pick<VideoConfig, 'width' | 'height' | 'scale'>): { x: number; y: number; width: number; height: number } {
  const width = Math.max(cfg.scale * cfg.width + 14, 100);
  const height = Math.max(cfg.scale * cfg.height + 14, 20);
  return { x: -30, y: -height, width, height };
}

/** Evolution's option texts of the cursor and reset attributes (the first one is the default) */
export const LOGISIM_VIDEO_CURSOR = ['Blinking Dot', 'No Cursor'] as const;
export const LOGISIM_VIDEO_RESET = ['Asynchronous', 'Synchronous'] as const;

/**
 * Settings of an RGB Video from its evolution attributes. A missing attribute is evolution's default (left out of
 * the file): blinking cursor, asynchronous reset, 888 RGB, 128 x 128, scale 2. The resolution choice is not saved
 * (evolution derives it from width / height); the image is not saved either.
 */
export function logisimVideoSettings(attr: Record<string, string>): { cfg: VideoConfig; ports: Array<{ key: string; off: Pt }>; notes: string[] } {
  const notes: string[] = [];
  const int = (name: string, what: string, dflt: number, min: number, max: number): number => {
    const v = attr[name];
    if (v === undefined) return dflt;
    const n = /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) {
      notes.push(`${what} "${v}" okunamadı, varsayılan ${dflt} alındı.`);
      return dflt;
    }
    const c = Math.max(min, Math.min(max, n));
    if (c !== n) notes.push(`${what} ${n}; ${min}-${max} aralığında olmalı, ${c} alındı.`);
    return c;
  };
  const option = <T extends string>(name: string, what: string, opts: readonly T[]): T => {
    const v = attr[name];
    if (v === undefined || opts.includes(v as T)) return (v as T) ?? opts[0];
    notes.push(`${what} "${v}" tanınmadı, varsayılan "${opts[0]}" alındı.`);
    return opts[0];
  };
  const cursor = option('cursor', 'imleç', LOGISIM_VIDEO_CURSOR);
  const reset = option('reset', 'sıfırlama', LOGISIM_VIDEO_RESET);
  const colorText = option('color', 'renk modeli', VIDEO_COLOR_MODELS.map((m) => m.circ));
  const cfg: VideoConfig = {
    color: VIDEO_COLOR_MODELS.find((m) => m.circ === colorText)!.id,
    reset: reset === 'Synchronous' ? 'sync' : 'async',
    cursor: cursor !== 'No Cursor',
    width: int('width', 'genişlik', 128, VIDEO_SIZE_MIN, VIDEO_SIZE_MAX),
    height: int('height', 'yükseklik', 128, VIDEO_SIZE_MIN, VIDEO_SIZE_MAX),
    scale: int('scale', 'ölçek', 2, 1, VIDEO_SCALE_MAX),
  };
  return { cfg, ports: logisimVideoPorts(), notes };
}

// ---- Aşama 5e part (evolution's std/base Image) ----

/** Logisim-evolution part name of the decorative image (Base library) */
export const LOGISIM_IMAGE_NAME = 'Image';

/**
 * Settings of an Image from its evolution attributes (ImageAttributes): image = the source string (a data URL or a
 * file path, line breaks dropped like evolution's writer), width / height = the frame (default 64; 0 or less: the
 * picture's size when it decodes, else 1), scale fit / stretch / cover, license (one of evolution's options) and
 * attribution. Evolution refuses a value it cannot parse; here it takes the default with a note.
 */
export function logisimImageSettings(attr: Record<string, string>): { cfg: ImageConfig; notes: string[] } {
  const notes: string[] = [];
  const src = (attr.image ?? '').replace(/[\r\n]+/g, '');
  const shown = imageShownSize(src);
  if (src && !src.startsWith('data:image/')) notes.push(`resim "${src}" dosya yolu olarak kayıtlı; tarayıcı bu dosyayı okuyamaz, boş çerçeve çizilir (yol korunur).`);
  else if (src && !shown) notes.push('gömülü resim PNG, JPEG, GIF ya da BMP olarak çözülemedi; Logisim-evolution da boş çerçeve çizer.');
  // XmlReader.initAttributeSet: the attributes in the part's list order (image, width, height, ...), a missing one set
  // to its default the same way; so the picture first sizes the frame, then width and height (64 when missing) are
  // set like the user would set them (0 or less: both sides from the picture when it decodes, else 1)
  let width = shown ? shown.width : IMAGE_DEFAULT_SIZE;
  let height = shown ? shown.height : IMAGE_DEFAULT_SIZE;
  for (const name of ['width', 'height'] as const) {
    const what = name === 'width' ? 'genişlik' : 'yükseklik';
    const v = attr[name];
    let n = IMAGE_DEFAULT_SIZE;
    if (v !== undefined) {
      n = /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN;
      if (!Number.isFinite(n)) {
        notes.push(`${what} "${v}" okunamadı, varsayılan ${IMAGE_DEFAULT_SIZE} alındı.`);
        n = IMAGE_DEFAULT_SIZE;
      }
    }
    if (n <= 0 && shown) {
      width = shown.width;
      height = shown.height;
      notes.push(`${what} ${n}; resmin kendi boyutu (${shown.width} × ${shown.height}) alındı.`);
    } else if (n <= 0) {
      if (name === 'width') width = 1;
      else height = 1;
      notes.push(`${what} ${n}; en az 1 olmalı, 1 alındı.`);
    } else if (name === 'width') width = n;
    else height = n;
  }
  const scaleText = attr.scale;
  let scale: ImageScale = 'fit';
  if (scaleText !== undefined) {
    if (IMAGE_SCALES.includes(scaleText as ImageScale)) scale = scaleText as ImageScale;
    else notes.push(`yerleşim "${scaleText}" tanınmadı, varsayılan "fit" alındı.`);
  }
  let license = 'Unspecified';
  if (attr.license !== undefined) {
    if (IMAGE_LICENSES.includes(attr.license)) license = attr.license;
    else notes.push(`lisans "${attr.license}" tanınmadı, varsayılan "Unspecified" alındı.`);
  }
  // width and height were set while loading, so evolution's userSetDimensions is on: a new picture keeps the frame
  return { cfg: { src, width, height, scale, license, attribution: attr.attribution ?? '', sized: true }, notes };
}

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
  // Written by Logisim-evolution (any version after 2.7.1)
  const evolutionFile = (() => {
    const v = (fileSource.match(/\d+/g) ?? ['2', '7', '1']).map(Number);
    const ref = [2, 7, 1];
    for (let k = 0; k < Math.max(v.length, ref.length); k++) if ((v[k] ?? 0) !== (ref[k] ?? 0)) return (v[k] ?? 0) > (ref[k] ?? 0);
    return false;
  })();
  if (circuits.length === 0) {
    throw new Error('Geçerli bir .circ devre dosyası bulunamadı (circuit etiketi yok).');
  }

  const circuitByName = new Map<string, Element>();
  circuits.forEach((c, i) => circuitByName.set(c.getAttribute('name') || `Devre ${i + 1}`, c));
  // Library numbers of evolution's TTL library (its chips are named by number: "7400")
  const ttlLibs = new Set(
    Array.from(xmlDoc.getElementsByTagName('lib'))
      .filter((l) => l.getAttribute('desc') === '#TTL')
      .map((l) => l.getAttribute('name') ?? '')
  );
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
    // Memory part settings and its connection points (relative to loc). Without an appearance attribute the
    // writing program's default is taken, unless the other look's pins clearly meet more wires
    const memSettings = (type: ComponentType, attr: Record<string, string>, loc: Pt) => {
      const st = logisimMemSettings(type, attr);
      const portsFor = (appearance: 'classic' | 'evolution') =>
        logisimMemPorts(type, {
          width: st.fileWidth,
          length: st.fileLength,
          parallel: st.parallel,
          appearance,
          // Evolution ignores a flip-flop's enable point, so do we; an up/down wire in a 2.7.1 file can only
          // come from a program that knows the pin (this one's export), so it is taken
          hasEnable: !evolutionFile,
          hasUpDown: true,
        });
      let appearance = st.appearance ?? (evolutionFile ? 'evolution' : 'classic');
      if (!st.appearance) {
        const wired = (a: 'classic' | 'evolution') => portsFor(a).filter((p) => netAt({ x: loc.x + p.off.x, y: loc.y + p.off.y }) !== null).length;
        const other = appearance === 'classic' ? 'evolution' : 'classic';
        if (wired(other) > wired(appearance)) appearance = other;
      }
      return { ...st, appearance, ports: portsFor(appearance) };
    };
    // RAM / ROM / random generator settings and connection points (relative to loc)
    const ramSettings = (type: ComponentType, attr: Record<string, string>) => {
      const st = logisimRamSettings(type, attr, evolutionFile);
      return { ...st, ports: logisimRamPorts(type, st.cfg, st.look) };
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
        // A long value (ROM contents) is the element's text instead of 'val'
        if (aName) attr[aName] = attrs[a].hasAttribute('val') ? attrs[a].getAttribute('val') ?? '' : attrs[a].textContent ?? '';
      }
      sig.push(`c${compNode.getAttribute('lib') ?? ''}:${compName}${compNode.getAttribute('loc')}${Object.entries(attr).map(([k, v]) => `${k}=${v}`).join(',')}`);
      // 2.7.1 and early evolution write output="true"; evolution 4+ writes type="output"
      const isOutput = attr.output === 'true' || (compName.trim().toLowerCase() === 'pin' && attr.type === 'output');
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
      const ttlType = ttlLibs.has(compNode.getAttribute('lib') ?? '') && isTtlType(`ttl${compName.trim()}`) ? (`ttl${compName.trim()}` as ComponentType) : null;
      let nativeType = isSub ? 'subcircuit' : ttlType ?? mapCircCompType(compName, isOutput, constVal);
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
      // (the RGB Video's width is its screen width in pixels, the Image's its frame width, not a bit width)
      if (width > 1 && !WIDE_IMPORT.has(nativeType) && !ARITH_TYPES.has(nativeType) && !MEM_TYPES.has(nativeType) && !RAM_TYPES.has(nativeType) && nativeType !== 'rgbVideo' && nativeType !== 'image')
        warnings.push(`${where}: ${width} bitlik, tek bit olarak alındı.`);
      const rot = FACING_ROTATION[facing] ?? 0;
      parts.push({ compName, loc, nativeType, attr, isOutput, label, facing, rot, size, width, inputsAttr, xorMode: attr.xor, negated, leftHanded, pull: attr.pull, outMode, sub, where });

      // Almost every Logisim part has a connection at loc (gate output, pin ...); memory parts list their own
      if (!MEM_TYPES.has(nativeType) && !RAM_TYPES.has(nativeType) && !IO_IMPORT.has(nativeType) && !BFH_TYPES.has(nativeType) && !IO5C_TYPES.has(nativeType) && !isTtlType(nativeType) && nativeType !== 'image') occupied.add(key(loc));
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
                : MEM_TYPES.has(nativeType)
                ? memSettings(nativeType, attr, loc).ports.map((p) => p.off)
                : RAM_TYPES.has(nativeType)
                ? ramSettings(nativeType, attr).ports.map((p) => p.off)
                : BFH_TYPES.has(nativeType)
                ? logisimBfhSettings(nativeType, attr).ports.map((p) => p.off)
                : IO5C_TYPES.has(nativeType)
                ? logisimIo5cPorts(nativeType).map((p) => p.off)
                : nativeType === 'rgbVideo'
                ? logisimVideoPorts().map((p) => p.off)
                : IO5_TYPES.has(nativeType)
                ? logisimIo5Settings(nativeType, attr).ports.map((p) => p.off)
                : IO_IMPORT.has(nativeType)
                ? logisimIoSettings(nativeType, attr, evolutionFile).ports.map((p) => p.off)
                : isTtlType(nativeType)
                ? ttlImportPorts(nativeType, attr.VccGndPorts === 'true').map((p) => rotateOffset(p.off, rot))
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
        // Evolution splitters go up to 64 bits (a real-time clock's output): ours keep the low 32 with their ends
        if (incoming > 32) {
          warnings.push(`${where}: ${incoming} bitlik; burada en çok 32 bit olduğundan yalnız alt 32 bit (uçlarıyla birlikte) alındı.`);
          bitEnd.length = 32;
        }
        const appear = attr.appear === 'right' ? 'right' : attr.appear === 'center' || attr.appear === 'legacy' ? 'center' : 'left';
        let inst = configureSplitter(createComponentInstance('splitter', 0, 0), { incoming: bitEnd.length, fanout, appear, bitEnd });
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
      if (MEM_TYPES.has(nativeType)) {
        // Every pin on its Logisim connection point (classic or evolution look); ours is drawn classic
        const st = memSettings(nativeType, attr, loc);
        for (const n of st.notes) warnings.push(`${where}: ${n}`);
        let inst = createComponentInstance(nativeType, 0, 0);
        inst = configureMem(inst, { width: st.width, length: st.length, parallel: st.parallel });
        const state = { ...inst.state, trigger: st.trigger };
        if (nativeType === 'counter') {
          if (st.max === undefined) delete state.counterMax;
          else state.counterMax = st.max;
          state.counterGoal = st.goal;
        }
        inst = { ...inst, state };
        const idOf = (k: string) => [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k)?.id;
        const offOf = new Map(st.ports.map((p) => [p.key, p.off]));
        const anchorKey = nativeType === 'shiftRegister' ? 'in' : 'q';
        place(
          inst,
          idOf(anchorKey)!,
          at(loc, offOf.get(anchorKey) ?? { x: 0, y: 0 }),
          label,
          st.ports.flatMap(({ key: k, off }): Array<[string, Pt]> => {
            const id = idOf(k);
            return id ? [[id, at(loc, off)]] : [];
          })
        );
        const wired = (k: string) => {
          const off = offOf.get(k);
          return !!off && netAt(at(loc, off)) !== null;
        };
        // Logisim 2.7.1 counts down while LD = 1 and CT is not 0; ours loads first, like evolution
        if (nativeType === 'counter' && !evolutionFile && wired('ld'))
          warnings.push(`${where}: Logisim 2.7.1'de LD = 1 iken CT de 0 değilse sayaç geri sayar; burada evolution gibi yükleme önceliklidir.`);
        if (nativeType === 'counter' && !evolutionFile && wired('ud'))
          warnings.push(`${where}: yukarı/aşağı (UD) girişi Logisim 2.7.1'de yok (hep yukarı sayar); burada evolution gibi bağlandı.`);
        continue;
      }
      if (isTtlType(nativeType)) {
        // Evolution TTL chip: turned like its facing, every pin joined at its evolution connection point
        const chip = ttlChipOf(nativeType)!;
        const vccGnd = attr.VccGndPorts === 'true';
        let inst = configureTtl(createComponentInstance(nativeType, 0, 0), { vccGnd });
        inst = { ...inst, rotation: rot ? (rot as 90 | 180 | 270) : undefined };
        if (attr.ShowInternalStructure === 'true') inst = { ...inst, state: { ...inst.state, ttlInternal: true } };
        if (chip.expire) {
          // 74123 R / C: kΩ / pF numbers (evolution also reads 10k, 4.7uF); an unreadable value keeps the default
          const rc = ttlRcOf({});
          const read = (name: string, unit: 'kohm' | 'pf', pair: [number, number], h: number) => {
            const raw = attr[name];
            if (raw === undefined) return;
            const n = parseEng(raw, unit);
            if (n === undefined) warnings.push(`${where}: ${name} = "${raw}" okunamadı (aralık dışı ya da geçersiz), varsayılan kullanıldı.`);
            else pair[h] = n;
          };
          for (const h of [0, 1]) {
            read(`${h + 1}Rext`, 'kohm', rc.rext, h);
            read(`${h + 1}Cext`, 'pf', rc.cext, h);
          }
          inst = { ...inst, state: { ...inst.state, ttlRext: rc.rext, ttlCext: rc.cext } };
        }
        const idOf = (k: string) => [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k)?.id;
        const ports = ttlImportPorts(nativeType, vccGnd).map(({ key: k, off }) => ({ k, pt: at(loc, rotateOffset(off, rot)) }));
        place(
          inst,
          idOf(ports[0].k)!,
          ports[0].pt,
          label,
          ports.flatMap(({ k, pt }): Array<[string, Pt]> => {
            const id = idOf(k);
            return id ? [[id, pt]] : [];
          })
        );
        if (ttlEvoRemapped(chip))
          warnings.push(
            `${where}: Logisim-evolution'ın ${chip.id}'sı VCC/GND'yi ${ttlEvoPin(chip, chip.vcc)}/${ttlEvoPin(chip, chip.gnd)} bacaklarında tutuyor; burada gerçek dizilim (VCC ${chip.vcc}, GND ${chip.gnd}) kullanılır, bağlantılar aynı isimli bacaklara taşındı.`
          );
        continue;
      }
      if (RAM_TYPES.has(nativeType)) {
        // Every pin on its Logisim connection point (2.7.1 or evolution layout); ours keeps its own drawing
        const st = ramSettings(nativeType, attr);
        for (const n of st.notes) warnings.push(`${where}: ${n}`);
        let inst = configureRam(createComponentInstance(nativeType, 0, 0), st.cfg);
        const state = { ...inst.state };
        if (nativeType === 'random') {
          state.trigger = st.cfg.trigger;
          if (st.seed) state.randomSeed = st.seed;
        }
        if ((nativeType === 'ram' || nativeType === 'dualRam') && st.cfg.flavor === 'evolution') {
          state.ramAsyncRead = st.asyncRead;
          state.ramReadBehavior = st.readBehavior;
        }
        if (st.pages && Object.keys(st.pages).length) state.memPages = st.pages;
        inst = { ...inst, state };
        const idOf = (k: string) => [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k)?.id;
        const anchorKey = nativeType === 'random' ? 'out' : 'd';
        const anchorOff = st.ports.find((p) => p.key === anchorKey)!.off;
        place(
          inst,
          idOf(anchorKey)!,
          at(loc, anchorOff),
          label,
          st.ports.flatMap(({ key: k, off }): Array<[string, Pt]> => {
            const id = idOf(k);
            return id ? [[id, at(loc, off)]] : [];
          })
        );
        continue;
      }
      if (BFH_TYPES.has(nativeType)) {
        // Evolution BFH part (no facing): every pin on its evolution connection point, our part unrotated
        const st = logisimBfhSettings(nativeType, attr);
        for (const n of st.notes) warnings.push(`${where}: ${n}`);
        const inst = configureBfh(createComponentInstance(nativeType, 0, 0), { binBits: st.bits });
        const idOf = (k: string) => [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k)?.id;
        const first = st.ports[0];
        place(
          inst,
          idOf(first.key)!,
          at(loc, first.off),
          label,
          st.ports.flatMap(({ key: k, off }): Array<[string, Pt]> => {
            const id = idOf(k);
            return id ? [[id, at(loc, off)]] : [];
          })
        );
        continue;
      }
      if (IO5C_TYPES.has(nativeType)) {
        // Keyboard / TTY / Telnet (no facing): every pin on its Logisim connection point, our part unrotated, empty
        // (Logisim keeps no buffer or screen contents in the file)
        const st = logisimIo5cSettings(nativeType, attr);
        for (const n of st.notes) warnings.push(`${where}: ${n}`);
        let inst = createComponentInstance(nativeType, 0, 0);
        inst = configureIo5c({ ...inst, state: { ...inst.state, ...st.state } }, st.cfg);
        const idOf = (k: string) => [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k)?.id;
        const first = st.ports[0];
        place(
          inst,
          idOf(first.key)!,
          at(loc, first.off),
          nativeType === 'telnet' ? label : undefined,
          st.ports.flatMap(({ key: k, off }): Array<[string, Pt]> => {
            const id = idOf(k);
            return id ? [[id, at(loc, off)]] : [];
          })
        );
        continue;
      }
      if (nativeType === 'image') {
        // Evolution's Image (no pins, no facing, no label): its top-left corner on the (scaled) loc; the frame keeps
        // evolution's size so the file goes back unchanged
        const st = logisimImageSettings(attr);
        for (const n of st.notes) warnings.push(`${where}: ${n}`);
        const p = scaled(loc);
        components.push(configureImage(createComponentInstance('image', p.x, p.y), st.cfg));
        continue;
      }
      if (nativeType === 'rgbVideo') {
        // Evolution's RGB Video (no facing, no label): every pin on its connection point, our part unrotated, the
        // screen black (evolution keeps no image in the file)
        const st = logisimVideoSettings(attr);
        for (const n of st.notes) warnings.push(`${where}: ${n}`);
        const inst = configureVideo(createComponentInstance('rgbVideo', 0, 0), st.cfg);
        const idOf = (k: string) => [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k)?.id;
        const first = st.ports[0];
        place(
          inst,
          idOf(first.key)!,
          at(loc, first.off),
          undefined,
          st.ports.flatMap(({ key: k, off }): Array<[string, Pt]> => {
            const id = idOf(k);
            return id ? [[id, at(loc, off)]] : [];
          })
        );
        continue;
      }
      if (IO_IMPORT.has(nativeType)) {
        // Every pin on its Logisim connection point; ours keeps its own drawing, turned like its facing (DIP switch,
        // Aşama 5a parts; a joystick's body too, although evolution's stays put: connections are wires anyway)
        const io5 = IO5_TYPES.has(nativeType);
        const st = io5 ? logisimIo5Settings(nativeType, attr) : logisimIoSettings(nativeType, attr, evolutionFile);
        for (const n of st.notes) warnings.push(`${where}: ${n}`);
        let inst = createComponentInstance(nativeType, 0, 0);
        inst = { ...inst, rotation: st.rot || undefined, state: { ...inst.state, ...st.state } };
        inst = io5 ? configureIo5(inst, st.cfg as Partial<Io5Config>) : configureIo(inst, st.cfg as Partial<IoConfig>);
        const idOf = (k: string) => [...inst.inputs, ...inst.outputs].find((p) => pinKey(inst, p) === k)?.id;
        const first = st.ports[0];
        place(
          inst,
          idOf(first.key)!,
          at(loc, first.off),
          label,
          st.ports.flatMap(({ key: k, off }): Array<[string, Pt]> => {
            const id = idOf(k);
            return id ? [[id, at(loc, off)]] : [];
          })
        );
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
        // Three-state input Pin: tristate="true" (2.7.1, early evolution) or behavior="tristate" (evolution 4+);
        // without either the writer's default: 2.7.1's Pin is three-state, evolution's is not
        if (nativeType === 'switch' && part.compName.trim().toLowerCase() === 'pin') {
          const a = part.attr;
          // a 2.7.1 Pin with a pull resistor reads 0/1 instead of floating (pull is not modelled here)
          const pulled = a.pull === 'up' || a.pull === 'down';
          const tri = a.behavior !== undefined ? a.behavior === 'tristate' : a.tristate !== undefined ? a.tristate === 'true' && !pulled : !evolutionFile && !pulled;
          if (tri) inst = { ...inst, state: { ...inst.state, pinTristate: true, ...floatingSwitchState(width) } };
        }
        components.push(inst);
        const pin = [...inst.inputs, ...inst.outputs][0];
        attach.push({ at: loc, compId: inst.id, pinId: pin.id, isOutput: pin.type === 'output' });
        // A Logisim Pin is a port of its circuit when the circuit is used as a subcircuit
        if (part.compName.trim().toLowerCase() === 'pin') {
          pins.push({ loc, facing: part.facing, isOutput: part.isOutput, label: label || '', width, compId: inst.id, pinId: pin.id });
        }
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
    const pinClash = (c: CircuitComponentInstance) =>
      [...c.inputs, ...c.outputs].some((p) => {
        const pt = pinPoint(p);
        return taken.has(pt) && taken.get(pt) !== c.id;
      });
    for (let k = 0; k < components.length; k++) {
      let comp = components[k];
      // an Image has no pins and may lie under other parts on purpose (a background): it stays and blocks nothing
      if (comp.type === 'image') continue;
      for (let tries = 0; tries < 400; tries++) {
        if (!pinClash(comp) && !overlaps(box(comp))) break;
        comp = updatePinPositions({ ...comp, y: comp.y + 10 });
      }
      // A crowded column can leave no clear body spot within reach; covering a body only hides it, but a pin
      // on another part's pin would join their nets, so never stop on one
      while (pinClash(comp)) comp = updatePinPositions({ ...comp, y: comp.y + 10 });
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
