// Plain helpers of the FPGA map dialog (Aşama 6i-3): geometry on the board photo, what a click on a resource maps,
// who uses which resource pin, and the board editor's defaults. No React and no DOM, so they are unit tested.
import type { BoardDefinition, BoardFpga, BoardIo, BoardIoKind, BoardRect } from '../board/model';
import type { BoardMapping, MappablePart, PinTarget } from '../map/model';
import {
  boardIoKey,
  canMapWhole,
  dirCompatible,
  emptyPartMap,
  ioLogicalPinCount,
  ioLogicalPinDir,
  isRgbArray,
  mapRgbOnArray,
  mapRun,
  mapWhole,
} from '../map/model';

/** Size of a board photo in evo (every evo board file has a 740 x 400 picture; the board editor scales to it) */
export const BOARD_WIDTH = 740;
export const BOARD_HEIGHT = 400;

/** The board's drawing area: the photo's size, or evo's standard size when there is no photo */
export function boardSize(board: Pick<BoardDefinition, 'picture'>): { width: number; height: number } {
  return board.picture ? { width: board.picture.width, height: board.picture.height } : { width: BOARD_WIDTH, height: BOARD_HEIGHT };
}

const inside = (r: BoardRect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** The resource under a point of the photo; the smallest one when rectangles overlap (a LED on a connector) */
export function hitTest(board: Pick<BoardDefinition, 'components'>, x: number, y: number): BoardIo | undefined {
  let best: BoardIo | undefined;
  for (const io of board.components) {
    if (!inside(io.rect, x, y)) continue;
    if (!best || io.rect.w * io.rect.h < best.rect.w * best.rect.h) best = io;
  }
  return best;
}

/**
 * Where each logical pin of a resource is drawn: an LED array as its grid of LEDs, a multiplexed display as its
 * digits split into 8 segments each, anything else as equal slices along the longer side (evo paintPartialMap
 * paints the same idea). A resource with one pin is its whole rectangle.
 */
export function logicalPinRects(io: BoardIo): BoardRect[] {
  const n = ioLogicalPinCount(io);
  const { x, y, w, h } = io.rect;
  if (n <= 0) return [];
  if (io.kind === 'ledArray' && io.ledArray) {
    const { rows, columns } = io.ledArray;
    const cw = w / columns;
    const rh = h / rows;
    return Array.from({ length: n }, (_, i) => ({ x: x + (i % columns) * cw, y: y + Math.floor(i / columns) * rh, w: cw, h: rh }));
  }
  if (io.kind === 'sevenSegmentScanning' && io.scanning) {
    const digits = io.scanning.digits;
    const horizontal = w >= h;
    const dw = horizontal ? w / digits : w;
    const dh = horizontal ? h : h / digits;
    return Array.from({ length: n }, (_, i) => {
      const d = Math.floor(i / 8);
      const s = i % 8;
      const dx = horizontal ? x + d * dw : x;
      const dy = horizontal ? y : y + d * dh;
      // The segments of one digit across its short side
      return horizontal ? { x: dx, y: dy + (s * dh) / 8, w: dw, h: dh / 8 } : { x: dx + (s * dw) / 8, y: dy, w: dw / 8, h: dh };
    });
  }
  if (n === 1) return [{ x, y, w, h }];
  const horizontal = w >= h;
  return Array.from({ length: n }, (_, i) =>
    horizontal ? { x: x + (i * w) / n, y, w: w / n, h } : { x, y: y + (i * h) / n, w, h: h / n },
  );
}

/** The logical pin of the resource under a point (0 when the point is outside every slice) */
export function logicalPinAt(io: BoardIo, x: number, y: number): number {
  const rects = logicalPinRects(io);
  const i = rects.findIndex((r) => inside(r, x, y));
  return i < 0 ? 0 : i;
}

/** One use of a resource's logical pin by a part pin */
export interface PinUse {
  compId: string;
  pin: number;
}

/** For every resource key, who uses each of its logical pins */
export function resourceUsage(board: BoardDefinition, mapping: BoardMapping | null): Map<string, PinUse[][]> {
  const usage = new Map<string, PinUse[][]>();
  for (const io of board.components) usage.set(boardIoKey(io), Array.from({ length: ioLogicalPinCount(io) }, () => []));
  if (!mapping) return usage;
  for (const [compId, targets] of Object.entries(mapping.parts)) {
    targets.forEach((t, pin) => {
      if (t?.kind !== 'pin') return;
      const slots = usage.get(t.io);
      if (slots && t.pin >= 0 && t.pin < slots.length) slots[t.pin].push({ compId, pin });
    });
  }
  return usage;
}

/** How much of a part is mapped (open and constants count as mapped) */
export function partMapState(part: MappablePart, targets: readonly (PinTarget | null)[] | undefined): 'none' | 'partial' | 'full' {
  if (!targets || targets.length !== part.pins.length) return 'none';
  const done = targets.filter((t) => t).length;
  return done === 0 ? 'none' : done === targets.length ? 'full' : 'partial';
}

const samePin = (a: PinTarget | null, b: PinTarget | null) => a?.kind === 'pin' && b?.kind === 'pin' && a.io === b.io && a.pin === b.pin;

/**
 * The part with new targets; any other part pin that was on one of the same resource pins loses it (evo
 * unmaps the old part when a resource is taken by a new one). The part's own pins may share one pin (the red,
 * green and blue of an RGB LED on one LED of an RGB array).
 */
export function assignPart(mapping: BoardMapping, part: MappablePart, targets: (PinTarget | null)[]): BoardMapping {
  const own = part.pins.map((_, i) => targets[i] ?? null);
  const parts: BoardMapping['parts'] = {};
  for (const [compId, other] of Object.entries(mapping.parts)) {
    if (compId === part.compId) continue;
    parts[compId] = other.some((t) => own.some((o) => samePin(t, o))) ? other.map((t) => (own.some((o) => samePin(t, o)) ? null : t)) : other;
  }
  parts[part.compId] = own;
  return { ...mapping, parts };
}

/** One pin of the part on a new target, freeing that resource pin from whoever had it (also another pin of the part) */
export function assignPin(mapping: BoardMapping, part: MappablePart, index: number, target: PinTarget | null): BoardMapping {
  const current = mapping.parts[part.compId];
  const own = current && current.length === part.pins.length ? [...current] : emptyPartMap(part);
  if (target?.kind === 'pin') own.forEach((t, i) => i !== index && samePin(t, target) && (own[i] = null));
  own[index] = target;
  const others: BoardMapping['parts'] = {};
  for (const [compId, other] of Object.entries(mapping.parts)) {
    if (compId === part.compId) continue;
    others[compId] = target?.kind === 'pin' && other.some((t) => samePin(t, target)) ? other.map((t) => (samePin(t, target) ? null : t)) : other;
  }
  return { ...mapping, parts: { ...others, [part.compId]: own } };
}

/**
 * What clicking resource pin `at` with a whole part selected maps (evo FpgaIoInformationContainer.tryMap order):
 * an RGB LED on the clicked LED of an RGB array, the whole resource when the part fits it, the part's pins on
 * consecutive pins from the clicked one (from its digit's first segment on a multiplexed display), or else from
 * the first place it fits. Null when the part cannot go on the resource.
 */
export function mapPartAt(part: MappablePart, io: BoardIo, at: number): (PinTarget | null)[] | null {
  if (part.pins.length === 0) return null;
  if (isRgbArray(io)) {
    const rgb = mapRgbOnArray(part, io, at);
    if (rgb) return rgb;
  }
  if (canMapWhole(part, io)) return mapWhole(part, io);
  const start = io.kind === 'sevenSegmentScanning' ? at - (at % 8) : at;
  const step = io.kind === 'sevenSegmentScanning' ? 8 : 1;
  const here = mapRun(part, io, start);
  if (here) return here;
  for (let s = 0; s + part.pins.length <= ioLogicalPinCount(io); s += step) {
    const run = mapRun(part, io, s);
    if (run) return run;
  }
  return null;
}

/** The target clicking resource pin `at` gives one part pin; null when the directions do not fit */
export function mapPinAt(part: MappablePart, index: number, io: BoardIo, at: number): PinTarget | null {
  const pin = part.pins[index];
  const dir = ioLogicalPinDir(io, at);
  if (!pin || !dir || !dirCompatible(pin.dir, dir)) return null;
  return { kind: 'pin', io: boardIoKey(io), pin: at };
}

/** Targets for "leave open" (outputs, bidirectional pins) or "tie to 0 / 1" (inputs) on every pin that can take it */
export function fillPart(part: MappablePart, current: readonly (PinTarget | null)[] | undefined, fill: 'open' | 0 | 1 | 'clear'): (PinTarget | null)[] {
  const base = current && current.length === part.pins.length ? current : emptyPartMap(part);
  return part.pins.map((p, i) => {
    if (fill === 'clear') return null;
    if (fill === 'open') return p.dir === 'in' ? base[i] : { kind: 'open' };
    return p.dir === 'in' ? { kind: 'const', value: fill } : base[i];
  });
}

// --- board editor ---------------------------------------------------------------------------------------

/** A rectangle from two drag corners, inside the board and at least 2 pixels wide and high */
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }, size: { width: number; height: number }): BoardRect | null {
  const clamp = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)));
  const x0 = clamp(Math.min(a.x, b.x), size.width);
  const y0 = clamp(Math.min(a.y, b.y), size.height);
  const x1 = clamp(Math.max(a.x, b.x), size.width);
  const y1 = clamp(Math.max(a.y, b.y), size.height);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** How many FPGA pins a resource kind usually has, by direction (a hint in the board editor) */
