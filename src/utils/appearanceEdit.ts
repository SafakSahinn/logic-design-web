import type {
  AppearanceDynamicShape,
  AppearanceShape,
  CircuitComponentInstance,
  CircuitWire,
  CustomSubcircuit,
  SubcircuitAppearance,
  SubcircuitAppearanceStyle,
} from '../types/circuit';
import {
  buildClassicAppearance,
  buildDefaultCustomAppearance,
  buildEvolutionAppearance,
  buildHolyCrossAppearance,
  subcircuitAppearancePins,
  subcircuitAppearanceShapes,
  subcircuitLayout,
  translateShape,
  type Facing,
} from './subcircuitAppearance';
import { snapPt10, rerouteWiresToRemappedPins } from './wiringEngine';
import { updatePinPositions } from './circuitEngine';
import { createDynamicShape, dynamicShapeValid, resolveDynamicTemplate } from './dynamicElements';

/**
 * Editing a subcircuit appearance (evolution's appearance editor, com.cburch.logisim.gui.appear + draw tools):
 * what the editor starts from, the geometry of the draw shapes it moves and resizes, and how a changed
 * appearance is carried to every instance (evolution keeps an instance's location on the anchor and its facing
 * attribute, so the anchor stays put and the drawing turns with the anchor's facing).
 */

type Pt = { x: number; y: number };

export const APPEARANCE_STYLE_OPTIONS: Array<{ value: SubcircuitAppearanceStyle; label: string; title: string }> = [
  { value: 'chip', label: 'Çip (uygulama)', title: 'Uygulamanın kendi entegre görünümü: girişler solda, çıkışlar sağda' },
  { value: 'classic', label: 'Klasik Logisim', title: 'Logisim 2.7.1 kutusu: pinler iç pinin baktığı yönün karşı kenarında' },
  { value: 'evolution', label: 'Holy Cross', title: 'Logisim-evolution "evolution" (Holy Cross) kutusu: ad üstte, etiketler içeride' },
  { value: 'logisim_evolution', label: 'Logisim-evolution', title: 'Logisim-evolution kendi görünümü: pin çıkıntıları, etiketler, alt ad şeridi' },
  { value: 'custom', label: 'Özel çizim', title: 'Görünüm düzenleyicide çizilen şekiller' },
];

const FACING_DEG: Record<Facing, number> = { east: 0, south: 90, west: 180, north: 270 };

/** Body size of an instance: the drawn layout, or our chip look (120 wide, 20px pin pitch) */
function bodyOf(def: CustomSubcircuit | undefined, comp: CircuitComponentInstance): { w: number; h: number; anchor: Pt; facing: Facing } {
  const layout = def ? subcircuitLayout(def) : null;
  if (layout) return { w: layout.width, h: layout.height, anchor: { x: layout.anchor.x, y: layout.anchor.y }, facing: layout.anchor.facing };
  const h = Math.max(60, (Math.max(comp.inputs.length, comp.outputs.length) + 1) * 20);
  // The chip look has no anchor: its first pin stands in for one
  return { w: 120, h, anchor: comp.inputs.length ? { x: 0, y: 20 } : { x: 120, y: 20 }, facing: 'east' };
}

/** A body point turned about the body centre, as updatePinPositions turns pins */
function rotateBody(p: Pt, w: number, h: number, rot: number): Pt {
  if (!rot) return p;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const dx = p.x - w / 2;
  const dy = p.y - h / 2;
  return { x: w / 2 + (dx * cos - dy * sin), y: h / 2 + (dx * sin + dy * cos) };
}

/**
 * Instances of `defId` re-laid for its new definition (already registered), each keeping its anchor on the same
 * canvas point and turning by the change of the anchor's facing. Returns the new parts and the wires re-routed to
 * the moved pins (pins keep their ids), or null when no instance of it is in `comps`.
 */
