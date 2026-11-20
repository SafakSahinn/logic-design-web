// Plan of the generated FPGA top level (Aşama 6i-4): which FPGA pins become ports of the top level, how every bit
// of the design module's ports is driven or read, which LED array / multiplexed display drivers and clock dividers
// are needed, and which FPGA pins the constraints place. The HDL writer (wrapper.ts) and the constraint writers
// (constraints.ts) only render this plan.
//
// The top level follows Logisim-evolution's ToplevelHdlGeneratorFactory: it instantiates the design module, its
// ports are the FPGA pins in use plus the board clock "fpgaGlobalClock", a pin of an active-low resource is
// inverted in the top level and its port carries the "n_" prefix, open outputs stay unconnected, constant inputs
// are tied, and bidirectional pins go straight to the design's inout port.
import type { PortDecl } from '../../utils/hdlGenerator';
import type { BoardDefinition, BoardIo, DriveStrength, IoStandard, LedArrayDrive, PullBehavior, ScanningDrive } from '../board/model';
import type { ResolvedPin } from '../map/resolve';
import { boardIoKey } from '../map/model';

/** evo TickComponentHdlGeneratorFactory.FPGA_CLOCK */
export const FPGA_CLOCK = 'fpgaGlobalClock';
/** evo ToplevelHdlGeneratorFactory.FPGA_TOP_LEVEL_NAME */
export const FPGA_TOP_LEVEL_NAME = 'LogisimToplevelShell';

export type PortDir = 'in' | 'out' | 'inout';

/** A port of the generated top level */
export interface TopPort {
  name: string;
  dir: PortDir;
  /** 1 = scalar */
  width: number;
}

/** An FPGA pin the constraints place: the top-level port (bit) and the pin's electrical settings */
export interface PlacedPin {
  port: string;
  /** Bit of a vector port; undefined for a scalar port */
  bit?: number;
  fpgaPin: string;
  ioStandard: IoStandard;
  pull: PullBehavior;
  drive: DriveStrength;
  /** The board oscillator */
  clock?: boolean;
}

/** Where one bit of a design input comes from */
export type InputSource = { kind: 'port'; port: string; invert: boolean } | { kind: 'const'; value: 0 | 1 };

/** One bit of a design port */
export type BitPlan =
  /** Design input bit: driven from a top-level port or a constant */
  | { kind: 'input'; source: InputSource }
  /** Design output bit: drives a top-level port */
  | { kind: 'output'; port: string; invert: boolean }
  /** Design output bit: drives a logical pin of an LED array / multiplexed display driver */
  | { kind: 'internal'; driver: number; color?: 'red' | 'green' | 'blue'; index: number }
  /** Design inout bit: goes straight to a top-level inout port */
  | { kind: 'inout'; port: string }
  /** Design output / inout bit nothing takes */
  | { kind: 'open' };

/** A port of the design module and what happens to each of its bits */
export interface DesignPortPlan {
  name: string;
  dir: PortDir;
  width: number;
  bits: BitPlan[];
  /** Index into TopLevelPlan.clocks for a clock port (bits is empty then) */
  clock?: number;
}

/** A clock port of the design: the board oscillator, divided down to the clock part's rate unless full speed */
export interface ClockPlan {
  /** Design port it drives */
  port: string;
  /** Rate asked for by the clock part, Hz */
  requestedHz: number;
  /** Half period in oscillator cycles; 0 = the oscillator itself */
  halfPeriod: number;
  /** Rate the top level really makes, Hz */
  actualHz: number;
}

/** A driver of an LED array or multiplexed 7-segment display */
export type DriverPlan =
  | {
      kind: 'ledArray';
      id: number;
      io: BoardIo;
      rows: number;
      columns: number;
      drive: LedArrayDrive;
      activeLow: boolean;
      /** Address bits of the scanned dimension (0 for the default drive) */
      addressBits: number;
      /** Per logical pin (LED), the design signal of each color; undefined = off */
      leds: { red?: string; green?: string; blue?: string; mono?: string }[];
      /** External signals in board pin order */
      external: { port: string; bit: number }[];
    }
  | {
      kind: 'scanning';
      id: number;
      io: BoardIo;
      digits: number;
      drive: ScanningDrive;
      activeLow: boolean;
      /** Width of the digit select output */
      selectWidth: number;
      /** Per logical pin (digit * 8 + segment), the design signal; undefined = off */
      segments: (string | undefined)[];
      external: { port: string; bit: number }[];
    };

