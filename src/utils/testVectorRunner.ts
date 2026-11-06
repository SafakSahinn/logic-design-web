import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import type { LogicValue, SignalValue } from '../types/logic';
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

const INPUT_TYPES = ['switch', 'pushbutton'];
const OUTPUT_TYPES = ['led', 'probe', 'buzzer'];
// Bit width of a test input (a switch can be wide, a push button is 1 bit) and of an output part
const inputWidth = (c: CircuitComponentInstance) => (c.type === 'switch' ? c.outputs[0]?.width ?? 1 : 1);
const outputWidth = (c: CircuitComponentInstance) => c.inputs[0]?.width ?? 1;

type VectorBit = 0 | 1 | 'X';

/**
 * One value of a test vector for a part `width` bits wide, as Logisim-evolution's TestVector reads it
 * (Value.fromLogString): exactly `width` binary digits, 0x… hexadecimal, 0o… octal, 0b… binary or a decimal
 * number (unsigned, or negative in two's complement); underscores are ignored (0x00_ff).
 * With `allowDontCare` (expected outputs) a lone x / X / - is "any value" and x digits are don't care bits.
 * A 1-bit part takes 0 / 1 (and x / X / - when allowed). Returns the bits LSB first, or an error text.
 */
export function parseVectorValue(token: string, width: number, allowDontCare: boolean): VectorBit[] | string {
  const t = token.trim().replace(/_/g, '');
  const isDc = (s: string) => s === 'x' || s === 'X' || s === '-';
  if (allowDontCare && isDc(t)) return Array<VectorBit>(width).fill('X');
  if (width === 1) {
    if (t === '0' || t === '1') return [Number(t) as 0 | 1];
    return `geçersiz değer: ${t}`;
  }
  const fromDigits = (digits: string, per: number): VectorBit[] | string => {
    const bits: VectorBit[] = [];
    for (let i = digits.length - 1; i >= 0; i--) {
      const ch = digits[i].toLowerCase();
      if (ch === 'x') {
        if (!allowDontCare) return `girişte x olamaz: ${t}`;
        for (let k = 0; k < per; k++) bits.push('X');
        continue;
      }
      const d = parseInt(ch, 2 ** per);
      if (Number.isNaN(d)) return `geçersiz değer: ${t}`;
      for (let k = 0; k < per; k++) bits.push((Math.floor(d / 2 ** k) % 2) as 0 | 1);
    }
    // Digits beyond the width must be 0 (a leading x is a don't care and harmless)
    if (bits.slice(width).some((b) => b === 1)) return `${t} ${width} bite sığmıyor`;
    while (bits.length < width) bits.push(0);
    return bits.slice(0, width);
  };
  if (/^0x[0-9a-fx]+$/i.test(t)) return fromDigits(t.slice(2), 4);
  if (/^0o[0-7x]+$/i.test(t)) return fromDigits(t.slice(2), 3);
  if (/^0b[01x]+$/i.test(t)) return fromDigits(t.slice(2), 1);
  if (/^[01x]+$/i.test(t) && t.length === width) return fromDigits(t, 1);
  if (/^-?\d+$/.test(t)) {
    let n = Number(t);
    if (!Number.isSafeInteger(n) || n >= 2 ** width || n < -(2 ** (width - 1))) return `${t} ${width} bite sığmıyor`;
    if (n < 0) n += 2 ** width;
    return Array.from({ length: width }, (_, k) => (Math.floor(n / 2 ** k) % 2) as 0 | 1);
  }
  return `geçersiz değer: ${t} (${width} bit: ${width} ikilik rakam, 0x… ya da ondalık)`;
}

// Bits (LSB first) as MSB-first text, x for undefined / floating bits
const bitText = (bits: (SignalValue | VectorBit)[]) =>
  bits
    .slice()
    .reverse()
    .map((b) => (b === 0 || b === 1 ? String(b) : b === 'E' ? 'E' : 'x'))
    .join('');

// Column header of a part: its name, with [width] for a wide one (Logisim-evolution test vector header)
const headerName = (name: string, width: number) => (width > 1 ? `${name}[${width}]` : name);

