// Xilinx 7-series flow through openXC7 (Aşama 6j-6), as openXC7's demo makefiles and Apio's xilinx plugin:
// yosys synth_xilinx -> nextpnr-xilinx (FASM) -> fasm2frames -> xc7frames2bit.
//
// The board files are evo's Vivado boards (vendor "vivado", an .xdc file); nextpnr-xilinx reads the same .xdc the
// Vivado export writes (it ignores the create_clock options it does not know). The chip database and Project X-Ray
// database stay outside the run folder: the desktop main process adds those paths (electron/toolRunner.cjs), the
// page names only the part.
import type { BoardDefinition } from '../board/model';
import type { FlowPlan, FlowStage } from './model';
import { vhdlToVerilogStage, yosysRead } from './stages';

/**
 * Dies openXC7 has a chip database for (the Apio openXC7 package, 2026-11). The xc7a15t (CMOD A7-15T) is missing
 * from Project X-Ray, so it is not listed.
 */
const XC7_DIES = new Set([
  'xc7a35t', 'xc7a50t', 'xc7a100t', 'xc7a200t',
  'xc7s25', 'xc7s50', 'xc7s75', 'xc7s100',
  'xc7z007s', 'xc7z010', 'xc7z020', 'xc7z030', 'xc7z035', 'xc7z045', 'xc7z100',
]);

/** A 7-series board with a Vivado (.xdc) description */
export function isXc7Board(board: BoardDefinition): boolean {
  return board.fpga.vendor === 'vivado' && /^xc7[aksz]/i.test(board.fpga.part.trim());
}

/** The openXC7 part name ("xc7a35tcpg236-1") of a board, or why the board cannot be built */
export function xc7Device(board: BoardDefinition): { ok: true; part: string } | { ok: false; reason: 'unknownPart' | 'badPackage' } {
  const die = board.fpga.part.trim().toLowerCase();
  if (!XC7_DIES.has(die)) return { ok: false, reason: 'unknownPart' };
  const pkg = board.fpga.package.trim().toLowerCase();
  if (!/^[a-z]{2,5}\d{3,4}$/.test(pkg)) return { ok: false, reason: 'badPackage' };
  // evo writes the speed grade as "-1"; Project X-Ray names the low-power grade "-2L"
  const speed = /^-?([1-3])([lL]?)$/.exec(board.fpga.speedGrade.trim());
  if (!speed) return { ok: false, reason: 'badPackage' };
  return { ok: true, part: `${die}${pkg}-${speed[1]}${speed[2].toUpperCase()}` };
}

export interface Xc7FlowInput {
  board: BoardDefinition;
  /** Top-level module / entity name */
  top: string;
  /** HDL files, in compile order (design first, then the top level) */
  sources: { fileName: string; text: string }[];
  lang: 'verilog' | 'vhdl';
  /** The .xdc constraint file */
  constraints: { fileName: string; text: string };
  /** Also write nextpnr's routed netlist (kept in the result) */
  writeRouted?: boolean;
}

const MINUTE = 60_000;
export const XC7_FILES = {
  json: 'toplevel.json',
  fasm: 'toplevel.fasm',
  frames: 'toplevel.frames',
  routed: 'routed.json',
  bitstream: 'toplevel.bit',
} as const;

export function planXc7Flow(input: Xc7FlowInput): { ok: true; plan: FlowPlan } | { ok: false; reason: 'notXc7' | 'unknownPart' | 'badPackage' } {
  if (!isXc7Board(input.board)) return { ok: false, reason: 'notXc7' };
  const dev = xc7Device(input.board);
  if (!dev.ok) return { ok: false, reason: dev.reason };
  const files: Record<string, string> = {};
  for (const s of input.sources) files[s.fileName] = s.text;
  files[input.constraints.fileName] = input.constraints.text;
  const sourceNames = input.sources.map((s) => s.fileName);
  const stages: FlowStage[] = [];

  let verilogFiles = sourceNames;
  if (input.lang === 'vhdl') {
    const ghdl = vhdlToVerilogStage(sourceNames, input.top);
    stages.push(ghdl.stage);
    verilogFiles = ghdl.verilogFiles;
  }
  stages.push({
    id: 'synth',
    tool: 'yosys',
    // openXC7's options: one flat netlist, abc9 mapping
    args: ['-p', `${yosysRead(verilogFiles, input.top)}; synth_xilinx -flatten -abc9 -arch xc7 -top ${input.top}; write_json ${XC7_FILES.json}`],
    needs: verilogFiles,
    outputs: [XC7_FILES.json],
    timeoutMs: 15 * MINUTE,
  });
  const routed = input.writeRouted ? ['--write', XC7_FILES.routed] : [];
  stages.push({
    id: 'placeRoute',
    tool: 'nextpnr-xilinx',
    args: ['--device', dev.part, '--json', XC7_FILES.json, '-o', `xdc=${input.constraints.fileName}`, '-o', `fasm=${XC7_FILES.fasm}`, ...routed],
    needs: [XC7_FILES.json, input.constraints.fileName],
    outputs: input.writeRouted ? [XC7_FILES.fasm, XC7_FILES.routed] : [XC7_FILES.fasm],
    timeoutMs: 20 * MINUTE,
  });
  stages.push({
    id: 'frames',
    tool: 'fasm2frames',
    args: ['--part', dev.part, XC7_FILES.fasm, XC7_FILES.frames],
    needs: [XC7_FILES.fasm],
    outputs: [XC7_FILES.frames],
    timeoutMs: 10 * MINUTE,
  });
  stages.push({
    id: 'pack',
    tool: 'xc7frames2bit',
    args: ['--part_name', dev.part, '--frm_file', XC7_FILES.frames, '--output_file', XC7_FILES.bitstream],
    needs: [XC7_FILES.frames],
    outputs: [XC7_FILES.bitstream],
    timeoutMs: 5 * MINUTE,
  });
  return {
    ok: true,
    plan: { family: 'xc7', files, stages, bitstream: XC7_FILES.bitstream, ...(input.writeRouted ? { keep: [XC7_FILES.routed] } : {}) },
  };
}
