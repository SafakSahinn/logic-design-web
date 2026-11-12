import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import { simulateCircuit } from './circuitEngine';
import { getTopLevelPorts, getTopModuleName, type PortDecl } from './hdlGenerator';
import { cellText, circuitHasState, parseTestVector, type TvRow, type TvSignal } from './testVectorRunner';

/*
 * HDL testbenches from test vectors (Aşama 3i). The testbench instantiates the module that generateVerilog /
 * generateVHDL write for the same circuit and runs the test vector the way the in-app runner and
 * Logisim-evolution do (testVectorRunner):
 *
 * - every step: on a step that continues a sequence every clock toggles first and the circuit settles, then the
 *   step's inputs are applied, the circuit settles again and the output and clock columns are checked;
 * - a reset (new <set>, or a combinational row) puts the circuit back in its power-up state. HDL cannot reset a
 *   module that has no reset port, so a circuit with memory gets a fresh instance of the module per reset (its
 *   own stimulus signals; the others stay untouched). Up to MAX_INSTANCES; beyond that one instance runs all
 *   steps and the state is not reset between them (noted in the file). A circuit without memory needs only
 *   the inputs and clocks put back.
 *
 * The power-up state is the generated HDL's: memory parts at 0, RAM / ROM at their contents, inputs that have
 * no column at their canvas values, clocks at 0, which is the runner's reset state too.
 */

export const MAX_INSTANCES = 128;
const STEP_NS = 10;

type Bit = 0 | 1 | 'X' | 'Z';

export interface TestbenchOutput {
  /** The testbench source (empty when the vector could not be read) */
  code: string;
  /** Name of the testbench module / entity */
  name: string;
  errors: string[];
  notes: string[];
}

interface TbPlan {
  top: string;
  name: string;
  ports: PortDecl[];
  columns: TvSignal[];
  rows: TvRow[];
  /** Rows of each module instance, in order */
  groups: number[][];
  /** Power-up value of every input port (LSB first) */
  held: Map<string, (0 | 1)[]>;
  /** Port names that are clocks */
  clocks: string[];
  /** Is a row a reset (start of a sequence / combinational row)? */
  resets: boolean[];
  /** One instance runs everything although the circuit has memory */
  merged: boolean;
  notes: string[];
}

