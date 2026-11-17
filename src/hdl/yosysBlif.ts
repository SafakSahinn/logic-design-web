// Verilog -> BLIF with yosys: the common back half of the VHDL (6b) and Verilog (6c) synthesis.
//
// The script stays inside the native tool policy (electron/toolPolicy.cjs): allowlisted commands only, no
// quotes, backslashes or "#", relative file names.
import type { HdlDiagnostic, HdlToolRun } from './types';

export const YOSYS_VERILOG_FILE = 'design.v';
export const YOSYS_BLIF_FILE = 'design.blif';

/** The yosys script; `top` must be a plain identifier (it is checked by the caller) */
export function yosysScript(top: string): string {
  return `read_verilog ${YOSYS_VERILOG_FILE}; synth -flatten -top ${top}; write_blif -icells ${YOSYS_BLIF_FILE}`;
}

/** A name yosys can take as a bare script token */
export const isPlainModuleName = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name);

/** yosys messages worth showing: errors and warnings (it prints them whatever -q says) */
export function parseYosysMessages(output: string): HdlDiagnostic[] {
  const out: HdlDiagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(?:[^:]*:\d+:\s*)?(ERROR|Warning):\s*(.*)$/.exec(line);
    if (m) out.push({ severity: m[1] === 'ERROR' ? 'error' : 'warning', source: 'yosys', message: m[2] });
  }
  return out;
}

export type YosysBlifResult = { ok: true; blif: string; diagnostics: HdlDiagnostic[] } | { ok: false; diagnostics: HdlDiagnostic[] };

export async function verilogToBlif(run: HdlToolRun, verilog: string, top: string, signal?: AbortSignal): Promise<YosysBlifResult> {
  if (!isPlainModuleName(top)) {
    return { ok: false, diagnostics: [{ severity: 'error', source: 'lds', message: `module name ${top} cannot be passed to yosys` }] };
  }
  const result = await run({
    tool: 'yosys',
    args: ['-q', '-p', yosysScript(top)],
    files: { [YOSYS_VERILOG_FILE]: verilog },
    outputs: [YOSYS_BLIF_FILE],
    signal,
  });
  const diagnostics = parseYosysMessages(`${result.stdout}\n${result.stderr}`);
  const data = result.files[YOSYS_BLIF_FILE];
  if (result.exitCode !== 0 || !data) {
    if (!diagnostics.some((d) => d.severity === 'error')) {
      diagnostics.push({ severity: 'error', source: 'yosys', message: `yosys stopped (exit code ${result.exitCode})` });
    }
    return { ok: false, diagnostics };
  }
  return { ok: true, blif: new TextDecoder().decode(data), diagnostics };
}
