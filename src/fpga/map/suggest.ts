// Suggested mapping of a design on a board (replaced the old sequential pin hand-out).
//
// Each part type has the resource kinds it goes on, best first (a switch on a DIP switch, then on a button ...).
// A part takes, in this order: a whole free resource it fits (evo complete map), a run of free consecutive pins
// of one resource (a 4-bit switch on half of an 8-switch DIP switch, a 7-segment display on one digit of a
// multiplexed one), or else free pins one by one. Pins already used, and the board's clock pin, are never handed
// out twice. Parts that have nothing to go on stay unmapped with a note saying what they need.
import type { BoardDefinition, BoardIo, BoardIoKind } from '../board/model';
import type { PortDecl } from '../../utils/hdlGenerator';
import type { BoardMapping, MappablePart, PinDir, PinTarget } from './model';
import { boardIoKey, canMapWhole, dirCompatible, ioLogicalPinCount, ioLogicalPinDir, isInternalResource, isRgbArray, mapRgbOnArray, mapRun, mapWhole } from './model';
import { occupiedFpgaPins } from './resolve';

/** A remark about a part (or a clock port) the suggestion could not settle by itself; text from fpga:note.<code> */
export interface MapNote {
  code: string;
  compId?: string;
  values: Record<string, string | number>;
}

const INPUT_KINDS: BoardIoKind[] = ['dipSwitch', 'button', 'pin', 'portIo'];
const BUTTON_KINDS: BoardIoKind[] = ['button', 'dipSwitch', 'pin', 'portIo'];
const LED_KINDS: BoardIoKind[] = ['led', 'ledArray', 'pin', 'portIo'];
const INOUT_KINDS: BoardIoKind[] = ['portIo', 'pin'];

/** Part types that have no board resource to go on: the note tells what to connect them to */
const NO_RESOURCE_TYPES = new Set([
  'programmableGenerator',
  'matrixKeypad',
  'joystick',
  'realTimeClock',
  'evoBuzzer',
  'digitalOscilloscope',
  'keyboard',
  'tty',
  'telnet',
  'rgbVideo',
  'asciiKeyboard',
  'buzzer',
  'dotMatrix',
]);

function kindsFor(type: string, dir: PinDir): BoardIoKind[] {
  switch (type) {
    case 'pushbutton':
    case 'powerOnReset':
      return BUTTON_KINDS;
    case 'switch':
    case 'dipSwitch':
    case 'slider':
    case 'passSwitch':
    case 'twoWaySwitch':
      return INPUT_KINDS;
    case 'led':
    case 'probe':
    case 'ledBar':
    case 'twoPinLed':
    case 'hexDigit':
      return LED_KINDS;
    default:
      return dir === 'in' ? INPUT_KINDS : dir === 'out' ? LED_KINDS : INOUT_KINDS;
  }
}

interface Allocator {
  board: BoardDefinition;
  usedLogical: Set<string>;
  usedFpga: Set<string>;
}

const logicalKey = (io: BoardIo, pin: number) => `${boardIoKey(io)}:${pin}`;

function isFree(a: Allocator, io: BoardIo, pin: number): boolean {
  if (a.usedLogical.has(logicalKey(io, pin))) return false;
  // An LED array / display is driven as a whole by the top level: its FPGA pins are taken once, by it
  if (isInternalResource(io)) {
    const own = [...a.usedLogical].some((k) => k.startsWith(`${boardIoKey(io)}:`));
    return own || occupiedFpgaPins(io, pin).every((p) => !a.usedFpga.has(p) && p !== a.board.fpga.clock.pin);
  }
  return occupiedFpgaPins(io, pin).every((p) => !a.usedFpga.has(p) && p !== a.board.fpga.clock.pin);
}

function take(a: Allocator, targets: (PinTarget | null)[]) {
  for (const t of targets) {
    if (t?.kind !== 'pin') continue;
    const io = a.board.components.find((c) => boardIoKey(c) === t.io);
    if (!io) continue;
    a.usedLogical.add(logicalKey(io, t.pin));
    for (const p of occupiedFpgaPins(io, t.pin)) a.usedFpga.add(p);
  }
}

const fitsFree = (a: Allocator, io: BoardIo, targets: (PinTarget | null)[] | null): targets is (PinTarget | null)[] =>
  !!targets && targets.every((t) => t?.kind === 'pin' && isFree(a, io, t.pin));

function resourcesOf(board: BoardDefinition, kinds: BoardIoKind[]): BoardIo[] {
  return kinds.flatMap((k) => board.components.filter((io) => io.kind === k && ioLogicalPinCount(io) > 0));
}

/** A whole free resource, then a free run, of the given kinds */
function placeBlock(a: Allocator, part: MappablePart, kinds: BoardIoKind[]): (PinTarget | null)[] | null {
  const resources = resourcesOf(a.board, kinds);
  for (const io of resources) {
    if (!canMapWhole(part, io)) continue;
    const t = mapWhole(part, io);
    if (fitsFree(a, io, t)) return t;
  }
  for (const io of resources) {
    for (let start = 0; start + part.pins.length <= ioLogicalPinCount(io); start++) {
      const t = mapRun(part, io, start);
      if (fitsFree(a, io, t)) return t;
    }
  }
  return null;
}