export interface TopLevelPlan {
  name: string;
  /** Design module / entity it instantiates */
  designName: string;
  ports: TopPort[];
  designPorts: DesignPortPlan[];
  clocks: ClockPlan[];
  drivers: DriverPlan[];
  /** Every FPGA pin the constraints place: the oscillator first (when used), then the mapped pins, then the drivers' pins */
  pins: PlacedPin[];
  usesClock: boolean;
  oscillatorHz: number;
  /** Findings while planning (resource pin counts that do not match the drive) */
  problems: { code: 'resourcePins'; io: BoardIo; expected: number; actual: number }[];
}

export interface ClockOptions {
  /** Feed every clock port the board oscillator directly */
  fullSpeed: boolean;
  /** Rate of a clock part that has no rate of its own (the simulator's global rate), Hz */
  defaultHz: number;
}

/** Bits needed to count 0 .. n-1 (evo getNrOfBitsRequired) */
export function addressBitsFor(n: number): number {
  return n <= 1 ? 0 : Math.ceil(Math.log2(n));
}

/** Bits that hold the value (at least 1) */
export function bitsFor(value: number): number {
  let bits = 1;
  while (value >= 2 ** bits) bits++;
  return bits;
}

/** Number of FPGA pins an LED array uses with its drive (inputs to the board: none) */
export function ledArrayPinCount(rows: number, columns: number, drive: LedArrayDrive): number {
  switch (drive) {
    case 'ledDefault':
      return rows * columns;
    case 'ledRowScanning':
      return addressBitsFor(rows) + columns;
    case 'ledColumnScanning':
      return addressBitsFor(columns) + rows;
    case 'rgbDefault':
      return 3 * rows * columns;
    case 'rgbRowScanning':
      return addressBitsFor(rows) + 3 * columns;
    case 'rgbColumnScanning':
      return addressBitsFor(columns) + 3 * rows;
  }
}

/** Width of a multiplexed display's digit select (evo nrOfControlBits / one pin per digit) */
export function scanningSelectWidth(digits: number, selectBits: number, drive: ScanningDrive): number {
  return drive === 'decoded' ? Math.max(addressBitsFor(digits), selectBits) : digits;
}

const SEGMENT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];

/** Makes identifiers unique without regard to case (VHDL) */
class Names {
  private used = new Set<string>();
  constructor(reserved: string[] = []) {
    for (const r of reserved) this.used.add(r.toLowerCase());
  }
  make(base: string): string {
    let name = base;
    for (let k = 1; this.used.has(name.toLowerCase()); k++) name = `${base}_${k}`;
    this.used.add(name.toLowerCase());
    return name;
  }
}

/** The external signals of an LED array driver, in board pin order (LDS order; evo's RGB default order is broken) */
function ledArrayExternal(id: number, rows: number, columns: number, drive: LedArrayDrive): { ports: TopPort[]; order: { port: string; bit: number }[] } {
  const n = rows * columns;
  const ports: TopPort[] = [];
  const add = (name: string, width: number) => {
    if (width > 0) ports.push({ name, dir: 'out', width });
  };
  switch (drive) {
    case 'ledDefault':
      add(`externalLeds${id}`, n);
      break;
    case 'ledRowScanning':
      add(`rowAddress${id}`, addressBitsFor(rows));
      add(`columnLeds${id}`, columns);
      break;
    case 'ledColumnScanning':
      add(`columnAddress${id}`, addressBitsFor(columns));
      add(`rowLeds${id}`, rows);
      break;
    case 'rgbDefault':
      add(`externalRedLeds${id}`, n);
      add(`externalGreenLeds${id}`, n);
      add(`externalBlueLeds${id}`, n);
      break;
    case 'rgbRowScanning':
      add(`rowAddress${id}`, addressBitsFor(rows));
      add(`columnRedLeds${id}`, columns);
      add(`columnGreenLeds${id}`, columns);
      add(`columnBlueLeds${id}`, columns);
      break;
    case 'rgbColumnScanning':
      add(`columnAddress${id}`, addressBitsFor(columns));
      add(`rowRedLeds${id}`, rows);
      add(`rowGreenLeds${id}`, rows);
      add(`rowBlueLeds${id}`, rows);
      break;
  }
  const order = ports.flatMap((p) => Array.from({ length: p.width }, (_, bit) => ({ port: p.name, bit })));
  return { ports, order };
}

