// VHDL synthesis (Aşama 6b): VHDL text -> ghdl --synth (Verilog) -> yosys (BLIF) -> StoredNetlist.
//
// Runs only when the user asks (or the part decides to), never per simulation step. Tool problems that are
// not about the design (tool missing, cancelled, timeout) are thrown as ToolError for the caller to show.
import { storeNetlist } from '../stored';
import { HdlError, type HdlDiagnostic, type HdlToolRun, type StoredNetlist } from '../types';
import { parseVerilogHeaders } from '../verilogHeader';
import { verilogToBlif } from '../yosysBlif';
import type { GenericSetting } from './generics';
import { vhdlToVerilog } from './ghdl';

export type VhdlSynthResult =
  | { ok: true; netlist: StoredNetlist; diagnostics: HdlDiagnostic[] }
  | { ok: false; stage: 'ghdl' | 'yosys' | 'netlist'; diagnostics: HdlDiagnostic[] };

export interface VhdlSynthOptions {
  generics?: GenericSetting[];
  signal?: AbortSignal;
}

/** ghdl's "top entity is "name"" note, or undefined */
function topFromNotes(diagnostics: HdlDiagnostic[]): string | undefined {
  for (const d of diagnostics) {
    const m = /^top entity is "(.*)"$/.exec(d.message);
    if (m) return m[1];
  }
  return undefined;
}

const fail = (stage: 'ghdl' | 'yosys' | 'netlist', diagnostics: HdlDiagnostic[], message: string): VhdlSynthResult => ({
  ok: false,
  stage,
  diagnostics: [...diagnostics, { severity: 'error', source: 'lds', message }],
});

export async function synthesizeVhdl(run: HdlToolRun, source: string, options: VhdlSynthOptions = {}): Promise<VhdlSynthResult> {
  const ghdl = await vhdlToVerilog(run, source, options.generics ?? [], options.signal);
  // the top entity's note is bookkeeping, not a message for the user
  const topNote = topFromNotes(ghdl.diagnostics);
  const diagnostics = ghdl.diagnostics.filter((d) => !/^top entity is "/.test(d.message));
  if (!ghdl.ok) return { ok: false, stage: 'ghdl', diagnostics };

  let headers;
  try {
    headers = parseVerilogHeaders(ghdl.verilog);
  } catch (e) {
    return fail('netlist', diagnostics, e instanceof Error ? e.message : String(e));
  }
  if (headers.length === 0) return fail('netlist', diagnostics, 'ghdl wrote no module');
  // ghdl writes the modules a design instantiates before the design itself
  const header = (topNote && headers.find((h) => h.name.toLowerCase() === topNote.toLowerCase())) || headers[headers.length - 1];

  const yosys = await verilogToBlif(run, ghdl.verilog, header.name, options.signal);
  diagnostics.push(...yosys.diagnostics);
  if (!yosys.ok) return { ok: false, stage: 'yosys', diagnostics };

  try {
    return { ok: true, netlist: storeNetlist(yosys.blif, header), diagnostics };
  } catch (e) {
    const message = e instanceof HdlError || e instanceof Error ? e.message : String(e);
    return fail('netlist', diagnostics, message);
  }
}
