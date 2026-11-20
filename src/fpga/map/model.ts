// FPGA board mapping model (Aşama 6i-2).
//
// The unit of a mapping is a canvas part, as in Logisim-evolution (fpga/data/MapComponent.java): a part has a list
// of pins, inputs first, then outputs, then bidirectional pins (directions as the FPGA sees them: a switch is an
// input, an LED an output). Every pin of a part is mapped on its own to one of:
//   - a pin of a board resource ("x_y" of the resource's rectangle + the resource's pin index, evo pmap "x_y_pin"),
//   - open (evo "open"; outputs and bidirectional pins only),
//   - a constant 0 / 1 (evo vconst; inputs only),
//   - nothing yet (evo "u").
// Mapping a part on a whole resource (evo map="x,y") is an operation that fills every pin (mapWhole); whether a
// stored mapping is such a complete map is derived from it (wholeResourceOf), as evo does when it writes a .circ.
//
// A board resource has logical pins (the ones a part maps to) and FPGA pins. They are the same except for two
// evo resources: an LED array has rows x columns logical pins (one per LED, all outputs) and a multiplexed
// 7-segment display has digits x 8 (segments a..g, dp of each digit, all outputs); the generated top level drives
// their real pins (evo FpgaIoInformationContainer, nrOfExternalPins).
import type { PortDecl } from '../../utils/hdlGenerator';
import { COMPONENT_CATALOG } from '../../utils/circuitEngine';
import type { BoardDefinition, BoardIo } from '../board/model';
import { boardIoPin, boardIoPinCount } from '../board/model';

export type PinDir = 'in' | 'out' | 'inout';

/** One bit of a top-level HDL port, as a pin of the part behind it */
export interface MapPartPin {
  /** HDL port name (getTopLevelPorts) */
  port: string;
  /** Bit of the port, LSB = 0 */
  bit: number;
  /** Width of the port */
  width: number;
  dir: PinDir;
  /** The canvas pin behind the bit and the bit of that pin (a wide pin, or one 1-bit pin per port bit) */
  source?: { pinId: string; bit: number };
}

/** A canvas part whose top-level ports go to the board */
export interface MappablePart {
  /** Canvas part id; the mapping is stored under it */
  compId: string;
  type: string;
  label?: string;
  /** evo .circ boardmap key ("/" + label), null while the part has no label */
  evoKey: string | null;
  /** Inputs first, then outputs, then bidirectional pins; in port order, LSB first */
  pins: MapPartPin[];
}

/** Where one part pin goes */
export type PinTarget = { kind: 'pin'; io: string; pin: number } | { kind: 'open' } | { kind: 'const'; value: 0 | 1 };

/** A design's mapping on one board: per part (canvas id), one target per part pin (null = not mapped) */
export interface BoardMapping {
  /** Board name (BoardDefinition.name; the boardname of a .circ map) */
  board: string;
  parts: Record<string, (PinTarget | null)[]>;
}

/** Text of a part pin for lists: the port, with the bit for a vector port */
export function partPinName(pin: MapPartPin): string {
  return pin.width > 1 ? `${pin.port}[${pin.bit}]` : pin.port;
}

/**
 * The label the user gave the part, if any. A new part is labelled with its catalog name; that default does not
 * count, as in the .circ export (Logisim parts have no label by default).
 */
export function ownLabel(c: { type: string; label?: string }): string | undefined {
  const label = c.label?.trim();
  return label && label !== COMPONENT_CATALOG[c.type as keyof typeof COMPONENT_CATALOG]?.name ? label : undefined;
}

const DIR_ORDER: Record<PinDir, number> = { in: 0, out: 1, inout: 2 };

/**
 * The parts behind the top-level ports, in the order their first port comes. Clock ports are left out: they
 * take the board's oscillator, they are not mapped (as in evo). Ports without a canvas part are left out too.
 */
