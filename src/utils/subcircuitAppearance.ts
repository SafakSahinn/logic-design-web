import type {
  AppearanceShape,
  CustomSubcircuit,
  SubcircuitAppearanceStyle,
  SubcircuitPortDefinition,
} from '../types/circuit';

/**
 * Subcircuit appearances, after Logisim-evolution 5 (com.cburch.logisim.circuit.appear): an IC body is a
 * drawing of shapes plus one port element per IC port and an anchor (the instance location and its default
 * facing). The default styles are built from the circuit's pins like evolution's DefaultClassicAppearance
 * (Logisim 2.7.1's box), DefaultHolyCrossAppearance (option "evolution"), DefaultEvolutionAppearance (option
 * "logisim_evolution") and DefaultCustomAppearance (the start of a custom drawing). Our own 'chip' look is not
 * a drawing: it keeps its own code path.
 */

export type Facing = 'east' | 'west' | 'north' | 'south';
interface Pt {
  x: number;
  y: number;
}

/** What the default appearances read from a circuit pin (evolution: the Pin instance) */
export interface AppearancePin {
  portId: string;
  isOutput: boolean;
  label: string;
  width: number;
  /** Connection point of the inner pin (sorting key) */
  loc: Pt;
  /** Direction the inner pin points (evolution Pin facing; input pins face east by default, outputs west) */
  facing: Facing;
}

// evolution DrawAttr fixed-pitch font metrics and fonts
const FIXED_FONT_HEIGHT = 12;
const FIXED_FONT_CHAR_WIDTH = 8;
const FIXED_FONT_ASCENT = 9;
const FIXED_FONT_DESCENT = 1;
const FIXED_FONT = 'Courier 10 Pitch';
const DEFAULT_FONT = 'SansSerif';
// evolution AppPreferences.COMPONENT_COLOR default (black) and Wire widths
const COMPONENT_COLOR = '#000000';
const WIRE_WIDTH = 3;
const WIRE_WIDTH_BUS = 4;
const OFFS = 50;

const FACINGS: Facing[] = ['east', 'south', 'west', 'north'];
/** Facing after turning `deg` clockwise on screen (our rotation: east -> south at 90) */
export function rotateFacing(f: Facing, deg: number): Facing {
  return FACINGS[(FACINGS.indexOf(f) + Math.round(((deg % 360) + 360) % 360 / 90)) % 4];
}
const reverse = (f: Facing): Facing => rotateFacing(f, 180);

/** evolution Location.create(x, y, true): Java int division by 5, so it truncates toward zero */
const snap5 = (v: number) => Math.trunc(v / 5) * 5;

/** Location.sortVertical (top first, then left) or sortHorizontal (left first, then top) */
function sortPins(pins: AppearancePin[], edge: Facing): AppearancePin[] {
  const vertical = edge === 'east' || edge === 'west';
  return [...pins].sort((a, b) =>
    vertical ? a.loc.y - b.loc.y || a.loc.x - b.loc.x : a.loc.x - b.loc.x || a.loc.y - b.loc.y
  );
}

/** evolution PinAttributes.isClock: an input whose label mentions clk / clock (any width) */
const isClockPin = (p: AppearancePin) => !p.isOutput && /clk|clock/i.test(p.label);

/** evolution's drawing keeps the port and anchor elements above the shapes: ports, then the anchor, last */
function elementsLast(list: AppearanceShape[]): AppearanceShape[] {
  return [...list.filter((s) => s.kind !== 'port' && s.kind !== 'anchor'), ...list.filter((s) => s.kind === 'port'), ...list.filter((s) => s.kind === 'anchor')];
}

const port = (portId: string, x: number, y: number): AppearanceShape => ({ kind: 'port', portId, x: snap5(x), y: snap5(y) });
const anchor = (x: number, y: number): AppearanceShape => ({ kind: 'anchor', x: snap5(x), y: snap5(y), facing: 'east' });

