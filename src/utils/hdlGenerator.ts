import type { CircuitComponentInstance, CircuitWire, CustomSubcircuit } from '../types/circuit';
import { getLogicalConnections } from './wiringEngine';
import { HEX_7SEG_MAP } from './circuitEngine';
import { getSubcircuitDefinition } from './subcircuitManager';

/*
 * Verilog / VHDL export.
 *
 * Both languages share one netlist pass (nets, drivers, floating inputs, names) and one
 * per-component description whose behaviour mirrors simulateCircuit():
 *  - multi-input gates ignore unconnected inputs, a gate with no connected input outputs 0
 *  - an unconnected decoder EN / register WE counts as enabled, any other floating input is 0
 *  - several drivers on one net share a signal (tri-state buses resolve through 'z')
 *  - registers start at the simulator's reset state (Q=0, RAM = 0..15, ROM = its contents)
 *  - custom ICs (subcircuits) are emitted as their own module / entity
 */

type Lang = 'verilog' | 'vhdl';

const RESERVED = new Set(
  (
    // Verilog
    'always and assign begin buf case casex casez default defparam disable edge else end endcase endfunction endmodule ' +
    'endtask for force forever fork function if initial inout input integer join module nand negedge nor not or output ' +
    'parameter posedge real reg repeat signed supply0 supply1 task time tri wait while wire xnor xor logic bit ' +
    // VHDL
    'abs access after alias all architecture array assert attribute block body buffer bus component configuration ' +
    'constant disconnect downto elsif entity exit file generate generic group guarded impure in inertial is label ' +
    'library linkage literal loop map mod new next null of on open others out package port postponed procedure process ' +
    'pure range record register reject rem report return rol ror select severity shared sla sll sra srl subtype then to ' +
    'transport type unaffected units until use variable when with std_logic std_logic_vector unsigned ieee work clk_in'
  ).split(' ')
);

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

// Identifier legal in both languages: [a-z][a-z0-9_]*, no "__", no trailing "_", not a keyword
function baseIdentifier(raw: string, fallback: string): string {
  let s = (raw || '')
    .replace(/'/g, '_n')
    .replace(/>=/g, '_ge_')
    .replace(/<=/g, '_le_')
    .replace(/>/g, '_gt_')
    .replace(/</g, '_lt_')
    .replace(/=/g, '_eq_')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]|i̇/g, (ch) => TR_MAP[ch] || '_')
    .normalize('NFKD')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = `u_${s}`;
  if (s.length > 60) s = s.slice(0, 60).replace(/_$/, '');
  if (RESERVED.has(s)) s = `${s}_s`;
  return s;
}

class NameTable {
  private used = new Set<string>();
  constructor(reserved: string[] = []) {
    reserved.forEach((r) => this.used.add(r));
  }
  reserve(name: string) {
    this.used.add(name);
  }
  make(raw: string, fallback = 'sig'): string {
    const base = baseIdentifier(raw, fallback);
    let name = base;
    for (let i = 2; this.used.has(name); i++) name = `${base}_${i}`;
    this.used.add(name);
    return name;
  }
}

// ---------------------------------------------------------------------------
// Language helpers for 1-bit expressions
// ---------------------------------------------------------------------------
interface LangOps {
  zero: string;
  one: string;
  hiZ: string;
  not: (a: string) => string;
  and: (xs: string[]) => string;
  or: (xs: string[]) => string;
  xor: (xs: string[]) => string;
  mux: (sel: string, whenOne: string, whenZero: string) => string;
  assign: (lhs: string, rhs: string) => string;
  comment: (text: string) => string;
}

const VERILOG: LangOps = {
  zero: "1'b0",
  one: "1'b1",
  hiZ: "1'bz",
  not: (a) => `~${wrap(a)}`,
  and: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' & ')),
  or: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' | ')),
  xor: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' ^ ')),
  mux: (sel, a, b) => `${wrap(sel)} ? ${wrap(a)} : ${wrap(b)}`,
  assign: (l, r) => `  assign ${l} = ${r};`,
  comment: (t) => `  // ${t}`,
};

const VHDL: LangOps = {
  zero: "'0'",
  one: "'1'",
  hiZ: "'Z'",
  not: (a) => `not ${wrap(a)}`,
  and: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' and ')),
  or: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' or ')),
  xor: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' xor ')),
  // VHDL-93 has no conditional operator inside expressions, so mux is emitted via helper below
  mux: (sel, a, b) => `__MUX__(${sel}|${a}|${b})`,
  assign: (l, r) => `  ${l} <= ${r};`,
  comment: (t) => `  -- ${t}`,
};

// VHDL condition "x = '1'" / "x = '0'". Comparing two literals ('0' = '1') is ambiguous in VHDL
// (character vs std_logic), so constant inputs (VCC/GND/floating) fold to true/false.
function is1(x: string): string {
  return x === "'1'" ? 'true' : x === "'0'" ? 'false' : `${x} = '1'`;
}
function is0(x: string): string {
  return x === "'0'" ? 'true' : x === "'1'" ? 'false' : `${x} = '0'`;
}