export function relayoutInstances(
  comps: CircuitComponentInstance[],
  wires: CircuitWire[],
  defId: string,
  oldDef: CustomSubcircuit,
  newDef: CustomSubcircuit
): { comps: CircuitComponentInstance[]; wires: CircuitWire[] } | null {
  const remap = new Map<string, string | null>();
  let changed = false;
  const next = comps.map((c) => {
    if (c.type !== 'subcircuit' || c.state.subcircuitId !== defId) return c;
    changed = true;
    const before = bodyOf(oldDef, c);
    const after = bodyOf(newDef, c);
    const rot = c.rotation || 0;
    const newRot = (((rot + FACING_DEG[before.facing] - FACING_DEG[after.facing]) % 360) + 360) % 360;
    const a0 = rotateBody(before.anchor, before.w, before.h, rot);
    const a1 = rotateBody(after.anchor, after.w, after.h, newRot);
    const x = Math.round((c.x + a0.x - a1.x) / 10) * 10;
    const y = Math.round((c.y + a0.y - a1.y) / 10) * 10;
    for (const p of [...c.inputs, ...c.outputs]) {
      const sp = snapPt10(p);
      remap.set(`${sp.x},${sp.y}`, p.id);
    }
    return updatePinPositions({ ...c, x, y, rotation: (newRot || undefined) as CircuitComponentInstance['rotation'] });
  });
  if (!changed) return null;
  return { comps: next, wires: rerouteWiresToRemappedPins(wires, comps, next, remap) };
}

/** The drawing the editor opens with: the custom drawing, else what the current style shows (a new custom start for the chip look) */
export function editorStartShapes(def: CustomSubcircuit): AppearanceShape[] {
  const style = def.appearance?.style ?? 'chip';
  if (style === 'custom' || style === 'chip') {
    const custom = subcircuitAppearanceShapes({ ...def, appearance: { ...def.appearance, style: 'custom', shapes: def.appearance?.shapes } });
    return custom ?? buildDefaultCustomAppearance(subcircuitAppearancePins(def));
  }
  return subcircuitAppearanceShapes(def) ?? buildDefaultCustomAppearance(subcircuitAppearancePins(def));
}

/** evolution's two reset buttons: the default custom start, or the Logisim-evolution box with fixed size */
export function resetShapes(def: CustomSubcircuit, kind: 'custom' | 'logisim_evolution' | 'classic' | 'evolution'): AppearanceShape[] {
  const pins = subcircuitAppearancePins(def);
  if (kind === 'logisim_evolution') return buildEvolutionAppearance(pins, def.name, true);
  if (kind === 'classic') return buildClassicAppearance(pins);
  if (kind === 'evolution') return buildHolyCrossAppearance(pins, def.name);
  return buildDefaultCustomAppearance(pins);
}

/** The appearance for a new style; a custom drawing is kept when switching away (evolution keeps it too) */
export function appearanceWithStyle(def: CustomSubcircuit, style: SubcircuitAppearanceStyle): SubcircuitAppearance | undefined {
  const cur = def.appearance;
  if (style === 'chip' && !cur?.shapes && !cur?.fixedSize) return undefined;
  const next: SubcircuitAppearance = { ...cur, style };
  if (style === 'custom' && !next.shapes?.length) next.shapes = buildDefaultCustomAppearance(subcircuitAppearancePins(def));
  return next;
}

// ---------------------------------------------------------------------------------------------------------
// Draw-shape geometry for the editor
// ---------------------------------------------------------------------------------------------------------

/** Points a shape can be dragged by (evolution getHandles): box corners, line / poly vertices, curve ends + control */
export function shapeHandles(s: AppearanceShape): Pt[] {
  switch (s.kind) {
    case 'rect':
    case 'oval':
    case 'image':
    case 'dynamic':
      return [
        { x: s.x, y: s.y },
        { x: s.x + s.width, y: s.y },
        { x: s.x + s.width, y: s.y + s.height },
        { x: s.x, y: s.y + s.height },
      ];
    case 'line':
      return [
        { x: s.x1, y: s.y1 },
        { x: s.x2, y: s.y2 },
      ];
    case 'poly':
      return s.points.map((p) => ({ ...p }));
    case 'curve':
      return [
        { x: s.x0, y: s.y0 },
        { x: s.cx, y: s.cy },
        { x: s.x1, y: s.y1 },
      ];
    default:
      return [];
  }
}

