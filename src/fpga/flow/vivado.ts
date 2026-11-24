// Xilinx 7-series build through the user's installed Vivado (Aşama 6k-2), the vendor alternative to openXC7.
//
// One stage: the desktop main process turns the option line below into a fixed non-project Tcl script
// (electron/vendorScripts.cjs: read sources and .xdc, synth_design, opt/place/route, write_bitstream) and runs
// `vivado -mode batch`. The page names only the part, the top level and file names (electron/vendorPolicy.cjs).
// Vivado reads VHDL itself, so there is no ghdl step; and it knows every 7-series die, including the xc7a15t of
// the CMOD A7-15T that openXC7 cannot build.
import type { BoardDefinition } from '../board/model';
import type { FlowPlan } from './model';

/** A 7-series board with a Vivado (.xdc) description: the boards this flow builds */
export function isVivadoBoard(board: BoardDefinition): boolean {
  return board.fpga.vendor === 'vivado' && /^xc7[aksz]/i.test(board.fpga.part.trim());
}

/** The die part of a 7-series name ("xc7a35t", "xc7z020", "xc7z007s", "xc7s50") */
const DIE_RE = /^xc7[aksz]\d{1,3}t?s?$/;

/**
 * The Vivado part name ("xc7a15tcpg236-1") of a board, or why it cannot be built. The same form as openXC7's
 * (xc7Device), without its list of supported dies.
 */
export function vivadoDevice(board: BoardDefinition): { ok: true; part: string; die: string } | { ok: false; reason: 'unknownPart' | 'badPackage' } {
  const die = board.fpga.part.trim().toLowerCase();
  if (!DIE_RE.test(die)) return { ok: false, reason: 'unknownPart' };
  const pkg = board.fpga.package.trim().toLowerCase();
  if (!/^[a-z]{2,5}\d{3,4}$/.test(pkg)) return { ok: false, reason: 'badPackage' };
  const speed = /^-?([1-3])([lL]?)$/.exec(board.fpga.speedGrade.trim());
  if (!speed) return { ok: false, reason: 'badPackage' };
  return { ok: true, part: `${die}${pkg}-${speed[1]}${speed[2].toUpperCase()}`, die };
}

export interface VivadoFlowInput {
  board: BoardDefinition;
  /** Top-level module / entity name */
  top: string;
  /** HDL files, in compile order (design first, then the top level); Verilog or VHDL */
  sources: { fileName: string; text: string }[];
  /** The .xdc constraint file */
  constraints: { fileName: string; text: string };
}

const MINUTE = 60_000;

/** The bitstream Vivado writes: <top>.bit (the template's write_bitstream) */
export const vivadoBitstream = (top: string): string => `${top}.bit`;

export function planVivadoFlow(input: VivadoFlowInput): { ok: true; plan: FlowPlan } | { ok: false; reason: 'notVivado' | 'unknownPart' | 'badPackage' } {
  if (!isVivadoBoard(input.board)) return { ok: false, reason: 'notVivado' };
  const dev = vivadoDevice(input.board);
  if (!dev.ok) return { ok: false, reason: dev.reason };
  const files: Record<string, string> = {};
  for (const s of input.sources) files[s.fileName] = s.text;
  files[input.constraints.fileName] = input.constraints.text;
  const sourceNames = input.sources.map((s) => s.fileName);
  const bitstream = vivadoBitstream(input.top);
  return {
    ok: true,
    plan: {
      family: 'vivado',
      files,
      stages: [
        {
          id: 'vendorBuild',
          tool: 'vivado',
          args: [
            '--step', 'build',
            '--part', dev.part,
            '--top', input.top,
            ...sourceNames.flatMap((s) => ['--source', s]),
            '--constraints', input.constraints.fileName,
          ],
          needs: [...sourceNames, input.constraints.fileName],
          outputs: [bitstream],
          // A small design takes 1.5 minutes (most of it Vivado starting and loading the part); large parts more
          timeoutMs: 20 * MINUTE,
        },
      ],
      bitstream,
    },
  };
}