// Parenthesise anything that is not a plain identifier / literal / index
function wrap(e: string): string {
  return /^[A-Za-z0-9_'\\[\]().]+$/.test(e) && !/\s/.test(e) ? e : `(${e})`;
}

// ---------------------------------------------------------------------------
// Netlist
// ---------------------------------------------------------------------------
const INPUT_TYPES = ['switch', 'pushbutton', 'clock', 'vcc', 'gnd', 'dipSwitch4', 'asciiKeyboard'];
const OUTPUT_TYPES = ['led', 'probe', 'buzzer', 'sevenSegment', 'hexDisplay', 'ledBar4', 'dotMatrix8x8', 'rgbMatrix16x16'];
const PASSIVE_TYPES = ['tunnel', 'textLabel'];

export interface PortDecl {
  name: string;
  dir: 'in' | 'out';
  width: number; // 1 = scalar
  // Canvas part behind a top-level port (used by the FPGA pin constraints)
  source?: { compId: string; type: string; group?: string };
}

interface ModuleSpec {
  name: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  // subcircuit modules: explicit ports bound to internal pins
  subPorts?: CustomSubcircuit['ports'];
}

interface BuiltModule {
  name: string;
  ports: PortDecl[];
  signals: { name: string; width: number; init?: string }[];
  body: string[];
  extraDecls: string[]; // VHDL types/arrays, Verilog memories
  warnings: string[];
}

function buildModule(
  spec: ModuleSpec,
  lang: Lang,
  subModules: Map<string, { def: CustomSubcircuit; moduleName: string }>,
  moduleNames: NameTable
): BuiltModule {
  const L = lang === 'verilog' ? VERILOG : VHDL;
  const names = new NameTable();
  const ports: PortDecl[] = [];
  const signals: BuiltModule['signals'] = [];
  const body: string[] = [];
  const extraDecls: string[] = [];
  const warnings: string[] = [];

  const subNames = spec.subPorts ? subPortNames(spec.subPorts) : null;
  if (subNames) [...subNames.inputs, ...subNames.outputs].forEach((n) => names.reserve(n));

  const comps = spec.components;
  const compById = new Map(comps.map((c) => [c.id, c]));
  const pinOwner = new Map<string, CircuitComponentInstance>();
  const pinIsOutput = new Map<string, boolean>();
  for (const c of comps) {
    for (const p of c.inputs) {
      pinOwner.set(p.id, c);
      pinIsOutput.set(p.id, false);
    }
    for (const p of c.outputs) {
      pinOwner.set(p.id, c);
      pinIsOutput.set(p.id, true);
    }
  }

  // Nets from the logical connections: driver pin + every other pin of the net
  const conns = getLogicalConnections(comps, spec.wires);
  const netOfPin = new Map<string, string[]>();
  const byDriver = new Map<string, string[]>();
  for (const w of conns) {
    if (!byDriver.has(w.fromPinId)) byDriver.set(w.fromPinId, [w.fromPinId]);
    byDriver.get(w.fromPinId)!.push(w.toPinId);
  }
  for (const pins of byDriver.values()) for (const p of pins) netOfPin.set(p, pins);
  const isConnected = (pinId: string) => (netOfPin.get(pinId)?.length || 0) > 1;

  // Real drivers of a net: output pins of non-passive, non-sink parts
  const netDrivers = (pinId: string): string[] =>
    (netOfPin.get(pinId) || []).filter((id) => {
      const owner = pinOwner.get(id);
      return pinIsOutput.get(id) && owner && !PASSIVE_TYPES.includes(owner.type) && !OUTPUT_TYPES.includes(owner.type);
    });

  // Expression for every output pin (ports, constants, internal signals)
  const pinExpr = new Map<string, string>();
  const declared = new Set<string>();
  const declare = (name: string, width = 1, init?: string) => {
    if (declared.has(name)) return;
    declared.add(name);
    signals.push({ name, width, init });
  };
  const vecIndex = (name: string, i: number) => (lang === 'verilog' ? `${name}[${i}]` : `${name}(${i})`);

  const portBound = new Map<string, string>(); // internal pin id -> port expression (subcircuits)
  const subInPorts = (spec.subPorts || []).filter((p) => p.type === 'input');
  const subOutPorts = (spec.subPorts || []).filter((p) => p.type === 'output');

  // --- input ports ---------------------------------------------------------
  if (spec.subPorts) {
    subInPorts.forEach((p, i) => {
      const pn = subNames!.inputs[i];
      ports.push({ name: pn, dir: 'in', width: 1 });
      const target = compById.get(p.targetCompId);
      if (target && (target.type === 'switch' || target.type === 'pushbutton')) {
        if (target.outputs[0]) pinExpr.set(target.outputs[0].id, pn);
      } else {
        portBound.set(p.targetPinId, pn);
        if (pinIsOutput.get(p.targetPinId)) pinExpr.set(p.targetPinId, pn);
      }
    });
  }

  for (const c of comps) {
    if (!INPUT_TYPES.includes(c.type)) continue;
    if (c.type === 'vcc') {
      if (c.outputs[0]) pinExpr.set(c.outputs[0].id, L.one);
      continue;
    }
    if (c.type === 'gnd') {
      if (c.outputs[0]) pinExpr.set(c.outputs[0].id, L.zero);
      continue;
    }
    if (spec.subPorts && (c.type === 'switch' || c.type === 'pushbutton')) {
      // Inside an IC an unbound switch is a constant at its current position
      if (c.outputs[0] && !pinExpr.has(c.outputs[0].id)) pinExpr.set(c.outputs[0].id, c.state.on ? L.one : L.zero);
      continue;
    }
    const label = c.label || c.type;
    if (c.type === 'clock') {
      const pn = names.make(/clk|saat|clock/i.test(label) ? label : `clk_${label}`, 'clk');
      ports.push({ name: pn, dir: 'in', width: 1, source: { compId: c.id, type: c.type } });
      if (c.outputs[0]) pinExpr.set(c.outputs[0].id, pn);
    } else if (c.type === 'dipSwitch4') {
      const pn = names.make(`in_${label}`, 'in_dip');
      ports.push({ name: pn, dir: 'in', width: 4, source: { compId: c.id, type: c.type } });
      c.outputs.forEach((p, i) => pinExpr.set(p.id, vecIndex(pn, i)));
    } else if (c.type === 'asciiKeyboard') {
      const pd = names.make(`kbd_${label}_data`, 'kbd_data');
      const ps = names.make(`kbd_${label}_strobe`, 'kbd_strobe');
      ports.push(
        { name: pd, dir: 'in', width: 7, source: { compId: c.id, type: c.type, group: 'data' } },
        { name: ps, dir: 'in', width: 1, source: { compId: c.id, type: c.type, group: 'strobe' } }
      );
      c.outputs.slice(0, 7).forEach((p, i) => pinExpr.set(p.id, vecIndex(pd, i)));
      if (c.outputs[7]) pinExpr.set(c.outputs[7].id, ps);
    } else {
      const pn = names.make(`in_${label}`, 'in_sig');
      ports.push({ name: pn, dir: 'in', width: 1, source: { compId: c.id, type: c.type } });
      if (c.outputs[0]) pinExpr.set(c.outputs[0].id, pn);
    }
  }

  // --- internal signals for every block output pin ------------------------
  const internalComps = comps.filter(
    (c) => !INPUT_TYPES.includes(c.type) && !OUTPUT_TYPES.includes(c.type) && !PASSIVE_TYPES.includes(c.type)
  );
  const compNames = new Map<string, string>();
  // Short block prefix so pin suffixes (_q0, _cout ...) survive in the signal names
  for (const c of internalComps) compNames.set(c.id, baseIdentifier(c.label || c.type, c.type.toLowerCase()).slice(0, 24).replace(/_$/, ''));

  // Nets with several drivers share one signal (tri-state bus)
  const busSignal = new Map<string, string>();
  for (const c of internalComps) {
    for (const p of c.outputs) {
      if (pinExpr.has(p.id)) continue;
      const drivers = netDrivers(p.id);
      if (drivers.length > 1) {
        const key = drivers.slice().sort().join('|');
        if (!busSignal.has(key)) {
          const bn = names.make(`bus_${compNames.get(c.id)}_${p.name}`, 'bus');
          busSignal.set(key, bn);
          declare(bn);
          const allTri = drivers.every((d) => pinOwner.get(d)?.type === 'triState');
          if (!allTri) warnings.push(`${bn}: birden fazla sürücü var (çakışma); simülatör bu durumda 0 okur.`);
        }
        pinExpr.set(p.id, busSignal.get(key)!);
      } else {
        const sn = names.make(`${compNames.get(c.id)}_${p.name}`, 's');
        declare(sn);
        pinExpr.set(p.id, sn);
      }
    }
  }

  // Value seen by an input pin
  const inputExpr = (pinId: string | undefined, floating: string = L.zero): string => {
    if (!pinId) return floating;
    if (portBound.has(pinId)) return portBound.get(pinId)!;
    const drivers = netDrivers(pinId);
    if (drivers.length === 0) {
      // A net driven only by an IC input port bound to another of its pins
      const bound = (netOfPin.get(pinId) || []).find((id) => portBound.has(id));
      return bound ? portBound.get(bound)! : floating;
    }
    return pinExpr.get(drivers[0]) || floating;
  };

  const emit = (lhs: string, rhs: string) => {
    if (lang === 'vhdl' && rhs.includes('__MUX__')) {
      body.push(`  ${lhs} <= ${vhdlMux(rhs)};`);
    } else {
      body.push(L.assign(lhs, rhs));
    }
  };

  // --- component behaviour ------------------------------------------------
  for (const c of internalComps) {
    const nm = compNames.get(c.id)!;
    const out = c.outputs.map((p) => pinExpr.get(p.id)!);
    const inp = (i: number, floating?: string) => inputExpr(c.inputs[i]?.id, floating);
    const connectedIns = c.inputs.filter((p) => isConnected(p.id) || portBound.has(p.id)).map((p) => inputExpr(p.id));
    body.push(L.comment(`${c.label || c.type} (${c.type})`));

    switch (c.type) {
      case 'not':
        emit(out[0], L.not(inp(0)));
        break;
      case 'and':
      case 'or':
      case 'nand':
      case 'nor':
      case 'xor':
      case 'xnor': {
        if (connectedIns.length === 0) {
          emit(out[0], L.zero);
          break;
        }
        const base =
          c.type === 'and' || c.type === 'nand' ? L.and(connectedIns) : c.type === 'or' || c.type === 'nor' ? L.or(connectedIns) : L.xor(connectedIns);
        emit(out[0], c.type === 'nand' || c.type === 'nor' || c.type === 'xnor' ? L.not(base) : base);
        break;
      }
      case 'triState':
        emit(out[0], L.mux(inp(1), inp(0), L.hiZ));
        break;
      case 'splitter4':
        for (let i = 0; i < 4; i++) if (out[i]) emit(out[i], inp(i));
        break;
      case 'halfAdder':
        emit(out[0], L.xor([inp(0), inp(1)]));
        emit(out[1], L.and([inp(0), inp(1)]));
        break;
      case 'fullAdder': {
        const [a, b, ci] = [inp(0), inp(1), inp(2)];
        emit(out[0], L.xor([a, b, ci]));
        emit(out[1], L.or([L.and([a, b]), L.and([ci, L.xor([a, b])])]));
        break;
      }
      case 'halfSubtractor':
        emit(out[0], L.xor([inp(0), inp(1)]));
        emit(out[1], L.and([L.not(inp(0)), inp(1)]));
        break;
      case 'fullSubtractor': {
        const [a, b, bi] = [inp(0), inp(1), inp(2)];
        emit(out[0], L.xor([a, b, bi]));
        emit(out[1], L.or([L.and([L.not(a), b]), L.and([L.not(L.xor([a, b])), bi])]));
        break;
      }
      case 'mux2':
        emit(out[0], L.mux(inp(2), inp(1), inp(0)));
        break;
      case 'mux4':
        emit(out[0], L.mux(inp(5), L.mux(inp(4), inp(3), inp(2)), L.mux(inp(4), inp(1), inp(0))));
        break;
      case 'mux8': {
        const d = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => inp(i));
        const [s0, s1, s2] = [inp(8), inp(9), inp(10)];
        const m2 = (i: number) => L.mux(s0, d[i + 1], d[i]);
        const m4 = (i: number) => L.mux(s1, m2(i + 2), m2(i));
        const y = names.make(`${nm}_sel`, 'sel');
        declare(y);
        emit(y, L.mux(s2, m4(4), m4(0)));
        if (out[0]) emit(out[0], y);
        if (out[1]) emit(out[1], L.not(y));
        break;
      }
      case 'demux2':
        emit(out[0], L.and([inp(0), L.not(inp(1))]));
        emit(out[1], L.and([inp(0), inp(1)]));
        break;
      case 'demux4': {
        const [dd, s0, s1] = [inp(0), inp(1), inp(2)];
        for (let i = 0; i < 4; i++) {
          if (out[i]) emit(out[i], L.and([dd, i & 1 ? s0 : L.not(s0), i & 2 ? s1 : L.not(s1)]));
        }
        break;
      }
      case 'decoder2to4':
      case 'decoder3to8': {
        const bits = c.type === 'decoder2to4' ? 2 : 3;
        const en = inp(0, L.one); // unconnected enable = enabled
        for (let i = 0; i < 1 << bits; i++) {
          const lits = [en];
          for (let b = 0; b < bits; b++) lits.push(i & (1 << b) ? inp(1 + b) : L.not(inp(1 + b)));
          if (out[i]) emit(out[i], L.and(lits));
        }
        break;
      }
      case 'priorityEncoder4to2': {
        const [d0, d1, d2, d3] = [inp(0), inp(1), inp(2), inp(3)];
        if (out[0]) emit(out[0], L.or([d3, d2])); // Y1
        if (out[1]) emit(out[1], L.or([d3, L.and([L.not(d2), d1])])); // Y0
        if (out[2]) emit(out[2], L.or([d0, d1, d2, d3])); // V
        break;
      }
      case 'bcdTo7Seg':
      case 'rom16x4': {
        // Constant lookup tables as sum-of-minterms over the 4 address bits (bit 0 = LSB)
        const addr = [inp(0), inp(1), inp(2), inp(3)];
        const table: number[] =
          c.type === 'bcdTo7Seg'
            ? Array.from({ length: 16 }, (_, k) => {
                const m = HEX_7SEG_MAP[k];
                return (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).reduce((acc, s, i) => acc | ((m[s] ? 1 : 0) << i), 0);
              })
            : Array.isArray(c.state.romData) && c.state.romData.length === 16
              ? c.state.romData
              : [0, 1, 4, 9, 3, 7, 15, 12, 8, 5, 10, 2, 6, 11, 14, 13];
        const nOut = c.type === 'bcdTo7Seg' ? 7 : 4;
        for (let bit = 0; bit < nOut; bit++) {
          if (!out[bit]) continue;
          const terms: string[] = [];
          for (let k = 0; k < 16; k++) {
            if ((table[k] >> bit) & 1) terms.push(L.and(addr.map((a, i) => ((k >> i) & 1 ? a : L.not(a)))));
          }
          emit(out[bit], terms.length === 0 ? L.zero : terms.length === 16 ? L.one : L.or(terms));
        }
        break;
      }
      case 'comparator4': {
        const a = [inp(3), inp(2), inp(1), inp(0)];
        const b = [inp(7), inp(6), inp(5), inp(4)];
        if (lang === 'verilog') {
          const av = `{${a.join(', ')}}`;
          const bv = `{${b.join(', ')}}`;
          if (out[0]) emit(out[0], `${av} > ${bv}`);
          if (out[1]) emit(out[1], `${av} == ${bv}`);
          if (out[2]) emit(out[2], `${av} < ${bv}`);
        } else {
          const av = names.make(`${nm}_a`, 'a');
          const bv = names.make(`${nm}_b`, 'b');
          declare(av, 4);
          declare(bv, 4);
          body.push(`  ${av} <= ${a.join(' & ')};`, `  ${bv} <= ${b.join(' & ')};`);
          if (out[0]) body.push(`  ${out[0]} <= '1' when unsigned(${av}) > unsigned(${bv}) else '0';`);
          if (out[1]) body.push(`  ${out[1]} <= '1' when ${av} = ${bv} else '0';`);
          if (out[2]) body.push(`  ${out[2]} <= '1' when unsigned(${av}) < unsigned(${bv}) else '0';`);
        }
        break;
      }
      case 'alu4': {
        const a = [inp(3), inp(2), inp(1), inp(0)];
        const b = [inp(8), inp(7), inp(6), inp(5)];
        const cin = inp(4);
        const [s0, s1] = [inp(9), inp(10)];
        const r = names.make(`${nm}_result`, 'result');
        if (lang === 'verilog') {
          // 5-bit sum/difference: bit 4 is the carry, or NOT borrow for A - B - Cin (Cout = A >= B + Cin)
          declare(r, 5);
          const sum = names.make(`${nm}_sum`, 'sum');
          const diff = names.make(`${nm}_diff`, 'diff');
          declare(sum, 5);
          declare(diff, 5);
          const av = `{1'b0, ${a.join(', ')}}`;
          const bv = `{1'b0, ${b.join(', ')}}`;
          body.push(
            `  assign ${sum} = ${av} + ${bv} + ${cin};`,
            `  assign ${diff} = ${av} - ${bv} - ${cin};`,
            `  assign ${r} = ({${s1}, ${s0}} == 2'b00) ? ${sum} :`,
            `                ({${s1}, ${s0}} == 2'b01) ? {(${av} >= ${bv} + ${cin}), ${diff}[3:0]} :`,
            `                ({${s1}, ${s0}} == 2'b10) ? (${av} & ${bv}) : (${av} | ${bv});`
          );
          for (let i = 0; i < 4; i++) if (out[i]) emit(out[i], `${r}[${i}]`);
          if (out[4]) emit(out[4], `${r}[4]`);
          if (out[5]) emit(out[5], `${r}[3:0] == 4'b0000`);
        } else {
          declare(r, 5);
          const av = names.make(`${nm}_a`, 'a');
          const bv = names.make(`${nm}_b`, 'b');
          declare(av, 4);
          declare(bv, 4);
          body.push(
            `  ${av} <= ${a.join(' & ')};`,
            `  ${bv} <= ${b.join(' & ')};`,
            `  process (${[av, bv, cin, s0, s1].filter(isSignalName).join(', ')})`,
            `    variable va, vb, vc : unsigned(4 downto 0);`,
            `  begin`,
            `    va := unsigned('0' & ${av});`,
            `    vb := unsigned('0' & ${bv});`,
            `    if ${is1(cin)} then vc := to_unsigned(1, 5); else vc := to_unsigned(0, 5); end if;`,
            `    if ${is0(s1)} and ${is0(s0)} then`,
            `      ${r} <= std_logic_vector(va + vb + vc);`,
            `    elsif ${is0(s1)} and ${is1(s0)} then`,
            `      ${r}(3 downto 0) <= std_logic_vector(resize(va - vb - vc, 4));`,
            `      if va >= vb + vc then ${r}(4) <= '1'; else ${r}(4) <= '0'; end if;`,
            `    elsif ${is1(s1)} and ${is0(s0)} then`,
            `      ${r} <= '0' & (${av} and ${bv});`,
            `    else`,
            `      ${r} <= '0' & (${av} or ${bv});`,
            `    end if;`,
            `  end process;`
          );
          for (let i = 0; i < 4; i++) if (out[i]) body.push(`  ${out[i]} <= ${r}(${i});`);
          if (out[4]) body.push(`  ${out[4]} <= ${r}(4);`);
          if (out[5]) body.push(`  ${out[5]} <= '1' when ${r}(3 downto 0) = "0000" else '0';`);
        }
        break;
      }
      case 'dFlipFlop':
      case 'jkFlipFlop':
      case 'tFlipFlop': {
        const q = names.make(`${nm}_q_reg`, 'q_reg');
        declare(q, 1, '0');
        const clk = inp(1);
        const rst = c.type === 'tFlipFlop' ? inp(2) : L.zero;
        const next =
          c.type === 'dFlipFlop'
            ? inp(0)
            : c.type === 'tFlipFlop'
              ? L.xor([q, inp(0)])
              : // JK: Q+ = J·Q' + K'·Q
                L.or([L.and([inp(0), L.not(q)]), L.and([L.not(inp(2)), q])]);
        body.push(...seqBlock(lang, clk, rst, [[q, next]], [[q, L.zero]], L));
        if (out[0]) emit(out[0], q);
        if (out[1]) emit(out[1], L.not(q));
        break;
      }
      case 'srLatch': {
        const q = names.make(`${nm}_q_reg`, 'q_reg');
        declare(q, 1, '0');
        const [s, r] = [inp(0), inp(1)];
        if (lang === 'verilog') {
          body.push(
            `  always @(*) begin`,
            `    if (${s} && !${r}) ${q} = 1'b1;`,
            `    else if (!${s} && ${r}) ${q} = 1'b0;`,
            `  end`
          );
        } else if (![s, r].some(isSignalName)) {
          // Both inputs constant: the latch never changes from set / its initial 0 (no empty process, VHDL-93)
          body.push(`  ${q} <= ${s === L.one && r === L.zero ? "'1'" : "'0'"};`);
        } else {
          body.push(
            `  process (${[s, r].filter(isSignalName).join(', ')})`,
            `  begin`,
            `    if ${is1(s)} and ${is0(r)} then ${q} <= '1';`,
            `    elsif ${is0(s)} and ${is1(r)} then ${q} <= '0';`,
            `    end if;`,
            `  end process;`
          );
        }
        if (out[0]) emit(out[0], q);
        if (out[1]) emit(out[1], L.not(q));
        break;
      }
      case 'counter4':
      case 'register4':
      case 'shiftRegister4': {
        const r = names.make(`${nm}_q_reg`, 'q_reg');
        declare(r, 4, '0000');
        const bit = (i: number) => vecIndex(r, i);
        let clk: string;
        let rst: string;
        let updates: [string, string][];
        if (c.type === 'counter4') {
          clk = inp(0);
          rst = inp(1);
          updates = [[r, lang === 'verilog' ? `${r} + 4'd1` : `std_logic_vector(unsigned(${r}) + 1)`]];
        } else if (c.type === 'register4') {
          clk = inp(4);
          rst = inp(6);
          const we = inp(5, L.one); // unconnected write enable = enabled
          const d = lang === 'verilog' ? `{${inp(3)}, ${inp(2)}, ${inp(1)}, ${inp(0)}}` : `${inp(3)} & ${inp(2)} & ${inp(1)} & ${inp(0)}`;
          updates = [[r, lang === 'verilog' ? `${wrap(we)} ? ${d} : ${r}` : `__WE__(${we}|${d}|${r})`]];
        } else {
          clk = inp(0);
          rst = inp(1);
          const [sl, sr, s0, s1] = [inp(2), inp(3), inp(4), inp(5)];
          // 74HC194: mode 1 (S1S0=01) shifts right, SR enters Q0 and data moves toward Q3;
          // mode 2 (10) shifts left, SL enters Q3 and data moves toward Q0; else hold
          const right = lang === 'verilog' ? `{${bit(2)}, ${bit(1)}, ${bit(0)}, ${sr}}` : `${r}(2 downto 0) & ${sr}`;
          const left = lang === 'verilog' ? `{${sl}, ${bit(3)}, ${bit(2)}, ${bit(1)}}` : `${sl} & ${r}(3 downto 1)`;
          updates = [
            [
              r,
              lang === 'verilog'
                ? `({${s1}, ${s0}} == 2'b01) ? ${right} : ({${s1}, ${s0}} == 2'b10) ? ${left} : ${r}`
                : `__SHIFT__(${s1}|${s0}|${right}|${left}|${r})`,
            ],
          ];
        }
        body.push(...seqBlock(lang, clk, rst, updates, [[r, lang === 'verilog' ? "4'b0000" : '"0000"']], L));
        for (let i = 0; i < 4; i++) if (out[i]) emit(out[i], bit(i));
        break;
      }
      case 'ram16x4': {
        const mem = names.make(`${nm}_mem`, 'mem');
        const init = Array.isArray(c.state.ramData) && c.state.ramData.length === 16 ? c.state.ramData : Array.from({ length: 16 }, (_, i) => i);
        const [clk, we] = [inp(8), inp(9)];
        if (lang === 'verilog') {
          const addr = `{${inp(3)}, ${inp(2)}, ${inp(1)}, ${inp(0)}}`;
          const din = `{${inp(7)}, ${inp(6)}, ${inp(5)}, ${inp(4)}}`;
          extraDecls.push(`  reg [3:0] ${mem} [0:15];`, `  initial begin`, ...init.map((v, i) => `    ${mem}[${i}] = 4'd${v & 15};`), `  end`);
          if (isSignalName(clk)) {
            body.push(`  always @(posedge ${clk}) begin`, `    if (${we}) ${mem}[${addr}] <= ${din};`, `  end`);
          }
          const rd = names.make(`${nm}_rdata`, 'rdata');
          declare(rd, 4);
          body.push(`  assign ${rd} = ${mem}[${addr}];`);
          for (let i = 0; i < 4; i++) if (out[i]) emit(out[i], `${rd}[${i}]`);
        } else {
          const typ = names.make(`${nm}_mem_t`, 'mem_t');
          const addrSig = names.make(`${nm}_addr`, 'addr');
          declare(addrSig, 4);
          extraDecls.push(
            `  type ${typ} is array (0 to 15) of std_logic_vector(3 downto 0);`,
            `  signal ${mem} : ${typ} := (${init.map((v) => `"${(v & 15).toString(2).padStart(4, '0')}"`).join(', ')});`
          );
          body.push(`  ${addrSig} <= ${inp(3)} & ${inp(2)} & ${inp(1)} & ${inp(0)};`);
          if (isSignalName(clk)) {
            body.push(
              `  process (${clk})`,
              `  begin`,
              `    if rising_edge(${clk}) then`,
              `      if ${is1(we)} then ${mem}(to_integer(unsigned(${addrSig}))) <= ${inp(7)} & ${inp(6)} & ${inp(5)} & ${inp(4)}; end if;`,
              `    end if;`,
              `  end process;`
            );
          }
          const rd = names.make(`${nm}_rdata`, 'rdata');
          declare(rd, 4);
          body.push(`  ${rd} <= ${mem}(to_integer(unsigned(${addrSig})));`);
          for (let i = 0; i < 4; i++) if (out[i]) body.push(`  ${out[i]} <= ${rd}(${i});`);
        }
        break;
      }
      case 'subcircuit': {
        const subId = c.state.subcircuitId as string | undefined;
        const def = subId ? getSubcircuitDefinition(subId) : undefined;
        if (!def) {
          warnings.push(`${c.label || c.id}: alt devre tanımı bulunamadı, çıkışlar 0 kabul edildi.`);
          out.forEach((o) => o && emit(o, L.zero));
          break;
        }
        if (!subModules.has(def.id)) {
          subModules.set(def.id, { def, moduleName: moduleNames.make(def.chipCode || def.name, 'custom_ic') });
        }
        const sub = subModules.get(def.id)!;
        const portNames = subPortNames(def.ports);
        const maps = [
          ...c.inputs.map((p, i) => [portNames.inputs[i], inputExpr(p.id)] as const),
          ...c.outputs.map((_p, i) => [portNames.outputs[i], out[i]] as const),
        ].filter(([pn]) => !!pn);
        const inst = names.make(`u_${nm}`, 'u_ic');
        if (lang === 'verilog') {
          body.push(`  ${sub.moduleName} ${inst} (`, maps.map(([pn, sig]) => `    .${pn}(${sig})`).join(',\n'), `  );`);
        } else {
          body.push(`  ${inst} : entity work.${sub.moduleName}`, `    port map (`, maps.map(([pn, sig]) => `      ${pn} => ${sig}`).join(',\n'), `    );`);
        }
        break;
      }
      default:
        warnings.push(`${c.label || c.type}: '${c.type}' bileşeni HDL'e çevrilemiyor, çıkışları 0 bırakıldı.`);
        out.forEach((o) => o && emit(o, L.zero));
        break;
    }
  }

  // --- output ports ---------------------------------------------------------
  if (spec.subPorts) {
    subOutPorts.forEach((p, i) => {
      const pn = subNames!.outputs[i];
      ports.push({ name: pn, dir: 'out', width: 1 });
      const target = compById.get(p.targetCompId);
      const expr =
        target && OUTPUT_TYPES.includes(target.type)
          ? inputExpr(target.inputs[0]?.id)
          : pinIsOutput.get(p.targetPinId)
            ? pinExpr.get(p.targetPinId) || L.zero
            : inputExpr(p.targetPinId);
      emit(pn, expr);
    });
  } else {
    for (const c of comps) {
      if (!OUTPUT_TYPES.includes(c.type)) continue;
      const label = c.label || c.type;
      const groups: { suffix: string; pins: typeof c.inputs }[] =
        c.type === 'dotMatrix8x8'
          ? [
              { suffix: 'rows', pins: c.inputs.slice(0, 8) },
              { suffix: 'cols', pins: c.inputs.slice(8, 16) },
            ]
          : c.type === 'rgbMatrix16x16'
            ? [
                { suffix: 'x', pins: c.inputs.slice(0, 4) },
                { suffix: 'y', pins: c.inputs.slice(4, 8) },
                { suffix: 'rgb', pins: c.inputs.slice(8, 11) },
                { suffix: 'we', pins: c.inputs.slice(11, 12) },
              ]
            : c.type === 'buzzer'
              ? [
                  { suffix: 'en', pins: c.inputs.slice(0, 1) },
                  { suffix: 'note', pins: c.inputs.slice(1, 5) },
                ]
              : [{ suffix: '', pins: c.inputs }];
      for (const g of groups) {
        if (g.pins.length === 0) continue;
        const prefix = c.type === 'sevenSegment' ? 'out_seg' : c.type === 'hexDisplay' ? 'out_hex' : 'out';
        const pn = names.make(`${prefix}_${label}${g.suffix ? `_${g.suffix}` : ''}`, 'out_sig');
        const width = c.type === 'led' || c.type === 'probe' ? 1 : g.pins.length;
        ports.push({ name: pn, dir: 'out', width, source: { compId: c.id, type: c.type, group: g.suffix || undefined } });
        g.pins.slice(0, width).forEach((pin, i) => emit(width === 1 ? pn : vecIndex(pn, i), inputExpr(pin.id)));
      }
    }
  }

  return { name: spec.name, ports, signals, body, extraDecls, warnings };
}