export function collectMappableParts(ports: PortDecl[], components: { id: string; type: string; label?: string }[] = []): MappablePart[] {
  const labels = new Map(components.map((c) => [c.id, ownLabel(c)]));
  const parts = new Map<string, MappablePart>();
  for (const p of ports) {
    const src = p.source;
    if (!src || src.type === 'clock') continue;
    let part = parts.get(src.compId);
    if (!part) {
      const label = labels.get(src.compId);
      part = { compId: src.compId, type: src.type, label, evoKey: label ? `/${label}` : null, pins: [] };
      parts.set(src.compId, part);
    }
    const ids = src.pins ?? [];
    for (let bit = 0; bit < p.width; bit++) {
      // one wide pin carries every bit, otherwise pin i is bit i (PortDecl.source)
      const pinId = ids.length === 1 ? ids[0] : ids[bit];
      part.pins.push({ port: p.name, bit, width: p.width, dir: p.dir, ...(pinId ? { source: { pinId, bit: ids.length === 1 ? bit : 0 } } : {}) });
    }
  }
  for (const part of parts.values()) {
    // Stable: ports keep their order inside a direction
    part.pins = part.pins.map((pin, i) => ({ pin, i })).sort((a, b) => DIR_ORDER[a.pin.dir] - DIR_ORDER[b.pin.dir] || a.i - b.i).map((x) => x.pin);
  }
  return [...parts.values()];
}

/** The clock ports of the design (they take the board oscillator) */
export function collectClockPorts(ports: PortDecl[]): PortDecl[] {
  return ports.filter((p) => p.source?.type === 'clock');
}

// --- board resources ---------------------------------------------------------------------------------------

/** Key of a board resource: the top-left corner of its rectangle, "x_y" (evo identifies resources by it) */
export function boardIoKey(io: BoardIo): string {
  return `${io.rect.x}_${io.rect.y}`;
}

/**
 * The resource a key names: the one whose rectangle starts there, or else the first one that holds the point
 * (evo looks a resource up with BoardRectangle.isPointInside).
 */
export function findBoardIo(board: BoardDefinition, key: string): BoardIo | undefined {
  const m = /^(\d+)_(\d+)$/.exec(key);
  if (!m) return undefined;
  const x = Number(m[1]);
  const y = Number(m[2]);
  return (
    board.components.find((io) => io.rect.x === x && io.rect.y === y) ??
    board.components.find((io) => x >= io.rect.x && x <= io.rect.x + io.rect.w && y >= io.rect.y && y <= io.rect.y + io.rect.h)
  );
}

/** The top level drives the resource's FPGA pins itself (LED array, multiplexed 7-segment display) */
export function isInternalResource(io: BoardIo): boolean {
  return (io.kind === 'ledArray' && !!io.ledArray) || (io.kind === 'sevenSegmentScanning' && !!io.scanning);
}

/** Number of pins a part can map to on the resource */
export function ioLogicalPinCount(io: BoardIo): number {
  if (io.kind === 'ledArray' && io.ledArray) return io.ledArray.rows * io.ledArray.columns;
  if (io.kind === 'sevenSegmentScanning' && io.scanning) return io.scanning.digits * 8;
  return boardIoPinCount(io);
}

/** Direction of the resource's logical pin i (undefined outside the resource) */
export function ioLogicalPinDir(io: BoardIo, index: number): PinDir | undefined {
  if (index < 0 || index >= ioLogicalPinCount(io)) return undefined;
  if (isInternalResource(io)) return 'out';
  return boardIoPin(io, index)?.dir;
}

/** The pin of a resource a part pin of this direction can take (evo tryInputMap / tryOutputMap / tryIOMap) */
export function dirCompatible(partDir: PinDir, ioDir: PinDir): boolean {
  return partDir === ioDir || ioDir === 'inout';
}

/** An LED array whose logical pins are RGB LEDs (a part's red, green and blue all go to the same pin) */
export function isRgbArray(io: BoardIo): boolean {
  return io.kind === 'ledArray' && !!io.ledArray && io.ledArray.drive.startsWith('rgb');
}

/**
 * Name of a resource's logical pin, as an i18n key of the fpga namespace and its values (evo
 * IoComponentTypes.getInputLabel / getOutputLabel / getIoLabel).
 */
