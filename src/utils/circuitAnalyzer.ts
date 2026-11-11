import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import { getLogicalConnections } from './wiringEngine';
import { getSubcircuitDefinition } from './subcircuitManager';
import {
  ARITH_TYPES,
  FLIP_FLOP_TYPES,
  MEM_TYPES,
  PLEXER_TYPES,
  RAM_TYPES,
  getArithConfig,
  getArithMode,
  getMemConfig,
  getPlexerConfig,
  getRamConfig,
  getTrigger,
  ramByteEnableCount,
  pinKey,
  shifterDistBits,
} from './circuitEngine';

const INPUT_TYPES = ['switch', 'pushbutton', 'clock', 'vcc', 'gnd', 'constant', 'dipSwitch4', 'dipSwitch', 'asciiKeyboard'];
// Displays carry no logic (no transistors counted)
const OUTPUT_TYPES = ['led', 'probe', 'sevenSegment', 'hexDisplay', 'hexDigit', 'buzzer', 'ledBar4', 'ledBar', 'dotMatrix8x8', 'dotMatrix', 'rgbMatrix16x16'];
const GATE_TYPES = ['not', 'buffer', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'triState', 'controlledInverter'];
// State-holding parts: timing paths start at their outputs and end at their inputs
const SEQUENTIAL_TYPES: string[] = [
  'dFlipFlop', 'jkFlipFlop', 'tFlipFlop', 'srLatch', 'register4', 'register4bit', 'counter4', 'counter4bit', 'shiftRegister4', 'shiftRegister4bit',
  ...MEM_TYPES,
  'ram16x4',
  'ram',
  'random',
  'dualRam',
];
// Timing paths end at these parts' inputs and restart at their outputs (RAM reads asynchronously, so it is not one)
const PATH_BREAK_TYPES = SEQUENTIAL_TYPES.filter((t) => t !== 'ram16x4' && t !== 'ram' && t !== 'dualRam');
/** evolution RAM with a clocked read: its output changes only at the clock edge, so it starts a new path */
function ramSyncRead(c: CircuitComponentInstance): boolean {
  if (c.type !== 'ram' && c.type !== 'dualRam') return false;
  const cfg = getRamConfig(c);
  return cfg.flavor === 'evolution' && (cfg.trigger === 'rising' || cfg.trigger === 'falling') && !c.state.ramAsyncRead;
}
const breaksPath = (c: CircuitComponentInstance) => PATH_BREAK_TYPES.includes(c.type) || ramSyncRead(c);
// Parts that are only wiring / display and add no logic level
const NO_DELAY_TYPES = [...INPUT_TYPES, ...OUTPUT_TYPES, 'tunnel', 'textLabel', 'splitter4', 'busSplitter', 'splitter', 'bitExtender'];

export interface CMOSGateStats {
  gateType: string;
  count: number;
  transistorsPerUnit: number;
  totalTransistors: number;
}

export interface CircuitAnalysisReport {
  totalComponents: number;
  totalWires: number;
  inputCount: number;
  outputCount: number;
  gateCount: number;
  sequentialCount: number;
  combinationalCount: number;
  totalCMOSTransistors: number;
  criticalPathDepth: number;
  breakdown: CMOSGateStats[];
}

const CMOS_TRANSISTOR_TABLE: Record<string, number> = {
  not: 2,
  buffer: 4,
  nand: 4,
  nor: 4,
  and: 6,
  or: 6,
  xor: 8,
  xnor: 8,
  triState: 6,
  controlledInverter: 4,
  halfAdder: 12,
  fullAdder: 28,
  halfSubtractor: 14,
  fullSubtractor: 32,
  mux2: 14,
  mux4: 34,
  mux8: 72,
  mux2to1: 14,
  mux4to1: 34,
  mux8to1: 72,
  demux2: 12,
  demux4: 28,
  demux1to2: 12,
  demux1to4: 28,
  decoder2to4: 24,
  decoder3to8: 52,
  bcdTo7Seg: 110,
  priorityEncoder4to2: 48,
  comparator4: 64,
  comparator4bit: 64,
  alu4: 280,
  alu4bit: 280,
  splitter4: 0,
  splitter: 0,
  busSplitter: 0,
  dotMatrix8x8: 128,
  rgbMatrix16x16: 512,
  asciiKeyboard: 140,
  dFlipFlop: 22,
  jkFlipFlop: 28,
  tFlipFlop: 24,
  srLatch: 8,
  register4: 92,
  register4bit: 92,
  counter4: 124,
  counter4bit: 124,
  shiftRegister4: 118,
  shiftRegister4bit: 118,
  ram16x4: 384,
  rom16x4: 192,
};