function scanningExternal(id: number, selectWidth: number): { ports: TopPort[]; order: { port: string; bit: number }[] } {
  const ports: TopPort[] = SEGMENT_NAMES.map((s) => ({ name: `Displ${id}_${s}`, dir: 'out' as const, width: 1 }));
  ports.push({ name: `Displ${id}Select`, dir: 'out', width: selectWidth });
  const order = ports.flatMap((p) => Array.from({ length: p.width }, (_, bit) => ({ port: p.name, bit })));
  return { ports, order };
}

/** The clock of one design clock port */
export function planClock(port: string, requestedHz: number, oscillatorHz: number, fullSpeed: boolean): ClockPlan {
  if (fullSpeed || !(requestedHz > 0) || requestedHz * 2 > oscillatorHz) {
    return { port, requestedHz, halfPeriod: 0, actualHz: oscillatorHz };
  }
  const halfPeriod = Math.max(1, Math.round(oscillatorHz / (2 * requestedHz)));
  return { port, requestedHz, halfPeriod, actualHz: oscillatorHz / (2 * halfPeriod) };
}

export interface PlanInput {
  designName: string;
  /** All ports of the design module (getTopLevelPorts) */
  designPorts: PortDecl[];
  /** resolveMapping of the design's parts on the board */
  resolved: ResolvedPin[];
  board: BoardDefinition;
  /** Clock part rate by canvas id (undefined = the default rate) */
  clockRates: Record<string, number | undefined>;
  clock: ClockOptions;
}

