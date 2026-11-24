// Intel / Altera build through the user's installed Quartus (Aşama 6k-3): Quartus Prime Lite for Cyclone IV/V/10 LP
// and MAX II/V/10, Quartus II 13.0sp1 for Cyclone I/II/III and MAX 3000/7000 (the main process picks the install
// per part, electron/vendorTools.cjs quartusKindsFor).
//
// One stage: the desktop main process writes the project file next to the page's <top>.qsf (checked line by line,
// electron/vendorPolicy.cjs) and runs `quartus_sh --flow compile <top>` (analysis, fitter, assembler, timing).
// Quartus reads Verilog and VHDL itself. An FPGA is configured from an SRAM object file (.sof); a CPLD (MAX 3000 /
// 7000, MAX II / V) has no SRAM configuration and the assembler writes only a programmer object file (.pof).
import type { BoardDefinition } from '../board/model';
import type { FlowPlan } from './model';

/** A board with a Quartus (.qsf) description: the Intel / Altera boards */
export function isQuartusBoard(board: BoardDefinition): boolean {
  return board.fpga.vendor === 'altera';
}

/** Altera device names as the policy takes them (EP4CE22F17C6, 5CSEMA5F31C6, 10M08SAU169C8G, EPM7128SLC84-7 ...) */
const PART_RE = /^(?:EP[0-9A-Z]{4,20}|EPM[0-9A-Z]{4,20}(?:-[0-9]{1,2})?|5[A-Z][0-9A-Z]{4,20}|10[A-Z][0-9A-Z]{4,20})$/;

/** The CPLD families: configured from a .pof only (MAX 3000A / 7000, MAX II, MAX V) */
const CPLD_RE = /^(?:EPM[379]\d{3}|EPM(?:240|570|1270|2210)|5M)/;

export type QuartusOutput = 'sof' | 'pof';

/** The Quartus device name of a board ("EP4CE22F17C6"), or why it cannot be built */
export function quartusDevice(board: BoardDefinition): { ok: true; part: string; output: QuartusOutput } | { ok: false; reason: 'unknownPart' } {
  const part = board.fpga.part.trim().toUpperCase();
  if (!PART_RE.test(part)) return { ok: false, reason: 'unknownPart' };
  return { ok: true, part, output: CPLD_RE.test(part) ? 'pof' : 'sof' };
}

/** The file the assembler writes for the board: <top>.sof for an FPGA, <top>.pof for a CPLD */
export const quartusBitstream = (top: string, output: QuartusOutput): string => `${top}.${output}`;

export interface QuartusFlowInput {
  board: BoardDefinition;
  /** Top-level entity name; the revision and the .qsf are named after it */
  top: string;
  /** HDL files, in compile order (design first, then the top level); Verilog or VHDL */
  sources: { fileName: string; text: string }[];
  /** The <top>.qsf settings file (device, sources, pins) */
  constraints: { fileName: string; text: string };
}

const MINUTE = 60_000;

export function planQuartusFlow(input: QuartusFlowInput): { ok: true; plan: FlowPlan } | { ok: false; reason: 'notQuartus' | 'unknownPart' } {
  if (!isQuartusBoard(input.board)) return { ok: false, reason: 'notQuartus' };
  const dev = quartusDevice(input.board);
  if (!dev.ok) return { ok: false, reason: dev.reason };
  const files: Record<string, string> = {};
  for (const s of input.sources) files[s.fileName] = s.text;
  files[input.constraints.fileName] = input.constraints.text;
  const sourceNames = input.sources.map((s) => s.fileName);
  const bitstream = quartusBitstream(input.top, dev.output);
  return {
    ok: true,
    plan: {
      family: 'quartus',
      files,
      stages: [
        {
          id: 'vendorBuild',
          tool: 'quartus',
          args: [
            '--step', 'compile',
            '--part', dev.part,
            '--top', input.top,
            ...sourceNames.flatMap((s) => ['--source', s]),
            '--constraints', input.constraints.fileName,
          ],
          needs: [...sourceNames, input.constraints.fileName],
          outputs: [bitstream],
          // A small design compiles in under a minute; a large Cyclone V part takes longer
          timeoutMs: 20 * MINUTE,
        },
      ],
      bitstream,
    },
  };
}
