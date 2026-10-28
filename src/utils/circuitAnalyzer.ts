import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import { getLogicalConnections } from './wiringEngine';
import { getSubcircuitDefinition } from './subcircuitManager';

const INPUT_TYPES = ['switch', 'pushbutton', 'clock', 'vcc', 'gnd', 'dipSwitch4', 'asciiKeyboard'];
const OUTPUT_TYPES = ['led', 'probe', 'sevenSegment', 'hexDisplay', 'buzzer', 'ledBar4', 'dotMatrix8x8', 'rgbMatrix16x16'];
const GATE_TYPES = ['not', 'buffer', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'triState', 'controlledInverter'];
// State-holding parts: timing paths start at their outputs and end at their inputs
const SEQUENTIAL_TYPES = ['dFlipFlop', 'jkFlipFlop', 'tFlipFlop', 'srLatch', 'register4', 'register4bit', 'counter4', 'counter4bit', 'shiftRegister4', 'shiftRegister4bit', 'ram16x4'];
// Timing paths end at these parts' inputs and restart at their outputs (RAM reads asynchronously, so it is not one)
const PATH_BREAK_TYPES = SEQUENTIAL_TYPES.filter((t) => t !== 'ram16x4');
// Parts that are only wiring / display and add no logic level
const NO_DELAY_TYPES = [...INPUT_TYPES, ...OUTPUT_TYPES, 'tunnel', 'textLabel', 'splitter4', 'busSplitter'];

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

  const weight = (c: CircuitComponentInstance) => (NO_DELAY_TYPES.includes(c.type) || PATH_BREAK_TYPES.includes(c.type) ? 0 : 1);
  // Arrival = logic levels up to and including this part's output
  const arrival = new Map<string, number>();
  const onStack = new Set<string>();
  const visit = (id: string): number => {
    if (arrival.has(id)) return arrival.get(id)!;
    const c = byId.get(id);
    if (!c) return 0;
    // A register's output is the start of a new path
    if (PATH_BREAK_TYPES.includes(c.type)) {
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

// Transistor count of one part: n-input gates scale with n, custom ICs count their contents
function transistorsOf(c: CircuitComponentInstance, seen: Set<string> = new Set()): number {
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
    case 'subcircuit': {
      const def = c.state.subcircuitId ? getSubcircuitDefinition(c.state.subcircuitId) : undefined;
      if (!def || seen.has(def.id)) return 0;
      const inner = new Set(seen).add(def.id);
      return def.components.reduce((sum, ic) => sum + transistorsOf(ic, inner), 0);
    }
    default:
      return CMOS_TRANSISTOR_TABLE[c.type] || 0;
  }
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
  for (const c of components) {
    const t = transistorsOf(c);
    if (t <= 0) continue;
    totalCMOSTransistors += t;
    const name =
      c.type === 'subcircuit'
        ? `IC: ${c.state.subcircuitName || c.label || 'Alt devre'}`
        : GATE_TYPES.includes(c.type) && c.type !== 'not' && c.type !== 'buffer' && c.type !== 'triState' && c.type !== 'controlledInverter'
          ? `${c.type.toUpperCase()} (${c.inputs.length} giriş)`
          : c.type.toUpperCase();
    const g = groups.get(name) || { gateType: name, count: 0, transistorsPerUnit: t, totalTransistors: 0 };
    g.count++;
    g.totalTransistors += t;
    groups.set(name, g);
  }
  breakdown.push(...groups.values());

  breakdown.sort((a, b) => b.totalTransistors - a.totalTransistors);

  // Dependency graph from the electrical nets (canvas wires are positional segments, not pin-to-pin)
  const criticalPathDepth = calculateCriticalPath(components, getLogicalConnections(components, wires));

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