/** The shape with handle `i` moved to `p` (a box keeps the opposite corner; shift = square, like evolution) */
export function moveHandle(s: AppearanceShape, i: number, p: Pt, square = false): AppearanceShape {
  switch (s.kind) {
    case 'rect':
    case 'oval':
    case 'image': {
      const corners = shapeHandles(s);
      const opp = corners[(i + 2) % 4];
      let dx = p.x - opp.x;
      let dy = p.y - opp.y;
      if (square) {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * m;
        dy = Math.sign(dy || 1) * m;
      }
      return { ...s, x: Math.min(opp.x, opp.x + dx), y: Math.min(opp.y, opp.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
    }
    case 'line':
      return i === 0 ? { ...s, x1: p.x, y1: p.y } : { ...s, x2: p.x, y2: p.y };
    case 'poly':
      return { ...s, points: s.points.map((q, k) => (k === i ? { x: p.x, y: p.y } : q)) };
    case 'curve':
      return i === 0 ? { ...s, x0: p.x, y0: p.y } : i === 1 ? { ...s, cx: p.x, cy: p.y } : { ...s, x1: p.x, y1: p.y };
    default:
      return s;
  }
}

export { translateShape };

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Rough text box: 0.6 em a character, ascent 0.8 em, descent 0.2 em (same estimate as the drawing bounds) */
function textBox(s: Extract<AppearanceShape, { kind: 'text' }>) {
  const lines = s.text.split('\n');
  const width = Math.max(1, ...lines.map((l) => l.length)) * s.fontSize * 0.6;
  const ascent = s.fontSize * 0.8;
  const descent = s.fontSize * 0.2;
  const baseline = s.valign === 'top' ? s.y + ascent : s.valign === 'middle' ? s.y + (ascent - descent) / 2 : s.valign === 'bottom' ? s.y - descent : s.y;
  const x = s.halign === 'left' ? s.x : s.halign === 'right' ? s.x - width : s.x - width / 2;
  return { x, y: baseline - ascent, width, height: ascent + descent + (lines.length - 1) * s.fontSize };
}

/** Whether `p` hits the shape (`tol` = pick distance in drawing units); a stroke-only shape is hit on its outline */
export function hitShape(s: AppearanceShape, p: Pt, tol: number): boolean {
  const filled = 'paint' in s && (s.paint === 'fill' || s.paint === 'both');
  switch (s.kind) {
    case 'rect':
    case 'image': {
      const inside = p.x >= s.x - tol && p.x <= s.x + s.width + tol && p.y >= s.y - tol && p.y <= s.y + s.height + tol;
      if (!inside) return false;
      if (s.kind === 'image' || filled) return true;
      return p.x <= s.x + tol || p.x >= s.x + s.width - tol || p.y <= s.y + tol || p.y >= s.y + s.height - tol;
    }
    case 'oval': {
      const rx = s.width / 2;
      const ry = s.height / 2;
      const cx = s.x + rx;
      const cy = s.y + ry;
      const outer = ((p.x - cx) / (rx + tol)) ** 2 + ((p.y - cy) / (ry + tol)) ** 2 <= 1;
      if (!outer) return false;
      if (filled || rx <= tol || ry <= tol) return true;
      return ((p.x - cx) / (rx - tol)) ** 2 + ((p.y - cy) / (ry - tol)) ** 2 >= 1;
    }
    case 'line':
      return distToSegment(p, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }) <= tol + (s.strokeWidth ?? 1) / 2;
    case 'poly': {
      const pts = s.points;
      for (let i = 0; i + 1 < pts.length; i++) if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return true;
      if (s.closed && pts.length > 2 && distToSegment(p, pts[pts.length - 1], pts[0]) <= tol) return true;
      if (filled && pts.length > 2) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          if (pts[i].y > p.y !== pts[j].y > p.y && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
        }
        return inside;
      }
      return false;
    }
    case 'curve': {
      let prev = { x: s.x0, y: s.y0 };
      for (let k = 1; k <= 24; k++) {
        const t = k / 24;
        const u = 1 - t;
        const q = { x: u * u * s.x0 + 2 * u * t * s.cx + t * t * s.x1, y: u * u * s.y0 + 2 * u * t * s.cy + t * t * s.y1 };
        if (distToSegment(p, prev, q) <= tol) return true;
        prev = q;
      }
      return false;
    }
    case 'text': {
      const b = textBox(s);
      return p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol;
    }
    case 'port':
    case 'anchor':
      return Math.abs(p.x - s.x) <= Math.max(tol, 5) && Math.abs(p.y - s.y) <= Math.max(tol, 5);
    case 'dynamic': {
      // DynamicElement.contains: inside the box (an LED: inside its oval)
      if (s.element === 'led' || s.element === 'rgbled') {
        const rx = s.width / 2 + tol;
        const ry = s.height / 2 + tol;
        return ((p.x - s.x - s.width / 2) / rx) ** 2 + ((p.y - s.y - s.height / 2) / ry) ** 2 <= 1;
      }
      return p.x >= s.x - tol && p.x <= s.x + s.width + tol && p.y >= s.y - tol && p.y <= s.y + s.height + tol;
    }
  }
}