/**
 * Critical path in logic levels: the largest number of logic parts a signal passes through between
 * primary inputs / register outputs and primary outputs / register inputs. Inputs, outputs, tunnels and
 * splitters add no level; a feedback loop (e.g. cross-coupled gates) is cut where it closes.
 */
function calculateCriticalPath(components: CircuitComponentInstance[], wires: CircuitWire[]): number {
  const byId = new Map(components.map((c) => [c.id, c]));
  const preds = new Map<string, Set<string>>();
  components.forEach((c) => preds.set(c.id, new Set()));
  for (const w of wires) {
    if (w.fromCompId && w.toCompId && w.fromCompId !== w.toCompId) preds.get(w.toCompId)?.add(w.fromCompId);
  }

  const weight = (c: CircuitComponentInstance) => (NO_DELAY_TYPES.includes(c.type) || breaksPath(c) ? 0 : 1);
  // Arrival = logic levels up to and including this part's output
  const arrival = new Map<string, number>();
  const onStack = new Set<string>();
  const visit = (id: string): number => {
    if (arrival.has(id)) return arrival.get(id)!;
    const c = byId.get(id);
    if (!c) return 0;
    // A register's output is the start of a new path
    if (breaksPath(c)) {
      arrival.set(id, 0);
      return 0;
    }
    if (onStack.has(id)) return 0; // feedback loop: cut here
    onStack.add(id);
    let best = 0;
    for (const p of preds.get(id) || []) best = Math.max(best, visit(p));
    onStack.delete(id);
    const a = best + weight(c);
    arrival.set(id, a);
    return a;
  };

  let maxDepth = 0;
  for (const c of components) {
    // Path ends: every part's inputs (registers included) see the arrival of their drivers
    for (const p of preds.get(c.id) || []) maxDepth = Math.max(maxDepth, visit(p));
    maxDepth = Math.max(maxDepth, visit(c.id));
  }
  return maxDepth;
}

// Breakdown row detail of a parametric part: its count depends on these settings
function arithGroupDetail(c: CircuitComponentInstance): string {
  const { width, inputs } = getArithConfig(c);
  const parts = [`${width} bit`];
  if (c.type === 'bitAdder') parts.push(`${inputs} giriş`);
  if (c.type === 'divider' && getArithMode(c) !== 'unsigned') parts.push('işaretli');
  if (c.type === 'bitFinder') parts.push(c.state.findType ?? 'low1');
  return parts.join(', ');
}
// Memory parts: width / stages, a level trigger (latches) and a wired flip-flop enable change the count
const withDetail = (name: string, detail: string) => (detail ? `${name} (${detail})` : name);
function memGroupDetail(c: CircuitComponentInstance, enWired: boolean): string {
  const { width, length, parallel } = getMemConfig(c);
  const t = getTrigger(c);
  const parts: string[] = [];
  if (c.type === 'register' || c.type === 'counter' || c.type === 'shiftRegister') parts.push(`${width} bit`);
  if (c.type === 'shiftRegister') parts.push(`${length} aşama`, parallel ? 'paralel' : 'seri');
  if (t === 'high' || t === 'low') parts.push('mandal');
  else if (t === 'falling') parts.push('düşen kenar');
  if (FLIP_FLOP_TYPES.has(c.type) && enWired) parts.push('EN');
  return parts.join(', ');
}
// RAM / ROM: size and the settings the count depends on
function ramGroupDetail(c: CircuitComponentInstance, wired: Set<string>): string {
  if (c.type === 'random') return '';
  const cfg = getRamConfig(c);
  const parts = [`${2 ** cfg.addrWidth}×${cfg.dataWidth}`, cfg.flavor === 'evolution' ? 'evo' : '2.7.1'];
  if (c.type === 'dualRam') parts.push('2 port');
  if (ramTriState(c)) parts.push('üç durumlu');
  if (ramSyncRead(c)) parts.push('eşzamanlı okuma');
  if ((c.type === 'ram' || c.type === 'dualRam') && ramClearWired(c, wired)) parts.push('CLR');
  const nBE = c.type === 'ram' ? ramByteEnableCount(cfg) : c.type === 'dualRam' ? 2 * ramByteEnableCount(cfg) : 0;
  if (nBE) parts.push(`${nBE} bayt`);
  return parts.join(', ');
}
// The data output can float: 2.7.1 select (RAM and ROM), an evolution bidirectional or OE-controlled RAM bus
function ramTriState(c: CircuitComponentInstance): boolean {
  const cfg = getRamConfig(c);
  if (cfg.flavor !== 'evolution') return true;
  return (c.type === 'ram' || c.type === 'dualRam') && cfg.dataBus !== 'separate';
}
function ramClearWired(c: CircuitComponentInstance, wired: Set<string>): boolean {
  const clr = c.inputs.find((p) => pinKey(c, p) === 'clr');
  return !!clr && wired.has(clr.id);
}
function plexerGroupDetail(c: CircuitComponentInstance): string {
  const { select, width } = getPlexerConfig(c);
  return c.type === 'multiplexer' || c.type === 'demultiplexer' ? `${select} seçme, ${width} bit` : `${select} seçme`;
}

