// FPGA board model (Aşama 6i).
//
// One board = the FPGA chip and its clock, the I/O resources on the board (buttons, LEDs, displays, connector
// pins ...) with the FPGA pins behind them, and an optional photo the resources are drawn on. The model follows
// the Logisim-evolution board XML (src/main/resources/resources/logisim/boards/*.xml in evo v5.0.0) so a board
// read from an evo file and written back is the same file.

/** Tool chain the board's FPGA is built with (evo FPGAInformation Vendor) */
export type BoardVendor = 'altera' | 'xilinx' | 'vivado' | 'openFpga';
export const BOARD_VENDORS: readonly BoardVendor[] = ['altera', 'xilinx', 'vivado', 'openFpga'];

/** Kind of an I/O resource (evo IoComponentTypes: Led .. LocalBus) */
export type BoardIoKind =
  | 'led'
  | 'button'
  | 'pin'
  | 'sevenSegment'
  | 'sevenSegmentNoDp'
  | 'sevenSegmentScanning'
  | 'dipSwitch'
  | 'rgbLed'
  | 'ledArray'
  | 'portIo'
  | 'localBus';
export const BOARD_IO_KINDS: readonly BoardIoKind[] = [
  'led',
  'button',
  'pin',
  'sevenSegment',
  'sevenSegmentNoDp',
  'sevenSegmentScanning',
  'dipSwitch',
  'rgbLed',
  'ledArray',
  'portIo',
  'localBus',
];

export type PullBehavior = 'float' | 'pullUp' | 'pullDown';
export const PULL_BEHAVIORS: readonly PullBehavior[] = ['float', 'pullUp', 'pullDown'];

/** 'default' = no IO standard is written to the constraints (the tool's default) */
export type IoStandard = 'default' | 'LVCMOS12' | 'LVCMOS15' | 'LVCMOS18' | 'LVCMOS25' | 'LVCMOS33' | 'LVTTL';
export const IO_STANDARDS: readonly IoStandard[] = ['default', 'LVCMOS12', 'LVCMOS15', 'LVCMOS18', 'LVCMOS25', 'LVCMOS33', 'LVTTL'];

/** Output drive strength in mA; 0 = the tool's default */
export type DriveStrength = 0 | 2 | 4 | 8 | 16 | 24;
export const DRIVE_STRENGTHS: readonly DriveStrength[] = [0, 2, 4, 8, 16, 24];

/** How an LED array's pins drive its LEDs (evo LedArrayDriving) */
export type LedArrayDrive = 'ledDefault' | 'ledRowScanning' | 'ledColumnScanning' | 'rgbDefault' | 'rgbRowScanning' | 'rgbColumnScanning';
export const LED_ARRAY_DRIVES: readonly LedArrayDrive[] = [
  'ledDefault',
  'ledRowScanning',
  'ledColumnScanning',
  'rgbDefault',
  'rgbRowScanning',
  'rgbColumnScanning',
];

/**
 * How a multiplexed 7-segment display picks its digit (evo SevenSegmentScanningDriving):
 * decoded = the digit number on selectBits address pins; activeLow / activeHigh = one select pin per digit.
 */
export type ScanningDrive = 'decoded' | 'activeLow' | 'activeHigh';
export const SCANNING_DRIVES: readonly ScanningDrive[] = ['decoded', 'activeLow', 'activeHigh'];

/** Rotation of a resource on the photo (evo writes it for DIP switches, displays and LED arrays) */
export type BoardRotation = 0 | 90 | -90 | 180;

/** Rectangle of a resource on the board photo, in photo pixels */
export interface BoardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardIo {
  kind: BoardIoKind;
  rect: BoardRect;
  /** Name shown for the resource; evo shows the kind when there is none */
  label?: string;
  /**
   * FPGA pins behind the resource, by direction, in the board file's order. A resource's pin i counts
   * inputs first, then outputs, then bidirectional pins (as evo numbers them).
   */
  inputPins: string[];
  outputPins: string[];
  ioPins: string[];
  ioStandard: IoStandard;
  pull: PullBehavior;
  drive: DriveStrength;
  /** The resource is on at 0 (evo ActivityLevel "Active low"); a Pin is always active high */
  activeLow: boolean;
  rotation: BoardRotation;
  /** LED arrays only */
  ledArray?: { rows: number; columns: number; drive: LedArrayDrive };
  /** Multiplexed 7-segment displays only; selectBits < 0 when the digits have one select pin each */
  scanning?: { digits: number; selectBits: number; drive: ScanningDrive };
}

export interface BoardClock {
  /** FPGA pin of the board's oscillator */
  pin: string;
  /** Oscillator frequency in Hz */
  frequency: number;
  pull: PullBehavior;
  ioStandard: IoStandard;
}

export interface BoardFpga {
  vendor: BoardVendor;
  /** Technology / family, e.g. "Artix-7", "Cyclone IV E" */
  family: string;
  /** Device, e.g. "xc7a35t" */
  part: string;
  package: string;
  speedGrade: string;
  /** Programming needs the USB-TMC download path (evo USBTMC) */
  usbTmc: boolean;
  /** Position of the FPGA in the JTAG chain */
  jtagPos: number;
  /** Configuration flash ("" = none) and its JTAG chain position */
  flashName: string;
  flashPos: number;
  clock: BoardClock;
  /** What unused FPGA pins do */
  unusedPull: PullBehavior;
}

/** The board photo: a JPEG (evo format 2) or raw RGB pixels (evo's old format 1, read only) */
export type BoardPicture =
  | { format: 'jpeg'; width: number; height: number; jpeg: Uint8Array }
  | { format: 'rgb'; width: number; height: number; rgb: Uint8Array };

export interface BoardDefinition {
  /** Board name; evo uses it as the root element of the board file and as the boardname of a .circ map */
  name: string;
  fpga: BoardFpga;
  components: BoardIo[];
  picture?: BoardPicture;
}

/** Number of FPGA pins of a resource */
export function boardIoPinCount(io: BoardIo): number {
  return io.inputPins.length + io.outputPins.length + io.ioPins.length;
}

/** FPGA pin and direction of a resource's pin i (inputs first, then outputs, then bidirectional pins) */
export function boardIoPin(io: BoardIo, index: number): { pin: string; dir: 'in' | 'out' | 'inout' } | undefined {
  if (index < 0) return undefined;
  if (index < io.inputPins.length) return { pin: io.inputPins[index], dir: 'in' };
  index -= io.inputPins.length;
  if (index < io.outputPins.length) return { pin: io.outputPins[index], dir: 'out' };
  index -= io.outputPins.length;
  if (index < io.ioPins.length) return { pin: io.ioPins[index], dir: 'inout' };
  return undefined;
}

/** Kinds evo writes a rotation for (IoComponentTypes.hasRotationAttribute) */
export function boardIoHasRotation(kind: BoardIoKind): boolean {
  return kind === 'dipSwitch' || kind === 'sevenSegment' || kind === 'sevenSegmentNoDp' || kind === 'sevenSegmentScanning' || kind === 'ledArray';
}
