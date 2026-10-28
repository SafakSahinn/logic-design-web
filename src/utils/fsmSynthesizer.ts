import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import type { LogicValue } from '../types/logic';
import { createComponentInstance, simulateCircuit, updatePinPositions } from './circuitEngine';
import { solveKMap } from './kmapSolver';
import { repairWires } from './wiringEngine';

export interface FSMState {
  id: string;
  name: string;
  code: string; // e.g. "00", "01", "10", "11"
}

export interface FSMTransition {
  id: string;
  fromStateId: string;
  toStateId: string;
  inputX: 0 | 1;
  outputZ: 0 | 1;
}

export interface FSMPreset {
  id: string;
  name: string;
  description: string;
  states: FSMState[];
  transitions: FSMTransition[];
}

export const FSM_PRESETS: FSMPreset[] = [
  {
    id: 'seq_101',
    name: '101 Dizi Algılayıcı (Sequence Detector)',
    description: 'Seri gelen bit akışında "101" dizisini yakaladığında Z=1 çıkışı veren Mealy FSM.',
    states: [
      { id: 's0', name: 'S0 (Başlangıç)', code: '00' },
      { id: 's1', name: 'S1 ("1" Geldi)', code: '01' },
      { id: 's2', name: 'S2 ("10" Geldi)', code: '10' },
    ],
    transitions: [
      { id: 't1', fromStateId: 's0', toStateId: 's0', inputX: 0, outputZ: 0 },
      { id: 't2', fromStateId: 's0', toStateId: 's1', inputX: 1, outputZ: 0 },
      { id: 't3', fromStateId: 's1', toStateId: 's2', inputX: 0, outputZ: 0 },
      { id: 't4', fromStateId: 's1', toStateId: 's1', inputX: 1, outputZ: 0 },
      { id: 't5', fromStateId: 's2', toStateId: 's0', inputX: 0, outputZ: 0 },
      { id: 't6', fromStateId: 's2', toStateId: 's1', inputX: 1, outputZ: 1 }, // Found 101!
    ],
  },
  {
    id: 'traffic_light',
    name: '3-Aşamalı Trafik Lambası',
    description: 'X=1 geldikçe Kırmızı -> Sarı -> Yeşil -> Kırmızı ilerleyen Moore FSM; Z yalnızca Yeşil durumunda 1.',
    states: [
      { id: 's0', name: 'S0 (Kırmızı)', code: '00' },
      { id: 's1', name: 'S1 (Sarı)', code: '01' },
      { id: 's2', name: 'S2 (Yeşil)', code: '10' },
    ],
    transitions: [
      { id: 't1', fromStateId: 's0', toStateId: 's1', inputX: 1, outputZ: 0 },
      { id: 't2', fromStateId: 's0', toStateId: 's0', inputX: 0, outputZ: 0 },
      { id: 't3', fromStateId: 's1', toStateId: 's2', inputX: 1, outputZ: 0 },
      { id: 't4', fromStateId: 's1', toStateId: 's1', inputX: 0, outputZ: 0 },
      { id: 't5', fromStateId: 's2', toStateId: 's0', inputX: 1, outputZ: 1 },
      { id: 't6', fromStateId: 's2', toStateId: 's2', inputX: 0, outputZ: 1 },
    ],
  },
];

export interface FSMSynthesisResult {
  transitionTable: {
    q1: number;
    q0: number;
    x: number;
    nextQ1: number;
    nextQ0: number;
    z: number;
  }[];
  d1Expression: string;
  d0Expression: string;
  zExpression: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
}

/**
 * Check a state table before synthesis: 1-4 states with distinct 2-bit codes, and transitions that point
 * at existing states. Returns the first problem in Turkish, or null.
 */
export function validateFSM(states: FSMState[], transitions: FSMTransition[]): string | null {
  if (states.length === 0) return 'En az bir durum tanımlayın.';
  if (states.length > 4) return '2 flip-flop ile en fazla 4 durum kodlanabilir.';
  const codes = new Set<string>();
  for (const s of states) {
    if (!/^[01]{2}$/.test(s.code)) return `"${s.name}" durumunun kodu 2 bit olmalı (00, 01, 10, 11).`;
    if (codes.has(s.code)) return `${s.code} kodu birden fazla duruma verilmiş.`;
    codes.add(s.code);
  }
  const ids = new Set(states.map((s) => s.id));
  for (const t of transitions) {
    if (ids.has(t.fromStateId) && !ids.has(t.toStateId)) return 'Bir geçiş silinmiş bir duruma gidiyor.';
  }
  return null;
}