// Port names of a custom IC module, shared by the module itself and every instance of it
function subPortNames(ports: CustomSubcircuit['ports']): { inputs: string[]; outputs: string[] } {
  const names = new NameTable();
  const inputs = ports.filter((p) => p.type === 'input').map((p, i) => names.make(p.name, `in_${i}`));
  const outputs = ports.filter((p) => p.type === 'output').map((p, i) => names.make(p.name, `out_${i}`));
  return { inputs, outputs };
}

function isSignalName(e: string): boolean {
  return /^[a-z][a-z0-9_]*(\[\d+\]|\(\d+\))?$/.test(e);
}

// Clocked process/always block with asynchronous active-high reset (as the simulator: reset wins)
function seqBlock(
  lang: Lang,
  clk: string,
  rst: string,
  updates: [string, string][],
  resets: [string, string][],
  L: LangOps
): string[] {
  const hasClk = isSignalName(clk);
  const hasRst = rst !== L.zero && rst !== L.one;
  const lines: string[] = [];
  if (rst === L.one) {
    // Reset tied high: the register is held cleared
    if (lang === 'verilog') lines.push(...resets.map(([r, v]) => `  always @(*) ${r} = ${v};`));
    else lines.push(...resets.map(([r, v]) => `  ${r} <= ${v};`));
    return lines;
  }
  if (!hasClk) {
    lines.push(L.comment(`saat girişi bağlı değil (${clk}); kayıtçı başlangıç değerinde kalır`));
    return lines;
  }
  if (lang === 'verilog') {
    lines.push(`  always @(posedge ${clk}${hasRst ? ` or posedge ${rst}` : ''}) begin`);
    if (hasRst) {
      lines.push(`    if (${rst}) begin`, ...resets.map(([r, v]) => `      ${r} <= ${v};`), `    end else begin`);
      lines.push(...updates.map(([r, v]) => `      ${r} <= ${v};`), `    end`);
    } else {
      lines.push(...updates.map(([r, v]) => `    ${r} <= ${v};`));
    }
    lines.push('  end');
  } else {
    const vhdlValue = (v: string) =>
      v.includes('__WE__') ? vhdlWe(v) : v.includes('__SHIFT__') ? vhdlShift(v) : v.includes('__MUX__') ? vhdlMuxSeq(v) : `@${v};`;
    lines.push(`  process (${clk}${hasRst && isSignalName(rst) ? `, ${rst}` : ''})`, `  begin`);
    if (hasRst) {
      lines.push(`    if ${is1(rst)} then`, ...resets.map(([r, v]) => `      ${r} <= ${v};`), `    elsif rising_edge(${clk}) then`);
    } else {
      lines.push(`    if rising_edge(${clk}) then`);
    }
    for (const [r, v] of updates) lines.push(...vhdlValue(v).split('\n').map((l) => `      ${l.replace(/^(\s*)@/, `$1${r} <= `)}`));
    lines.push('    end if;', '  end process;');
  }
  return lines;
}

