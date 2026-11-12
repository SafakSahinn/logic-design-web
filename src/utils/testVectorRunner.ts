import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import type { SignalValue } from '../types/logic';
import {
  COMPONENT_CATALOG,
  FLIP_FLOP_TYPES,
  MEM_TYPES,
  RAM_TYPES,
  floatingSwitchState,
  getInputSignalNames,
  simulateCircuit,
} from './circuitEngine';
import { getTopLevelPorts } from './hdlGenerator';
import { TTL_SEQ_TYPES } from './ttlChips';

/*
 * Test vectors (Aşama 3i-1). Two formats are read:
 *
 * - Logisim-evolution's (TestVector / TestVectorEvaluator): a header line of column names (name[width] for a
 *   wide one), optional <set> and <seq> columns, one value per column on every following line, # comments.
 *   Input columns are driven, output and clock columns are checked. <DC> = any value, <float> = floating.
 *   A row with <seq> 0 is combinational: the circuit is reset before it. Rows of one <set> (> 0) run in
 *   <seq> order without a reset; every step after the first starts with a clock tick (all clocks toggle).
 * - The app's older one: "inputs | expected outputs", inputs and outputs in canvas order, every row
 *   combinational.
 *
 * Column names are the HDL top-level port names (hdlGenerator getTopLevelPorts), so the same file drives the
 * generated Verilog / VHDL testbench. The in-app names (A, B ... / OUT0 ...), a part's own label when it has no
 * spaces, and <clk> for the only clock are accepted as well.
 *
 * Reset (a new set or a combinational row): flip-flops, latches, registers, counters, shift registers and IC
 * insides start at 0, the random generator restarts from its seed, clocks go to 0. RAM and ROM keep their
 * contents and inputs that have no column keep their canvas values: that is the circuit's power-up state in the
 * generated HDL as well.
 */

type VectorBit = 0 | 1 | 'X' | 'Z';

/**
 * One value of a test vector for a part `width` bits wide, as Logisim-evolution's Value.fromLogString reads
 * it: exactly `width` binary digits, 0x… hexadecimal, 0o… octal, 0b… binary or a decimal number (unsigned, or
 * negative in two's complement); underscores are ignored (0x00_ff). x digits are unknown bits (in an expected
 * value: don't care bits); a lone x / X / - is all bits unknown. Without `allowUnknown` x is refused.
 * Returns the bits LSB first, or an error text.
 */