/** Logisim 2.7.1's box (evolution DefaultClassicAppearance): pins on the edge opposite to where they point */
export function buildClassicAppearance(pins: AppearancePin[]): AppearanceShape[] {
  const edge: Record<Facing, AppearancePin[]> = { north: [], south: [], east: [], west: [] };
  for (const p of pins) edge[reverse(p.facing)].push(p);
  (Object.keys(edge) as Facing[]).forEach((k) => (edge[k] = sortPins(edge[k], k)));
  const numNorth = edge.north.length;
  const numSouth = edge.south.length;
  const numEast = edge.east.length;
  const numWest = edge.west.length;
  const maxVert = Math.max(numNorth, numSouth);
  const maxHorz = Math.max(numEast, numWest);
  const computeOffset = (numFacing: number, numOpposite: number, maxOthers: number) => {
    const maxThis = Math.max(numFacing, numOpposite);
    const maxOffs = maxThis <= 1 ? (maxOthers === 0 ? 15 : 10) : maxThis === 2 ? 10 : maxOthers === 0 ? 5 : 10;
    return maxOffs + 10 * Math.trunc((maxThis - numFacing) / 2);
  };
  const computeDimension = (maxThis: number, maxOthers: number) =>
    maxThis < 3 ? 30 : maxOthers === 0 ? 10 * maxThis : 10 * maxThis + 10;
  const offsNorth = computeOffset(numNorth, numSouth, maxHorz);
  const offsSouth = computeOffset(numSouth, numNorth, maxHorz);
  const offsEast = computeOffset(numEast, numWest, maxVert);
  const offsWest = computeOffset(numWest, numEast, maxVert);
  const width = computeDimension(maxVert, maxHorz);
  const height = computeDimension(maxHorz, maxVert);
  let ax = 0;
  let ay = 0;
  if (numEast > 0) [ax, ay] = [width, offsEast];
  else if (numNorth > 0) [ax, ay] = [offsNorth, 0];
  else if (numWest > 0) [ax, ay] = [0, offsWest];
  else if (numSouth > 0) [ax, ay] = [offsSouth, height];
  const rX = Math.trunc((OFFS + ax) / 10) * 10;
  const rY = Math.trunc((OFFS + ay) / 10) * 10;
  const ret: AppearanceShape[] = [
    {
      kind: 'curve',
      x0: rX + Math.trunc((width - 8) / 2),
      y0: rY + 1,
      x1: rX + Math.trunc((width + 8) / 2),
      y1: rY + 1,
      cx: rX + Math.trunc(width / 2),
      cy: rY + 11,
      strokeWidth: 2,
      stroke: '#808080',
    },
    { kind: 'rect', x: rX, y: rY, width, height, strokeWidth: 2 },
  ];
  const place = (list: AppearancePin[], x: number, y: number, dx: number, dy: number) =>
    list.forEach((p, i) => ret.push(port(p.portId, x + dx * i, y + dy * i)));
  place(edge.west, rX, rY + offsWest, 0, 10);
  place(edge.east, rX + width, rY + offsEast, 0, 10);
  place(edge.north, rX + offsNorth, rY, 10, 0);
  place(edge.south, rX + offsSouth, rY + height, 10, 0);
  ret.push(anchor(rX + ax, rY + ay));
  return elementsLast(ret);
}

/** Inputs on the west edge, outputs on the east one, each sorted top to bottom */
function westEast(pins: AppearancePin[]): { west: AppearancePin[]; east: AppearancePin[] } {
  return { west: sortPins(pins.filter((p) => !p.isOutput), 'west'), east: sortPins(pins.filter((p) => p.isOutput), 'east') };
}

