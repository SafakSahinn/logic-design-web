// Writing a bitstream to a board (Aşama 6j-3), as Logisim-evolution's OpenFpgaDownload.downloadToBoard:
// `openFPGALoader [-f] toplevel.bit` (SRAM is spelled out as -m here), run where the bitstream is. Without -f the design goes to the FPGA's SRAM
// (lost at power-off); with -f it goes to the configuration flash (kept). The desktop main process asks the user
// before a flash write. openFPGALoader needs a USB device, so it runs on the desktop only; the web saves the .bit
// file instead (saveBitstream).
import type { BoardDefinition } from '../board/model';
import type { ToolFileData, ToolId, ToolProgress } from '../../tools/types';
import { isEcp5Board } from './ecp5';
import { isXc7Board } from './xc7';
import { isVivadoBoard, vivadoDevice } from './vivado';
import { isQuartusBoard, quartusDevice, type QuartusOutput } from './quartus';

export type ProgramTarget = 'sram' | 'flash';

/**
 * openFPGALoader cable or board options per board name. evo passes none and lets openFPGALoader use its default
 * (a direct FT2232 JTAG interface), which is what the GECKO5 board has; openFPGALoader has no "gecko5" board entry.
 * A board whose programmer needs an explicit choice gets one here, not in the board files (they stay evo's format);
 * a -b board name must also be added to LOADER_BOARDS, a -c cable name to LOADER_CABLES in electron/toolPolicy.cjs.
 */
const PROGRAMMER_ARGS: Record<string, string[]> = {
  GECKO5_EDUCATION: [],
  // Xilinx 7-series (6j-6): openFPGALoader's board entries pick the cable and the SPI flash
  BASYS3: ['-b', 'basys3'],
  BASYS3_7SEG: ['-b', 'basys3'],
  DIGILENT_NEXYS_A7_100T: ['-b', 'nexys_a7_100'],
  ALCHITRY_AU_IO: ['-b', 'alchitry_au'],
  TUL_PYNQ_Z2: ['-b', 'pynq_z2'],
  // The first Zybo has no board entry (only the Zybo Z7); its JTAG is Digilent's FT2232 cable
  ZYBO: ['-c', 'digilent'],
};

/** The cable / board options for a board, or null when the open flow cannot program it */
export function programmerArgs(board: BoardDefinition): string[] | null {
  if (!isEcp5Board(board) && !isXc7Board(board)) return null;
  return Object.prototype.hasOwnProperty.call(PROGRAMMER_ARGS, board.name) ? [...PROGRAMMER_ARGS[board.name]] : [];
}

/**
 * Whether openFPGALoader can write the board's configuration flash. On a Zynq the flash belongs to the processor
 * side (it boots the PL through the PS), so only an SRAM load over JTAG is offered there.
 */
export function canWriteFlash(board: BoardDefinition): boolean {
  if (programmerArgs(board) === null) return false;
  return !/^xc7z/i.test(board.fpga.part.trim());
}

/** One openFPGALoader run, shaped like a src/tools runTool request */
export interface ProgramRequest {
  tool: ToolId;
  args: string[];
  files: Record<string, ToolFileData>;
  outputs: string[];
  timeoutMs: number;
}

const MINUTE = 60_000;
export const PROGRAM_FILE = 'toplevel.bit';

export function planProgram(input: {
  board: BoardDefinition;
  bitstream: Uint8Array;
  target: ProgramTarget;
}): { ok: true; request: ProgramRequest } | { ok: false; reason: 'notSupported' | 'noFlash' | 'emptyBitstream' } {
  const cable = programmerArgs(input.board);
  if (!cable) return { ok: false, reason: 'notSupported' };
  if (input.target === 'flash' && !canWriteFlash(input.board)) return { ok: false, reason: 'noFlash' };
  if (input.bitstream.length === 0) return { ok: false, reason: 'emptyBitstream' };
  return {
    ok: true,
    request: {
      tool: 'openfpgaloader',
      // evo passes nothing for SRAM (openFPGALoader's default); the policy wants the target spelled out
      args: [...cable, input.target === 'flash' ? '-f' : '-m', PROGRAM_FILE],
      files: { [PROGRAM_FILE]: input.bitstream },
      outputs: [],
      // An ECP5-85 SRAM load takes seconds; erasing and writing flash can take a few minutes
      timeoutMs: input.target === 'flash' ? 10 * MINUTE : 2 * MINUTE,
    },
  };
}