/** Box of a shape for the rubber band (whole shape inside the band = selected, as evolution's select tool) */
export function shapeBox(s: AppearanceShape): { minX: number; minY: number; maxX: number; maxY: number } {
  if (s.kind === 'text') {
    const b = textBox(s);
    return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
  }
  const pts = s.kind === 'port' || s.kind === 'anchor' ? [{ x: s.x, y: s.y }] : shapeHandles(s);
  return {
    minX: Math.min(...pts.map((q) => q.x)),
    minY: Math.min(...pts.map((q) => q.y)),
    maxX: Math.max(...pts.map((q) => q.x)),
    maxY: Math.max(...pts.map((q) => q.y)),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Evolution's own geometry (CanvasObject.getBounds / contains(loc, false) / overlaps), used to place new
// dynamic elements where nothing is drawn (ShowStateDialog.pickPlacement)
// ---------------------------------------------------------------------------------------------------------

/** Evolution's Bounds: integer corner and size, a point inside when x <= px < x + w */
type EvoBounds = { x: number; y: number; w: number; h: number };

const expandB = (b: EvoBounds, d: number): EvoBounds => (d === 0 ? b : { x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/** Bounds.add(x, y) */
function addPt(b: EvoBounds, x: number, y: number): EvoBounds {
  let { x: nx, y: ny, w, h } = b;
  if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
  if (x < b.x) {
    nx = x;
    w = b.x + b.w - x;
  } else if (x >= b.x + b.w) w = x - b.x + 1;
  if (y < b.y) {
    ny = y;
    h = b.y + b.h - y;
  } else if (y >= b.y + b.h) h = y - b.y + 1;
  return { x: nx, y: ny, w, h };
}

const paintType = (s: AppearanceShape): 'stroke' | 'fill' | 'both' => (s as { paint?: 'stroke' | 'fill' | 'both' }).paint ?? 'stroke';
const strokeOf = (s: AppearanceShape): number => (s as { strokeWidth?: number }).strokeWidth ?? 1;

function curvePoints(s: Extract<AppearanceShape, { kind: 'curve' }>, n = 32): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    pts.push({ x: u * u * s.x0 + 2 * u * t * s.cx + t * t * s.x1, y: u * u * s.y0 + 2 * u * t * s.cy + t * t * s.y1 });
  }
  return pts;
}

function insidePolygon(pts: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (pts[i].y > p.y !== pts[j].y > p.y && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}

function distToPath(p: Pt, pts: Pt[], closed: boolean): number {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i], pts[i + 1]));
  if (closed && pts.length > 2) d = Math.min(d, distToSegment(p, pts[pts.length - 1], pts[0]));
  if (pts.length === 1) d = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  return d;
}