export function ioPinLabel(io: BoardIo, index: number): { key: string; values: Record<string, number | string> } {
  const count = ioLogicalPinCount(io);
  if (io.kind === 'ledArray' && io.ledArray) {
    return { key: 'map.pin.ledArray', values: { row: Math.floor(index / io.ledArray.columns), column: index % io.ledArray.columns } };
  }
  if (io.kind === 'sevenSegmentScanning' && io.scanning) {
    return { key: 'map.pin.scanning', values: { digit: Math.floor(index / 8), segment: SEGMENTS[index % 8] } };
  }
  if ((io.kind === 'sevenSegment' || io.kind === 'sevenSegmentNoDp') && boardIoPin(io, index)?.dir === 'out') {
    return { key: 'map.pin.segment', values: { segment: SEGMENTS[index - io.inputPins.length] ?? String(index) } };
  }
  if (io.kind === 'rgbLed' && boardIoPin(io, index)?.dir === 'out') {
    return { key: `map.pin.rgb.${['red', 'green', 'blue'][index - io.inputPins.length] ?? 'red'}`, values: {} };
  }
  if (io.kind === 'dipSwitch' && boardIoPin(io, index)?.dir === 'in') return { key: 'map.pin.switch', values: { n: index + 1 } };
  return count > 1 ? { key: 'map.pin.numbered', values: { n: index } } : { key: 'map.pin.single', values: {} };
}

const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];

// --- mapping operations ------------------------------------------------------------------------------------

/** A mapping for the part with every pin unmapped */
export function emptyPartMap(part: MappablePart): (PinTarget | null)[] {
  return part.pins.map(() => null);
}

/**
 * Whether the part can go on the whole resource (evo FpgaIoInformationContainer.isCompleteMap): the same number
 * of inputs, outputs and bidirectional pins, or a resource of only bidirectional pins and a part of only inputs
 * or only outputs as many as them.
 */
export function canMapWhole(part: MappablePart, io: BoardIo): boolean {
  if (isInternalResource(io)) return false;
  const n = (d: PinDir) => part.pins.filter((p) => p.dir === d).length;
  const [pin, pout, pio] = [n('in'), n('out'), n('inout')];
  const [rin, rout, rio] = [io.inputPins.length, io.outputPins.length, io.ioPins.length];
  if (pin + pout + pio === 0) return false;
  if (pin === rin && pout === rout && pio === rio) return true;
  return rin === 0 && rout === 0 && pio === 0 && ((pin === rio && pout === 0) || (pout === rio && pin === 0));
}

/**
 * The part on the whole resource (evo MapComponent.tryMap(FpgaIoInformationContainer)): input k on the
 * resource's input k, output k on its output k, a pin the resource lacks in that direction on its
 * bidirectional pin of the same number. Null when the part does not fit (canMapWhole).
 */
export function mapWhole(part: MappablePart, io: BoardIo): (PinTarget | null)[] | null {
  if (!canMapWhole(part, io)) return null;
  const key = boardIoKey(io);
  const rin = io.inputPins.length;
  const rout = io.outputPins.length;
  const k = { in: 0, out: 0, inout: 0 };
  const result: PinTarget[] = [];
  for (const p of part.pins) {
    const i = k[p.dir]++;
    let pin: number;
    if (p.dir === 'in') pin = i < rin ? i : rin + rout + i;
    else if (p.dir === 'out') pin = i < rout ? rin + i : rin + rout + i;
    else pin = rin + rout + i;
    result.push({ kind: 'pin', io: key, pin });
  }
  return result;
}

/**
 * The part's pins on consecutive logical pins of the resource from `start` on (evo's DIP switch on a DIP switch,
 * LED bar on an LED array row, 7-segment display on a digit of a multiplexed one: start = digit x 8). Every pin
 * must exist and take the part pin's direction; null otherwise.
 */
export function mapRun(part: MappablePart, io: BoardIo, start: number): (PinTarget | null)[] | null {
  const key = boardIoKey(io);
  const result: PinTarget[] = [];
  for (let i = 0; i < part.pins.length; i++) {
    const dir = ioLogicalPinDir(io, start + i);
    if (!dir || !dirCompatible(part.pins[i].dir, dir)) return null;
    result.push({ kind: 'pin', io: key, pin: start + i });
  }
  return result;
}

/**
 * An RGB LED part (red, green, blue outputs) on one LED of an RGB LED array: all three pins on that logical pin
 * (evo MapComponent.tryCompleteMap). Null when the resource is not an RGB array or the part is not 3 outputs.
 */