/** Free pins one by one; pins left without one stay null */
function placeScattered(a: Allocator, part: MappablePart): (PinTarget | null)[] {
  const result: (PinTarget | null)[] = [];
  for (const pin of part.pins) {
    let found: PinTarget | null = null;
    for (const io of resourcesOf(a.board, kindsFor(part.type, pin.dir))) {
      // A display's segments only make sense as a whole digit
      if (io.kind === 'sevenSegmentScanning') continue;
      for (let i = 0; i < ioLogicalPinCount(io) && !found; i++) {
        const dir = ioLogicalPinDir(io, i);
        if (dir && dirCompatible(pin.dir, dir) && isFree(a, io, i)) found = { kind: 'pin', io: boardIoKey(io), pin: i };
      }
      if (found) break;
    }
    if (found) take(a, [found]);
    result.push(found);
  }
  return result;
}

function placeSevenSegment(a: Allocator, part: MappablePart): (PinTarget | null)[] | null {
  const whole = placeBlock(a, part, ['sevenSegment', 'sevenSegmentNoDp']);
  if (whole) return whole;
  // One digit of a multiplexed display: the part's segments on that digit's a..g, dp (evo tryScanningMap)
  for (const io of resourcesOf(a.board, ['sevenSegmentScanning'])) {
    for (let digit = 0; digit * 8 < ioLogicalPinCount(io); digit++) {
      const t = mapRun(part, io, digit * 8);
      if (fitsFree(a, io, t)) return t;
    }
  }
  return null;
}

function placeRgbLed(a: Allocator, part: MappablePart): (PinTarget | null)[] | null {
  const whole = placeBlock(a, part, ['rgbLed']);
  if (whole) return whole;
  for (const io of a.board.components.filter(isRgbArray)) {
    for (let led = 0; led < ioLogicalPinCount(io); led++) {
      const t = mapRgbOnArray(part, io, led);
      if (t && isFree(a, io, led)) return t;
    }
  }
  return null;
}

const partName = (part: MappablePart) => part.label || part.pins[0]?.port || part.type;

/**
 * A suggested mapping of the parts on the board, keeping what `keep` already maps (the user's own choices).
 * The clock ports only get a note: they take the board's oscillator.
 */
export function suggestMapping(
  board: BoardDefinition,
  parts: MappablePart[],
  options: { keep?: BoardMapping; clockPorts?: PortDecl[]; activeLowParts?: ReadonlySet<string> } = {}
): { mapping: BoardMapping; notes: MapNote[] } {
  const a: Allocator = { board, usedLogical: new Set(), usedFpga: new Set() };
  const mapping: BoardMapping = { board: board.name, parts: {} };
  const notes: MapNote[] = [];
  const keep = options.keep?.board === board.name ? options.keep : undefined;

  // The user's own targets first, so the suggestion works around them
  for (const part of parts) {
    const kept = keep?.parts[part.compId];
    if (kept && kept.length === part.pins.length && kept.some((t) => t)) {
      mapping.parts[part.compId] = [...kept];
      take(a, kept);
    }
  }

  for (const port of options.clockPorts ?? []) {
    notes.push({ code: 'clockOnOscillator', values: { port: port.name, mhz: +(board.fpga.clock.frequency / 1e6).toFixed(3), pin: board.fpga.clock.pin } });
  }

  for (const part of parts) {
    if (mapping.parts[part.compId]) continue;
    const name = partName(part);
    if (NO_RESOURCE_TYPES.has(part.type)) {
      mapping.parts[part.compId] = part.pins.map(() => null);
      notes.push({ code: `noResource.${part.type}`, compId: part.compId, values: { name } });
      continue;
    }
    let targets: (PinTarget | null)[] | null = null;
    if (part.type === 'sevenSegment') targets = placeSevenSegment(a, part);
    else if (part.type === 'rgbLed') targets = placeRgbLed(a, part);
    else if (part.pins.every((p) => p.dir === part.pins[0].dir)) targets = placeBlock(a, part, kindsFor(part.type, part.pins[0].dir));
    if (targets) take(a, targets);
    else {
      targets = placeScattered(a, part);
      if (part.type === 'rgbLed' && targets.some((t) => t)) notes.push({ code: 'rgbOnLeds', compId: part.compId, values: { name } });
    }
    mapping.parts[part.compId] = targets;

    const missing = targets.filter((t) => !t).length;
    if (missing > 0) notes.push({ code: 'outOfResources', compId: part.compId, values: { name, count: missing } });
    if (part.type === 'powerOnReset' && missing === 0) notes.push({ code: 'powerOnResetOnButton', compId: part.compId, values: { name } });
    if (part.type === 'hexDigit' && missing === 0) notes.push({ code: 'hexDigitOnLeds', compId: part.compId, values: { name } });
    if (part.type === 'portIo' && part.pins.some((p) => p.dir === 'inout')) notes.push({ code: 'portIoConnector', compId: part.compId, values: { name } });
    if (options.activeLowParts?.has(part.compId)) notes.push({ code: 'partActiveLow', compId: part.compId, values: { name } });
  }
  return { mapping, notes };
}