/** CanvasObject.getBounds of a shape (the stroke counts from width 2 on, as evolution's shapes) */
export function evoBounds(s: AppearanceShape, out?: ReadonlySet<string>): EvoBounds {
  const half = (b: EvoBounds) => (strokeOf(s) < 2 || paintType(s) === 'fill' ? b : expandB(b, Math.trunc(strokeOf(s) / 2)));
  switch (s.kind) {
    case 'rect':
    case 'oval':
      return half({ x: s.x, y: s.y, w: s.width, h: s.height });
    case 'image':
      return { x: s.x, y: s.y, w: s.width, h: s.height };
    case 'line':
      return addPt({ x: s.x1, y: s.y1, w: 0, h: 0 }, s.x2, s.y2);
    case 'poly': {
      const xs = s.points.map((q) => q.x);
      const ys = s.points.map((q) => q.y);
      const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
      return strokeOf(s) < 2 ? b : expandB(b, Math.trunc(strokeOf(s) / 2));
    }
    case 'curve': {
      const pts = curvePoints(s);
      const x0 = Math.floor(Math.min(...pts.map((q) => q.x)));
      const y0 = Math.floor(Math.min(...pts.map((q) => q.y)));
      return { x: x0, y: y0, w: Math.ceil(Math.max(...pts.map((q) => q.x))) - x0, h: Math.ceil(Math.max(...pts.map((q) => q.y))) - y0 };
    }
    case 'text': {
      const b = textBox(s);
      return { x: Math.floor(b.x), y: Math.floor(b.y), w: Math.ceil(b.width), h: Math.ceil(b.height) };
    }
    case 'port': {
      const r = out?.has(s.portId) ? 5 : 4;
      return { x: s.x - r, y: s.y - r, w: 2 * r, h: 2 * r };
    }
    case 'anchor': {
      const d = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] }[s.facing];
      return addPt({ x: s.x - 3, y: s.y - 3, w: 6, h: 6 }, s.x + d[0] * 11, s.y + d[1] * 11);
    }
    case 'dynamic': {
      const b = { x: s.x, y: s.y, w: s.width, h: s.height };
      const sw = s.strokeWidth ?? 0;
      return sw < 2 ? b : expandB(b, Math.trunc(sw / 2));
    }
  }
}

