// Lattice ECP5 flow, as Logisim-evolution's OpenFpgaDownload: yosys synth_ecp5 -> nextpnr-ecp5 -> ecppack.
//
// evo reads VHDL with the ghdl-yosys plugin; plugins are refused by the tool policy (electron/toolPolicy.cjs),
// so VHDL goes through `ghdl --synth --out=verilog` first (the same route as the VHDL Entity part, Aşama 6b) and
// yosys reads ghdl's Verilog. Without ghdl (the web) the caller builds the project in Verilog instead.
import type { BoardDefinition } from '../board/model';
import type { FlowPlan, FlowStage } from './model';

/** nextpnr-ecp5 device options; evo's board files name the part as "85k", "um5g-25k" ... */
const ECP5_PARTS = new Set(['12k', '25k', '45k', '85k', 'um-25k', 'um-45k', 'um-85k', 'um5g-25k', 'um5g-45k', 'um5g-85k']);

/** evo spells the family "epc5" in its board files */
export function isEcp5Board(board: BoardDefinition): boolean {
  return board.fpga.vendor === 'openFpga' && /^(ecp5|epc5)$/i.test(board.fpga.family.trim());
}

/** The nextpnr-ecp5 device flag and package of a board, or why the board cannot be built */
export function ecp5Device(board: BoardDefinition): { ok: true; device: string; pkg: string } | { ok: false; reason: 'unknownPart' | 'badPackage' } {
  const part = board.fpga.part.trim().toLowerCase();
  if (!ECP5_PARTS.has(part)) return { ok: false, reason: 'unknownPart' };
  const pkg = board.fpga.package.trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(pkg)) return { ok: false, reason: 'badPackage' };
  return { ok: true, device: `--${part}`, pkg };
}

export interface Ecp5FlowInput {
  board: BoardDefinition;
  /** Top-level module / entity name */
  top: string;
  /** HDL files, in compile order (design first, then the top level) */
  sources: { fileName: string; text: string }[];
  lang: 'verilog' | 'vhdl';
  /** The .lpf constraint file */
  constraints: { fileName: string; text: string };
  /** Also write nextpnr's routed netlist (kept in the result) for the post-route functional check */
  writeRouted?: boolean;
}

const MINUTE = 60_000;
export const ECP5_FILES = {
  ghdlVerilog: 'ghdl_out.v',
  json: 'toplevel.json',
  config: 'toplevel.config',
  routed: 'routed.json',
  bitstream: 'toplevel.bit',
} as const;

export function planEcp5Flow(input: Ecp5FlowInput): { ok: true; plan: FlowPlan } | { ok: false; reason: 'notEcp5' | 'unknownPart' | 'badPackage' } {
  if (!isEcp5Board(input.board)) return { ok: false, reason: 'notEcp5' };
  const dev = ecp5Device(input.board);
  if (!dev.ok) return { ok: false, reason: dev.reason };
  const files: Record<string, string> = {};
  for (const s of input.sources) files[s.fileName] = s.text;
  files[input.constraints.fileName] = input.constraints.text;
  const sourceNames = input.sources.map((s) => s.fileName);
  const stages: FlowStage[] = [];

  let verilogFiles = sourceNames;
  if (input.lang === 'vhdl') {
    stages.push({
      id: 'vhdlToVerilog',
      tool: 'ghdl',
      // Same options as the VHDL Entity part; "-e <top>" elaborates the top level and everything below it
      args: ['--synth', '--std=08', '-fsynopsys', '--out=verilog', ...sourceNames, '-e', input.top],
      needs: sourceNames,
      outputs: [],
      stdoutTo: ECP5_FILES.ghdlVerilog,
      timeoutMs: 5 * MINUTE,
    });
    verilogFiles = [ECP5_FILES.ghdlVerilog];
  }
  stages.push({
    id: 'synth',
    tool: 'yosys',
    args: ['-p', `read_verilog -sv ${verilogFiles.join(' ')}; hierarchy -top ${input.top}; synth_ecp5 -top ${input.top} -json ${ECP5_FILES.json}`],
    needs: verilogFiles,
    outputs: [ECP5_FILES.json],
    timeoutMs: 15 * MINUTE,
  });
  const routed = input.writeRouted ? ['--write', ECP5_FILES.routed] : [];
  stages.push({
    id: 'placeRoute',
    tool: 'nextpnr-ecp5',
    args: [dev.device, '--package', dev.pkg, '--json', ECP5_FILES.json, '--lpf', input.constraints.fileName, '--textcfg', ECP5_FILES.config, ...routed],
    needs: [ECP5_FILES.json, input.constraints.fileName],
    outputs: input.writeRouted ? [ECP5_FILES.config, ECP5_FILES.routed] : [ECP5_FILES.config],
    timeoutMs: 20 * MINUTE,
  });
  stages.push({
    id: 'pack',
    tool: 'ecppack',
    // evo's options: compressed bitstream, 62 MHz configuration clock
    args: ['--compress', '--freq', '62.0', '--input', ECP5_FILES.config, '--bit', ECP5_FILES.bitstream],
    needs: [ECP5_FILES.config],
    outputs: [ECP5_FILES.bitstream],
    timeoutMs: 5 * MINUTE,
  });
  return {
    ok: true,
    plan: { family: 'ecp5', files, stages, bitstream: ECP5_FILES.bitstream, ...(input.writeRouted ? { keep: [ECP5_FILES.routed] } : {}) },
  };
}