/** Looks for the board's FPGA on the JTAG chain without writing anything */
export function planDetect(board: BoardDefinition): { ok: true; request: ProgramRequest } | { ok: false; reason: 'notSupported' } {
  const cable = programmerArgs(board);
  if (!cable) return { ok: false, reason: 'notSupported' };
  return { ok: true, request: { tool: 'openfpgaloader', args: [...cable, '--detect'], files: {}, outputs: [], timeoutMs: MINUTE } };
}

/**
 * What went wrong, read from openFPGALoader's output:
 *   noCable: no programming cable found (board not plugged in, driver missing);
 *   noFpga: the cable answered but no FPGA is on the JTAG chain (board off);
 *   unknownBoard / unknownCable: the name in PROGRAMMER_ARGS is not known to this openFPGALoader;
 *   wrongDevice: the bitstream is for another FPGA than the one found, or openFPGALoader does not know that FPGA;
 *   other: anything else (the log has the details).
 */
export type ProgramProblem = 'noCable' | 'noFpga' | 'unknownBoard' | 'unknownCable' | 'wrongDevice' | 'other';

// Messages of openFPGALoader 1.x (src/main.cpp, jtag.cpp, ftdipp_mpsse.cpp, lattice.cpp)
export function classifyProgramOutput(text: string): ProgramProblem {
  if (/cannot find board '/i.test(text)) return 'unknownBoard';
  if (/^error : \S+ not found/im.test(text)) return 'unknownCable';
  if (/JTAG init failed|unable to open ftdi device|unable to open usb|libusb\w*: .*(error|fail)/i.test(text)) return 'noCable';
  if (/Error: no device found|Unknown device with IDCODE/i.test(text)) return 'noFpga';
  if (/mismatch between target's idcode and bitstream idcode|Error: device [0-9a-f]+ not supported/i.test(text)) return 'wrongDevice';
  return 'other';
}

/**
 * Programming through the user's Vivado (Aşama 6k-2): the main process runs a fixed hardware-manager script
 * (electron/vendorScripts.cjs) that starts Vivado's own hw_server on this computer, opens the JTAG cable whose chain
 * holds the board's FPGA, and loads the bitstream into the FPGA's SRAM. The page names only the part and the file.
 * The configuration flash is not written this way (it needs Vivado's flash-part settings per board).
 */
export const VIVADO_PROGRAM_FILE = 'design.bit';

export function planVivadoProgram(input: {
  board: BoardDefinition;
  bitstream: Uint8Array;
}): { ok: true; request: ProgramRequest } | { ok: false; reason: 'notSupported' | 'emptyBitstream' } {
  if (!isVivadoBoard(input.board)) return { ok: false, reason: 'notSupported' };
  const dev = vivadoDevice(input.board);
  if (!dev.ok) return { ok: false, reason: 'notSupported' };
  if (input.bitstream.length === 0) return { ok: false, reason: 'emptyBitstream' };
  return {
    ok: true,
    request: {
      tool: 'vivado',
      args: ['--step', 'program', '--part', dev.part, '--bitstream', VIVADO_PROGRAM_FILE],
      files: { [VIVADO_PROGRAM_FILE]: input.bitstream },
      outputs: [],
      // Vivado and its hw_server take 20-30 s to start; the SRAM load itself takes seconds
      timeoutMs: 4 * MINUTE,
    },
  };
}

/**
 * What went wrong in a Vivado programming run: the script's own "LDS-ERROR:" lines first, then Vivado's messages
 * (Labtools 27-3303: the bitstream is for another device).
 */
export function classifyVivadoProgramOutput(text: string): ProgramProblem {
  if (/LDS-ERROR: no hardware target|No hardware targets? (?:exist|found)|There is no (?:active|current) (?:hw_)?target/i.test(text)) return 'noCable';
  if (/LDS-ERROR: no FPGA on the chain/.test(text)) return 'noFpga';
  if (/LDS-ERROR: no matching FPGA|Labtools 27-3303|Incorrect bitstream assigned/i.test(text)) return 'wrongDevice';
  return 'other';
}

/**
 * Programming through the user's Quartus (Aşama 6k-3): the main process runs quartus_pgm on the first JTAG cable
 * (USB-Blaster) with a fixed command line (electron/vendorScripts.cjs quartusProgram); the page names only the
 * part (which picks the Quartus install) and the file. An FPGA gets the .sof in its SRAM (lost at power-off); a
 * CPLD gets the .pof in its own non-volatile memory, which the main process asks the user about first, as a flash
 * write.
 */
export const QUARTUS_PROGRAM_FILES: Record<QuartusOutput, string> = { sof: 'design.sof', pof: 'design.pof' };

export function planQuartusProgram(input: {
  board: BoardDefinition;
  bitstream: Uint8Array;
}): { ok: true; request: ProgramRequest; target: ProgramTarget } | { ok: false; reason: 'notSupported' | 'emptyBitstream' } {
  if (!isQuartusBoard(input.board)) return { ok: false, reason: 'notSupported' };
  const dev = quartusDevice(input.board);
  if (!dev.ok) return { ok: false, reason: 'notSupported' };
  if (input.bitstream.length === 0) return { ok: false, reason: 'emptyBitstream' };
  const file = QUARTUS_PROGRAM_FILES[dev.output];
  return {
    ok: true,
    target: dev.output === 'pof' ? 'flash' : 'sram',
    request: {
      tool: 'quartus',
      args: ['--step', 'program', '--part', dev.part, '--bitstream', file],
      files: { [file]: input.bitstream },
      outputs: [],
      // quartus_pgm starts in seconds; erasing and writing a CPLD takes seconds too
      timeoutMs: 4 * MINUTE,
    },
  };
}

/**
 * What went wrong in a quartus_pgm run (Quartus Prime 25.1 and Quartus II 13.0 print the same messages):
 * Error 213013 "Programming hardware cable not detected" (also when no USB-Blaster driver is installed), a JTAG
 * chain without devices, or a device whose JTAG ID is not the one the file is for.
 */
export function classifyQuartusProgramOutput(text: string): ProgramProblem {
  if (/Error \(213013\)|Programming hardware cable not detected|No JTAG hardware available/i.test(text)) return 'noCable';
  if (/Error \(209053\)|Error \(209040\)|Can't access JTAG chain|Unable to scan device chain|JTAG chain (?:is )?broken/i.test(text)) return 'noFpga';
  if (/Error \(209015\)|Expected JTAG ID code|Unexpected JTAG ID|Device chain in Chain Description File does not match/i.test(text)) return 'wrongDevice';
  return 'other';
}

export type ProgramResult =
  | { ok: true; exitCode: 0; stdout: string; stderr: string }
  | { ok: false; kind: 'toolFailed'; problem: ProgramProblem; exitCode: number; stdout: string; stderr: string }
  /** The runner refused or broke off the run (not installed, the user declined the flash write, cancelled ...) */
  | { ok: false; kind: 'runError'; error: unknown };

/** The part of src/tools runTool programming uses */
export type ProgramToolRun = (
  request: ProgramRequest & { signal?: AbortSignal; onProgress?: (progress: ToolProgress) => void },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export async function runProgram(
  request: ProgramRequest,
  run: ProgramToolRun,
  options: { signal?: AbortSignal; onLine?: (line: string, stream: 'stdout' | 'stderr') => void } = {},
): Promise<ProgramResult> {
  let r: Awaited<ReturnType<ProgramToolRun>>;
  try {
    r = await run({
      ...request,
      signal: options.signal,
      onProgress: options.onLine ? (p) => p.phase === 'run' && p.line !== undefined && options.onLine!(p.line, p.stream ?? 'stdout') : undefined,
    });
  } catch (error) {
    return { ok: false, kind: 'runError', error };
  }
  if (r.exitCode === 0) return { ok: true, exitCode: 0, stdout: r.stdout, stderr: r.stderr };
  return {
    ok: false,
    kind: 'toolFailed',
    problem: (request.tool === 'vivado' ? classifyVivadoProgramOutput : request.tool === 'quartus' ? classifyQuartusProgramOutput : classifyProgramOutput)(
      `${r.stderr}\n${r.stdout}`,
    ),
    exitCode: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

/**
 * Saves a bitstream as a file through the browser (the web's way to program: the user loads it with their own
 * programmer). Returns false when the page cannot start a download.
 */
export function saveBitstream(bitstream: Uint8Array, fileName: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  // .bit (Xilinx, ECP5), .sof / .pof (Quartus)
  const safeName = /^[\w.-]{1,100}\.(bit|sof|pof)$/.test(fileName) ? fileName : PROGRAM_FILE;
  // Copy into a plain ArrayBuffer: a view on a SharedArrayBuffer cannot back a Blob
  const url = URL.createObjectURL(new Blob([new Uint8Array(bitstream)], { type: 'application/octet-stream' }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Some browsers start the download after click() returns, so the address is released a little later
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return true;
}
