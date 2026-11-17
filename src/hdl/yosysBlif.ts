// Verilog -> BLIF with yosys: the common back half of the VHDL (6b) and Verilog (6c) synthesis.
//
// The script stays inside the native tool policy (electron/toolPolicy.cjs): allowlisted commands only, no
// quotes, backslashes or "#", relative file names.
import type { HdlDiagnostic, HdlToolRun } from './types';

export const YOSYS_VERILOG_FILE = 'design.v';
export const YOSYS_BLIF_FILE = 'design.blif';

export interface YosysBlifOptions {
  /** Read the source as SystemVerilog (read_verilog -sv) */
  sv?: boolean;
  /** Commands run after reading and before synthesis (e.g. chparam); must stay inside the tool policy */
  prepare?: string;
  /** design.v is the user's own text, so its line numbers are kept in the messages */
  userSource?: boolean;
  signal?: AbortSignal;
}

/** The yosys script; `top` must be a plain identifier (it is checked by the caller) */
export function yosysScript(top: string, options: Pick<YosysBlifOptions, 'sv' | 'prepare'> = {}): string {
  const read = `read_verilog${options.sv ? ' -sv' : ''} ${YOSYS_VERILOG_FILE}`;
  const prepare = options.prepare ? ` ${options.prepare};` : '';
  return `${read};${prepare} synth -flatten -top ${top}; write_blif -icells ${YOSYS_BLIF_FILE}`;
}

/** A name yosys can take as a bare script token */
export const isPlainModuleName = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name);

/**
 * yosys messages worth showing: errors and warnings (it prints them whatever -q says). Located ones look like
 * "design.v:3: ERROR: text"; with `withLines` their line is kept (only when design.v is the user's text).
 */
export function parseYosysMessages(output: string, withLines = false): HdlDiagnostic[] {
  const out: HdlDiagnostic[] = [];
  // the WebAssembly build colours its messages (ANSI escapes) even when the output is not a terminal
  // eslint-disable-next-line no-control-regex
  for (const raw of output.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(?:([^:]*):(\d+):\s*)?(ERROR|Warning):\s*(.*)$/.exec(line);
    if (!m) continue;
    const d: HdlDiagnostic = { severity: m[3] === 'ERROR' ? 'error' : 'warning', source: 'yosys', message: m[4] };
    if (withLines && m[2] !== undefined && m[1].endsWith(YOSYS_VERILOG_FILE)) d.line = Number(m[2]);
    out.push(d);
  }
  return out;
}

export type YosysBlifResult = { ok: true; blif: string; diagnostics: HdlDiagnostic[] } | { ok: false; diagnostics: HdlDiagnostic[] };

export async function verilogToBlif(run: HdlToolRun, verilog: string, top: string, options: YosysBlifOptions = {}): Promise<YosysBlifResult> {
  if (!isPlainModuleName(top)) {
    return { ok: false, diagnostics: [{ severity: 'error', source: 'lds', message: `module name ${top} cannot be passed to yosys` }] };
  }
  const result = await run({
    tool: 'yosys',
    args: ['-q', '-p', yosysScript(top, options)],
    files: { [YOSYS_VERILOG_FILE]: verilog },
    outputs: [YOSYS_BLIF_FILE],
    signal: options.signal,
  });
  const diagnostics = parseYosysMessages(`${result.stdout}\n${result.stderr}`, options.userSource);
  const data = result.files[YOSYS_BLIF_FILE];
  if (result.exitCode !== 0 || !data) {
    if (!diagnostics.some((d) => d.severity === 'error')) {
      diagnostics.push({ severity: 'error', source: 'yosys', message: `yosys stopped (exit code ${result.exitCode})` });
    }
    return { ok: false, diagnostics };
  }
  return { ok: true, blif: new TextDecoder().decode(data), diagnostics };
}