export function kindPinHint(kind: BoardIoKind): { in: number; out: number; io: number } {
  switch (kind) {
    case 'led':
      return { in: 0, out: 1, io: 0 };
    case 'button':
      return { in: 1, out: 0, io: 0 };
    case 'pin':
      return { in: 0, out: 0, io: 1 };
    case 'sevenSegment':
      return { in: 0, out: 8, io: 0 };
    case 'sevenSegmentNoDp':
      return { in: 0, out: 7, io: 0 };
    case 'rgbLed':
      return { in: 0, out: 3, io: 0 };
    case 'dipSwitch':
      return { in: 8, out: 0, io: 0 };
    case 'portIo':
      return { in: 0, out: 0, io: 8 };
    case 'sevenSegmentScanning':
      return { in: 0, out: 12, io: 0 };
    case 'ledArray':
      return { in: 0, out: 8, io: 0 };
    case 'localBus':
      return { in: 0, out: 0, io: 0 };
  }
}

/** A new resource of a kind on a rectangle, with no FPGA pins yet */
export function newResource(kind: BoardIoKind, rect: BoardRect): BoardIo {
  const io: BoardIo = { kind, rect, inputPins: [], outputPins: [], ioPins: [], ioStandard: 'default', pull: 'float', drive: 0, activeLow: false, rotation: 0 };
  return withKind(io, kind);
}