/** CanvasObject.contains(loc, false): a stroke-only shape only on its outline */
export function evoContains(s: AppearanceShape, p: Pt, out?: ReadonlySet<string>): boolean {
  const inRect = (x: number, y: number, w: number, h: number) => p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
  switch (s.kind) {
    case 'rect':
    case 'oval': {
      const inner = (x: number, y: number, w: number, h: number): boolean => {
        if (!inRect(x, y, w, h)) return false;
        if (s.kind === 'oval') {
          const dx = p.x - (x + 0.5 * w);
          const dy = p.y - (y + 0.5 * h);
          return (dx * dx) / (w * w) + (dy * dy) / (h * h) <= 0.25;
        }
        if (!s.rx) return true;
        const rx = Math.min(s.rx, w / 2);
        const ry = Math.min(s.rx, h / 2);
        const cx = p.x < x + rx ? x + rx : p.x >= x + w - rx ? x + w - rx : p.x;
        const cy = p.y < y + ry ? y + ry : p.y >= y + h - ry ? y + h - ry : p.y;
        return ((p.x - cx) / (rx || 1)) ** 2 + ((p.y - cy) / (ry || 1)) ** 2 <= 1;
      };
      const sw = strokeOf(s);
      const type = paintType(s);
      if (type === 'fill') return inner(s.x, s.y, s.width, s.height);
      if (type === 'stroke') {
        const tol2 = Math.max(4, sw);
        const tol = Math.trunc(tol2 / 2);
        return inner(s.x - tol, s.y - tol, s.width + tol2, s.height + tol2) && !inner(s.x + tol, s.y + tol, s.width - tol2, s.height - tol2);
      }
      const tol = Math.trunc(sw / 2);
      return inner(s.x - tol, s.y - tol, s.width + sw, s.height + sw);
    }
    case 'image':
      return inRect(s.x, s.y, s.width, s.height);
    case 'line': {
      const t = Math.max(2, Math.trunc(strokeOf(s) / 2));
      return distToSegment(p, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }) < t;
    }
    case 'poly':
    case 'curve': {
      const pts = s.kind === 'poly' ? s.points : curvePoints(s);
      const closed = s.kind === 'poly' ? s.closed : false;
      const type = paintType(s);
      const sw = strokeOf(s);
      if (type === 'stroke') return distToPath(p, pts, closed) < Math.max(2, Math.trunc(sw / 2));
      if (pts.length > 2 && insidePolygon(pts, p)) return true;
      return type === 'both' && distToPath(p, pts, closed) < sw / 2;
    }
    case 'text': {
      const b = textBox(s);
      return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    }
    case 'port':
      return out?.has(s.portId) ? (p.x - s.x) ** 2 + (p.y - s.y) ** 2 < 25 : inRect(s.x - 4, s.y - 4, 8, 8);
    case 'anchor':
      return (p.x - s.x) ** 2 + (p.y - s.y) ** 2 < 9;
    case 'dynamic':
      return inRect(s.x, s.y, s.width, s.height);
  }
}

/**
 * AbstractCanvasObject.overlaps: the bounds meet in an area and some point of it lies in both shapes. Evolution
 * tries 50 random points; this looks at the points of the common area (thinned out on large areas).
 */
export function evoOverlaps(a: AppearanceShape, b: AppearanceShape, out?: ReadonlySet<string>): boolean {
  const A = evoBounds(a, out);
  const B = evoBounds(b, out);
  const x0 = Math.max(A.x, B.x);
  const y0 = Math.max(A.y, B.y);
  const x1 = Math.min(A.x + A.w, B.x + B.w);
  const y1 = Math.min(A.y + A.h, B.y + B.h);
  if (x1 <= x0 || y1 <= y0) return false;
  const step = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) if (evoContains(a, { x, y }, out) && evoContains(b, { x, y }, out)) return true;
  return false;
}

/** ShowStateDialog.pickPlacement: down 10 at a time; past the bottom of the drawing, one column right and back to its top */
function pickPlacement(avoid: AppearanceShape[], shape: AppearanceDynamicShape, box: EvoBounds, out: ReadonlySet<string>): AppearanceDynamicShape {
  let s = shape;
  for (let guard = 0; guard < 20000 && avoid.some((o) => evoOverlaps(s, o, out)); guard++) {
    s = { ...s, y: s.y + 10 };
    if (s.x < box.x + box.w && s.y + evoBounds(s).h >= box.y + box.h) s = { ...s, x: s.x + 10, y: Math.trunc((box.y + 9) / 10) * 10 };
  }
  return s;
}

/** A path as one string, for comparing paths */
export const dynamicPathKey = (path: string[]) => path.join('\u0000');

/**
 * ShowStateDialog.apply: the drawing with exactly the dynamic elements of `checked` (paths to parts that can be
 * shown). Elements no longer checked (or whose part is gone) are removed; new ones are made in the order of their
 * parts' locations, starting at the top-left of the whole drawing and each moved down / right until it overlaps
 * nothing but the anchor; they go on top of the drawing, under the ports. `keepOrder`: make them in the order of
 * `checked` (tests).
 */