// Transistor count of one part: n-input gates scale with n, custom ICs count their contents
function transistorsOf(c: CircuitComponentInstance, wired: Set<string>, seen: Set<string> = new Set()): number {
  const n = Math.max(1, c.inputs.length);
  switch (c.type) {
    case 'not':
      return 2;
    case 'buffer':
      return 4; // two inverters
    case 'nand':
    case 'nor':
      return 2 * n; // n series + n parallel transistors
    case 'and':
    case 'or':
      return 2 * n + 2; // NAND/NOR + inverter
    case 'xor':
    case 'xnor':
      return 8 * Math.max(1, n - 1); // chain of 2-input stages
    case 'multiplexer':
    case 'demultiplexer':
    case 'decoder':
    case 'priorityEncoder': {
      // Same scale as the fixed parts in the table (2:1 MUX 14, 4:1 34, 1:4 DEMUX 28, 3:8 decoder 52,
      // 4:2 priority encoder 48), per data bit for MUX / DEMUX
      const { select, width } = getPlexerConfig(c);
      const k = 1 << select;
      if (c.type === 'multiplexer') return width * (10 * k - 6);
      if (c.type === 'demultiplexer') return width * (8 * k - 4);
      if (c.type === 'decoder') return 7 * k - 4;
      return 12 * k;
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
    case 'alu': {
      // Same scale as the fixed parts (full adder 28, full subtractor 32, 2:1 MUX 14, 4-bit comparator 64):
      // ripple adder / subtractor, invert + increment, array multiplier (w^2 AND + FA cells), restoring array
      // divider (w^2 subtract + select cells), barrel shifter, square-and-multiply exponentiator
      const { width: w, inputs: n } = getArithConfig(c);
      const signed = getArithMode(c) !== 'unsigned';
      switch (c.type) {
        case 'adder':
          return 28 * w;
        case 'subtractor':
          return 32 * w;
        case 'negator':
          return 14 * w;
        case 'absolute':
          return 20 * w;
        case 'comparator':
          return 16 * w;
        case 'minMax':
          return 44 * w;
        case 'shifter':
          return 14 * w * shifterDistBits(w);
        case 'multiplier':
          return 34 * w * w;
        case 'divider':
          return 46 * w * w + (signed ? 80 * w : 0); // signed: conditional negation of 2 inputs + 2 outputs
        case 'squareRoot':
          return 23 * w * w;
        case 'exponentiator':
          return 68 * w * w * w;
        case 'bitAdder':
          return 28 * n * w;
        case 'alu':
          // One ripple adder shared by ADD / SUB with an XOR inverting B (28w + 8w), AND 6w, XOR 8w, NOR 4w with
          // OR as NOR + inverter (2w), an 8:1 MUX per bit (7 x 14), the w-input NOR for Z (2w); V, SLT, the
          // C select and the op decoder about 40
          return 156 * w + 40;
        default: {
          const t = c.state.findType ?? 'low1';
          return 12 * w + (t === 'low0' || t === 'high0' ? 2 * w : 0);
        }
      }
    }
    case 'flipFlopD':
    case 'flipFlopT':
    case 'flipFlopJK':
    case 'flipFlopSR':
    case 'register':
    case 'counter':
    case 'shiftRegister': {
      // Same scale (2:1 MUX 14): a transmission-gate D latch is 14, an edge-triggered master-slave D flip-flop
      // 28 (asynchronous clear / preset included); T = D + XOR feedback + clock gating 40, J-K = D + J·Q' + K'·Q
      // 42, S-R edge = D + next-state logic 40, gated S-R latch (4 NAND) 16; a wired enable adds a hold MUX 14.
      // Register = D flip-flop + enable MUX per bit (latches when level-triggered); counter = flip-flop + load
      // MUX + up/down half adder + goal compare per bit + 20 control; shift register stage = flip-flop + shift
      // hold MUX, + load MUX when parallel
      const { width: w, length: len, parallel } = getMemConfig(c);
      const t = getTrigger(c);
      const level = t === 'high' || t === 'low';
      if (c.type === 'register') return (level ? 28 : 42) * w;
      if (c.type === 'counter') return 82 * w + 20;
      if (c.type === 'shiftRegister') return (parallel ? 56 : 42) * w * len;
      const enCost = flipFlopEnableWired(c, wired) ? 14 : 0;
      if (c.type === 'flipFlopD') return (level ? 14 : 28) + enCost;
      if (c.type === 'flipFlopSR') return (level ? 16 : 40) + enCost;
      return (c.type === 'flipFlopT' ? 40 : 42) + enCost;
    }
    case 'ram':
    case 'rom': {
      // N = 2^n words of w bits. RAM: 6T SRAM cell per bit, n -> 2^n row decoder (7N - 4, as the decoder part),
      // sense amplifier + write driver + precharge per bit 14, control 20; a floating output adds a three-state
      // buffer per bit (6), an evolution clocked read an output register (28 per bit), a wired clear a reset
      // transistor per cell, byte enables a write gate (AND, 6) each. ROM: NOR ROM, one transistor per bit
      // position, decoder, pull-up + inverter per bit 3
      const cfg = getRamConfig(c);
      const N = 2 ** cfg.addrWidth;
      const w = cfg.dataWidth;
      const tri = ramTriState(c) ? 6 * w : 0;
      if (c.type === 'rom') return N * w + 7 * N - 4 + 3 * w + tri;
      return (
        6 * N * w + 7 * N - 4 + 14 * w + 20 + tri + (ramSyncRead(c) ? 28 * w : 0) +
        (ramClearWired(c, wired) ? N * w : 0) + 6 * ramByteEnableCount(cfg)
      );
    }
    case 'dualRam': {
      // Dual-port SRAM: the standard 8T cell (6T + a second pair of access transistors), and per port its own
      // row decoder, sense amplifier / write driver / precharge column circuit, control, output buffers and
      // registers and byte-enable gates as in the single RAM; one clear transistor per cell for the shared pin
      const cfg = getRamConfig(c);
      const N = 2 ** cfg.addrWidth;
      const w = cfg.dataWidth;
      const perPort = 7 * N - 4 + 14 * w + 20 + (ramTriState(c) ? 6 * w : 0) + (ramSyncRead(c) ? 28 * w : 0) + 6 * ramByteEnableCount(cfg);
      return 8 * N * w + 2 * perPort + (ramClearWired(c, wired) ? N * w : 0);
    }
    case 'random':
      // Logisim 2.7.1's 48-bit LCG: state register 48 x 28, seed load + next hold MUXes 2 x 48 x 14, the
      // constant multiply (0x5DEECE66D has 23 one bits: an adder of 48 - k bits per shifted copy, 18004) and
      // + 0xB (48 half adders, 672); the output is bits of the state, whatever its width
      return 48 * 28 + 2 * 48 * 14 + 18004 + 48 * 14;
    case 'subcircuit': {
      const def = c.state.subcircuitId ? getSubcircuitDefinition(c.state.subcircuitId) : undefined;
      if (!def || seen.has(def.id)) return 0;
      const inner = new Set(seen).add(def.id);
      const innerWired = wiredPins(getLogicalConnections(def.components, def.wires));
      return def.components.reduce((sum, ic) => sum + transistorsOf(ic, innerWired, inner), 0);
    }
    default:
      return CMOS_TRANSISTOR_TABLE[c.type] || 0;
  }
}

function flipFlopEnableWired(c: CircuitComponentInstance, wired: Set<string>): boolean {
  const en = c.inputs.find((p) => pinKey(c, p) === 'en');
  return !!en && wired.has(en.id);
}

// Pins that sit on a net with a driver (an open input reads x: a flip-flop's open enable costs nothing)
function wiredPins(conns: CircuitWire[]): Set<string> {
  const s = new Set<string>();
  for (const w of conns) {
    s.add(w.fromPinId);
    s.add(w.toPinId);
  }
  return s;
}

/**
 * Generates comprehensive hardware statistics, CMOS transistor count, and critical path report.
 */
export function analyzeCircuit(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): CircuitAnalysisReport {
  let inputCount = 0;
  let outputCount = 0;
  let gateCount = 0;
  let sequentialCount = 0;
  let combinationalCount = 0;

  components.forEach((c) => {

    if (INPUT_TYPES.includes(c.type)) {
      inputCount++;
    } else if (OUTPUT_TYPES.includes(c.type)) {
      outputCount++;
    } else if (GATE_TYPES.includes(c.type)) {
      gateCount++;
    } else if (SEQUENTIAL_TYPES.includes(c.type)) {
      sequentialCount++;
    } else if (!['tunnel', 'textLabel'].includes(c.type)) {
      combinationalCount++;
    }
  });

  const breakdown: CMOSGateStats[] = [];
  let totalCMOSTransistors = 0;

  // Group by what the transistor count depends on: gate type + input count, IC definition, or type
  const groups = new Map<string, CMOSGateStats>();
  const conns = getLogicalConnections(components, wires);
  const wired = wiredPins(conns);
  for (const c of components) {
    const t = transistorsOf(c, wired);
    if (t <= 0) continue;
    totalCMOSTransistors += t;
    const name =
      c.type === 'subcircuit'
        ? `IC: ${c.state.subcircuitName || c.label || 'Alt devre'}`
        : GATE_TYPES.includes(c.type) && c.type !== 'not' && c.type !== 'buffer' && c.type !== 'triState' && c.type !== 'controlledInverter'
          ? `${c.type.toUpperCase()} (${c.inputs.length} giriş)`
          : ARITH_TYPES.has(c.type)
            ? `${c.type.toUpperCase()} (${arithGroupDetail(c)})`
            : PLEXER_TYPES.has(c.type)
              ? `${c.type.toUpperCase()} (${plexerGroupDetail(c)})`
              : MEM_TYPES.has(c.type)
                ? withDetail(c.type.toUpperCase(), memGroupDetail(c, flipFlopEnableWired(c, wired)))
                : RAM_TYPES.has(c.type)
                  ? withDetail(c.type.toUpperCase(), ramGroupDetail(c, wired))
                  : c.type.toUpperCase();
    const g = groups.get(name) || { gateType: name, count: 0, transistorsPerUnit: t, totalTransistors: 0 };
    g.count++;
    g.totalTransistors += t;
    groups.set(name, g);
  }
  breakdown.push(...groups.values());

  breakdown.sort((a, b) => b.totalTransistors - a.totalTransistors);

  // Dependency graph from the electrical nets (canvas wires are positional segments, not pin-to-pin)
  const criticalPathDepth = calculateCriticalPath(components, conns);

  return {
    totalComponents: components.length,
    totalWires: wires.length,
    inputCount,
    outputCount,
    gateCount,
    sequentialCount,
    combinationalCount,
    totalCMOSTransistors,
    criticalPathDepth,
    breakdown,
  };
}