/**
 * Solve excitation equations and synthesize digital circuit for a 2-bit FSM. The flip-flops power up at
 * Q1Q0 = 00; codes no state uses (and missing transitions) go to the first state on the next clock edge.
 */
export function synthesizeFSM(
  states: FSMState[],
  transitions: FSMTransition[],
  startX = 80,
  startY = 80
): FSMSynthesisResult {
  const problem = validateFSM(states, transitions);
  if (problem) throw new Error(problem);
  const resetCode = states[0].code;

  // Build excitation transition table for 3 input variables: Q1, Q0, X (8 rows)
  const d1MintermValues: Record<number, LogicValue> = {};
  const d0MintermValues: Record<number, LogicValue> = {};
  const zMintermValues: Record<number, LogicValue> = {};

  // Initialize with zeros
  for (let i = 0; i < 8; i++) {
    d1MintermValues[i] = 0;
    d0MintermValues[i] = 0;
    zMintermValues[i] = 0;
  }

  const transitionTable = [];

  for (let q1 = 0; q1 <= 1; q1++) {
    for (let q0 = 0; q0 <= 1; q0++) {
      for (let x = 0; x <= 1; x++) {
        const stateCode = `${q1}${q0}`;
        const curState = states.find((s) => s.code === stateCode);
        const trans = curState
          ? transitions.find((t) => t.fromStateId === curState.id && t.inputX === x)
          : undefined;

        let nextQ1 = parseInt(resetCode[0], 10);
        let nextQ0 = parseInt(resetCode[1], 10);
        let z = 0;

        if (trans) {
          const targetState = states.find((s) => s.id === trans.toStateId);
          if (targetState) {
            nextQ1 = parseInt(targetState.code[0] || '0', 10);
            nextQ0 = parseInt(targetState.code[1] || '0', 10);
          }
          z = trans.outputZ;
        }

        const mintermIdx = (q1 << 2) | (q0 << 1) | x;
        d1MintermValues[mintermIdx] = (nextQ1 === 1 ? 1 : 0) as LogicValue;
        d0MintermValues[mintermIdx] = (nextQ0 === 1 ? 1 : 0) as LogicValue;
        zMintermValues[mintermIdx] = (z === 1 ? 1 : 0) as LogicValue;

        transitionTable.push({ q1, q0, x, nextQ1, nextQ0, z });
      }
    }
  }

  // Solve minimal SOP expressions for D1, D0, Z using K-Map
  const d1Sol = solveKMap(d1MintermValues, 3);
  const d0Sol = solveKMap(d0MintermValues, 3);
  const zSol = solveKMap(zMintermValues, 3);

  // Construct the circuit that really implements D1, D0 and Z (K-map variables: A = Q1, B = Q0, C = X)
  const sx = Math.round(startX / 10) * 10;
  const sy = Math.round(startY / 10) * 10;
  const components: CircuitComponentInstance[] = [];
  const wires: CircuitWire[] = [];
  // Unique ids: the FSM can be synthesised several times onto the same sheet
  const uid = `fsm_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`;
  let wireNo = 0;
  const add = (type: Parameters<typeof createComponentInstance>[0], x: number, y: number, label: string, key: string, inputs?: number) => {
    let comp = createComponentInstance(type, x, y, label, `${uid}_${key}`);
    if (inputs && inputs > comp.inputs.length) {
      comp.inputs = Array.from({ length: inputs }).map((_, k) => ({
        id: `${comp.id}_in${k}`,
        name: String.fromCharCode(65 + k),
        type: 'input' as const,
        value: 0 as LogicValue,
        x,
        y,
      }));
      comp.state = { ...comp.state, gateInputsCount: inputs };
    }
    comp = updatePinPositions(comp);
    components.push(comp);
    return comp;
  };
  const connect = (from: { compId: string; pinId: string }, to: CircuitComponentInstance, toPinIdx: number) => {
    wires.push({
      id: `${uid}_w${wireNo++}`,
      fromCompId: from.compId,
      fromPinId: from.pinId,
      toCompId: to.id,
      toPinId: to.inputs[toPinIdx].id,
      value: 0,
    });
  };

  const clk = add('clock', sx, sy, 'Sistem Saati (CLK)', 'clk');
  const xIn = add('switch', sx, sy + 120, 'Giriş (X)', 'x');
  const xNot = add('not', sx + 120, sy + 200, "X'", 'xnot');
  connect({ compId: xIn.id, pinId: xIn.outputs[0].id }, xNot, 0);
  const ff1 = add('dFlipFlop', sx + 620, sy + 40, 'Durum FF1 (Q1)', 'ff1');
  const ff0 = add('dFlipFlop', sx + 620, sy + 220, 'Durum FF0 (Q0)', 'ff0');
  connect({ compId: clk.id, pinId: clk.outputs[0].id }, ff1, 1);
  connect({ compId: clk.id, pinId: clk.outputs[0].id }, ff0, 1);

  // Literal sources: Q / Q' straight from the flip-flops, X from the switch, X' through the NOT gate
  const literal = (name: string): { compId: string; pinId: string } => {
    const neg = name.endsWith("'");
    const v = name[0];
    if (v === 'A') return { compId: ff1.id, pinId: ff1.outputs[neg ? 1 : 0].id };
    if (v === 'B') return { compId: ff0.id, pinId: ff0.outputs[neg ? 1 : 0].id };
    return neg ? { compId: xNot.id, pinId: xNot.outputs[0].id } : { compId: xIn.id, pinId: xIn.outputs[0].id };
  };

  // Labels in state-machine names instead of the K-map letters
  const named = (e: string) => e.replace(/A/g, 'Q1').replace(/B/g, 'Q0').replace(/C/g, 'X');

  // One SOP -> AND column + OR gate, driving `target` input `pinIdx`
  let row = 0;
  const buildSop = (sop: string, label: string, target: CircuitComponentInstance, pinIdx: number) => {
    const expr = (sop || '0').trim();
    if (expr === '0' || expr === '1') {
      const c = add(expr === '1' ? 'vcc' : 'gnd', sx + 260, sy + row * 90, `${label} = ${expr}`, `${label}_const`);
      row++;
      connect({ compId: c.id, pinId: c.outputs[0].id }, target, pinIdx);
      return;
    }
    const terms = expr.split('+').map((t) => t.trim()).filter(Boolean);
    const firstRow = row;
    const termOuts = terms.map((term, ti) => {
      const lits = term.match(/[A-C]'?/g) || [];
      if (lits.length === 1) return literal(lits[0]);
      const gate = add('and', sx + 260, sy + row * 90, `${label}: ${named(term)}`, `${label}_and${ti}`, lits.length);
      row++;
      lits.forEach((l, k) => connect(literal(l), gate, k));
      return { compId: gate.id, pinId: gate.outputs[0].id };
    });
    if (termOuts.length === 1) {
      connect(termOuts[0], target, pinIdx);
      return;
    }
    // Beside its own AND gates, or on a fresh row when every term is a single literal (never on top of
    // another equation's OR gate: overlapping pins would short the two equations)
    const orRow = row > firstRow ? Math.floor((firstRow + row - 1) / 2) : row++;
    const orGate = add('or', sx + 440, sy + orRow * 90, `${label} = ${named(expr)}`, `${label}_or`, termOuts.length);
    termOuts.forEach((o, k) => connect(o, orGate, k));
    connect({ compId: orGate.id, pinId: orGate.outputs[0].id }, target, pinIdx);
  };

  const ledZ = add('led', sx + 820, sy + 140, 'Çıkış (Z)', 'z');
  buildSop(d1Sol.simplifiedSOP, 'D1', ff1, 0);
  buildSop(d0Sol.simplifiedSOP, 'D0', ff0, 0);
  buildSop(zSol.simplifiedSOP, 'Z', ledZ, 0);

  const normalizedWires = repairWires(wires, components);
  const sim = simulateCircuit(components, normalizedWires);

  return {
    transitionTable,
    d1Expression: d1Sol.simplifiedSOP || '0',
    d0Expression: d0Sol.simplifiedSOP || '0',
    zExpression: zSol.simplifiedSOP || '0',
    components: sim.components,
    wires: sim.wires,
  };
}
