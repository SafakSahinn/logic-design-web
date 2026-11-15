import type {
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