function plan(
  circuitName: string,
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  text: string
): { plan?: TbPlan; errors: string[] } {
  const tv = parseTestVector(components, wires, text);
  if (tv.errors.length > 0) return { errors: tv.errors };
  const bad = tv.rows.flatMap((r) => [
    ...r.errors.map((e) => `Satır ${r.line}: ${e}`),
    ...r.cells.flatMap((c) => (c.kind === 'bad' ? [`Satır ${r.line}: ${c.msg}`] : [])),
  ]);
  if (bad.length > 0) return { errors: bad };
  if (tv.rows.length === 0) return { errors: ['Test vektöründe satır yok.'] };

  const top = getTopModuleName(circuitName);
  const ports = getTopLevelPorts(circuitName, components, wires);
  const notes: string[] = [];

  // Power-up input values: the canvas values (settled), clocks 0
  const canvas = simulateCircuit(components.map((c) => ({ ...c, inputs: c.inputs.map((p) => ({ ...p })), outputs: c.outputs.map((p) => ({ ...p })), state: { ...c.state } })), wires).components;
  const held = new Map<string, (0 | 1)[]>();
  const clocks: string[] = [];
  for (const p of ports) {
    if (p.dir !== 'in') continue;
    if (p.source?.type === 'clock') {
      clocks.push(p.name);
      held.set(p.name, [0]);
      continue;
    }
    const comp = canvas.find((c) => c.id === p.source?.compId);
    const pins = p.source?.pins ?? [];
    const pinOf = (id: string) => comp?.outputs.find((q) => q.id === id) ?? comp?.inputs.find((q) => q.id === id);
    let bits: (0 | 1)[];
    if (pins.length === 1 && p.width > 1) {
      const q = pinOf(pins[0]);
      bits = Array.from({ length: p.width }, (_, k) => (q?.bits?.[k] === 1 ? 1 : 0));
    } else bits = Array.from({ length: p.width }, (_, k) => (pins[k] && pinOf(pins[k])?.value === 1 ? 1 : 0));
    held.set(p.name, bits);
  }

  // Resets and module instances
  const resets: boolean[] = [];
  let curSet = -1;
  let curSeq = 0;
  for (const r of tv.rows) {
    resets.push(r.seq === 0 || curSeq === 0 || r.set !== curSet);
    curSet = r.set;
    curSeq = r.seq;
  }
  const stateful = circuitHasState(components.filter((c) => c.type !== 'clock'));
  let groups: number[][] = [];
  if (stateful) {
    tv.rows.forEach((_, i) => {
      if (resets[i] || groups.length === 0) groups.push([]);
      groups[groups.length - 1].push(i);
    });
  } else groups = [tv.rows.map((_, i) => i)];
  let merged = false;
  if (groups.length > MAX_INSTANCES) {
    merged = true;
    groups = [tv.rows.map((_, i) => i)];
    notes.push(
      `Devrede bellek var ve test ${resets.filter(Boolean).length} kez sıfırlanıyor; ${MAX_INSTANCES} örnekten fazlası yerine tek modül örneği kullanıldı, sıfırlamalar arasında durum korunur (uygulama içi koşturucudan farklı olabilir).`
    );
  }
  const drivesUnknown = tv.rows.some((r) =>
    r.cells.some((c, i) => tv.columns[i].role === 'in' && (c.kind === 'float' || (c.kind === 'val' && c.bits.some((b) => b !== 0 && b !== 1))))
  );
  if (drivesUnknown) {
    notes.push("Bazı girişler x ya da <float> ile sürülüyor: HDL'de E (kısa devre) değeri yok, simülatörün E verdiği yerde HDL x verir; bu satırların sonucu farklı olabilir.");
  }
  if (components.some((c) => c.type === 'asciiKeyboard')) {
    notes.push("ASCII klavye HDL'de giriş portudur (veri ve strobe tuvaldeki değerinde tutulur); klavyenin CLR ile strobe'u temizlemesi modellenmez.");
  }
  if (components.some((c) => c.type === 'random' && !(c.state.randomSeed ?? 0))) {
    notes.push('Tohumu 0 olan rastgele sayı üreteci simülatörde her açılışta farklı başlar; beklenen değerleri tutmayabilir.');
  }
  const name = `${top}_tb`;
  return { plan: { top, name, ports, columns: tv.columns, rows: tv.rows, groups, held, clocks, resets, merged, notes }, errors: [] };
}

const msbText = (bits: Bit[]) =>
  bits
    .slice()
    .reverse()
    .map((b) => (b === 0 || b === 1 ? String(b) : b === 'Z' ? 'z' : 'x'))
    .join('');

// ---------------------------------------------------------------------------------------------------------
// Verilog

const vLit = (bits: Bit[]) => `${bits.length}'b${msbText(bits)}`;

