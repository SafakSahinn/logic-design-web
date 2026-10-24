import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';

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
  nand: 4,
  nor: 4,
  and: 6,
  or: 6,
  xor: 8,
  xnor: 8,
  triState: 6,
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
 * Calculates topological critical path depth (logic levels) from primary inputs to outputs
 */
function calculateCriticalPath(components: CircuitComponentInstance[], wires: CircuitWire[]): number {
  if (components.length === 0 || wires.length === 0) return 0;

  // Build component dependency graph: compId -> Array of downstream compIds
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  components.forEach((c) => {
    adj.set(c.id, []);
    inDegree.set(c.id, 0);
  });

  wires.forEach((w) => {
    if (w.fromCompId && w.toCompId && w.fromCompId !== w.toCompId) {
      adj.get(w.fromCompId)?.push(w.toCompId);
      inDegree.set(w.toCompId, (inDegree.get(w.toCompId) || 0) + 1);
    }
  });

  // Longest path via topological order (Dynamic Programming)
  const depth = new Map<string, number>();
  const queue: string[] = [];

  components.forEach((c) => {
    // Primary inputs or nodes with in-degree 0
    if ((inDegree.get(c.id) || 0) === 0) {
      depth.set(c.id, 1);
      queue.push(c.id);
    }
  });

  let maxDepth = 0;

  while (queue.length > 0) {
    const u = queue.shift()!;
    const uDepth = depth.get(u) || 1;
    if (uDepth > maxDepth) maxDepth = uDepth;

    const neighbors = adj.get(u) || [];
    neighbors.forEach((v) => {
      const curVDepth = depth.get(v) || 0;
      if (uDepth + 1 > curVDepth) {
        depth.set(v, uDepth + 1);
      }
      const newInDeg = (inDegree.get(v) || 1) - 1;
      inDegree.set(v, newInDeg);
      if (newInDeg === 0) {
        queue.push(v);
      }
    });
  }

  return Math.max(maxDepth, components.length > 0 ? 1 : 0);
}

/**
 * Generates comprehensive hardware statistics, CMOS transistor count, and critical path report.
 */
export function analyzeCircuit(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): CircuitAnalysisReport {
  const compCounts = new Map<string, number>();
  let inputCount = 0;
  let outputCount = 0;
  let gateCount = 0;
  let sequentialCount = 0;
  let combinationalCount = 0;

  components.forEach((c) => {
    compCounts.set(c.type, (compCounts.get(c.type) || 0) + 1);

    if (['switch', 'pushbutton', 'clock', 'vcc', 'gnd', 'dipSwitch4', 'asciiKeyboard'].includes(c.type)) {
      inputCount++;
    } else if (['led', 'probe', 'sevenSegment', 'hexDisplay', 'buzzer', 'ledBar4', 'dotMatrix8x8', 'rgbMatrix16x16'].includes(c.type)) {
      outputCount++;
    } else if (['not', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'triState'].includes(c.type)) {
      gateCount++;
    } else if ([
      'dFlipFlop',
      'jkFlipFlop',
      'tFlipFlop',
      'srLatch',
      'register4',
      'register4bit',
      'counter4',
      'counter4bit',
      'shiftRegister4',
      'shiftRegister4bit',
      'ram16x4',
      'rom16x4',
    ].includes(c.type)) {
      sequentialCount++;
    } else {
      combinationalCount++;
    }
  });

  const breakdown: CMOSGateStats[] = [];
  let totalCMOSTransistors = 0;

  compCounts.forEach((count, type) => {
    const transistorsPerUnit = CMOS_TRANSISTOR_TABLE[type] || 0;
    const total = count * transistorsPerUnit;
    totalCMOSTransistors += total;

    if (transistorsPerUnit > 0) {
      breakdown.push({
        gateType: type.toUpperCase(),
        count,
        transistorsPerUnit,
        totalTransistors: total,
      });
    }
  });

  breakdown.sort((a, b) => b.totalTransistors - a.totalTransistors);

  const criticalPathDepth = calculateCriticalPath(components, wires);

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