export function applyShowState(def: CustomSubcircuit, shapes: AppearanceShape[], checked: string[][], keepOrder = false): AppearanceShape[] {
  const want = new Set(checked.map(dynamicPathKey));
  const out = new Set(def.ports.filter((p) => p.type === 'output').map((p) => p.id));
  let box: EvoBounds | null = null;
  for (const s of shapes) {
    const b = evoBounds(s, out);
    box = !box ? b : { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) };
  }
  const bbox = box ?? { x: 0, y: 0, w: 0, h: 0 };
  const present = new Set<string>();
  const kept = shapes.filter((s) => {
    if (s.kind !== 'dynamic') return true;
    const k = dynamicPathKey(s.path);
    if (!want.has(k) || !dynamicShapeValid(def, s) || present.has(k)) return false;
    present.add(k);
    return true;
  });
  const toAdd = checked
    .filter((p) => !present.has(dynamicPathKey(p)))
    .map((path) => ({ path, chain: path.map((_, i) => resolveDynamicTemplate(def, path.slice(0, i + 1))) }))
    .filter((t) => t.chain.every(Boolean));
  // CompareByLocations: part by part along the paths, x then y (our parts' own corner: they have no Logisim location)
  if (!keepOrder) toAdd.sort((a, b) => {
    for (let i = 0; i < a.chain.length && i < b.chain.length; i++) {
      const pa = a.chain[i]!;
      const pb = b.chain[i]!;
      if (pa.x !== pb.x) return pa.x - pb.x;
      if (pa.y !== pb.y) return pa.y - pb.y;
    }
    return 0;
  });
  const avoid = kept.filter((s) => s.kind !== 'anchor');
  const added: AppearanceShape[] = [];
  let loc = { x: Math.trunc(bbox.x / 5) * 5, y: Math.trunc(bbox.y / 5) * 5 };
  for (const t of toAdd) {
    const target = t.chain[t.chain.length - 1]!;
    const fresh = createDynamicShape(target, t.path, loc.x, loc.y);
    if (!fresh) continue;
    // a new terminal element is 240 x 130 (TtyShape) until it is first painted with a state
    const placed = pickPlacement(avoid, fresh.element === 'tty' ? { ...fresh, width: 240, height: 130 } : fresh, bbox, out);
    loc = { x: placed.x, y: placed.y };
    avoid.push(placed);
    added.push({ ...fresh, x: placed.x, y: placed.y });
  }
  return portsOnTop([...kept, ...added]);
}

/** Keeps ports then the anchor on top of the drawing (evolution's CircuitAppearance does so after every change) */
export function portsOnTop(list: AppearanceShape[]): AppearanceShape[] {
  return [
    ...list.filter((s) => s.kind !== 'port' && s.kind !== 'anchor'),
    ...list.filter((s) => s.kind === 'port'),
    ...list.filter((s) => s.kind === 'anchor'),
  ];
}

/** Raise / lower the selected drawing shapes one step or to the top / bottom (ports and the anchor never move in the order) */
export function reorder(list: AppearanceShape[], selected: Set<number>, how: 'up' | 'down' | 'top' | 'bottom'): { list: AppearanceShape[]; selected: Set<number> } {
  const nDraw = list.filter((s) => s.kind !== 'port' && s.kind !== 'anchor').length;
  const draw = list.slice(0, nDraw).map((s, i) => ({ s, sel: selected.has(i) }));
  const rest = list.slice(nDraw);
  if (how === 'top') draw.sort((a, b) => Number(a.sel) - Number(b.sel));
  else if (how === 'bottom') draw.sort((a, b) => Number(b.sel) - Number(a.sel));
  else if (how === 'up') {
    for (let i = draw.length - 2; i >= 0; i--) if (draw[i].sel && !draw[i + 1].sel) [draw[i], draw[i + 1]] = [draw[i + 1], draw[i]];
  } else {
    for (let i = 1; i < draw.length; i++) if (draw[i].sel && !draw[i - 1].sel) [draw[i], draw[i - 1]] = [draw[i - 1], draw[i]];
  }
  const sel = new Set<number>();
  draw.forEach((d, i) => d.sel && sel.add(i));
  rest.forEach((_, i) => selected.has(nDraw + i) && sel.add(nDraw + i));
  return { list: [...draw.map((d) => d.s), ...rest], selected: sel };
}
