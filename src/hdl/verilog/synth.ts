// Verilog synthesis (Aşama 6c): Verilog / SystemVerilog text -> yosys (BLIF) -> StoredNetlist.
// No translation step: yosys reads the user's text itself, so its messages point at the user's lines.
//
// The module reader (module.ts) runs first: it picks the top module, checks the parameter settings (so a
// wrong name gives a translated message instead of yosys' defparam error) and gives the port order and widths.
// Tool problems that are not about the design (tool missing, cancelled, timeout) are thrown as ToolError.
import { storeNetlist } from '../stored';
import { HdlError, type HdlDiagnostic, type HdlToolRun, type StoredNetlist } from '../types';
import type { VerilogModuleHeader } from '../verilogHeader';
import { isPlainModuleName, verilogToBlif } from '../yosysBlif';
import { topVerilogModule, type VerilogModule } from './module';
import { checkParamSettings, chparamCommand, paramValues, type ParamSetting } from './params';

export type VerilogSynthResult =
  | { ok: true; netlist: StoredNetlist; diagnostics: HdlDiagnostic[] }
  | { ok: false; stage: 'read' | 'yosys' | 'netlist'; diagnostics: HdlDiagnostic[]; error?: HdlError };

export interface VerilogSynthOptions {
  parameters?: ParamSetting[];
  signal?: AbortSignal;
}

/** The header storeNetlist needs, from the module reader's view of the top module */
export const moduleHeader = (m: VerilogModule): VerilogModuleHeader => ({
  name: m.name,
  ports: m.ports.map((p) => ({ name: p.name, direction: p.direction, width: p.width })),
});

const lds = (message: string, line?: number): HdlDiagnostic => ({ severity: 'error', source: 'lds', message, ...(line === undefined ? {} : { line }) });

export async function synthesizeVerilog(run: HdlToolRun, source: string, options: VerilogSynthOptions = {}): Promise<VerilogSynthResult> {
  const parameters = options.parameters ?? [];
  let top: VerilogModule;
  try {
    top = topVerilogModule(source, paramValues(parameters));
    checkParamSettings(top, parameters);
    if (!isPlainModuleName(top.name)) throw new HdlError('verilogTopName', `the module name ${top.name} cannot be passed to yosys`, { module: top.name }, top.line);
  } catch (e) {
    if (!(e instanceof HdlError)) throw e;
    return { ok: false, stage: 'read', diagnostics: [lds(e.message, e.line)], error: e };
  }

  const yosys = await verilogToBlif(run, source, top.name, {
    sv: true,
    prepare: chparamCommand(parameters, top.name),
    userSource: true,
    signal: options.signal,
  });
  const diagnostics = [...yosys.diagnostics];
  if (!yosys.ok) return { ok: false, stage: 'yosys', diagnostics };

  try {
    return { ok: true, netlist: storeNetlist(yosys.blif, moduleHeader(top)), diagnostics };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, stage: 'netlist', diagnostics: [...diagnostics, lds(message)], error: e instanceof HdlError ? e : undefined };
  }
}