/** Plans the top level of a design on a board. The mapping is assumed to have passed the design rule check. */
export function planTopLevel(input: PlanInput): TopLevelPlan {
  const { board, designName } = input;
  const oscillatorHz = board.fpga.clock.frequency;
  const name = designName.toLowerCase() === FPGA_TOP_LEVEL_NAME.toLowerCase() ? `${FPGA_TOP_LEVEL_NAME}_top` : FPGA_TOP_LEVEL_NAME;

  // --- drivers of the internal resources, in board order ---
  const usedInternal = new Set<BoardIo>();
  for (const r of input.resolved) if (r.target.kind === 'internal') usedInternal.add(r.target.io);
  const drivers: DriverPlan[] = [];
  const driverOf = new Map<BoardIo, DriverPlan>();
  const problems: TopLevelPlan['problems'] = [];
  const driverPorts: TopPort[] = [];
  let arrays = 0;
  let displays = 0;
  for (const io of board.components) {
    if (!usedInternal.has(io)) continue;
    const pinCount = io.inputPins.length + io.outputPins.length + io.ioPins.length;
    if (io.kind === 'ledArray' && io.ledArray) {
      const { rows, columns, drive } = io.ledArray;
      const id = arrays++;
      const ext = ledArrayExternal(id, rows, columns, drive);
      const expected = ledArrayPinCount(rows, columns, drive);
      if (expected !== pinCount) problems.push({ code: 'resourcePins', io, expected, actual: pinCount });
      const scanned = drive === 'ledRowScanning' || drive === 'rgbRowScanning' ? rows : drive === 'ledColumnScanning' || drive === 'rgbColumnScanning' ? columns : 1;
      const d: DriverPlan = {
        kind: 'ledArray',
        id,
        io,
        rows,
        columns,
        drive,
        activeLow: io.activeLow,
        addressBits: addressBitsFor(scanned),
        leds: Array.from({ length: rows * columns }, () => ({})),
        external: ext.order,
      };
      drivers.push(d);
      driverOf.set(io, d);
      driverPorts.push(...ext.ports);
    } else if (io.kind === 'sevenSegmentScanning' && io.scanning) {
      const { digits, selectBits, drive } = io.scanning;
      const id = displays++;
      const selectWidth = scanningSelectWidth(digits, selectBits, drive);
      const ext = scanningExternal(id, selectWidth);
      const expected = 8 + selectWidth;
      if (expected !== pinCount) problems.push({ code: 'resourcePins', io, expected, actual: pinCount });
      const d: DriverPlan = {
        kind: 'scanning',
        id,
        io,
        digits,
        drive,
        activeLow: io.activeLow,
        selectWidth,
        segments: Array.from({ length: digits * 8 }, () => undefined),
        external: ext.order,
      };
      drivers.push(d);
      driverOf.set(io, d);
      driverPorts.push(...ext.ports);
    }
  }

  // --- names: the oscillator, the drivers' ports and the design-side signals are fixed; FPGA pin ports get theirs ---
  const names = new Names([
    FPGA_CLOCK,
    name,
    designName,
    'dut',
    ...driverPorts.map((p) => p.name),
    ...input.designPorts.map((p) => `s_${p.name}`),
    ...input.designPorts.filter((p) => p.source?.type === 'clock').map((p) => `s_clock_${p.name}`),
    ...drivers.flatMap((d) => driverSignals(d)),
  ]);

  const resolvedByPort = new Map<string, Map<number, ResolvedPin>>();
  for (const r of input.resolved) {
    let m = resolvedByPort.get(r.pin.port);
    if (!m) resolvedByPort.set(r.pin.port, (m = new Map()));
    m.set(r.pin.bit, r);
  }

  const fpgaPorts: TopPort[] = [];
  const pins: PlacedPin[] = [];
  const clocks: ClockPlan[] = [];
  const designPorts: DesignPortPlan[] = [];

  for (const port of input.designPorts) {
    const plan: DesignPortPlan = { name: port.name, dir: port.dir, width: port.width, bits: [] };
    if (port.source?.type === 'clock') {
      const rate = input.clockRates[port.source.compId] ?? input.clock.defaultHz;
      plan.clock = clocks.length;
      clocks.push(planClock(port.name, rate, oscillatorHz, input.clock.fullSpeed));
      designPorts.push(plan);
      continue;
    }
    const byBit = resolvedByPort.get(port.name);
    for (let bit = 0; bit < port.width; bit++) {
      const r = byBit?.get(bit);
      const t = r?.target;
      const base = port.width > 1 ? `${port.name}_${bit}` : port.name;
      if (port.dir === 'in') {
        if (t?.kind === 'fpga') {
          const invert = t.activeLow;
          const pn = names.make(invert ? `n_${base}` : base);
          fpgaPorts.push({ name: pn, dir: 'in', width: 1 });
          pins.push({ port: pn, fpgaPin: t.fpgaPin.trim(), ioStandard: t.ioStandard, pull: t.pull, drive: t.drive });
          plan.bits.push({ kind: 'input', source: { kind: 'port', port: pn, invert } });
        } else if (t?.kind === 'const') plan.bits.push({ kind: 'input', source: { kind: 'const', value: t.value } });
        else plan.bits.push({ kind: 'input', source: { kind: 'const', value: 0 } });
      } else if (port.dir === 'out') {
        if (t?.kind === 'fpga') {
          const invert = t.activeLow;
          const pn = names.make(invert ? `n_${base}` : base);
          fpgaPorts.push({ name: pn, dir: 'out', width: 1 });
          pins.push({ port: pn, fpgaPin: t.fpgaPin.trim(), ioStandard: t.ioStandard, pull: t.pull, drive: t.drive });
          plan.bits.push({ kind: 'output', port: pn, invert });
        } else if (t?.kind === 'internal' && r) {
          const d = driverOf.get(t.io);
          if (!d) plan.bits.push({ kind: 'open' });
          else {
            const signal = port.width > 1 ? { port: port.name, bit } : { port: port.name };
            const sig = signalText(signal);
            if (d.kind === 'scanning') {
              d.segments[t.ioPin] = sig;
              plan.bits.push({ kind: 'internal', driver: drivers.indexOf(d), index: t.ioPin });
            } else {
              const led = d.leds[t.ioPin];
              const color = rgbColorOf(r, input.resolved, d);
              if (color) led[color] = sig;
              else led.mono = sig;
              plan.bits.push({ kind: 'internal', driver: drivers.indexOf(d), color, index: t.ioPin });
            }
          }
        } else plan.bits.push({ kind: 'open' });
      } else {
        // inout: straight to the pin (evo: IO pins are mapped directly), no inversion
        if (t?.kind === 'fpga') {
          const pn = names.make(base);
          fpgaPorts.push({ name: pn, dir: 'inout', width: 1 });
          pins.push({ port: pn, fpgaPin: t.fpgaPin.trim(), ioStandard: t.ioStandard, pull: t.pull, drive: t.drive });
          plan.bits.push({ kind: 'inout', port: pn });
        } else plan.bits.push({ kind: 'open' });
      }
    }
    designPorts.push(plan);
  }

  for (const d of drivers) {
    const io = d.io;
    const fpga = [...io.inputPins, ...io.outputPins, ...io.ioPins];
    d.external.forEach((e, i) => {
      if (i < fpga.length) pins.push({ port: e.port, bit: driverPortWidth(driverPorts, e.port) > 1 ? e.bit : undefined, fpgaPin: fpga[i].trim(), ioStandard: io.ioStandard, pull: io.pull, drive: io.drive });
    });
  }

  const scans = drivers.some((d) => d.kind === 'scanning' || !d.drive.endsWith('Default'));
  const usesClock = clocks.length > 0 || scans;
  const ports: TopPort[] = [];
  if (usesClock) {
    ports.push({ name: FPGA_CLOCK, dir: 'in', width: 1 });
    const c = board.fpga.clock;
    pins.unshift({ port: FPGA_CLOCK, fpgaPin: c.pin.trim(), ioStandard: c.ioStandard, pull: c.pull, drive: 0, clock: true });
  }
  ports.push(...fpgaPorts, ...driverPorts);
  return { name, designName, ports, designPorts, clocks, drivers, pins, usesClock, oscillatorHz, problems };
}