export function parseVectorValue(token: string, width: number, allowUnknown: boolean): VectorBit[] | string {
  const t = token.trim().replace(/_/g, '');
  const isDc = (s: string) => s === 'x' || s === 'X' || s === '-';
  if (allowUnknown && isDc(t)) return Array<VectorBit>(width).fill('X');
  if (width === 1) {
    if (t === '0' || t === '1') return [Number(t) as 0 | 1];
    return `geçersiz değer: ${t}`;
  }
  const fromDigits = (digits: string, per: number): VectorBit[] | string => {
    const bits: VectorBit[] = [];
    for (let i = digits.length - 1; i >= 0; i--) {
      const ch = digits[i].toLowerCase();
      if (ch === 'x') {
        if (!allowUnknown) return `girişte x olamaz: ${t}`;
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

// Bits (LSB first) as MSB-first text, x for unknown / floating bits
const bitText = (bits: (SignalValue | VectorBit)[]) =>
  bits
    .slice()
    .reverse()
    .map((b) => (b === 0 || b === 1 ? String(b) : b === 'E' ? 'E' : 'x'))
    .join('');

/** A circuit signal a test vector column can name: an HDL top-level port */
export interface TvSignal {
  name: string;
  width: number;
  /** in = driven by the test, out = checked, clock = toggled every step and checked */
  role: 'in' | 'out' | 'clock';
  compId: string;
  type: string;
  /** Pin ids behind it: one wide pin, or one 1-bit pin per bit (LSB first) */
  pins: string[];
  /** Why it cannot be driven by a test (keyboard) */
  unsupported?: string;
}

export type TvCell = { kind: 'val'; bits: VectorBit[] } | { kind: 'dc' } | { kind: 'float' } | { kind: 'bad'; msg: string };

export interface TvRow {
  /** Line of the text the row came from (1-based) */
  line: number;
  set: number;
  seq: number;
  cells: TvCell[];
  /** Problems with the row's shape (wrong count of values): the row fails */
  errors: string[];
}

export interface ParsedTestVector {
  format: 'evolution' | 'legacy';
  columns: TvSignal[];
  rows: TvRow[];
  /** Problems that stop the whole test (unknown column, width mismatch, set/seq order) */
  errors: string[];
}

// Output parts of the older format, in canvas order: own label when unique and not the default, else OUT0, OUT1...
const LEGACY_OUTPUT_TYPES = ['led', 'probe', 'buzzer'];
const LEGACY_INPUT_TYPES = ['switch', 'pushbutton'];
const legacyOutputNames = (outputs: CircuitComponentInstance[]): Map<string, string> => {
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

/** Every signal of the circuit a test can use, named as the HDL top-level ports */
export function getTestSignals(components: CircuitComponentInstance[], wires: CircuitWire[]): TvSignal[] {
  return getTopLevelPorts('digital_circuit', components, wires)
    .filter((p) => p.source && p.source.pins && p.source.pins.length > 0)
    .map((p) => ({
      name: p.name,
      width: p.width,
      role: p.dir === 'out' ? 'out' : p.source!.type === 'clock' ? 'clock' : 'in',
      compId: p.source!.compId,
      type: p.source!.type,
      pins: p.source!.pins!,
      unsupported: p.source!.type === 'asciiKeyboard' ? 'ASCII klavye test vektörüyle sürülemiyor' : undefined,
    }));
}

const tokensOf = (line: string) => line.split(/\s+/).filter(Boolean);
const stripComment = (line: string) => {
  const i = line.indexOf('#');
  return i >= 0 ? line.slice(0, i) : line;
};

function parseCell(token: string, sig: TvSignal): TvCell {
  const up = token.toUpperCase();
  if (up === '<DC>') return sig.role === 'in' ? { kind: 'bad', msg: `${sig.name}: <DC> yalnız çıkışta kullanılır` } : { kind: 'dc' };
  if (up === '<FLOAT>') return { kind: 'float' };
  const bits = parseVectorValue(token, sig.width, true);
  if (typeof bits === 'string') return { kind: 'bad', msg: `${sig.name}: ${bits}` };
  return { kind: 'val', bits };
}

/** Read a test vector text (either format) against the circuit */
export function parseTestVector(
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  text: string
): ParsedTestVector {
  const signals = getTestSignals(components, wires);
  const lines = text.split(/\r?\n/);
  const firstData = lines.findIndex((l) => tokensOf(stripComment(l)).length > 0);
  if (firstData < 0) return { format: 'evolution', columns: [], rows: [], errors: ['Test vektörü boş.'] };
  const firstPortOf = (compId: string) => signals.find((s) => s.compId === compId);

  // --- the app's older format: "inputs | expected outputs" -------------------------------------------
  if (stripComment(lines[firstData]).includes('|')) {
    const errors: string[] = [];
    const inComps = components.filter((c) => LEGACY_INPUT_TYPES.includes(c.type));
    const outComps = components.filter((c) => LEGACY_OUTPUT_TYPES.includes(c.type));
    const inCols = inComps.map((c) => firstPortOf(c.id));
    const outCols = outComps.map((c) => firstPortOf(c.id));
    if (inCols.some((s) => !s) || outCols.some((s) => !s)) errors.push('Bazı giriş/çıkış parçaları HDL portu olmadığı için okunamadı.');
    const ins = inCols.filter((s): s is TvSignal => !!s);
    const outs = outCols.filter((s): s is TvSignal => !!s);
    const rows: TvRow[] = [];
    lines.forEach((raw, li) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const [left, right = ''] = line.split('|');
      const inTok = tokensOf(left);
      const outTok = tokensOf(right);
      const rowErrors: string[] = [];
      if (inTok.length !== ins.length) {
        rowErrors.push(`${ins.length} giriş değeri bekleniyordu, ${inTok.length} yazılmış`);
      }
      if (outTok.length > outs.length) rowErrors.push(`${outs.length} çıkış var, ${outTok.length} beklenen değer yazılmış`);
      const cells: TvCell[] = [
        ...ins.map((s, i): TvCell => {
          if (i >= inTok.length) return { kind: 'val', bits: Array<VectorBit>(s.width).fill(0) };
          const bits = parseVectorValue(inTok[i], s.width, false);
          return typeof bits === 'string' ? { kind: 'bad', msg: `giriş: ${bits}` } : { kind: 'val', bits };
        }),
        ...outs.map((s, i): TvCell => {
          if (i >= outTok.length) return { kind: 'dc' };
          const bits = parseVectorValue(outTok[i], s.width, true);
          return typeof bits === 'string' ? { kind: 'bad', msg: `beklenen: ${bits}` } : { kind: 'val', bits };
        }),
      ];
      rows.push({ line: li + 1, set: 0, seq: 0, cells, errors: rowErrors });
    });
    return { format: 'legacy', columns: [...ins, ...outs], rows, errors };
  }

  // --- Logisim-evolution's format --------------------------------------------------------------------
  const errors: string[] = [];
  const header = tokensOf(stripComment(lines[firstData]));
  let setIdx = -1;
  let seqIdx = -1;
  const columns: TvSignal[] = [];
  const colOfToken: number[] = []; // header token index -> column index (-1 for <set> / <seq>)

  // Name lookup: port name, in-app name, label without spaces, <clk>
  const byName = new Map<string, TvSignal>();
  const inAppIn = getInputSignalNames(components);
  const inAppOut = legacyOutputNames(components.filter((c) => LEGACY_OUTPUT_TYPES.includes(c.type)));
  const addAlias = (name: string, s?: TvSignal) => {
    if (s && name && !/\s/.test(name) && !byName.has(name)) byName.set(name, s);
  };
  for (const s of signals) byName.set(s.name, s);
  for (const [id, n] of inAppIn) addAlias(n, firstPortOf(id));
  for (const [id, n] of inAppOut) addAlias(n, firstPortOf(id));
  for (const c of components) {
    const own = signals.filter((s) => s.compId === c.id);
    if (own.length === 1) addAlias((c.label || '').trim(), own[0]);
  }
  const clocks = signals.filter((s) => s.role === 'clock');

  header.forEach((tok, ti) => {
    const up = tok.toUpperCase();
    if (up === '<SET>') {
      setIdx = ti;
      colOfToken.push(-1);
      return;
    }
    if (up === '<SEQ>') {
      seqIdx = ti;
      colOfToken.push(-1);
      return;
    }
    let name = tok;
    let width = 1;
    const s = tok.indexOf('[');
    if (s >= 0) {
      const e = tok.indexOf(']');
      const w = Number(tok.slice(s + 1, e));
      if (e !== tok.length - 1 || s === 0 || e === s + 1 || !Number.isInteger(w) || w < 1 || w > 32) {
        errors.push(`Başlıkta hatalı sütun: ${tok}`);
        colOfToken.push(-1);
        return;
      }
      name = tok.slice(0, s);
      width = w;
    }
    let sig = byName.get(name);
    if (!sig && name.toLowerCase() === '<clk>') {
      if (clocks.length === 1) sig = clocks[0];
      else errors.push(clocks.length === 0 ? 'Devrede saat yok (<clk>).' : '<clk> belirsiz: devrede birden çok saat var, saatin port adını yazın.');
    }
    if (!sig) {
      if (name.toLowerCase() !== '<clk>') errors.push(`"${name}" sütununa karşılık gelen giriş, çıkış ya da saat yok.`);
      colOfToken.push(-1);
      return;
    }
    if (sig.width !== width) errors.push(`${name}: başlıkta ${width} bit, devrede ${sig.width} bit (${sig.width > 1 ? `${name}[${sig.width}]` : name} yazın).`);
    if (sig.unsupported) errors.push(`${name}: ${sig.unsupported}.`);
    if (columns.includes(sig)) errors.push(`${name} sütunu iki kez yazılmış.`);
    colOfToken.push(columns.length);
    columns.push(sig);
  });

  const rows: TvRow[] = [];
  for (let li = firstData + 1; li < lines.length; li++) {
    const tok = tokensOf(stripComment(lines[li]));
    if (tok.length === 0) continue;
    const rowErrors: string[] = [];
    const cells: TvCell[] = columns.map(() => ({ kind: 'dc' }));
    let set = 0;
    let seq = 0;
    if (tok.length !== header.length) rowErrors.push(`${header.length} değer bekleniyordu, ${tok.length} yazılmış`);
    tok.slice(0, header.length).forEach((t, ti) => {
      if (ti === setIdx || ti === seqIdx) {
        const n = Number(t);
        if (!Number.isInteger(n) || n < 0) rowErrors.push(`geçersiz ${ti === setIdx ? '<set>' : '<seq>'} değeri: ${t}`);
        else if (ti === setIdx) set = n;
        else seq = n;
        return;
      }
      const ci = colOfToken[ti];
      if (ci >= 0) cells[ci] = parseCell(t, columns[ci]);
    });
    rows.push({ line: li + 1, set, seq, cells, errors: rowErrors });
  }

  // Set / seq order, as Logisim-evolution checks it
  let lastSet = 0;
  let lastSeq = 0;
  for (const r of rows) {
    if (r.set < lastSet) errors.push(`Satır ${r.line}: <set> sırası bozuk (${lastSet}, sonra ${r.set}).`);
    else if (r.set === lastSet && r.set > 0 && r.seq <= lastSeq) errors.push(`Satır ${r.line}: <seq> sırası bozuk (${lastSeq}, sonra ${r.seq}).`);
    if (r.set === 0 && r.seq !== 0) errors.push(`Satır ${r.line}: <set> 0 iken <seq> ${r.seq} olamaz.`);
    if (r.set !== 0 && r.seq === 0) errors.push(`Satır ${r.line}: <set> ${r.set} iken <seq> 0 olamaz.`);
    lastSet = r.set;
    lastSeq = r.seq;
  }
  return { format: 'evolution', columns, rows, errors };
}

// ---------------------------------------------------------------------------------------------------------
// Running

const cloneComp = (c: CircuitComponentInstance): CircuitComponentInstance => ({
  ...c,
  inputs: c.inputs.map((p) => ({ ...p })),
  outputs: c.outputs.map((p) => ({ ...p })),
  state: { ...c.state },
});

/** Does the circuit keep state between steps (memory parts, latches, ICs)? */
export function circuitHasState(components: CircuitComponentInstance[]): boolean {
  return components.some(
    (c) =>
      MEM_TYPES.has(c.type) || RAM_TYPES.has(c.type) || TTL_SEQ_TYPES.has(c.type) || c.type === 'srLatch' || c.type === 'subcircuit' || c.type === 'clock'
  );
}

/** The circuit's reset state (see the note at the top) */
export function resetCircuitState(components: CircuitComponentInstance[]): CircuitComponentInstance[] {
  return components.map((c) => {
    const n = cloneComp(c);
    const st = n.state;
    if (FLIP_FLOP_TYPES.has(c.type) || c.type === 'srLatch') {
      st.q = 0;
      st.qBar = 1;
    }
    delete st.lastClk;
    delete st.lastClkB;
    delete st.seqBits;
    delete st.shiftStages;
    delete st.ttlSeq;
    delete st.regBits;
    delete st.subcircuitInternal;
    delete st.oscillating;
    if (c.type === 'random') {
      delete st.randomCur;
      delete st.randomValue;
    }
    if (c.type === 'clock') st.on = false;
    // A three-state input pin starts floating again, as Logisim resets its pin state
    if (c.type === 'switch' && st.pinTristate) {
      delete st.portValue;
      delete st.portBits;
      Object.assign(st, floatingSwitchState(c.outputs[0]?.width ?? 1));
    }
    return n;
  });
}

const toNumber = (bits: (0 | 1)[]) => bits.reduce<number>((n, b, k) => n + b * 2 ** k, 0);

// Drive an input signal of the (cloned) circuit with a value; returns an error text when it cannot
function driveInput(comps: CircuitComponentInstance[], sig: TvSignal, cell: TvCell): string | null {
  const c = comps.find((x) => x.id === sig.compId);
  if (!c || cell.kind === 'dc' || cell.kind === 'bad') return null;
  const bits: VectorBit[] = cell.kind === 'float' ? Array<VectorBit>(sig.width).fill('Z') : cell.bits;
  const known = bits.every((b) => b === 0 || b === 1);
  const st = c.state;
  if (c.type === 'dipSwitch') {
    if (!known) return `${sig.name}: DIP anahtar yalnız 0/1 alır`;
    st.dipBits = toNumber(bits as (0 | 1)[]);
    return null;
  }
  if (c.type === 'switch' && sig.width > 1) {
    if (known) {
      delete st.portBits;
      st.inputValue = toNumber(bits as (0 | 1)[]);
    } else st.portBits = bits as SignalValue[];
    return null;
  }
  if (c.type === 'switch' || c.type === 'pushbutton') {
    const b = bits[0];
    if (b === 0 || b === 1) {
      delete st.portValue;
      st.on = b === 1;
    } else st.portValue = b;
    return null;
  }
  return null;
}

// Current bits (LSB first) of a signal in a simulated circuit
function readSignal(comps: CircuitComponentInstance[], sig: TvSignal): SignalValue[] {
  const c = comps.find((x) => x.id === sig.compId);
  if (!c) return Array<SignalValue>(sig.width).fill('X');
  const pin = (id: string) => c.inputs.find((p) => p.id === id) ?? c.outputs.find((p) => p.id === id);
  if (sig.pins.length === 1 && sig.width > 1) {
    const p = pin(sig.pins[0]);
    const bits = p?.bits && p.bits.length === sig.width ? p.bits : Array<SignalValue>(sig.width).fill(p?.value ?? 'X');
    return [...bits];
  }
  return sig.pins.map((id) => pin(id)?.value ?? 'X');
}

const cellMatches = (cell: TvCell, actual: SignalValue[]): boolean => {
  if (cell.kind === 'dc' || cell.kind === 'bad') return true;
  if (cell.kind === 'float') return actual.every((b) => b === 'Z' || b === 'X');
  // An x bit takes 0, 1 or an unknown / floating bit but not an error (Logisim-evolution Value.compatible)
  return cell.bits.every((b, k) => (b === 'X' ? actual[k] !== 'E' : actual[k] === b));
};

export const cellText = (cell: TvCell, width: number): string =>
  cell.kind === 'dc'
    ? '<DC>'
    : cell.kind === 'float'
      ? '<float>'
      : cell.kind === 'bad'
        ? '?'
        : bitText(cell.bits.slice(0, width));

export interface TestVectorRow {
  index: number;
  /** Source line, and the row's <set> / <seq> */
  line?: number;
  set?: number;
  seq?: number;
  /** Input values by column name (MSB-first bit text) */
  inputValues: Record<string, SignalValue | string>;
  expectedOutputs: Record<string, string>;
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
  /** Problems that stopped the test (nothing ran) */
  errors?: string[];
}

/**
 * Run parsed rows on the circuit. Returns, for every row, the bits of every column after the row's step
 * (inputs as driven, outputs and clocks as read) and whether the circuit oscillated.
 */
export function evaluateTestRows(
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  columns: TvSignal[],
  rows: TvRow[]
): { actual: SignalValue[][]; oscillating: boolean; driveErrors: string[] }[] {
  const out: { actual: SignalValue[][]; oscillating: boolean; driveErrors: string[] }[] = [];
  let comps = components;
  let curWires = wires;
  let curSet = -1;
  let curSeq = 0;
  let oscillating = false;
  const clockIds = new Set(components.filter((c) => c.type === 'clock').map((c) => c.id));
  for (const row of rows) {
    const reset = row.seq === 0 || curSeq === 0 || row.set !== curSet;
    curSet = row.set;
    curSeq = row.seq;
    if (reset) {
      const sim = simulateCircuit(resetCircuitState(components), wires);
      comps = sim.components;
      curWires = sim.wires;
      oscillating = !!sim.oscillating;
    } else if (!oscillating) {
      // Clock tick first (Logisim-evolution toggles every clock, then sets the step's inputs)
      const ticked = comps.map((c) => (clockIds.has(c.id) ? { ...cloneComp(c), state: { ...c.state, on: !c.state.on } } : c));
      const sim = simulateCircuit(ticked, curWires);
      comps = sim.components;
      curWires = sim.wires;
      oscillating = !!sim.oscillating;
    }
    const driveErrors: string[] = [];
    if (!oscillating) {
      const driven = comps.map(cloneComp);
      columns.forEach((sig, i) => {
        if (sig.role !== 'in') return;
        const err = driveInput(driven, sig, row.cells[i]);
        if (err) driveErrors.push(err);
      });
      const sim = simulateCircuit(driven, curWires);
      comps = sim.components;
      curWires = sim.wires;
      oscillating = !!sim.oscillating;
    }
    out.push({ actual: columns.map((sig) => readSignal(comps, sig)), oscillating, driveErrors });
  }
  return out;
}

/** Run a test vector text (either format) on the circuit and compare expected vs actual values */
export function runCircuitTestbench(
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  rawVectorText: string
): TestbenchResult {
  const startTime = performance.now();
  const tv = parseTestVector(components, wires, rawVectorText);
  const finish = (rows: TestVectorRow[], errors?: string[]): TestbenchResult => {
    const passed = rows.filter((r) => r.passed).length;
    return {
      totalTests: rows.length,
      passedTests: passed,
      failedTests: rows.length - passed,
      successRate: rows.length > 0 ? Math.round((passed / rows.length) * 100) : 0,
      durationMs: Math.round((performance.now() - startTime) * 10) / 10,
      rows,
      ...(errors && errors.length ? { errors } : {}),
    };
  };
  if (tv.errors.length > 0) return finish([], tv.errors);

  const results = evaluateTestRows(components, wires, tv.columns, tv.rows);
  const rows: TestVectorRow[] = tv.rows.map((row, ri) => {
    const res = results[ri];
    const inputValues: Record<string, SignalValue | string> = {};
    const expectedOutputs: Record<string, string> = {};
    const actualOutputs: Record<string, SignalValue | string> = {};
    const mismatches: string[] = row.errors.map((m) => `Satır biçimi: ${m}`);
    row.cells.forEach((cell) => cell.kind === 'bad' && mismatches.push(`Satır biçimi: ${cell.msg}`));
    mismatches.push(...res.driveErrors.map((m) => `Satır biçimi: ${m}`));
    if (res.oscillating) mismatches.push('Devre salınıyor (oturmuyor)');
    tv.columns.forEach((sig, i) => {
      const cell = row.cells[i];
      const act = res.actual[i];
      const actText = sig.width > 1 ? bitText(act) : act[0] === 0 || act[0] === 1 ? act[0] : bitText(act);
      if (sig.role === 'in') {
        inputValues[sig.name] = cellText(cell, sig.width);
        return;
      }
      expectedOutputs[sig.name] = cellText(cell, sig.width);
      actualOutputs[sig.name] = actText;
      if (!res.oscillating && !cellMatches(cell, act)) mismatches.push(`${sig.name}: beklenen ${cellText(cell, sig.width)}, alınan ${bitText(act)}`);
    });
    return {
      index: ri + 1,
      line: row.line,
      set: row.set,
      seq: row.seq,
      inputValues,
      expectedOutputs,
      actualOutputs,
      passed: mismatches.length === 0,
      mismatches,
    };
  });
  return finish(rows);
}

// ---------------------------------------------------------------------------------------------------------
// Generating

// A value as test vector text: binary for up to 8 bits (and whenever a bit is unknown), else 0x hexadecimal
function valueText(bits: SignalValue[]): string {
  const w = bits.length;
  if (bits.every((b) => b === 'Z')) return '<float>';
  // An error bit (E, short circuit) matches only <DC> (Logisim-evolution: an x bit expects 0, 1 or unknown)
  if (bits.some((b) => b === 'E')) return '<DC>';
  const known = bits.every((b) => b === 0 || b === 1);
  if (w === 1) return known ? String(bits[0]) : 'x';
  if (!known || w <= 8) {
    // "0x…" would read as hexadecimal (Logisim-evolution picks the radix from the prefix first): 0b prefix
    const t = bitText(bits);
    return t.startsWith('0x') ? `0b${t}` : t;
  }
  let n = 0n;
  bits.forEach((b, k) => b === 1 && (n |= 1n << BigInt(k)));
  return `0x${n.toString(16)}`;
}

const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length));

/**
 * A test vector in Logisim-evolution's format for every input: whole input parts are swept while their bits
 * fit in `maxInputs` (the rest stay at their canvas values), and the expected values are the simulator's
 * current results, so the file checks that the circuit (or its generated HDL) still behaves the same.
 * A circuit with a clock or memory gets one sequence (<set> 1): the inputs change on the steps where the
 * clock falls and hold while it rises, two steps per input combination, between `minSteps` and `maxSteps` steps.
 */
export function generateExhaustiveTestVector(
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  maxInputs = 10,
  maxSteps = 256,
  minSteps = 32
): string {
  const signals = getTestSignals(components, wires);
  const ins = signals.filter((s) => s.role === 'in' && !s.unsupported);
  const clocks = signals.filter((s) => s.role === 'clock');
  const outs = signals.filter((s) => s.role === 'out');
  if (ins.length === 0 && clocks.length === 0) return '# Tuvalde test edilecek giriş (anahtar, buton, DIP anahtar) ya da saat bulunamadı.';

  const sequential = clocks.length > 0 || circuitHasState(components);
  let swept = 0;
  let sweptBits = 0;
  while (swept < ins.length && sweptBits + ins[swept].width <= maxInputs) sweptBits += ins[swept++].width;
  const allCombos = 2 ** sweptBits;
  // A sequence walks the combinations (again and again while short, so a counter gets to count) for at least
  // minSteps steps and at most maxSteps
  const combos = sequential ? Math.min(Math.max(allCombos, Math.ceil(minSteps / 2)), Math.floor(maxSteps / 2)) : allCombos;

  // Values of the un-swept inputs: their canvas values
  const canvas = simulateCircuit(components.map(cloneComp), wires).components;
  const held = ins.map((s) => readSignal(canvas, s));
  const comboBits = (r: number): VectorBit[][] => {
    let rest = r;
    const vals: VectorBit[][] = ins.map((_, i) => held[i].map((b) => (b === 1 ? 1 : 0)) as VectorBit[]);
    for (let i = swept - 1; i >= 0; i--) {
      const w = ins[i].width;
      vals[i] = Array.from({ length: w }, (_, k) => (Math.floor((rest % 2 ** w) / 2 ** k) % 2) as 0 | 1);
      rest = Math.floor(rest / 2 ** w);
    }
    return vals;
  };

  const columns = [...ins, ...(sequential ? clocks : []), ...outs];
  const rows: TvRow[] = [];
  for (let r = 0; r < combos; r++) {
    const vals = comboBits(r % allCombos);
    const cells: TvCell[] = columns.map((_, i) => (i < ins.length ? { kind: 'val', bits: vals[i] } : { kind: 'dc' }));
    if (sequential) {
      rows.push({ line: 0, set: 1, seq: rows.length + 1, cells, errors: [] });
      rows.push({ line: 0, set: 1, seq: rows.length + 1, cells, errors: [] });
    } else rows.push({ line: 0, set: 0, seq: 0, cells, errors: [] });
  }
  const results = evaluateTestRows(components, wires, columns, rows);

  const head = columns.map((s) => (s.width > 1 ? `${s.name}[${s.width}]` : s.name));
  if (sequential) head.push('<set>', '<seq>');
  const table = rows.map((row, ri) => {
    const vals = columns.map((sig, i) => (sig.role === 'in' ? valueText(row.cells[i].kind === 'val' ? (row.cells[i] as { bits: SignalValue[] }).bits : held[i]) : valueText(results[ri].actual[i])));
    if (sequential) vals.push(String(row.set), String(row.seq));
    return vals;
  });
  const widths = head.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
  const lines: string[] = [];
  lines.push('# Logisim-evolution test vektörü. Beklenen değerler simülatörün şu anki sonuçları; gerekirse elle değiştirin.');
  lines.push('# Değer: bit sayısı kadar 0/1 (ör. 0101), 0x onaltılık ya da ondalık; x = önemsiz bit, <DC> = her değer, <float> = yüzer.');
  if (sequential) {
    lines.push('# Sıralı test: aynı <set> içindeki adımlar sıfırlanmadan <seq> sırasıyla koşar; ilk adımdan sonra her adım bir saat tikiyle başlar.');
  }
  if (swept < ins.length) {
    lines.push(`# Girişler ${ins.reduce((a, s) => a + s.width, 0)} bit; yalnız ilk ${swept} girişin (${sweptBits} bit) kombinasyonları gezildi, öbürleri tuvaldeki değerinde.`);
  }
  if (sequential && combos < allCombos) lines.push(`# Adım sınırı: ${allCombos} kombinasyonun ilk ${combos} tanesi.`);
  lines.push(head.map((h, i) => pad(h, widths[i])).join(' ').trimEnd());
  for (const r of table) lines.push(r.map((v, i) => pad(v, widths[i])).join(' ').trimEnd());
  return lines.join('\n');
}