/** A Verilog-2001 testbench for the module generateVerilog writes for this circuit */
export function generateVerilogTestbench(
  circuitName: string,
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  vectorText: string
): TestbenchOutput {
  const { plan: P, errors } = plan(circuitName, components, wires, vectorText);
  if (!P) return { code: '', name: '', errors, notes: [] };
  const L: string[] = [];
  const sig = (g: number, port: string) => `g${g}_${port}`;
  const decl = (w: number) => (w > 1 ? `[${w - 1}:0] ` : '');

  L.push('// =============================================================================');
  L.push('// Generated by LogicDesign Studio: test vector testbench');
  L.push(`// Testbench of module ${P.top} (simulate together with the generated design file)`);
  L.push(`// Date: ${new Date().toISOString()}`);
  L.push('// Standard: IEEE 1364-2001 (Verilog HDL)');
  L.push('// =============================================================================');
  L.push('// Her adım: sıralı bir testin devamıysa önce tüm saatler terslenir ve devre oturur, sonra adımın');
  L.push('// girişleri verilir, devre yine oturur ve çıkış / saat sütunları denetlenir. Sıfırlama (yeni <set> ya da');
  L.push(P.groups.length > 1 ? '// kombinasyonel satır) yeni bir modül örneğiyle yapılır: her örnek açılış durumundan başlar.' : '// kombinasyonel satır) girişleri ve saatleri açılış değerine döndürür.');
  for (const n of P.notes) L.push(`// NOT: ${n}`);
  L.push('`timescale 1ns / 1ps');
  L.push('');
  L.push(`module ${P.name};`);
  L.push('  integer n_pass, n_fail;');
  L.push('  reg row_ok;');
  L.push('');
  // Every bit of a value unknown or floating (expected <float>)
  L.push('  function all_unknown;');
  L.push('    input [31:0] v;');
  L.push('    input integer w;');
  L.push('    integer k;');
  L.push('    begin');
  L.push('      all_unknown = 1\'b1;');
  L.push("      for (k = 0; k < w; k = k + 1) if (v[k] === 1'b0 || v[k] === 1'b1) all_unknown = 1'b0;");
  L.push('    end');
  L.push('  endfunction');
  L.push('');

  P.groups.forEach((_, g) => {
    L.push(`  // Modül örneği ${g}`);
    for (const p of P.ports) {
      if (p.dir === 'in') L.push(`  reg ${decl(p.width)}${sig(g, p.name)} = ${vLit(P.held.get(p.name)!)};`);
      else L.push(`  wire ${decl(p.width)}${sig(g, p.name)};`);
    }
    L.push(`  ${P.top} dut${g} (`);
    L.push(P.ports.map((p) => `    .${p.name}(${sig(g, p.name)})`).join(',\n'));
    L.push('  );');
    L.push('');
  });

  L.push('  initial begin');
  L.push('    n_pass = 0;');
  L.push('    n_fail = 0;');
  L.push(`    #${STEP_NS}; // açılış: devre oturur (t = 0'daki x -> 0/1 geçişleri kenar sayılmaz)`);
  P.groups.forEach((rows, g) => {
    rows.forEach((ri, k) => {
      const row = P.rows[ri];
      L.push(`    // satır ${row.line}${row.set ? ` (set ${row.set}, seq ${row.seq})` : ''}`);
      if (P.resets[ri] && k > 0) {
        // Same instance (no memory, or merged): inputs and clocks back to their power-up values
        for (const p of P.ports) if (p.dir === 'in') L.push(`    ${sig(g, p.name)} = ${vLit(P.held.get(p.name)!)};`);
        L.push(`    #${STEP_NS};`);
      } else if (!P.resets[ri]) {
        for (const c of P.clocks) L.push(`    ${sig(g, c)} = ~${sig(g, c)};`);
        L.push(`    #${STEP_NS};`);
      }
      P.columns.forEach((col, i) => {
        if (col.role !== 'in') return;
        const cell = row.cells[i];
        if (cell.kind === 'val') L.push(`    ${sig(g, col.name)} = ${vLit(cell.bits)};`);
        else if (cell.kind === 'float') L.push(`    ${sig(g, col.name)} = ${col.width}'b${'z'.repeat(col.width)};`);
      });
      L.push(`    #${STEP_NS};`);
      L.push("    row_ok = 1'b1;");
      P.columns.forEach((col, i) => {
        if (col.role === 'in') return;
        const cell = row.cells[i];
        const s = sig(g, col.name);
        const show = `$display("HATA satır %0d: ${col.name} = %b, beklenen ${cellText(cell, col.width)}", ${row.line}, ${s});`;
        if (cell.kind === 'float') L.push(`    if (!all_unknown(${s}, ${col.width})) begin ${show} row_ok = 1'b0; end`);
        else if (cell.kind === 'val') {
          const mask = cell.bits.map((b): Bit => (b === 'X' ? 0 : 1));
          const exp = cell.bits.map((b): Bit => (b === 1 ? 1 : 0));
          const cond = mask.every((b) => b === 1) ? `${s} !== ${vLit(exp)}` : `(${s} & ${vLit(mask)}) !== ${vLit(exp)}`;
          if (mask.some((b) => b === 1)) L.push(`    if (${cond}) begin ${show} row_ok = 1'b0; end`);
        }
      });
      L.push('    if (row_ok) n_pass = n_pass + 1; else n_fail = n_fail + 1;');
    });
  });
  L.push('    $display("Geçen: %0d, Hatalı: %0d", n_pass, n_fail);');
  L.push('    $finish;');
  L.push('  end');
  L.push('endmodule');
  return { code: L.join('\n') + '\n', name: P.name, errors: [], notes: P.notes };
}