/** Text width of the Holy Cross appearance: 10 point character widths for ' '..'}', 8 for the rest */
const ASCII_WIDTHS = [
  3, 4, 5, 8, 6, 10, 9, 3, 4, 4, 5, 8, 3, 4, 3, 3, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 8, 8, 8, 5, 11, 7, 7, 8, 8, 7, 6, 8, 8, 3, 3,
  7, 6, 9, 8, 8, 7, 8, 7, 7, 5, 8, 7, 9, 6, 7, 6, 4, 3, 4, 8, 5, 5, 6, 6, 5, 6, 6, 4, 6, 6, 2, 2, 5, 2, 10, 6, 6, 6, 6, 4, 5, 4, 6, 6,
  8, 6, 6, 5, 6, 3, 6,
];
export function holyCrossTextWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? ASCII_WIDTHS[c - 32] ?? 8 : 8;
  }
  return w;
}

/** evolution DefaultHolyCrossAppearance (attribute value "evolution"): name on top, labels inside */
export function buildHolyCrossAppearance(pins: AppearancePin[], name: string): AppearanceShape[] {
  const LABEL_OUTSIDE = 5;
  const LABEL_GAP = 15;
  const PORT_GAP = 10;
  const TOP_MARGIN = 30;
  const TOP_TEXT_MARGIN = 5;
  const BOTTOM_MARGIN = 5;
  const { west, east } = westEast(pins);
  const maxLeft = Math.max(0, ...west.map((p) => holyCrossTextWidth(p.label)));
  const maxRight = Math.max(0, ...east.map((p) => holyCrossTextWidth(p.label)));
  const maxHorz = Math.max(east.length, west.length);
  let width = 2 * LABEL_OUTSIDE + maxLeft + maxRight + LABEL_GAP;
  width = Math.max(100, Math.trunc((width + 9) / 10) * 10);
  const height = Math.max(40, PORT_GAP * maxHorz + TOP_MARGIN + BOTTOM_MARGIN);
  let aX = 0;
  let aY = 0;
  if (east.length > 0) [aX, aY] = [width, TOP_MARGIN];
  else if (west.length > 0) [aX, aY] = [0, TOP_MARGIN];
  const rx = OFFS + (9 - ((aX + 9) % 10));
  const ry = OFFS + (9 - ((aY + 9) % 10));
  const ret: AppearanceShape[] = [{ kind: 'rect', x: rx, y: ry, width, height, strokeWidth: 2 }];
  const place = (list: AppearancePin[], x: number, left: boolean) =>
    list.forEach((p, i) => {
      const y = ry + TOP_MARGIN + PORT_GAP * i;
      ret.push(port(p.portId, x, y));
      if (p.label)
        ret.push({
          kind: 'text',
          x: x + (left ? LABEL_OUTSIDE : -LABEL_OUTSIDE),
          y,
          text: p.label,
          fontFamily: DEFAULT_FONT,
          fontSize: 10,
          fill: COMPONENT_COLOR,
          halign: left ? 'left' : 'right',
          valign: 'middle',
        });
    });
  place(west, rx, true);
  place(east, rx + width, false);
  if (name)
    ret.push({ kind: 'text', x: rx + Math.trunc(width / 2), y: ry + TOP_TEXT_MARGIN, text: name, fontFamily: DEFAULT_FONT, fontSize: 12, fill: COMPONENT_COLOR, halign: 'center', valign: 'top' });
  ret.push(anchor(rx + aX, ry + aY));
  return elementsLast(ret);
}

