// ghdl --synth: VHDL -> Verilog, and its messages mapped to lines of the user's text.
//
// The arguments stay inside the native tool policy (electron/toolPolicy.cjs): --synth, allowlisted options,
// a relative source file and "-e" with no unit, so ghdl picks the top entity itself.
import type { HdlDiagnostic, HdlToolRun } from '../types';
import { genericArgs, type GenericSetting } from './generics';

export const VHDL_FILE = 'design.vhd';

/**
 * VHDL-2008 with the Synopsys packages (std_logic_unsigned & co., common in course material).
 * No --latches: ghdl 6.0's Verilog writer turns a latch into "always @(g) q <= d;", which yosys reads as a
 * plain wire, so an inferred latch stays a ghdl error instead of becoming a wrong circuit.
 */
export function ghdlSynthArgs(generics: GenericSetting[]): string[] {
  return ['--synth', '--std=08', '-fsynopsys', '--out=verilog', ...genericArgs(generics), VHDL_FILE, '-e'];
}

/**
 * Reads ghdl's messages. Located ones look like "design.vhd:12:5:error: text" (followed by the source line
 * and a caret, which are skipped); others like "C:\...\ghdl.exe:error: text" or "*command line*:1:1:error:".
 */
export function parseGhdlMessages(output: string): HdlDiagnostic[] {
  const out: HdlDiagnostic[] = [];
  const located = new RegExp(String.raw`^(.*?):(\d+):(\d+):\s*(?:(error|warning|note):)?\s*(.*)$`);
  const general = /^(?:.*?ghdl(?:\.exe)?|\*command line\*(?::\d+:\d+)?):\s*(error|warning|note):\s*(.*)$/i;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === '') continue;
    const g = general.exec(line);
    if (g) {
      out.push({ severity: g[1].toLowerCase() as HdlDiagnostic['severity'], source: 'ghdl', message: g[2] });
      continue;
    }
    const m = located.exec(line);
    if (m && m[1].endsWith(VHDL_FILE)) {
      out.push({ severity: (m[4] ?? 'error') as HdlDiagnostic['severity'], source: 'ghdl', message: m[5], line: Number(m[2]), column: Number(m[3]) });
    }
  }
  return out;
}

export type GhdlResult = { ok: true; verilog: string; diagnostics: HdlDiagnostic[] } | { ok: false; diagnostics: HdlDiagnostic[] };

export async function vhdlToVerilog(run: HdlToolRun, source: string, generics: GenericSetting[], signal?: AbortSignal): Promise<GhdlResult> {
  const result = await run({ tool: 'ghdl', args: ghdlSynthArgs(generics), files: { [VHDL_FILE]: source }, signal });
  const diagnostics = parseGhdlMessages(result.stderr);
  if (result.exitCode !== 0 || !/\bmodule\b/.test(result.stdout)) {
    if (!diagnostics.some((d) => d.severity === 'error')) {
      diagnostics.push({ severity: 'error', source: 'ghdl', message: `ghdl stopped (exit code ${result.exitCode})` });
    }
    return { ok: false, diagnostics };
  }
  return { ok: true, verilog: result.stdout, diagnostics };
}