/** The resource changed to another kind (adds or drops the LED array / display settings) */
export function withKind(io: BoardIo, kind: BoardIoKind): BoardIo {
  const next: BoardIo = { ...io, kind };
  delete next.ledArray;
  delete next.scanning;
  if (kind === 'ledArray') next.ledArray = io.ledArray ?? { rows: 2, columns: 4, drive: 'ledDefault' };
  if (kind === 'sevenSegmentScanning') next.scanning = io.scanning ?? { digits: 4, selectBits: -1, drive: 'activeLow' };
  if (kind === 'pin') next.activeLow = false;
  return next;
}

/** FPGA pins typed as a list: separated by commas, semicolons or white space */
export function parsePinList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** FPGA pins given to more than one resource pin on the board (compared without case) */
export function boardPinProblems(board: Pick<BoardDefinition, 'components' | 'fpga'>): { duplicates: string[] } {
  const seen = new Map<string, number>();
  for (const io of board.components) for (const p of [...io.inputPins, ...io.outputPins, ...io.ioPins]) seen.set(p.toUpperCase(), (seen.get(p.toUpperCase()) ?? 0) + 1);
  return { duplicates: [...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p) };
}

export function defaultFpga(): BoardFpga {
  return {
    vendor: 'vivado',
    family: 'Artix-7',
    part: 'xc7a35t',
    package: 'cpg236',
    speedGrade: '-1',
    usbTmc: false,
    jtagPos: 1,
    flashName: '',
    flashPos: 2,
    clock: { pin: 'W5', frequency: 100000000, pull: 'float', ioStandard: 'LVCMOS33' },
    unusedPull: 'float',
  };
}

/** An empty board to start the editor with */
export function emptyBoard(name = 'MY_BOARD'): BoardDefinition {
  return { name, fpga: defaultFpga(), components: [] };
}

/** A deep copy the editor can change without touching a shared (cached built-in) board */
export function cloneBoard(board: BoardDefinition): BoardDefinition {
  return {
    name: board.name,
    fpga: { ...board.fpga, clock: { ...board.fpga.clock } },
    components: board.components.map((io) => ({
      ...io,
      rect: { ...io.rect },
      inputPins: [...io.inputPins],
      outputPins: [...io.outputPins],
      ioPins: [...io.ioPins],
      ...(io.ledArray ? { ledArray: { ...io.ledArray } } : {}),
      ...(io.scanning ? { scanning: { ...io.scanning } } : {}),
    })),
    ...(board.picture ? { picture: board.picture } : {}),
  };
}

/** Where a picture of w x h goes on the standard board area: scaled to fit, centred */
export function fitPicture(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const s = Math.min(BOARD_WIDTH / w, BOARD_HEIGHT / h);
  const dw = Math.round(w * s);
  const dh = Math.round(h * s);
  return { x: Math.round((BOARD_WIDTH - dw) / 2), y: Math.round((BOARD_HEIGHT - dh) / 2), w: dw, h: dh };
}