/** evolution DefaultEvolutionAppearance (attribute value "logisim_evolution"): stubs, labels, name bar */
export function buildEvolutionAppearance(pins: AppearancePin[], name: string, fixedSize: boolean): AppearanceShape[] {
  const { west, east } = westEast(pins);
  const labelWidth = (p: AppearancePin) => p.label.length * FIXED_FONT_CHAR_WIDTH;
  const maxLeft = Math.max(0, ...west.map(labelWidth));
  const maxRight = Math.max(0, ...east.map(labelWidth));
  const titleWidth = (name ? name.length : 14) * FIXED_FONT_CHAR_WIDTH;
  const maxVert = Math.max(east.length, west.length);
  const dy = Math.trunc((FIXED_FONT_HEIGHT + (FIXED_FONT_HEIGHT >> 2) + 5) / 10) * 10;
  const textWidth = fixedSize ? 25 * FIXED_FONT_CHAR_WIDTH : Math.max(maxLeft + maxRight + 35, titleWidth + 15);
  const thight = Math.trunc((FIXED_FONT_HEIGHT + 10) / 10) * 10;
  const width = Math.trunc(textWidth / 10) * 10 + 20;
  const height = maxVert > 0 ? maxVert * dy + thight : 10 + thight;
  const sdy = (FIXED_FONT_ASCENT - FIXED_FONT_DESCENT) >> 1;
  let ax = 0;
  let ay = 0;
  if (east.length > 0) [ax, ay] = [width, 10];
  else if (west.length > 0) [ax, ay] = [0, 10];
  const rx = OFFS + (9 - ((ax + 9) % 10));
  const ry = OFFS + (9 - ((ay + 9) % 10));
  const ret: AppearanceShape[] = [];
  const place = (list: AppearancePin[], x: number, left: boolean) =>
    list.forEach((p, i) => {
      const y = ry + 10 + dy * i;
      const wide = p.width > 1;
      const h = wide ? WIRE_WIDTH_BUS : WIRE_WIDTH;
      ret.push({ kind: 'rect', x: left ? x : x - 10, y: y - (h >> 1), width: 10, height: h, paint: 'fill', fill: COMPONENT_COLOR });
      ret.push(port(p.portId, x, y));
      const clock = isClockPin(p);
      if (clock)
        ret.push({ kind: 'poly', closed: false, points: [{ x: x + 11, y: y - 4 }, { x: x + 18, y }, { x: x + 11, y: y + 4 }], strokeWidth: 2 });
      let label = p.label;
      const max = clock ? 11 : 12;
      if (fixedSize && label.length > max) label = label.substring(0, max - 3) + '...';
      ret.push({
        kind: 'text',
        x: x + (left ? 15 : -15) + (clock ? 8 : 0),
        y: y + sdy,
        text: label,
        fontFamily: FIXED_FONT,
        fontSize: 12,
        fill: COMPONENT_COLOR,
        halign: left ? 'left' : 'right',
        valign: 'baseline',
      });
    });
  place(west, rx, true);
  place(east, rx + width, false);
  ret.push({ kind: 'rect', x: rx + 10, y: ry + height - thight, width: width - 20, height: thight, paint: 'fill', fill: COMPONENT_COLOR });
  ret.push({ kind: 'rect', x: rx + 10, y: ry, width: width - 20, height, strokeWidth: 2, stroke: COMPONENT_COLOR });
  let label = name || 'VHDL Component';
  if (fixedSize && label.length > 23) label = label.substring(0, 20) + '...';
  ret.push({
    kind: 'text',
    x: rx + (width >> 1),
    y: ry + (height - FIXED_FONT_DESCENT - 5),
    text: label,
    fontFamily: FIXED_FONT,
    fontSize: 14,
    bold: true,
    fill: '#ffffff',
    halign: 'center',
    valign: 'baseline',
  });
  ret.push(anchor(rx + ax, ry + ay));
  return elementsLast(ret);
}