export function mapRgbOnArray(part: MappablePart, io: BoardIo, led: number): (PinTarget | null)[] | null {
  if (!isRgbArray(io) || part.pins.length !== 3 || part.pins.some((p) => p.dir !== 'out')) return null;
  if (led < 0 || led >= ioLogicalPinCount(io)) return null;
  const key = boardIoKey(io);
  return part.pins.map(() => ({ kind: 'pin', io: key, pin: led }));
}

/**
 * The resource the part is completely mapped on, if it is (evo MapComponent.isCompleteMap(true) with the
 * resource taken by nothing else): evo writes such a map as map="x,y". Otherwise undefined (evo writes pmap).
 */
export function wholeResourceOf(part: MappablePart, targets: readonly (PinTarget | null)[], board: BoardDefinition, mapping: BoardMapping): BoardIo | undefined {
  if (targets.length !== part.pins.length || targets.length === 0) return undefined;
  const first = targets[0];
  if (!first || first.kind !== 'pin') return undefined;
  if (!targets.every((t) => t?.kind === 'pin' && t.io === first.io)) return undefined;
  const io = findBoardIo(board, first.io);
  if (!io) return undefined;
  const expected = mapWhole(part, io);
  if (!expected || expected.some((t, i) => t?.kind !== 'pin' || (targets[i] as { pin: number }).pin !== t.pin)) return undefined;
  // Every pin of the resource is this part's (evo isCompletelyMappedBy)
  for (const [compId, other] of Object.entries(mapping.parts)) {
    if (compId === part.compId) continue;
    if (other.some((t) => t?.kind === 'pin' && t.io === first.io)) return undefined;
  }
  return io;
}

/** Whether every pin of the part is open, or every pin a constant (evo writes them as open / vconst) */
export function uniformTarget(targets: readonly (PinTarget | null)[]): 'open' | { value: bigint } | undefined {
  if (targets.length === 0) return undefined;
  if (targets.every((t) => t?.kind === 'open')) return 'open';
  if (targets.every((t) => t?.kind === 'const')) {
    let value = 0n;
    targets.forEach((t, i) => {
      if ((t as { value: 0 | 1 }).value) value |= 1n << BigInt(i);
    });
    return { value };
  }
  return undefined;
}

/** Sets one part pin's target in a copy of the mapping */
export function setPinTarget(mapping: BoardMapping, part: MappablePart, pin: number, target: PinTarget | null): BoardMapping {
  const current = mapping.parts[part.compId] ?? emptyPartMap(part);
  const next = part.pins.map((_, i) => (i === pin ? target : (current[i] ?? null)));
  return { ...mapping, parts: { ...mapping.parts, [part.compId]: next } };
}

/** Sets all of a part's targets in a copy of the mapping (null removes the part's map) */
export function setPartTargets(mapping: BoardMapping, part: MappablePart, targets: (PinTarget | null)[] | null): BoardMapping {
  const parts = { ...mapping.parts };
  if (targets) parts[part.compId] = part.pins.map((_, i) => targets[i] ?? null);
  else delete parts[part.compId];
  return { ...mapping, parts };
}

/**
 * Brings a stored mapping up to date with the design: a part that is gone is dropped, a part whose pin count
 * changed starts unmapped (evo MapComponent.copyMapFrom does the same), a part not in the mapping yet is added
 * unmapped. Returns the new mapping and the ids of the parts that were dropped or reset.
 */
export function reconcileMapping(mapping: BoardMapping, parts: MappablePart[]): { mapping: BoardMapping; dropped: string[]; reset: string[] } {
  const dropped: string[] = [];
  const reset: string[] = [];
  const known = new Set(parts.map((p) => p.compId));
  for (const id of Object.keys(mapping.parts)) if (!known.has(id)) dropped.push(id);
  const next: BoardMapping['parts'] = {};
  for (const part of parts) {
    const stored = mapping.parts[part.compId];
    if (stored && stored.length !== part.pins.length) reset.push(part.compId);
    next[part.compId] = stored && stored.length === part.pins.length ? stored.map((t) => t ?? null) : emptyPartMap(part);
  }
  return { mapping: { board: mapping.board, parts: next }, dropped, reset };
}
