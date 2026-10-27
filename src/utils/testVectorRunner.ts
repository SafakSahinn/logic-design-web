import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import type { LogicValue } from '../types/logic';
import { COMPONENT_CATALOG, getInputSignalNames, simulateCircuit } from './circuitEngine';

// Unique column names for output parts: own label when unique and not the default, else OUT0, OUT1...
// (records keyed by a shared default label like "Işıklı Gösterge (LED)" would merge the columns)
const getOutputSignalNames = (outputs: CircuitComponentInstance[]): Map<string, string> => {
  const count = new Map<string, number>();
  for (const c of outputs) count.set((c.label || '').trim(), (count.get((c.label || '').trim()) || 0) + 1);
  const names = new Map<string, string>();
  outputs.forEach((c, i) => {
    const l = (c.label || '').trim();
    const isDefault = !l || l === COMPONENT_CATALOG[c.type]?.name;
    names.set(c.id, !isDefault && count.get(l) === 1 ? l : `OUT${i}`);
  });
  return names;
};

export interface TestVectorRow {
  index: number;
  inputValues: Record<string, LogicValue>;
  expectedOutputs: Record<string, LogicValue>;
  actualOutputs?: Record<string, LogicValue>;
  passed?: boolean;
  mismatches?: string[];
}

export interface TestbenchResult {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number; // 0 to 100
  durationMs: number;
  rows: TestVectorRow[];
}

/**
 * Automatically generate a complete exhaustive testbench (truth table) for all inputs
 */
export function generateExhaustiveTestVector(
  components: CircuitComponentInstance[],
  maxInputs = 4
): string {
  const inputs = components.filter((c) => ['switch', 'pushbutton'].includes(c.type));
  const outputs = components.filter((c) => ['led', 'probe', 'buzzer'].includes(c.type));

  if (inputs.length === 0) return '# Tuvalde test edilecek giriş (anahtar) bulunamadı.';

  const signalNames = getInputSignalNames(components);
  const outNames = getOutputSignalNames(outputs);
  const inputNames = inputs.slice(0, maxInputs).map((c, i) => signalNames.get(c.id) || `IN${i}`);
  const outputNames = outputs.map((c, i) => outNames.get(c.id) || `OUT${i}`);

  const lines: string[] = [];
  lines.push(`# Testbench: ${inputNames.join(' ')} | ${outputNames.join(' ')}`);

  const numRows = Math.pow(2, inputNames.length);
  for (let r = 0; r < numRows; r++) {
    const bits = r.toString(2).padStart(inputNames.length, '0').split('').join(' ');
    // Default expected output dummy placeholder or calculated
    const dummyOut = outputNames.map(() => '0').join(' ');
    lines.push(`${bits} | ${dummyOut}`);
  }

  return lines.join('\n');
}

/**
 * Execute testbench on circuit and compare expected vs actual outputs
 */
export function runCircuitTestbench(
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  rawVectorText: string
): TestbenchResult {
  const startTime = performance.now();

  const inputComps = components.filter((c) => ['switch', 'pushbutton'].includes(c.type));
  const outputComps = components.filter((c) => ['led', 'probe', 'buzzer'].includes(c.type));
  const inNames = getInputSignalNames(components);
  const outNames = getOutputSignalNames(outputComps);

  const textLines = rawVectorText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const rows: TestVectorRow[] = [];
  let passedCount = 0;

  textLines.forEach((line, rowIndex) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 1) return;

    const inBits = parts[0].split(/\s+/).map((b) => (b === '1' ? 1 : 0) as LogicValue);
    const expBits = parts.length > 1
      ? parts[1].split(/\s+/).map((b) => (b === '1' ? 1 : 0) as LogicValue)
      : [];

    const inputValues: Record<string, LogicValue> = {};
    const expectedOutputs: Record<string, LogicValue> = {};

    // 1. Clone components and set input values
    const testComps = components.map((c) => {
      const cloned = {
        ...c,
        inputs: c.inputs.map((p) => ({ ...p })),
        outputs: c.outputs.map((p) => ({ ...p })),
        state: { ...c.state },
      };

      const inIdx = inputComps.findIndex((ic) => ic.id === c.id);
      if (inIdx !== -1 && inIdx < inBits.length) {
        const val = inBits[inIdx];
        inputValues[inNames.get(c.id) || c.id] = val;
        cloned.state.on = val === 1;
        if (cloned.outputs[0]) cloned.outputs[0].value = val;
      }
      return cloned;
    });

    outputComps.forEach((oc, oIdx) => {
      if (oIdx < expBits.length) {
        expectedOutputs[outNames.get(oc.id) || oc.id] = expBits[oIdx];
      }
    });

    // 2. Simulate circuit
    const sim = simulateCircuit(testComps, wires, 6);

    // 3. Read actual outputs
    const actualOutputs: Record<string, LogicValue> = {};
    const mismatches: string[] = [];
    let isRowPassed = true;

    outputComps.forEach((oc, oIdx) => {
      const target = sim.components.find((c) => c.id === oc.id);
      const actualVal = (target?.inputs[0]?.value ?? 0) as LogicValue;
      const key = outNames.get(oc.id) || oc.id;
      actualOutputs[key] = actualVal;

      if (oIdx < expBits.length) {
        const expectedVal = expBits[oIdx];
        if (actualVal !== expectedVal) {
          isRowPassed = false;
          mismatches.push(`${key}: beklenen ${expectedVal}, alınan ${actualVal}`);
        }
      }
    });

    if (isRowPassed) passedCount++;

    rows.push({
      index: rowIndex + 1,
      inputValues,
      expectedOutputs,
      actualOutputs,
      passed: isRowPassed,
      mismatches,
    });
  });

  const durationMs = Math.round((performance.now() - startTime) * 10) / 10;
  const total = rows.length;

  return {
    totalTests: total,
    passedTests: passedCount,
    failedTests: total - passedCount,
    successRate: total > 0 ? Math.round((passedCount / total) * 100) : 0,
    durationMs,
    rows,
  };
}
