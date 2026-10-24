import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import type { LogicValue } from '../types/logic';
import { createComponentInstance, simulateCircuit, updatePinPositions } from './circuitEngine';
import { solveKMap } from './kmapSolver';

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
    description: 'Kırmızı -> Sarı -> Yeşil durumları arasında adım adım ilerleyen Moore FSM.',
    states: [
      { id: 's0', name: 'S0 (Kırmızı)', code: '00' },
      { id: 's1', name: 'S1 (Sarı)', code: '01' },
      { id: 's2', name: 'S2 (Yeşil)', code: '10' },
    ],
    transitions: [
      { id: 't1', fromStateId: 's0', toStateId: 's1', inputX: 1, outputZ: 0 },
      { id: 't2', fromStateId: 's0', toStateId: 's0', inputX: 0, outputZ: 0 },
      { id: 't3', fromStateId: 's1', toStateId: 's2', inputX: 1, outputZ: 1 },
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
 * Solve excitation equations and synthesize digital circuit for a 2-bit FSM
 */
export function synthesizeFSM(
  states: FSMState[],
  transitions: FSMTransition[],
  startX = 80,
  startY = 80
): FSMSynthesisResult {
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

        let nextQ1 = 0;
        let nextQ0 = 0;
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

  // Construct circuit layout on canvas
  const components: CircuitComponentInstance[] = [];
  const wires: CircuitWire[] = [];

  // Input Components (Clock, Reset, Input X)
  const compClk = { ...createComponentInstance('clock', startX, startY + 60, 'Sistem Saati (CLK)'), id: 'fsm_clk' };
  const compRst = { ...createComponentInstance('switch', startX, startY + 160, 'Sıfırla (RST)'), id: 'fsm_rst' };
  const compX = { ...createComponentInstance('switch', startX, startY + 260, 'Giriş (X)'), id: 'fsm_x' };

  // D Flip-Flops for State Storage
  const compFF1 = { ...createComponentInstance('dFlipFlop', startX + 380, startY + 80, 'Durum FF1 (Q1)'), id: 'fsm_ff1' };
  const compFF0 = { ...createComponentInstance('dFlipFlop', startX + 380, startY + 240, 'Durum FF0 (Q0)'), id: 'fsm_ff0' };

  // Logic Gates for Next State (AND, OR, NOT)
  const compAnd1 = { ...createComponentInstance('and', startX + 200, startY + 60, 'D1 Mantık Kapısı'), id: 'fsm_and1' };
  const compAnd0 = { ...createComponentInstance('and', startX + 200, startY + 220, 'D0 Mantık Kapısı'), id: 'fsm_and0' };

  // Output Z LED
  const compLedZ = { ...createComponentInstance('led', startX + 540, startY + 180, 'Çıkış (Z)'), id: 'fsm_led_z' };

  const compsToAdd = [compClk, compRst, compX, compFF1, compFF0, compAnd1, compAnd0, compLedZ].map(updatePinPositions);
  components.push(...compsToAdd);

  // Wire connections
  // Clock to both Flip-Flops
  wires.push(
    { id: 'fsm_w1', fromCompId: 'fsm_clk', fromPinId: 'fsm_clk_out', toCompId: 'fsm_ff1', toPinId: 'fsm_ff1_inClk', value: 0 },
    { id: 'fsm_w2', fromCompId: 'fsm_clk', fromPinId: 'fsm_clk_out', toCompId: 'fsm_ff0', toPinId: 'fsm_ff0_inClk', value: 0 },
    // Reset to both Flip-Flops
    { id: 'fsm_w3', fromCompId: 'fsm_rst', fromPinId: 'fsm_rst_out', toCompId: 'fsm_ff1', toPinId: 'fsm_ff1_inRst', value: 0 },
    { id: 'fsm_w4', fromCompId: 'fsm_rst', fromPinId: 'fsm_rst_out', toCompId: 'fsm_ff0', toPinId: 'fsm_ff0_inRst', value: 0 },
    // Input X to Next State logic
    { id: 'fsm_w5', fromCompId: 'fsm_x', fromPinId: 'fsm_x_out', toCompId: 'fsm_and1', toPinId: 'fsm_and1_in0', value: 0 },
    { id: 'fsm_w6', fromCompId: 'fsm_x', fromPinId: 'fsm_x_out', toCompId: 'fsm_and0', toPinId: 'fsm_and0_in0', value: 0 },
    // Logic gate outputs to D inputs
    { id: 'fsm_w7', fromCompId: 'fsm_and1', fromPinId: 'fsm_and1_out', toCompId: 'fsm_ff1', toPinId: 'fsm_ff1_inD', value: 0 },
    { id: 'fsm_w8', fromCompId: 'fsm_and0', fromPinId: 'fsm_and0_out', toCompId: 'fsm_ff0', toPinId: 'fsm_ff0_inD', value: 0 },
    // Output Z
    { id: 'fsm_w9', fromCompId: 'fsm_ff1', fromPinId: 'fsm_ff1_outQ', toCompId: 'fsm_led_z', toPinId: 'fsm_led_z_in', value: 0 }
  );

  const sim = simulateCircuit(components, wires);

  return {
    transitionTable,
    d1Expression: d1Sol.simplifiedSOP || '0',
    d0Expression: d0Sol.simplifiedSOP || '0',
    zExpression: zSol.simplifiedSOP || '0',
    components: sim.components,
    wires: sim.wires,
  };
}