/** evolution DefaultCustomAppearance: what a new custom appearance starts from */
export function buildDefaultCustomAppearance(pins: AppearancePin[]): AppearanceShape[] {
  const { west, east } = westEast(pins);
  const maxVert = Math.max(east.length, west.length);
  const width = Math.trunc((25 * FIXED_FONT_CHAR_WIDTH) / 10) * 10 + 20;
  const height = maxVert > 0 ? maxVert * 10 + 10 : 10;
  let ax = 0;
  let ay = 0;
  if (east.length > 0) [ax, ay] = [width, 10];
  else if (west.length > 0) [ax, ay] = [0, 10];
  const rx = OFFS + (9 - ((ax + 9) % 10));
  const ry = OFFS + (9 - ((ay + 9) % 10));
  const ret: AppearanceShape[] = [];
  west.forEach((p, i) => ret.push(port(p.portId, rx, ry + 10 + 10 * i)));
  east.forEach((p, i) => ret.push(port(p.portId, rx + width, ry + 10 + 10 * i)));
  ret.push({ kind: 'rect', x: rx, y: ry, width, height, strokeWidth: 1 });
  ret.push(anchor(rx + ax, ry + ay));
  return elementsLast(ret);
}

/** The pins of a subcircuit definition as the default appearances read them */
export function subcircuitAppearancePins(def: CustomSubcircuit): AppearancePin[] {
  return def.ports.map((p: SubcircuitPortDefinition) => {
    const inner = def.components.find((c) => c.id === p.targetCompId);
    const pin = inner && [...inner.inputs, ...inner.outputs].find((q) => q.id === p.targetPinId);
    const isOutput = p.type === 'output';
    return {
      portId: p.id,
      isOutput,
      label: p.name ?? '',
      width: p.width ?? 1,
      loc: pin ? { x: pin.x, y: pin.y } : { x: 0, y: 0 },
      facing: rotateFacing(isOutput ? 'west' : 'east', inner?.rotation ?? 0),
    };
  });
}

/** The full drawing (shapes, ports, anchor) of a definition's appearance; null for our chip look */
export function subcircuitAppearanceShapes(def: CustomSubcircuit): AppearanceShape[] | null {
  const style: SubcircuitAppearanceStyle = def.appearance?.style ?? 'chip';
  if (style === 'chip') return null;
  const pins = subcircuitAppearancePins(def);
  if (style === 'classic') return buildClassicAppearance(pins);
  if (style === 'evolution') return buildHolyCrossAppearance(pins, def.name);
  if (style === 'logisim_evolution') return buildEvolutionAppearance(pins, def.name, !!def.appearance?.fixedSize);
  const shapes = def.appearance?.shapes;
  if (!shapes || !shapes.length) return buildDefaultCustomAppearance(pins);
  // Ports the drawing lacks (added to the circuit after it was drawn) go next to it, like evolution adds them
  const have = new Set(shapes.flatMap((s) => (s.kind === 'port' ? [s.portId] : [])));
  const missing = def.ports.filter((p) => !have.has(p.id));
  const out = shapes.filter((s) => s.kind !== 'port' || def.ports.some((p) => p.id === s.portId));
  if (!out.some((s) => s.kind === 'anchor')) {
    const first = out.find((s) => s.kind === 'port');
    out.push({ kind: 'anchor', x: first?.x ?? 0, y: first?.y ?? 0, facing: 'east' });
  }
  if (missing.length) {
    const b = shapesBounds(out);
    const a = out.find((s) => s.kind === 'anchor')!;
    const gridUp = (v: number, base: number) => base + Math.ceil((v - base) / 10) * 10;
    const gridDown = (v: number, base: number) => base + Math.floor((v - base) / 10) * 10;
    const y0 = gridUp(b.maxY + 10, a.y);
    let li = 0;
    let ri = 0;
    for (const p of missing) {
      if (p.type === 'input') out.push({ kind: 'port', portId: p.id, x: gridDown(b.minX, a.x), y: y0 + 10 * li++ });
      else out.push({ kind: 'port', portId: p.id, x: gridUp(b.maxX, a.x), y: y0 + 10 * ri++ });
    }
  }
  return out;
}