export interface TestVectorRow {
  index: number;
  /** Input values by input name; a wide input's value is its MSB-first bit text */
  inputValues: Record<string, SignalValue | string>;
  expectedOutputs: Record<string, LogicValue | string>;
  actualOutputs?: Record<string, SignalValue | string>;
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
 * Automatically generate a complete exhaustive testbench (truth table) for all inputs. Whole input parts
 * are swept while their bits fit in `maxInputs`; the rest stay 0.
 */
export function generateExhaustiveTestVector(
  components: CircuitComponentInstance[],
  maxInputs = 10
): string {
  const inputs = components.filter((c) => INPUT_TYPES.includes(c.type));
  const outputs = components.filter((c) => OUTPUT_TYPES.includes(c.type));

  if (inputs.length === 0) return '# Tuvalde test edilecek giriş (anahtar) bulunamadı.';

  const signalNames = getInputSignalNames(components);
  const outNames = getOutputSignalNames(outputs);
  // Every row lists all inputs; beyond maxInputs bits only the first parts are enumerated (the rest stay 0)
  const inputNames = inputs.map((c, i) => signalNames.get(c.id) || `IN${i}`);
  const outputNames = outputs.map((c, i) => outNames.get(c.id) || `OUT${i}`);
  const inWidths = inputs.map(inputWidth);
  const outWidths = outputs.map(outputWidth);
  let swept = 0;
  let sweptBits = 0;
  while (swept < inputs.length && sweptBits + inWidths[swept] <= maxInputs) sweptBits += inWidths[swept++];
  const anyWide = [...inWidths, ...outWidths].some((w) => w > 1);

  const lines: string[] = [];
  lines.push(
    `# Testbench: ${inputNames.map((n, i) => headerName(n, inWidths[i])).join(' ')} | ${outputNames
      .map((n, i) => headerName(n, outWidths[i]))
      .join(' ')}`
  );
  lines.push('# Beklenen çıkışları (| sağı) doldurun: 0, 1 veya X (önemsiz).');
  if (anyWide) {
    lines.push('# Çok bitli değer: bit sayısı kadar 0/1 (ör. 0101), 0x onaltılık ya da ondalık; beklenende x = önemsiz bit.');
  }
  if (swept < inputs.length) {
    lines.push(
      anyWide
        ? `# Girişler ${inWidths.reduce((a, b) => a + b, 0)} bit; yalnızca ilk ${swept} girişin (${sweptBits} bit) tüm kombinasyonları üretildi.`
        : `# ${inputs.length} giriş var; yalnızca ilk ${swept} tanesinin tüm kombinasyonları üretildi.`
    );
  }

  const numRows = Math.pow(2, sweptBits);
  for (let r = 0; r < numRows; r++) {
    // Row number split over the swept parts, first part = most significant bits
    let rest = r;
    const values: string[] = new Array(inputs.length);
    for (let i = swept - 1; i >= 0; i--) {
      const w = inWidths[i];
      values[i] = (rest % 2 ** w).toString(2).padStart(w, '0');
      rest = Math.floor(rest / 2 ** w);
    }
    for (let i = swept; i < inputs.length; i++) values[i] = '0'.repeat(inWidths[i]);
    const bits = inWidths.every((w) => w === 1) ? values.join('').split('').join(' ') : values.join(' ');
    // Default expected output dummy placeholder or calculated
    const dummyOut = outWidths.map((w) => '0'.repeat(w)).join(' ');
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

  const inputComps = components.filter((c) => INPUT_TYPES.includes(c.type));
  const outputComps = components.filter((c) => OUTPUT_TYPES.includes(c.type));
  const inNames = getInputSignalNames(components);
  const outNames = getOutputSignalNames(outputComps);
  const inWidths = inputComps.map(inputWidth);
  const outWidths = outputComps.map(outputWidth);
  const allOneBit = [...inWidths, ...outWidths].every((w) => w === 1);

  const textLines = rawVectorText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const rows: TestVectorRow[] = [];
  let passedCount = 0;

  textLines.forEach((line, rowIndex) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 1) return;

    // Inputs must be exactly one value per input part; expected outputs are values with x / X / - as
    // don't care. A malformed row is reported as failed instead of silently reading bad bits as 0.
    const inTokens = parts[0].split(/\s+/).filter(Boolean);
    const expTokens = parts.length > 1 ? parts[1].split(/\s+/).filter(Boolean) : [];
    const formatErrors: string[] = [];
    if (inTokens.length !== inputComps.length) {
      formatErrors.push(
        `${inputComps.length} giriş ${allOneBit ? 'biti' : 'değeri'} bekleniyordu, ${inTokens.length} yazılmış`
      );
    }
    const inBits = inTokens.map((tok, i) => (i < inputComps.length ? parseVectorValue(tok, inWidths[i], false) : []));
    if (allOneBit) {
      const badIn = inTokens.filter((b) => b !== '0' && b !== '1');
      if (badIn.length > 0) formatErrors.push(`geçersiz giriş değeri: ${badIn.join(', ')}`);
    } else {
      inBits.forEach((b) => typeof b === 'string' && formatErrors.push(`giriş: ${b}`));
    }
    if (expTokens.length > outputComps.length) {
      formatErrors.push(`${outputComps.length} çıkış var, ${expTokens.length} beklenen değer yazılmış`);
    }
    const expBits = expTokens.map((tok, i) => (i < outputComps.length ? parseVectorValue(tok, outWidths[i], true) : []));
    if (allOneBit) {
      const badExp = expTokens.filter((b) => !['0', '1', 'x', 'X', '-'].includes(b));
      if (badExp.length > 0) formatErrors.push(`geçersiz beklenen değer: ${badExp.join(', ')}`);
    } else {
      expBits.forEach((b) => typeof b === 'string' && formatErrors.push(`beklenen: ${b}`));
    }

    const inputValues: Record<string, SignalValue | string> = {};
    const expectedOutputs: Record<string, LogicValue | string> = {};

    // 1. Clone components and set input values (a malformed value drives 0)
    const testComps = components.map((c) => {
      const cloned = {
        ...c,
        inputs: c.inputs.map((p) => ({ ...p })),
        outputs: c.outputs.map((p) => ({ ...p })),
        state: { ...c.state },
      };

      const inIdx = inputComps.findIndex((ic) => ic.id === c.id);
      if (inIdx !== -1 && inIdx < inTokens.length) {
        const parsed = inBits[inIdx];
        const bits: (0 | 1)[] = typeof parsed === 'string' ? Array(inWidths[inIdx]).fill(0) : parsed.map((b) => (b === 1 ? 1 : 0));
        const key = inNames.get(c.id) || c.id;
        if (inWidths[inIdx] > 1) {
          inputValues[key] = bitText(bits);
          cloned.state.inputValue = bits.reduce<number>((n, b, k) => n + b * 2 ** k, 0);
        } else {
          const val = bits[0] as SignalValue;
          inputValues[key] = val;
          cloned.state.on = val === 1;
          if (cloned.outputs[0]) cloned.outputs[0].value = val;
        }
      }
      return cloned;
    });

    outputComps.forEach((oc, oIdx) => {
      if (oIdx < expBits.length) {
        const parsed = expBits[oIdx];
        const key = outNames.get(oc.id) || oc.id;
        if (outWidths[oIdx] > 1) expectedOutputs[key] = typeof parsed === 'string' ? expTokens[oIdx] : bitText(parsed);
        else expectedOutputs[key] = typeof parsed === 'string' ? 'X' : (parsed[0] as LogicValue);
      }
    });

    // 2. Simulate circuit
    const sim = simulateCircuit(testComps, wires);

    // 3. Read actual outputs
    const actualOutputs: Record<string, SignalValue | string> = {};
    const mismatches: string[] = formatErrors.map((m) => `Satır biçimi: ${m}`);
    let isRowPassed = formatErrors.length === 0;

    outputComps.forEach((oc, oIdx) => {
      const target = sim.components.find((c) => c.id === oc.id);
      const key = outNames.get(oc.id) || oc.id;
      const w = outWidths[oIdx];
      const pin = target?.inputs[0];
      const actualBits: SignalValue[] =
        w > 1 ? pin?.bits ?? Array<SignalValue>(w).fill('X') : [(pin?.value ?? 0) as SignalValue];
      actualOutputs[key] = w > 1 ? bitText(actualBits) : actualBits[0];

      const expected = oIdx < expBits.length ? expBits[oIdx] : undefined;
      if (expected === undefined || typeof expected === 'string') return;
      const differs = expected.some((b, k) => b !== 'X' && actualBits[k] !== b);
      if (differs) {
        isRowPassed = false;
        mismatches.push(
          `${key}: beklenen ${w > 1 ? bitText(expected) : expected[0]}, alınan ${w > 1 ? bitText(actualBits) : actualBits[0]}`
        );
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