/** Names of the signals the top level declares for a driver's inputs */
export function driverSignals(d: DriverPlan): string[] {
  if (d.kind === 'scanning') return [`s_scanningSevenSegSegments${d.id}`];
  return d.drive.startsWith('rgb') ? [`s_internalRedLeds${d.id}`, `s_internalGreenLeds${d.id}`, `s_internalBlueLeds${d.id}`] : [`s_internalLeds${d.id}`];
}

function driverPortWidth(ports: TopPort[], name: string): number {
  return ports.find((p) => p.name === name)?.width ?? 1;
}

/** A design signal as written in the top level ("s_port" or "s_port[bit]"; the writers turn [] into () for VHDL) */
function signalText(s: { port: string; bit?: number }): string {
  return s.bit === undefined ? `s_${s.port}` : `s_${s.port}[${s.bit}]`;
}

/**
 * Color of a part pin on an RGB LED array: an RGB LED part has its red, green and blue all on the same LED (evo
 * tryCompleteMap); they are the part's outputs in order. Any other part pin on an RGB array lights all three.
 */
function rgbColorOf(r: ResolvedPin, all: ResolvedPin[], d: Extract<DriverPlan, { kind: 'ledArray' }>): 'red' | 'green' | 'blue' | undefined {
  if (!d.drive.startsWith('rgb') || r.target.kind !== 'internal') return undefined;
  const led = r.target.ioPin;
  const key = boardIoKey(d.io);
  const same = all.filter((o) => o.part.compId === r.part.compId && o.target.kind === 'internal' && boardIoKey(o.target.io) === key && o.target.ioPin === led);
  if (same.length !== 3) return undefined;
  return (['red', 'green', 'blue'] as const)[same.indexOf(r)];
}