/** Estimated extent of a text shape: 0.6 em per character, ascent 0.8 em, descent 0.2 em */
export function appearanceTextBox(s: Extract<AppearanceShape, { kind: 'text' }>): { x: number; y: number; width: number; height: number; baseline: number } {
  const lines = s.text.split('\n');
  const width = Math.max(1, ...lines.map((l) => l.length)) * s.fontSize * 0.6;
  const ascent = s.fontSize * 0.8;
  const descent = s.fontSize * 0.2;
  const baseline =
    s.valign === 'top' ? s.y + ascent : s.valign === 'middle' ? s.y + (ascent - descent) / 2 : s.valign === 'bottom' ? s.y - descent : s.y;
  const x = s.halign === 'left' ? s.x : s.halign === 'right' ? s.x - width : s.x - width / 2;
  return { x, y: baseline - ascent, width, height: ascent + descent + (lines.length - 1) * s.fontSize, baseline };
}

/** Bounds of a drawing (ports and the anchor count as their point, like evolution's CircuitAppearance.getBounds) */
export function shapesBounds(shapes: AppearanceShape[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const s of shapes) {
    switch (s.kind) {
      case 'rect':
      case 'oval':
      case 'image':
        add(s.x, s.y);
        add(s.x + s.width, s.y + s.height);
        break;
      case 'line':
        add(s.x1, s.y1);
        add(s.x2, s.y2);
        break;
      case 'poly':
        s.points.forEach((p) => add(p.x, p.y));
        break;
      case 'curve':
        add(s.x0, s.y0);
        add(s.x1, s.y1);
        // the curve stays inside the hull of its ends and the half-way point towards the control
        add((s.x0 + 2 * s.cx + s.x1) / 4, (s.y0 + 2 * s.cy + s.y1) / 4);
        break;
      case 'text': {
        const b = appearanceTextBox(s);
        add(b.x, b.y);
        add(b.x + b.width, b.y + b.height);
        break;
      }
      case 'port':
      case 'anchor':
        add(s.x, s.y);
        break;
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * An appearance placed as our part body: the drawing moved so the body's top-left corner is the origin. The
 * corner sits on the 10px grid counted from the anchor (ports are 10px apart from it, so they land on the grid),
 * and width + height is a multiple of 20 so a quarter turn about the body centre keeps them there.
 */
export interface SubcircuitLayout {
  /** Drawing shapes (no ports, no anchor), body coordinates, bottom first */
  shapes: AppearanceShape[];
  /** Port id -> connection point in body coordinates */
  ports: Map<string, Pt>;
  /** Connection points of the definition's input ports and output ports, in port order (our pin order) */
  inputs: Pt[];
  outputs: Pt[];
  anchor: Pt & { facing: Facing };
  width: number;
  height: number;
}

const layoutCache = new WeakMap<CustomSubcircuit, SubcircuitLayout | null>();

export function subcircuitLayout(def: CustomSubcircuit): SubcircuitLayout | null {
  if (layoutCache.has(def)) return layoutCache.get(def)!;
  const all = subcircuitAppearanceShapes(def);
  let result: SubcircuitLayout | null = null;
  if (all) {
    const a = all.find((s): s is Extract<AppearanceShape, { kind: 'anchor' }> => s.kind === 'anchor')!;
    const b = shapesBounds(all);
    const ox = a.x - Math.ceil((a.x - b.minX) / 10) * 10;
    const oy = a.y - Math.ceil((a.y - b.minY) / 10) * 10;
    const width = Math.max(10, Math.ceil((b.maxX - ox) / 10) * 10);
    let height = Math.max(10, Math.ceil((b.maxY - oy) / 10) * 10);
    if ((width + height) % 20 !== 0) height += 10;
    const ports = new Map<string, Pt>();
    const shapes: AppearanceShape[] = [];
    for (const s of all) {
      if (s.kind === 'port') ports.set(s.portId, { x: s.x - ox, y: s.y - oy });
      else if (s.kind !== 'anchor') shapes.push(translateShape(s, -ox, -oy));
    }
    const at = (p: SubcircuitPortDefinition) => ports.get(p.id) ?? { x: 0, y: 0 };
    const inputs = def.ports.filter((p) => p.type === 'input').map(at);
    const outputs = def.ports.filter((p) => p.type === 'output').map(at);
    result = { shapes, ports, inputs, outputs, anchor: { x: a.x - ox, y: a.y - oy, facing: a.facing }, width, height };
  }
  layoutCache.set(def, result);
  return result;
}

export function translateShape(s: AppearanceShape, dx: number, dy: number): AppearanceShape {
  switch (s.kind) {
    case 'line':
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case 'poly':
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case 'curve':
      return { ...s, x0: s.x0 + dx, y0: s.y0 + dy, cx: s.cx + dx, cy: s.cy + dy, x1: s.x1 + dx, y1: s.y1 + dy };
    default:
      return { ...s, x: s.x + dx, y: s.y + dy };
  }
}

// ---- SVG elements of an appearance, as evolution's SvgCreator / AppearancePort / AppearanceAnchor write them ----

/** One SVG element: tag, attributes in writing order, text content */
export interface AppearanceSvgElement {
  tag: string;
  attrs: Array<[string, string]>;
  text?: string;
}

const colorPart = (c: string) => c.slice(0, 7).toLowerCase();
const alphaOf = (c: string): number | null => (/^#[0-9a-f]{8}$/i.test(c) ? parseInt(c.slice(7, 9), 16) : null);
/** Java String.format("%5.3f", alpha / 255.0) */
const opacityText = (a: number) => (a / 255).toFixed(3).padStart(5, ' ');

function strokeAttrs(out: Array<[string, string]>, strokeWidth: number | undefined, stroke: string | undefined) {
  if ((strokeWidth ?? 1) !== 1) out.push(['stroke-width', String(strokeWidth)]);
  const c = stroke ?? '#000000';
  out.push(['stroke', colorPart(c)]);
  const a = alphaOf(c);
  if (a !== null && a !== 255) out.push(['stroke-opacity', opacityText(a)]);
  out.push(['fill', 'none']);
}

/** SvgCreator.populateFill */
function fillAttrs(out: Array<[string, string]>, s: { paint?: string; strokeWidth?: number; stroke?: string; fill?: string }) {
  const type = s.paint ?? 'stroke';
  if (type === 'fill') out.push(['stroke', 'none']);
  else strokeAttrs(out, s.strokeWidth, s.stroke);
  if (type === 'stroke') {
    const i = out.findIndex(([k]) => k === 'fill');
    if (i >= 0) out[i] = ['fill', 'none'];
    else out.push(['fill', 'none']);
    return;
  }
  const f = s.fill ?? '#ffffff';
  const i = out.findIndex(([k]) => k === 'fill');
  if (colorPart(f) === '#000000') {
    if (i >= 0) out.splice(i, 1);
  } else if (i >= 0) out[i] = ['fill', colorPart(f)];
  else out.push(['fill', colorPart(f)]);
  const a = alphaOf(f);
  if (a !== null && a !== 255) out.push(['fill-opacity', opacityText(a)]);
}

/**
 * The SVG element of one appearance object. Ports need their inner pin location and direction; the port and
 * anchor format is evolution's (centre x, y and dir) or Logisim 2.7.1's (a box: x, y, width, height, which
 * evolution reads too).
 */
export function appearanceShapeToSvg(
  s: AppearanceShape,
  portInfo: (portId: string) => { pin: Pt; isInput: boolean } | undefined,
  format: 'evolution' | 'logisim' = 'evolution'
): AppearanceSvgElement | null {
  const n = (v: number) => String(Math.round(v));
  switch (s.kind) {
    case 'rect': {
      const attrs: Array<[string, string]> = [['x', n(s.x)], ['y', n(s.y)], ['width', n(s.width)], ['height', n(s.height)]];
      fillAttrs(attrs, s);
      if (s.rx !== undefined) attrs.push(['rx', n(s.rx)], ['ry', n(s.rx)]);
      return { tag: 'rect', attrs };
    }
    case 'oval': {
      // Java int division, as SvgCreator.createOval
      const hw = Math.trunc(s.width / 2);
      const hh = Math.trunc(s.height / 2);
      const attrs: Array<[string, string]> = [['cx', n(s.x + hw)], ['cy', n(s.y + hh)], ['rx', n(hw)], ['ry', n(hh)]];
      fillAttrs(attrs, s);
      return { tag: 'ellipse', attrs };
    }
    case 'line': {
      const attrs: Array<[string, string]> = [['x1', n(s.x1)], ['y1', n(s.y1)], ['x2', n(s.x2)], ['y2', n(s.y2)]];
      strokeAttrs(attrs, s.strokeWidth, s.stroke);
      return { tag: 'line', attrs };
    }
    case 'poly': {
      const attrs: Array<[string, string]> = [['points', s.points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')]];
      fillAttrs(attrs, s);
      return { tag: s.closed ? 'polygon' : 'polyline', attrs };
    }
    case 'curve': {
      const attrs: Array<[string, string]> = [['d', `M${n(s.x0)},${n(s.y0)} Q${n(s.cx)},${n(s.cy)} ${n(s.x1)},${n(s.y1)}`]];
      fillAttrs(attrs, s);
      return { tag: 'path', attrs };
    }
    case 'text': {
      const attrs: Array<[string, string]> = [['x', n(s.x)], ['y', n(s.y)]];
      const f = s.fill ?? '#000000';
      if (colorPart(f) !== '#000000') attrs.push(['fill', colorPart(f)]);
      const a = alphaOf(f);
      if (a !== null && a !== 255) attrs.push(['fill-opacity', opacityText(a)]);
      attrs.push(['font-family', s.fontFamily], ['font-size', String(s.fontSize)]);
      if (s.italic) attrs.push(['font-style', 'italic']);
      if (s.bold) attrs.push(['font-weight', 'bold']);
      attrs.push(['text-anchor', s.halign === 'left' ? 'start' : s.halign === 'right' ? 'end' : 'middle']);
      attrs.push(['dominant-baseline', s.valign === 'top' ? 'top' : s.valign === 'bottom' ? 'bottom' : s.valign === 'baseline' ? 'alphabetic' : 'central']);
      return { tag: 'text', attrs, text: s.text };
    }
    case 'image': {
      const attrs: Array<[string, string]> = [];
      if (s.attribution) attrs.push(['attribution', s.attribution]);
      if (s.license) attrs.push(['license', s.license]);
      attrs.push(['x', n(s.x)], ['y', n(s.y)], ['width', n(Math.max(1, s.width))], ['height', n(Math.max(1, s.height))]);
      if (s.scale) attrs.push(['scale', s.scale]);
      if (s.src) attrs.push(['href', s.src.replace(/[\r\n]+/g, '')]);
      return { tag: 'image', attrs };
    }
    case 'port': {
      const info = portInfo(s.portId);
      if (!info) return null;
      const pin = `${n(info.pin.x)},${n(info.pin.y)}`;
      if (format === 'logisim') {
        const r = info.isInput ? 4 : 5;
        return { tag: 'circ-port', attrs: [['height', String(2 * r)], ['pin', pin], ['width', String(2 * r)], ['x', n(s.x - r)], ['y', n(s.y - r)]] };
      }
      return { tag: 'circ-port', attrs: [['dir', info.isInput ? 'in' : 'out'], ['pin', pin], ['x', n(s.x)], ['y', n(s.y)]] };
    }
    case 'anchor':
      if (format === 'logisim')
        return { tag: 'circ-anchor', attrs: [['facing', s.facing], ['height', '6'], ['width', '6'], ['x', n(s.x - 3)], ['y', n(s.y - 3)]] };
      return { tag: 'circ-anchor', attrs: [['facing', s.facing], ['x', n(s.x)], ['y', n(s.y)]] };
  }
}
