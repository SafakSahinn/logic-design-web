// Xilinx Spartan-3 / Spartan-6 and CoolRunner-II build through the user's installed ISE 14.7 WebPACK (Aşama 6k-4).
//
// ISE runs as a chain of programs, one stage each, as ISE's own "Generate Programming File" process:
//   FPGA: xst (synthesis, <top>.ngc) -> ngdbuild (with the .ucf, <top>.ngd) -> map (<top>_map.ncd, <top>.pcf)
//         -> par (<top>.ncd) -> bitgen (<top>.bit)
//   CPLD: xst -> ngdbuild -> cpldfit (<top>.vm6) -> hprep6 (<top>.jed, a JEDEC fuse file)
// The desktop main process writes XST's project and script files and the command lines from fixed templates
// (electron/vendorScripts.cjs); the page names only the step, the part, the top level and file names
// (electron/vendorPolicy.cjs). XST reads Verilog and VHDL itself. The free WebPACK edition does not have every
// device (the REPTAR's xc6slx150t: Xst:1817, see vendorHints.ts).
import type { BoardDefinition } from '../board/model';
import type { FlowPlan, FlowStage } from './model';

/** A board with an ISE (.ucf) description: evo's "XILINX" boards */
export function isIseBoard(board: BoardDefinition): boolean {
  return board.fpga.vendor === 'xilinx';
}

/** ISE device-speed-package, as the policy takes it (electron/vendorPolicy.cjs ISE_PART_RE) */
const PART_RE = /^xc(?:3s[0-9]{2,4}(?:e|a|an|adsp)?|6slx[0-9]{1,3}t?|2c[0-9]{2,3}a?|95[0-9]{2,3}(?:xl|xv)?)-(?:[1-9]|1[0-9]|20)l?-[a-z]{2,4}[0-9]{2,4}$/;
/** CoolRunner-II and XC9500 CPLDs: fitted by cpldfit, programmed from a .jed */
const CPLD_RE = /^xc(?:2c|95)/;

export type IseOutput = 'bit' | 'jed';

/**
 * The ISE part name of a board ("xc6slx9-2-tqg144": device, speed grade, package; evo writes the speed grade as
 * "4" or "-4"), whether it is a CPLD, and its JTAG chain position for iMPACT; or why it cannot be built.
 */
export function iseDevice(
  board: BoardDefinition,
): { ok: true; part: string; output: IseOutput; jtagPos: number } | { ok: false; reason: 'unknownPart' | 'badPackage' } {
  const die = board.fpga.part.trim().toLowerCase();
  if (!/^xc[0-9a-z]{3,12}$/.test(die)) return { ok: false, reason: 'unknownPart' };
  const speed = /^-?((?:[1-9]|1[0-9]|20)l?)$/i.exec(board.fpga.speedGrade.trim());
  const pkg = board.fpga.package.trim().toLowerCase();
  if (!speed || !/^[a-z]{2,4}[0-9]{2,4}$/.test(pkg)) return { ok: false, reason: 'badPackage' };
  const part = `${die}-${speed[1].toLowerCase()}-${pkg}`;
  if (!PART_RE.test(part)) return { ok: false, reason: 'unknownPart' };
  const jtagPos = Number.isInteger(board.fpga.jtagPos) && board.fpga.jtagPos >= 1 && board.fpga.jtagPos <= 16 ? board.fpga.jtagPos : 1;
  return { ok: true, part, output: CPLD_RE.test(part) ? 'jed' : 'bit', jtagPos };
}

/** The file the chain ends with: <top>.bit (bitgen) or <top>.jed (hprep6) */
export const iseBitstream = (top: string, output: IseOutput): string => `${top}.${output}`;

export interface IseFlowInput {
  board: BoardDefinition;
  /** Top-level module / entity name; every intermediate file is named after it */
  top: string;
  /** HDL files, in compile order (design first, then the top level); Verilog or VHDL */
  sources: { fileName: string; text: string }[];
  /** The .ucf constraint file (pins, clock) */
  constraints: { fileName: string; text: string };
}

const MINUTE = 60_000;

export function planIseFlow(input: IseFlowInput): { ok: true; plan: FlowPlan } | { ok: false; reason: 'notIse' | 'unknownPart' | 'badPackage' } {
  if (!isIseBoard(input.board)) return { ok: false, reason: 'notIse' };
  const dev = iseDevice(input.board);
  if (!dev.ok) return { ok: false, reason: dev.reason };
  const { top } = input;
  const files: Record<string, string> = {};
  for (const s of input.sources) files[s.fileName] = s.text;
  files[input.constraints.fileName] = input.constraints.text;
  const sourceNames = input.sources.map((s) => s.fileName);
  const part = ['--part', dev.part];
  const stage = (id: FlowStage['id'], step: string, args: string[], needs: string[], outputs: string[], timeoutMs: number): FlowStage => ({
    id,
    tool: 'ise',
    args: ['--step', step, ...args, '--top', top],
    needs,
    outputs,
    timeoutMs,
  });
  const stages: FlowStage[] = [
    stage('iseSynth', 'xst', [...part, ...sourceNames.flatMap((s) => ['--source', s])], sourceNames, [`${top}.ngc`], 15 * MINUTE),
    stage('iseTranslate', 'ngdbuild', [...part, '--constraints', input.constraints.fileName], [`${top}.ngc`, input.constraints.fileName], [`${top}.ngd`], 10 * MINUTE),
  ];
  if (dev.output === 'jed') {
    stages.push(
      stage('iseFit', 'cpldfit', part, [`${top}.ngd`], [`${top}.vm6`], 10 * MINUTE),
      stage('iseJedec', 'hprep6', [], [`${top}.vm6`], [`${top}.jed`], 5 * MINUTE),
    );
  } else {
    stages.push(
      stage('iseMap', 'map', part, [`${top}.ngd`], [`${top}_map.ncd`, `${top}.pcf`], 20 * MINUTE),
      // A Spartan-3 5000 takes a while to route; a small design on a small part takes seconds
      stage('isePlaceRoute', 'par', [], [`${top}_map.ncd`, `${top}.pcf`], [`${top}.ncd`], 30 * MINUTE),
      stage('iseBitgen', 'bitgen', [], [`${top}.ncd`, `${top}.pcf`], [`${top}.bit`], 10 * MINUTE),
    );
  }
  return { ok: true, plan: { family: 'ise', files, stages, bitstream: iseBitstream(top, dev.output) } };
}