// ---- VHDL expression helpers (VHDL-93 has no ?: operator) -----------------
function splitArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '|' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function extractCall(expr: string, tag: string): { before: string; args: string[]; after: string } | null {
  const at = expr.indexOf(`${tag}(`);
  if (at < 0) return null;
  let depth = 0;
  for (let i = at + tag.length; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    if (expr[i] === ')') {
      depth--;
      if (depth === 0) return { before: expr.slice(0, at), args: splitArgs(expr.slice(at + tag.length + 1, i)), after: expr.slice(i + 1) };
    }
  }
  return null;
}

// Concurrent "x <= a when sel = '1' else b" chain; nested muxes go into the else branch or are flattened
function vhdlMux(expr: string): string {
  const call = extractCall(expr, '__MUX__');
  if (!call) return expr;
  const [sel, a, b] = call.args.map((x) => x.trim());
  if (call.before.trim() || call.after.trim()) {
    // mux used inside a larger expression: rewrite as and/or form
    return vhdlMux(`${call.before}((${vhdlMuxInline(sel)} and ${vhdlMuxInline(a)}) or (not ${vhdlMuxInline(sel)} and ${vhdlMuxInline(b)}))${call.after}`);
  }
  if (sel === "'1'") return vhdlMux(a);
  if (sel === "'0'") return vhdlMux(b);
  if (b === "'Z'") return `${vhdlMuxInline(a)} when ${is1(vhdlMuxInline(sel))} else 'Z'`;
  return `${vhdlMuxInline(a)} when ${is1(vhdlMuxInline(sel))} else ${vhdlMux(b)}`;
}

function vhdlMuxInline(expr: string): string {
  let e = expr;
  for (let call = extractCall(e, '__MUX__'); call; call = extractCall(e, '__MUX__')) {
    const [sel, a, b] = call.args.map((x) => vhdlMuxInline(x.trim()));
    e = `${call.before}((${wrap(sel)} and ${wrap(a)}) or (not ${wrap(sel)} and ${wrap(b)}))${call.after}`;
  }
  return e;
}

function vhdlMuxSeq(v: string): string {
  return `@${vhdlMuxInline(v)};`;
}

function vhdlWe(v: string): string {
  const call = extractCall(v, '__WE__')!;
  const [we, d] = call.args.map((x) => x.trim());
  return `if ${is1(we)} then\n  @${d};\nend if;`;
}

function vhdlShift(v: string): string {
  const call = extractCall(v, '__SHIFT__')!;
  const [s1, s0, right, left] = call.args.map((x) => x.trim());
  return `if ${is0(s1)} and ${is1(s0)} then\n  @${right};\nelsif ${is1(s1)} and ${is0(s0)} then\n  @${left};\nend if;`;
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------
function header(lang: Lang, title: string, standard: string): string {
  const c = lang === 'verilog' ? '//' : '--';
  return [
    `${c} =============================================================================`,
    `${c} Generated by LogicDesign Studio HDL Synthesis Engine`,
    `${c} Project: Sıfırdan İşlemciye (From Zero to CPU)`,
    `${c} ${lang === 'verilog' ? 'Module' : 'Entity'}: ${title}`,
    `${c} Date: ${new Date().toISOString()}`,
    `${c} Standard: ${standard}`,
    `${c} =============================================================================`,
  ].join('\n');
}

function renderVerilog(m: BuiltModule): string {
  const portLines = m.ports.map(
    (p) => `  ${p.dir === 'in' ? 'input' : 'output'} wire ${p.width > 1 ? `[${p.width - 1}:0] ` : ''}${p.name}`
  );
  const sigLines = m.signals.map((s) => {
    const reg = s.init !== undefined;
    const width = s.width > 1 ? `[${s.width - 1}:0] ` : '';
    const init = reg && s.init !== undefined ? ` = ${s.width}'b${s.init}` : '';
    return `  ${reg ? 'reg' : 'wire'} ${width}${s.name}${init};`;
  });
  return [
    `module ${m.name} (`,
    portLines.length > 0 ? portLines.join(',\n') : '  // Devrede harici I/O portu yok',
    ');',
    '',
    ...(m.warnings.length ? [...m.warnings.map((w) => `  // UYARI: ${w}`), ''] : []),
    ...(sigLines.length ? ['  // Dahili sinyaller', ...sigLines, ''] : []),
    ...(m.extraDecls.length ? [...m.extraDecls, ''] : []),
    ...m.body,
    '',
    'endmodule',
  ].join('\n');
}

function renderVHDL(m: BuiltModule): string {
  const portLines = m.ports.map(
    (p) => `    ${p.name} : ${p.dir} ${p.width > 1 ? `std_logic_vector(${p.width - 1} downto 0)` : 'std_logic'}`
  );
  const sigLines = m.signals.map((s) => {
    const type = s.width > 1 ? `std_logic_vector(${s.width - 1} downto 0)` : 'std_logic';
    const init = s.init !== undefined ? (s.width > 1 ? ` := "${s.init}"` : ` := '${s.init}'`) : '';
    return `  signal ${s.name} : ${type}${init};`;
  });
  return [
    'library IEEE;',
    'use IEEE.STD_LOGIC_1164.ALL;',
    'use IEEE.NUMERIC_STD.ALL;',
    '',
    `entity ${m.name} is`,
    ...(portLines.length ? ['  port (', portLines.join(';\n'), '  );'] : []),
    `end entity ${m.name};`,
    '',
    `architecture Behavioral of ${m.name} is`,
    ...m.warnings.map((w) => `  -- UYARI: ${w}`),
    ...sigLines,
    ...m.extraDecls,
    'begin',
    ...m.body,
    'end architecture Behavioral;',
  ].join('\n');
}

function generate(lang: Lang, circuitName: string, components: CircuitComponentInstance[], wires: CircuitWire[]): string {
  const moduleNames = new NameTable();
  const topName = moduleNames.make(circuitName || 'digital_circuit', 'digital_circuit');
  const subModules = new Map<string, { def: CustomSubcircuit; moduleName: string }>();
  const top = buildModule({ name: topName, components, wires }, lang, subModules, moduleNames);

  // Sub-modules (custom ICs may themselves contain ICs: keep going until no new ones appear)
  const rendered: BuiltModule[] = [];
  const done = new Set<string>();
  for (let progress = true; progress; ) {
    progress = false;
    for (const [id, sub] of Array.from(subModules.entries())) {
      if (done.has(id)) continue;
      done.add(id);
      progress = true;
      rendered.push(
        buildModule({ name: sub.moduleName, components: sub.def.components, wires: sub.def.wires, subPorts: sub.def.ports }, lang, subModules, moduleNames)
      );
    }
  }

  const render = lang === 'verilog' ? renderVerilog : renderVHDL;
  const std = lang === 'verilog' ? 'IEEE 1364-2001 (Verilog HDL)' : 'IEEE 1076-2008 (VHDL)';
  const parts = [header(lang, topName, std), ''];
  if (lang === 'verilog') parts.push('`timescale 1ns / 1ps', '');
  for (const m of rendered.reverse()) parts.push(render(m), '');
  parts.push(render(top), '');
  return parts.join('\n');
}

// Top-level port list exactly as generateVerilog / generateVHDL name it
export function getTopLevelPorts(circuitName: string, components: CircuitComponentInstance[], canvasWires: CircuitWire[]): PortDecl[] {
  const moduleNames = new NameTable();
  const topName = moduleNames.make(circuitName || 'digital_circuit', 'digital_circuit');
  return buildModule({ name: topName, components, wires: canvasWires }, 'verilog', new Map(), moduleNames).ports;
}

export function generateVerilog(circuitName: string, components: CircuitComponentInstance[], canvasWires: CircuitWire[]): string {
  return generate('verilog', circuitName, components, canvasWires);
}

export function generateVHDL(circuitName: string, components: CircuitComponentInstance[], canvasWires: CircuitWire[]): string {
  return generate('vhdl', circuitName, components, canvasWires);
}
