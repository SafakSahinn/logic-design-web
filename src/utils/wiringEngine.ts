import type { CircuitWire, CircuitPin, CircuitComponentInstance } from '../types/circuit';
import type { LogicValue } from '../types/logic';

export const GRID_SIZE = 10;

/**
 * Snap coordinate value to 10px invisible grid (Logisim standard 10px grid)
 */
export const snapTo10 = (val: number): number => Math.round(val / GRID_SIZE) * GRID_SIZE;

/**
 * Snap 2D coordinate point strictly to 10px invisible grid
 */
export const snapPt10 = (pt: { x: number; y: number }): { x: number; y: number } => ({
  x: Math.round(pt.x / GRID_SIZE) * GRID_SIZE,
  y: Math.round(pt.y / GRID_SIZE) * GRID_SIZE,
});

/**
 * Component body size lookup. circuitEngine registers COMPONENT_CATALOG sizes here so the auto-router
 * can keep re-routed wires out of gate/chip bodies without wiringEngine importing circuitEngine.
 */
type ComponentBodySizeResolver = (comp: CircuitComponentInstance) => { width: number; height: number } | null;
let componentBodySizeResolver: ComponentBodySizeResolver | null = null;
export const setComponentBodySizeResolver = (fn: ComponentBodySizeResolver) => {
  componentBodySizeResolver = fn;
};

interface BodyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Body rectangle on the canvas; rotation turns the body around its centre exactly like updatePinPositions
const getComponentBodyRect = (comp: CircuitComponentInstance): BodyRect | null => {
  const size = componentBodySizeResolver ? componentBodySizeResolver(comp) : null;
  if (!size || size.width <= 0 || size.height <= 0) return null;
  const rot = comp.rotation || 0;
  const cx = comp.x + size.width / 2;
  const cy = comp.y + size.height / 2;
  const quarterTurn = rot === 90 || rot === 270;
  const hw = (quarterTurn ? size.height : size.width) / 2;
  const hh = (quarterTurn ? size.width : size.height) / 2;
  // Pins are snapped onto the 10px grid (a 104px wide chip has its outputs at +100), so shrink the body to
  // the grid as well; otherwise border pins would count as being inside their own body.
  return {
    x0: Math.ceil((cx - hw) / GRID_SIZE) * GRID_SIZE,
    y0: Math.ceil((cy - hh) / GRID_SIZE) * GRID_SIZE,
    x1: Math.floor((cx + hw) / GRID_SIZE) * GRID_SIZE,
    y1: Math.floor((cy + hh) / GRID_SIZE) * GRID_SIZE,
  };
};

export interface WirePoint {
  x: number;
  y: number;
}

export interface WireSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isVertical: boolean;
  wireId: string;
}

export interface CircuitJunction {
  x: number;
  y: number;
  value: LogicValue;
  hasConflict: boolean;
  isBus: boolean;
}

/**
 * Logisim WiringTool direction constants (from com.cburch.logisim.tools.WiringTool)
 * 0 = NONE (at start point)
 * 1 = HORIZONTAL first (then vertical)
 * 2 = VERTICAL first (then horizontal)
 */
export type LogisimWireDirection = 0 | 1 | 2;
export const DIR_NONE: LogisimWireDirection = 0;
export const DIR_HORIZONTAL: LogisimWireDirection = 1;
export const DIR_VERTICAL: LogisimWireDirection = 2;

/**
 * Exact implementation of Logisim's WiringTool.computeMove(int newX, int newY)
 * Locks initial drag direction (Horizontal-first vs Vertical-first) as soon as
 * the cursor leaves the start location, and only flips if cursor returns to startX or startY.
 */
export const computeLogisimWireDirection = (
  start: WirePoint,
  cur: WirePoint,
  direction: LogisimWireDirection
): LogisimWireDirection => {
  const s = snapPt10(start);
  const c = snapPt10(cur);
  let dir = direction;

  if (dir === DIR_NONE) {
    if (c.x !== s.x) dir = DIR_HORIZONTAL;
    else if (c.y !== s.y) dir = DIR_VERTICAL;
  } else if (dir === DIR_HORIZONTAL && c.x === s.x) {
    if (c.y === s.y) dir = DIR_NONE;
    else dir = DIR_VERTICAL;
  } else if (dir === DIR_VERTICAL && c.y === s.y) {
    if (c.x === s.x) dir = DIR_NONE;
    else dir = DIR_HORIZONTAL;
  }

  return dir;
};

/**
 * Computes the orthogonal segments produced by Logisim's WiringTool
 * between `start` and `cur` given locked `direction`.
 * When `components` is provided, automatically steps around any intermediate component pins
 * (such as sibling input pins on the same gate) so connecting to pin B never shorts pin A.
 */
export const getLogisimWiringToolSegments = (
  start: WirePoint,
  cur: WirePoint,
  direction: LogisimWireDirection,
  components?: CircuitComponentInstance[],
  wires?: CircuitWire[]
): Array<{ e0: WirePoint; e1: WirePoint }> => {
  const s = snapPt10(start);
  const c = snapPt10(cur);

  if (s.x === c.x && s.y === c.y) return [];

  const obstaclePins = new Set<string>();
  if (components) {
    for (const comp of components) {
      for (const pin of [...comp.inputs, ...comp.outputs]) {
        const sp = snapPt10(pin);
        if ((sp.x === s.x && sp.y === s.y) || (sp.x === c.x && sp.y === c.y)) continue;
        obstaclePins.add(`${sp.x},${sp.y}`);
      }
    }
  }

  // Existing wires: passing over one of their endpoints/corners, or running along one of them, would make
  // WireRepair join the new wire to that net. Only the new wire's own two ends may touch other wires.
  const wireSegs: Array<{ a: WirePoint; b: WirePoint }> = [];
  if (wires) {
    for (const w of wires) {
      if (!w.startPoint || !w.endPoint) continue;
      const wa = snapPt10(w.startPoint);
      const wb = snapPt10(w.endPoint);
      if (wa.x !== wb.x && wa.y !== wb.y) continue;
      wireSegs.push({ a: wa, b: wb });
      for (const p of [wa, wb]) {
        if ((p.x === s.x && p.y === s.y) || (p.x === c.x && p.y === c.y)) continue;
        obstaclePins.add(`${p.x},${p.y}`);
      }
    }
  }
  const overlapsWire = (a: WirePoint, b: WirePoint): boolean => {
    for (const w of wireSegs) {
      if (a.x === b.x && w.a.x === w.b.x && a.x === w.a.x) {
        const lo = Math.max(Math.min(a.y, b.y), Math.min(w.a.y, w.b.y));
        const hi = Math.min(Math.max(a.y, b.y), Math.max(w.a.y, w.b.y));
        if (hi > lo) return true;
      } else if (a.y === b.y && w.a.y === w.b.y && a.y === w.a.y) {
        const lo = Math.max(Math.min(a.x, b.x), Math.min(w.a.x, w.b.x));
        const hi = Math.min(Math.max(a.x, b.x), Math.max(w.a.x, w.b.x));
        if (hi > lo) return true;
      }
    }
    return false;
  };

  const segHitsObstacle = (a: WirePoint, b: WirePoint): boolean => {
    if (overlapsWire(a, b)) return true;
    if (obstaclePins.size === 0) return false;
    if (a.x === b.x) {
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      for (let y = minY; y <= maxY; y += GRID_SIZE) {
        if (obstaclePins.has(`${a.x},${y}`)) return true;
      }
    } else if (a.y === b.y) {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      for (let x = minX; x <= maxX; x += GRID_SIZE) {
        if (obstaclePins.has(`${x},${a.y}`)) return true;
      }
    }
    return false;
  };

  const pathHitsObstacle = (pts: WirePoint[]): boolean => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (segHitsObstacle(pts[i], pts[i + 1])) return true;
    }
    return false;
  };

  const ptsToSegs = (pts: WirePoint[]): Array<{ e0: WirePoint; e1: WirePoint }> => {
    const clean = simplifyCollinearPoints(pts);
    const out: Array<{ e0: WirePoint; e1: WirePoint }> = [];
    for (let i = 0; i < clean.length - 1; i++) {
      if (clean[i].x !== clean[i + 1].x || clean[i].y !== clean[i + 1].y) {
        out.push({ e0: clean[i], e1: clean[i + 1] });
      }
    }
    return out;
  };

  if (s.x === c.x || s.y === c.y) {
    if (!segHitsObstacle(s, c)) {
      return [{ e0: s, e1: c }];
    }
    for (const offset of [-20, 20, -10, 10, -30, 30]) {
      const cand =
        s.x === c.x
          ? [s, { x: s.x + offset, y: s.y }, { x: s.x + offset, y: c.y }, c]
          : [s, { x: s.x, y: s.y + offset }, { x: c.x, y: s.y + offset }, c];
      if (!pathHitsObstacle(cand)) {
        return ptsToSegs(cand);
      }
    }
    return [{ e0: s, e1: c }];
  }

  const m: WirePoint =
    direction === DIR_HORIZONTAL
      ? { x: c.x, y: s.y }
      : { x: s.x, y: c.y };

  if (!pathHitsObstacle([s, m, c])) {
    return ptsToSegs([s, m, c]);
  }

  // Default L-bend hits an intermediate pin (e.g. dropping vertically through pin A to reach pin B).
  // Try stepping the turn back by 20px (or 10..40px) before the target/start pin or flipping L-direction.
  const tryHvh = (): Array<{ e0: WirePoint; e1: WirePoint }> | null => {
    const stepSign = c.x > s.x ? -1 : 1;
    for (const d of [20, 10, 30, 40, -10, -20]) {
      for (const baseX of [c.x + stepSign * d, s.x - stepSign * d]) {
        if (baseX === s.x || baseX === c.x) continue;
        const cand = [s, { x: baseX, y: s.y }, { x: baseX, y: c.y }, c];
        if (!pathHitsObstacle(cand)) return ptsToSegs(cand);
      }
    }
    return null;
  };

  const tryVhv = (): Array<{ e0: WirePoint; e1: WirePoint }> | null => {
    const stepSign = c.y > s.y ? -1 : 1;
    for (const d of [20, 10, 30, 40, -10, -20]) {
      for (const baseY of [c.y + stepSign * d, s.y - stepSign * d]) {
        if (baseY === s.y || baseY === c.y) continue;
        const cand = [s, { x: s.x, y: baseY }, { x: c.x, y: baseY }, c];
        if (!pathHitsObstacle(cand)) return ptsToSegs(cand);
      }
    }
    return null;
  };

  const mAlt: WirePoint =
    direction === DIR_HORIZONTAL
      ? { x: s.x, y: c.y }
      : { x: c.x, y: s.y };

  if (direction === DIR_HORIZONTAL) {
    const hvh = tryHvh();
    if (hvh) return hvh;
    if (!pathHitsObstacle([s, mAlt, c])) return ptsToSegs([s, mAlt, c]);
    const vhv = tryVhv();
    if (vhv) return vhv;
  } else {
    const vhv = tryVhv();
    if (vhv) return vhv;
    if (!pathHitsObstacle([s, mAlt, c])) return ptsToSegs([s, mAlt, c]);
    const hvh = tryHvh();
    if (hvh) return hvh;
  }

  return ptsToSegs([s, m, c]);
};

/**
 * Simplifies a sequence of orthogonal points by removing redundant collinear intermediate points.
 */
export const simplifyCollinearPoints = (pts: WirePoint[]): WirePoint[] => {
  if (pts.length <= 2) return pts;
  const result: WirePoint[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    if (curr.x === prev.x && curr.y === prev.y) continue;
    const isCollinearH = prev.y === curr.y && curr.y === next.y;
    const isCollinearV = prev.x === curr.x && curr.x === next.x;
    if (!isCollinearH && !isCollinearV) {
      result.push(curr);
    }
  }
  const last = pts[pts.length - 1];
  const prev = result[result.length - 1];
  if (last.x !== prev.x || last.y !== prev.y) {
    result.push(last);
  }
  return result;
};

/**
 * Decomposes any CircuitWire into strictly orthogonal (Horizontal or Vertical)
 * 10px grid-locked segments.
 * In Logisim mode, each wire is a single horizontal or vertical segment (p0.x === p1.x || p0.y === p1.y).
 * Legacy / preset wires with multi-bend paths are also cleanly decomposed.
 */
export const getWireOrthogonalSegments = (
  wire: CircuitWire,
  startPt: WirePoint,
  endPt: WirePoint
): WireSegment[] => {
  const p0 = snapPt10(startPt);
  const p1 = snapPt10(endPt);
  const segs: WireSegment[] = [];

  const addSeg = (a: WirePoint, b: WirePoint) => {
    if (a.x === b.x && a.y === b.y) return;
    segs.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      isVertical: a.x === b.x,
      wireId: wire.id,
    });
  };

  if (wire.waypoints && wire.waypoints.length > 0) {
    const rawPts = [p0, ...wire.waypoints.map(snapPt10), p1];
    const pts = simplifyCollinearPoints(rawPts);
    let prev = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const curr = pts[i];
      if (prev.x === curr.x || prev.y === curr.y) {
        addSeg(prev, curr);
      } else {
        const dx = Math.abs(curr.x - prev.x);
        const dy = Math.abs(curr.y - prev.y);
        const corner = dy > dx ? { x: prev.x, y: curr.y } : { x: curr.x, y: prev.y };
        addSeg(prev, corner);
        addSeg(corner, curr);
      }
      prev = curr;
    }
  } else if (p0.x === p1.x || p0.y === p1.y) {
    // Pure straight horizontal or vertical Logisim Wire segment
    addSeg(p0, p1);
  } else if (wire.branchPoint) {
    const dx = Math.abs(p1.x - p0.x);
    const dy = Math.abs(p1.y - p0.y);
    const corner = dy > dx ? { x: p0.x, y: p1.y } : { x: p1.x, y: p0.y };
    addSeg(p0, corner);
    addSeg(corner, p1);
  } else {
    // Legacy / preset gate output-to-input connection
    const rawMidX = wire.elbowX !== undefined ? wire.elbowX : (p0.x + p1.x) / 2;
    const midX = snapTo10(rawMidX);

    if (midX <= Math.min(p0.x, p1.x) || midX >= Math.max(p0.x, p1.x)) {
      const dx = Math.abs(p1.x - p0.x);
      const dy = Math.abs(p1.y - p0.y);
      const corner = dy > dx ? { x: p0.x, y: p1.y } : { x: p1.x, y: p0.y };
      addSeg(p0, corner);
      addSeg(corner, p1);
    } else {
      const c1 = { x: midX, y: p0.y };
      const c2 = { x: midX, y: p1.y };
      addSeg(p0, c1);
      addSeg(c1, c2);
      addSeg(c2, p1);
    }
  }

  return segs;
};

/**
 * Converts orthogonal segments into a clean SVG path string using M, H, V
 */
export const segmentsToSvgPath = (segs: WireSegment[]): string => {
  if (segs.length === 0) return '';
  let d = `M ${segs[0].x1},${segs[0].y1}`;
  for (const s of segs) {
    if (s.isVertical) {
      d += ` V ${s.y2}`;
    } else {
      d += ` H ${s.x2}`;
    }
  }
  return d;
};

/**
 * Find closest orthogonal projection point on a wire's path,
 * clamped to wire segments and strictly snapped to the 10px grid.
 */
export const getClosestPointOnWire = (
  wire: CircuitWire,
  startPt: WirePoint,
  endPt: WirePoint,
  click: WirePoint
): WirePoint => {
  const segs = getWireOrthogonalSegments(wire, startPt, endPt);
  if (segs.length === 0) return snapPt10(startPt);

  let bestPt = { x: segs[0].x1, y: segs[0].y1 };
  let bestDistSq = Infinity;

  for (const s of segs) {
    let px: number;
    let py: number;
    if (s.isVertical) {
      px = s.x1;
      const minY = Math.min(s.y1, s.y2);
      const maxY = Math.max(s.y1, s.y2);
      const snappedY = snapTo10(click.y);
      py = Math.max(minY, Math.min(maxY, snappedY));
    } else {
      py = s.y1;
      const minX = Math.min(s.x1, s.x2);
      const maxX = Math.max(s.x1, s.x2);
      const snappedX = snapTo10(click.x);
      px = Math.max(minX, Math.min(maxX, snappedX));
    }

    const dSq = (px - click.x) ** 2 + (py - click.y) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestPt = { x: px, y: py };
    }
  }

  return bestPt;
};

/**
 * Canonical straight Logisim wire segment (e0 <= e1, either horizontal or vertical)
 */
interface CanonicalSeg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  isVertical: boolean;
  isBus: boolean;
  bitWidth: number;
  value: LogicValue;
  hasConflict: boolean;
  preferredId?: string;
}

const createCanonicalSeg = (
  a: WirePoint,
  b: WirePoint,
  meta: { isBus?: boolean; bitWidth?: number; value?: LogicValue; hasConflict?: boolean; id?: string }
): CanonicalSeg | null => {
  const p0 = snapPt10(a);
  const p1 = snapPt10(b);
  if (p0.x === p1.x && p0.y === p1.y) return null;
  const isVertical = p0.x === p1.x;
  if (isVertical) {
    const y0 = Math.min(p0.y, p1.y);
    const y1 = Math.max(p0.y, p1.y);
    return {
      x0: p0.x,
      y0,
      x1: p0.x,
      y1,
      isVertical: true,
      isBus: !!meta.isBus,
      bitWidth: meta.bitWidth || (meta.isBus ? 4 : 1),
      value: meta.value ?? 0,
      hasConflict: !!meta.hasConflict,
      preferredId: meta.id,
    };
  } else {
    const x0 = Math.min(p0.x, p1.x);
    const x1 = Math.max(p0.x, p1.x);
    return {
      x0,
      y0: p0.y,
      x1,
      y1: p0.y,
      isVertical: false,
      isBus: !!meta.isBus,
      bitWidth: meta.bitWidth || (meta.isBus ? 4 : 1),
      value: meta.value ?? 0,
      hasConflict: !!meta.hasConflict,
      preferredId: meta.id,
    };
  }
};

/**
 * Checks if point `pt` lies on segment `[startPt, endPt]` (including endpoints)
 */
export const isPointOnWireSegment = (
  pt: WirePoint,
  startPt: WirePoint,
  endPt: WirePoint,
  tolerance = 0
): boolean => {
  const x0 = Math.min(startPt.x, endPt.x);
  const x1 = Math.max(startPt.x, endPt.x);
  const y0 = Math.min(startPt.y, endPt.y);
  const y1 = Math.max(startPt.y, endPt.y);

  if (startPt.x === endPt.x) {
    return Math.abs(pt.x - startPt.x) <= tolerance && pt.y >= y0 - tolerance && pt.y <= y1 + tolerance;
  } else if (startPt.y === endPt.y) {
    return Math.abs(pt.y - startPt.y) <= tolerance && pt.x >= x0 - tolerance && pt.x <= x1 + tolerance;
  }
  return false;
};

/**
 * Logical pin-to-pin view of the circuit for netlist consumers (HDL export, circuit analysis).
 * Canvas wires are straight segments whose ends are usually corners, so "which output drives this input"
 * has to come from the electrical nets (pins + wire endpoints by grid location, legacy pin-to-pin wires,
 * matching tunnel labels), exactly like the simulator sees them. Returns one connection per driven pin:
 * fromPinId = the net's driver (first output pin), toPinId = every other pin of the net.
 */
export const getLogicalConnections = (
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): CircuitWire[] => {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const loc = (p: WirePoint) => `loc_${snapTo10(p.x)}_${snapTo10(p.y)}`;

  const pinOwner = new Map<string, CircuitComponentInstance>();
  const pinIsOutput = new Map<string, boolean>();
  const order: string[] = [];
  for (const c of components) {
    for (const p of [...c.inputs, ...c.outputs]) {
      pinOwner.set(p.id, c);
      pinIsOutput.set(p.id, p.type === 'output');
      order.push(p.id);
      union(p.id, loc(p));
    }
  }
  const tunnelByLabel = new Map<string, string>();
  for (const c of components) {
    if (c.type !== 'tunnel') continue;
    const pins = [...c.inputs, ...c.outputs];
    for (let i = 1; i < pins.length; i++) union(pins[0].id, pins[i].id);
    const label = (c.label || 'Tünel').trim();
    if (pins[0]) {
      if (tunnelByLabel.has(label)) union(tunnelByLabel.get(label)!, pins[0].id);
      else tunnelByLabel.set(label, pins[0].id);
    }
  }
  for (const w of wires) {
    if (w.startPoint && w.endPoint) {
      union(loc(w.startPoint), loc(w.endPoint));
    } else {
      if (w.fromPinId && w.toPinId) union(w.fromPinId, w.toPinId);
      if (w.branchPoint && w.toPinId) union(loc(w.branchPoint), w.toPinId);
    }
  }

  const nets = new Map<string, string[]>();
  for (const id of order) {
    const r = find(id);
    if (!nets.has(r)) nets.set(r, []);
    nets.get(r)!.push(id);
  }
  const result: CircuitWire[] = [];
  let n = 0;
  for (const pins of nets.values()) {
    if (pins.length < 2) continue;
    const driver =
      pins.find((id) => pinIsOutput.get(id) && pinOwner.get(id)?.type !== 'tunnel') ||
      pins.find((id) => pinIsOutput.get(id)) ||
      pins[0];
    for (const id of pins) {
      if (id === driver) continue;
      result.push({
        id: `net_${n++}`,
        fromCompId: pinOwner.get(driver)!.id,
        fromPinId: driver,
        toCompId: pinOwner.get(id)!.id,
        toPinId: id,
        value: 0,
      });
    }
  }
  return result;
};

/**
 * Ids of every wire segment electrically joined to `wireId` through shared endpoints (one Logisim wire / net).
 */
export const getConnectedWireIds = (wires: CircuitWire[], wireId: string): string[] => {
  const keyOf = (p: WirePoint) => `${snapTo10(p.x)},${snapTo10(p.y)}`;
  const atLoc = new Map<string, CircuitWire[]>();
  for (const w of wires) {
    if (!w.startPoint || !w.endPoint) continue;
    for (const k of [keyOf(w.startPoint), keyOf(w.endPoint)]) {
      if (!atLoc.has(k)) atLoc.set(k, []);
      atLoc.get(k)!.push(w);
    }
  }
  const start = wires.find((w) => w.id === wireId);
  if (!start || !start.startPoint || !start.endPoint) return start ? [start.id] : [];
  const seen = new Set<string>([start.id]);
  const queue: CircuitWire[] = [start];
  while (queue.length > 0) {
    const w = queue.shift()!;
    for (const k of [keyOf(w.startPoint!), keyOf(w.endPoint!)]) {
      for (const o of atLoc.get(k) || []) {
        if (!seen.has(o.id)) {
          seen.add(o.id);
          queue.push(o);
        }
      }
    }
  }
  return Array.from(seen);
};

/**
 * Wire clusters (connected through endpoints) that only touch pins of the given components, i.e. the wiring
 * that belongs entirely to a selection. Used to copy a selection together with its internal wiring.
 */
export const getInternalWires = (
  wires: CircuitWire[],
  components: CircuitComponentInstance[],
  selectedCompIds: string[]
): CircuitWire[] => {
  const keyOf = (p: WirePoint) => `${snapTo10(p.x)},${snapTo10(p.y)}`;
  const pinOwner = new Map<string, string>();
  for (const c of components) {
    for (const p of [...c.inputs, ...c.outputs]) pinOwner.set(keyOf(p), c.id);
  }
  const selected = new Set(selectedCompIds);
  const result: CircuitWire[] = [];
  const done = new Set<string>();
  for (const w of wires) {
    if (done.has(w.id) || !w.startPoint || !w.endPoint) continue;
    const cluster = new Set(getConnectedWireIds(wires, w.id));
    cluster.forEach((id) => done.add(id));
    const members = wires.filter((x) => cluster.has(x.id));
    let touchesSelected = false;
    let touchesOther = false;
    for (const m of members) {
      for (const p of [m.startPoint!, m.endPoint!]) {
        const owner = pinOwner.get(keyOf(p));
        if (!owner) continue;
        if (selected.has(owner)) touchesSelected = true;
        else touchesOther = true;
      }
    }
    if (touchesSelected && !touchesOther) result.push(...members);
  }
  return result;
};

/**
 * Slides one straight wire segment perpendicular to itself so that it passes through `target`.
 * Each end of the segment keeps its connections:
 * - an open end simply moves along,
 * - a plain corner/T whose other wires all run along the move axis is stretched (those wires follow),
 * - an end on a component pin or on a collinear neighbour gets a new jog wire from the old to the new end,
 *   so the segment never tears away from a pin.
 * Always computed from the wires as they were when the drag started.
 */
export const moveWireSegment = (
  wires: CircuitWire[],
  components: CircuitComponentInstance[],
  wireId: string,
  target: WirePoint
): CircuitWire[] => {
  const w = wires.find((x) => x.id === wireId);
  if (!w || !w.startPoint || !w.endPoint || (w.waypoints && w.waypoints.length > 0)) return wires;
  const ws = snapPt10(w.startPoint);
  const we = snapPt10(w.endPoint);
  if (ws.x !== we.x && ws.y !== we.y) return wires;
  const isVertical = ws.x === we.x;
  const t = snapPt10(target);
  const dx = isVertical ? t.x - ws.x : 0;
  const dy = isVertical ? 0 : t.y - ws.y;
  if (dx === 0 && dy === 0) return wires;

  const keyOf = (p: WirePoint) => `${p.x},${p.y}`;
  const pinLocs = new Set<string>();
  for (const comp of components) {
    for (const pin of [...comp.inputs, ...comp.outputs]) pinLocs.add(keyOf(snapPt10(pin)));
  }

  const result = wires.map((x) => ({ ...x }));
  const extra: CircuitWire[] = [];

  [ws, we].forEach((p, endIdx) => {
    const moved = { x: p.x + dx, y: p.y + dy };
    const others = result.filter((o) => {
      if (o.id === w.id || !o.startPoint || !o.endPoint) return false;
      const os = snapPt10(o.startPoint);
      const oe = snapPt10(o.endPoint);
      return keyOf(os) === keyOf(p) || keyOf(oe) === keyOf(p);
    });
    if (others.length === 0 && !pinLocs.has(keyOf(p))) return; // open end: moves with the segment

    const alongMoveAxis = (o: CircuitWire) => {
      const os = snapPt10(o.startPoint!);
      const oe = snapPt10(o.endPoint!);
      return (!o.waypoints || o.waypoints.length === 0) && (isVertical ? os.y === oe.y : os.x === oe.x);
    };

    if (!pinLocs.has(keyOf(p)) && others.length > 0 && others.every(alongMoveAxis)) {
      for (const o of others) {
        if (keyOf(snapPt10(o.startPoint!)) === keyOf(p)) o.startPoint = moved;
        else o.endPoint = moved;
        o.fromCompId = '';
        o.toCompId = '';
        o.fromPinId = `loc_${o.startPoint!.x}_${o.startPoint!.y}`;
        o.toPinId = `loc_${o.endPoint!.x}_${o.endPoint!.y}`;
      }
      return;
    }

    extra.push({
      ...w,
      id: `${w.id}_jog${endIdx}`,
      fromCompId: '',
      fromPinId: `loc_${p.x}_${p.y}`,
      toCompId: '',
      toPinId: `loc_${moved.x}_${moved.y}`,
      startPoint: p,
      endPoint: moved,
      waypoints: undefined,
      branchPoint: undefined,
      elbowX: undefined,
    });
  });

  const target0 = result.find((x) => x.id === w.id)!;
  target0.startPoint = { x: ws.x + dx, y: ws.y + dy };
  target0.endPoint = { x: we.x + dx, y: we.y + dy };
  target0.fromCompId = '';
  target0.toCompId = '';
  target0.fromPinId = `loc_${target0.startPoint.x}_${target0.startPoint.y}`;
  target0.toPinId = `loc_${target0.endPoint.x}_${target0.endPoint.y}`;

  return [...result, ...extra];
};

/**
 * Logisim's WiringTool shortening check (willShorten / getShortenResult in WiringTool.java):
 * When the user starts dragging at an endpoint of an existing straight wire `w` and drags
 * back along `w` itself, Logisim shortens (or removes if dragged to the other end) `w`.
 */
export const computeWireShortening = (
  wires: CircuitWire[],
  dragStart: WirePoint,
  dragCur: WirePoint,
  getStart: (w: CircuitWire) => WirePoint,
  getEnd: (w: CircuitWire, s: WirePoint) => WirePoint
): { targetWire: CircuitWire; newStart: WirePoint; newEnd: WirePoint; remove: boolean } | null => {
  const p0 = snapPt10(dragStart);
  const p1 = snapPt10(dragCur);
  if (p0.x === p1.x && p0.y === p1.y) return null;
  if (p0.x !== p1.x && p0.y !== p1.y) return null;

  for (const w of wires) {
    if (w.waypoints && w.waypoints.length > 0) continue;
    const ws = snapPt10(getStart(w));
    const we = snapPt10(getEnd(w, ws));
    if (ws.x !== we.x && ws.y !== we.y) continue; // Only straight segments

    const startsAtWs = ws.x === p0.x && ws.y === p0.y;
    const startsAtWe = we.x === p0.x && we.y === p0.y;
    if (!startsAtWs && !startsAtWe) continue;

    if (isPointOnWireSegment(p1, ws, we, 0)) {
      const otherEnd = startsAtWs ? we : ws;
      const remove = p1.x === otherEnd.x && p1.y === otherEnd.y;
      return {
        targetWire: w,
        newStart: p1,
        newEnd: otherEnd,
        remove,
      };
    }
  }

  return null;
};

/**
 * Exact implementation of Logisim's `WireRepair` (com.cburch.logisim.circuit.WireRepair):
 * 1. Decomposes all wires into straight horizontal/vertical grid-locked segments.
 * 2. Merges overlapping parallel segments (`doOverlaps`).
 * 3. Splits segments wherever another wire's endpoint or a component pin touches their interior (`doSplits`).
 * 4. Merges collinear segments meeting at a degree-2 point where no pin or perpendicular wire exists (`doMerges`).
 */
export const repairWires = (
  wires: CircuitWire[],
  components: CircuitComponentInstance[]
): CircuitWire[] => {
  // Map all component pins by snapped coordinate key "x,y"
  const pinAtLoc = new Map<string, { compId: string; pinId: string }>();
  for (const comp of components) {
    for (const pin of [...comp.inputs, ...comp.outputs]) {
      const sp = snapPt10(pin);
      pinAtLoc.set(`${sp.x},${sp.y}`, { compId: comp.id, pinId: pin.id });
    }
  }

  const findPinById = (pinId: string): CircuitPin | null => {
    if (!pinId) return null;
    for (const comp of components) {
      for (const p of comp.inputs) if (p.id === pinId) return p;
      for (const p of comp.outputs) if (p.id === pinId) return p;
    }
    return null;
  };

  // Step 0: Decompose all wires into canonical straight segments.
  // For legacy/preset wires (wires without explicit startPoint & endPoint), use net-aware
  // orthogonal channel routing so parallel wires of different nets never overlap or short-circuit.
  const ufParent = new Map<string, string>();
  const ufFind = (k: string): string => {
    let curr = k;
    while (ufParent.has(curr) && ufParent.get(curr) !== curr) {
      curr = ufParent.get(curr)!;
    }
    let trace = k;
    while (ufParent.has(trace) && ufParent.get(trace) !== curr) {
      const nxt = ufParent.get(trace)!;
      ufParent.set(trace, curr);
      trace = nxt;
    }
    if (!ufParent.has(curr)) ufParent.set(curr, curr);
    return curr;
  };
  const ufUnion = (a: string, b: string) => {
    const ra = ufFind(a);
    const rb = ufFind(b);
    if (ra !== rb) ufParent.set(ra, rb);
  };

  for (const [locKey, pinInfo] of pinAtLoc) {
    ufUnion(`loc:${locKey}`, `pin:${pinInfo.pinId}`);
  }

  const resolvedEndpoints: Array<{
    wire: CircuitWire;
    sPt: WirePoint;
    ePt: WirePoint;
    isCanonical: boolean;
    netKey: string;
  }> = [];

  for (const w of wires) {
    let sPt: WirePoint | null = null;
    let ePt: WirePoint | null = null;

    if (w.startPoint) {
      sPt = snapPt10(w.startPoint);
    } else if (w.branchPoint) {
      sPt = snapPt10(w.branchPoint);
    } else if (w.fromPinId) {
      const fp = findPinById(w.fromPinId);
      if (fp) sPt = snapPt10(fp);
    }

    if (w.endPoint) {
      ePt = snapPt10(w.endPoint);
    } else if (w.toPinId) {
      const tp = findPinById(w.toPinId);
      if (tp) ePt = snapPt10(tp);
    }

    if (!sPt || !ePt) continue;

    const sk = w.fromPinId && !w.fromPinId.startsWith('loc_') ? `pin:${w.fromPinId}` : `loc:${sPt.x},${sPt.y}`;
    const ek = w.toPinId && !w.toPinId.startsWith('loc_') ? `pin:${w.toPinId}` : `loc:${ePt.x},${ePt.y}`;
    ufUnion(sk, `loc:${sPt.x},${sPt.y}`);
    ufUnion(ek, `loc:${ePt.x},${ePt.y}`);
    ufUnion(sk, ek);

    const isCanonical = Boolean(w.startPoint && w.endPoint && (!w.waypoints || w.waypoints.length === 0));
    resolvedEndpoints.push({ wire: w, sPt, ePt, isCanonical, netKey: sk });
  }

  const pinNetAtLoc = new Map<string, string>();
  for (const [locKey, pinInfo] of pinAtLoc) {
    pinNetAtLoc.set(locKey, ufFind(`pin:${pinInfo.pinId}`));
  }

  interface RoutedNetSeg {
    isVertical: boolean;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    netId: string;
  }
  const placedNetSegs: RoutedNetSeg[] = [];
  const netCorners = new Map<string, string>(); // "x,y" -> netId

  // Auto-routed wires must not run through component bodies (pins sit on the body border, so only the
  // strict interior is an obstacle). Dense or overlapping layouts fall back to body-blind routing.
  const bodyRects: BodyRect[] = [];
  for (const comp of components) {
    const r = getComponentBodyRect(comp);
    if (r) bodyRects.push(r);
  }
  const isInsideBody = (x: number, y: number): boolean => {
    for (const r of bodyRects) {
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
    }
    return false;
  };

  const recordCorner = (pt: WirePoint, netId: string) => {
    netCorners.set(`${pt.x},${pt.y}`, netId);
  };

  const recordSeg = (cSeg: CanonicalSeg, netId: string) => {
    placedNetSegs.push({
      isVertical: cSeg.isVertical,
      x0: cSeg.x0,
      y0: cSeg.y0,
      x1: cSeg.x1,
      y1: cSeg.y1,
      netId,
    });
    recordCorner({ x: cSeg.x0, y: cSeg.y0 }, netId);
    recordCorner({ x: cSeg.x1, y: cSeg.y1 }, netId);
  };

  const isPointOnRoutedSeg = (px: number, py: number, s: RoutedNetSeg): boolean => {
    if (s.isVertical) return px === s.x0 && py >= s.y0 && py <= s.y1;
    return py === s.y0 && px >= s.x0 && px <= s.x1;
  };

  const isCandidatePathValid = (pts: WirePoint[], netId: string, avoidBodies = false): boolean => {
    const cleanPts: WirePoint[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = cleanPts[cleanPts.length - 1];
      if (pts[i].x !== prev.x || pts[i].y !== prev.y) {
        cleanPts.push(pts[i]);
      }
    }
    if (cleanPts.length < 2) return true;

    // Check corners against existing segments/pins of other nets
    for (const pt of cleanPts) {
      const k = `${pt.x},${pt.y}`;
      const pinNet = pinNetAtLoc.get(k);
      if (pinNet && pinNet !== netId) return false;
      const cornerNet = netCorners.get(k);
      if (cornerNet && cornerNet !== netId) return false;
      for (const s of placedNetSegs) {
        if (s.netId !== netId && isPointOnRoutedSeg(pt.x, pt.y, s)) {
          return false;
        }
      }
    }

    // Check each segment against pins, corners, and collinear overlaps of other nets
    for (let i = 0; i < cleanPts.length - 1; i++) {
      const pA = cleanPts[i];
      const pB = cleanPts[i + 1];
      const isVert = pA.x === pB.x;
      const x0 = Math.min(pA.x, pB.x);
      const x1 = Math.max(pA.x, pB.x);
      const y0 = Math.min(pA.y, pB.y);
      const y1 = Math.max(pA.y, pB.y);

      if (isVert) {
        for (let y = y0; y <= y1; y += GRID_SIZE) {
          if (avoidBodies && isInsideBody(x0, y)) return false;
          const k = `${x0},${y}`;
          const pNet = pinNetAtLoc.get(k);
          if (pNet && pNet !== netId) return false;
          const cNet = netCorners.get(k);
          if (cNet && cNet !== netId) return false;
        }
        for (const s of placedNetSegs) {
          if (s.netId === netId) continue;
          if (s.isVertical && s.x0 === x0) {
            if (Math.max(y0, s.y0) <= Math.min(y1, s.y1)) return false;
          }
        }
      } else {
        for (let x = x0; x <= x1; x += GRID_SIZE) {
          if (avoidBodies && isInsideBody(x, y0)) return false;
          const k = `${x},${y0}`;
          const pNet = pinNetAtLoc.get(k);
          if (pNet && pNet !== netId) return false;
          const cNet = netCorners.get(k);
          if (cNet && cNet !== netId) return false;
        }
        for (const s of placedNetSegs) {
          if (s.netId === netId) continue;
          if (!s.isVertical && s.y0 === y0) {
            if (Math.max(x0, s.x0) <= Math.min(x1, s.x1)) return false;
          }
        }
      }
    }

    return true;
  };

  const gridRoute = (sPt: WirePoint, ePt: WirePoint, netId: string, avoidBodies = false): WirePoint[] | null => {
    const MARGIN = 300;
    const minX = Math.min(sPt.x, ePt.x) - MARGIN;
    const minY = Math.min(sPt.y, ePt.y) - MARGIN;
    const W = (Math.max(sPt.x, ePt.x) + MARGIN - minX) / GRID_SIZE + 1;
    const H = (Math.max(sPt.y, ePt.y) + MARGIN - minY) / GRID_SIZE + 1;
    if (W * H > 250000) return null;

    const blocked = new Uint8Array(W * H); // foreign pin / corner / endpoint
    const hCover = new Uint8Array(W * H); // covered by a foreign horizontal segment
    const vCover = new Uint8Array(W * H); // covered by a foreign vertical segment
    const idx = (x: number, y: number) => {
      const ix = (x - minX) / GRID_SIZE;
      const iy = (y - minY) / GRID_SIZE;
      return ix < 0 || iy < 0 || ix >= W || iy >= H ? -1 : iy * W + ix;
    };
    const parseKey = (k: string) => k.split(',').map(Number);
    for (const [k, net] of pinNetAtLoc) {
      if (net === netId) continue;
      const [x, y] = parseKey(k);
      const i = idx(x, y);
      if (i >= 0) blocked[i] = 1;
    }
    for (const [k, net] of netCorners) {
      if (net === netId) continue;
      const [x, y] = parseKey(k);
      const i = idx(x, y);
      if (i >= 0) blocked[i] = 1;
    }
    for (const sg of placedNetSegs) {
      if (sg.netId === netId) continue;
      if (sg.isVertical) {
        for (let y = sg.y0; y <= sg.y1; y += GRID_SIZE) {
          const i = idx(sg.x0, y);
          if (i >= 0) vCover[i] = 1;
        }
      } else {
        for (let x = sg.x0; x <= sg.x1; x += GRID_SIZE) {
          const i = idx(x, sg.y0);
          if (i >= 0) hCover[i] = 1;
        }
      }
    }
    if (avoidBodies) {
      for (const r of bodyRects) {
        for (let x = Math.ceil(r.x0 / GRID_SIZE) * GRID_SIZE; x < r.x1; x += GRID_SIZE) {
          if (x <= r.x0) continue;
          for (let y = Math.ceil(r.y0 / GRID_SIZE) * GRID_SIZE; y < r.y1; y += GRID_SIZE) {
            if (y <= r.y0) continue;
            const i = idx(x, y);
            if (i >= 0) blocked[i] = 1;
          }
        }
      }
    }
    const sI = idx(sPt.x, sPt.y);
    const eI = idx(ePt.x, ePt.y);
    blocked[sI] = 0;
    blocked[eI] = 0;

    const BEND = 4;
    const N = W * H * 2;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap: Array<[number, number]> = [];
    const push = (c: number, st: number) => {
      heap.push([c, st]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    for (const d of [0, 1]) {
      dist[sI * 2 + d] = 0;
      push(0, sI * 2 + d);
    }
    let goal = -1;
    while (heap.length > 0) {
      const [c, st] = pop();
      if (c > dist[st]) continue;
      const cell = st >> 1;
      const d = st & 1; // 0 = horizontal, 1 = vertical
      if (cell === eI) {
        goal = st;
        break;
      }
      const relax = (nst: number, nc: number) => {
        if (nc < dist[nst]) {
          dist[nst] = nc;
          prev[nst] = st;
          push(nc, nst);
        }
      };
      // Turn in place (not allowed on foreign wires: a corner there would connect to them)
      if (!hCover[cell] && !vCover[cell] && !blocked[cell]) relax(cell * 2 + (1 - d), c + BEND);
      const cx = cell % W;
      const cy = (cell - cx) / W;
      for (const step of [-1, 1]) {
        const nx = d === 0 ? cx + step : cx;
        const ny = d === 1 ? cy + step : cy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ncell = ny * W + nx;
        if (blocked[ncell]) continue;
        if (d === 0 && hCover[cell] && hCover[ncell]) continue; // collinear overlap
        if (d === 1 && vCover[cell] && vCover[ncell]) continue;
        relax(ncell * 2 + d, c + 1);
      }
    }
    if (goal < 0) return null;
    const pts: WirePoint[] = [];
    for (let st = goal; st >= 0; st = prev[st]) {
      const cell = st >> 1;
      const cx = cell % W;
      const cy = (cell - cx) / W;
      pts.push({ x: minX + cx * GRID_SIZE, y: minY + cy * GRID_SIZE });
    }
    pts.reverse();
    return simplifyCollinearPoints(pts);
  };

  let rawSegs: CanonicalSeg[] = [];

  // Pass 1: Process already-canonical wires first
  for (const item of resolvedEndpoints) {
    if (!item.isCanonical) continue;
    const netId = ufFind(item.netKey);
    const ortho = getWireOrthogonalSegments(item.wire, item.sPt, item.ePt);
    ortho.forEach((os, idx) => {
      const cSeg = createCanonicalSeg(
        { x: os.x1, y: os.y1 },
        { x: os.x2, y: os.y2 },
        {
          isBus: item.wire.isBus,
          bitWidth: item.wire.bitWidth,
          value: item.wire.value,
          hasConflict: item.wire.hasConflict,
          id: ortho.length === 1 && idx === 0 ? item.wire.id : undefined,
        }
      );
      if (cSeg) {
        rawSegs.push(cSeg);
        recordSeg(cSeg, netId);
      }
    });
  }

  // Pass 2: Route legacy/preset wires with collision avoidance.
  // Routing is greedy (one connection after another), so an early route can wall in the pin of a later one
  // (e.g. a chip dropped right next to a display). The unrouteable connection would then fall back to a
  // plain L-path that runs over foreign pins and shorts them. Rip-up & retry: route the failed connections
  // first and keep the attempt with the fewest unsafe fallbacks.
  const pendingItems = resolvedEndpoints.filter((item) => !item.isCanonical);
  const baseSegCount = rawSegs.length;
  const basePlacedCount = placedNetSegs.length;
  const baseCorners = new Map(netCorners);
  const resetPass2 = () => {
    rawSegs.length = baseSegCount;
    placedNetSegs.length = basePlacedCount;
    netCorners.clear();
    baseCorners.forEach((v, k) => netCorners.set(k, v));
  };

  // Returns the items that needed the unsafe (collision-blind) fallback
  const routePending = (order: typeof pendingItems): typeof pendingItems => {
  const unsafe: typeof pendingItems = [];
  for (const item of order) {
    const { wire: w, sPt, ePt } = item;
    const netId = ufFind(item.netKey);

    let chosenPts: WirePoint[] | null = null;

    if (w.waypoints && w.waypoints.length > 0) {
      chosenPts = [sPt, ...w.waypoints.map(snapPt10), ePt];
    } else {
      const candidates: WirePoint[][] = [];

      // 1. Straight line if aligned
      if (sPt.x === ePt.x || sPt.y === ePt.y) {
        candidates.push([sPt, ePt]);
      }

      // 2. Reuse existing vertical trunk X of the same net (for clean Logisim fan-outs)
      for (const s of placedNetSegs) {
        if (s.netId === netId && s.isVertical && s.x0 > Math.min(sPt.x, ePt.x) && s.x0 < Math.max(sPt.x, ePt.x)) {
          candidates.push([sPt, { x: s.x0, y: sPt.y }, { x: s.x0, y: ePt.y }, ePt]);
        }
      }

      // 3. Explicit elbowX if present
      if (w.elbowX !== undefined) {
        const ex = snapTo10(w.elbowX);
        candidates.push([sPt, { x: ex, y: sPt.y }, { x: ex, y: ePt.y }, ePt]);
      }

      // 4. L-shaped 2-segment paths (great for bottom/top pins like CLK, WE, B0..B3, C0..C7)
      const toPinKey = `${ePt.x},${ePt.y}`;
      const toPinObj = pinAtLoc.get(toPinKey);
      let isTopBottomTarget = false;
      if (toPinObj) {
        const comp = components.find((c) => c.id === toPinObj.compId);
        const pin = comp ? comp.inputs.find((p) => p.id === toPinObj.pinId) : undefined;
        if (pin && comp && Math.abs(pin.x - comp.x) > 4) {
          isTopBottomTarget = true;
        }
      }
      if (isTopBottomTarget) {
        candidates.push([sPt, { x: ePt.x, y: sPt.y }, ePt]);
      }

      // 5. Z-shaped 3-segment paths (H-V-H) spiraling outward from midpoint X
      const baseMidX = snapTo10((sPt.x + ePt.x) / 2);
      candidates.push([sPt, { x: baseMidX, y: sPt.y }, { x: baseMidX, y: ePt.y }, ePt]);
      for (let d = GRID_SIZE; d <= 260; d += GRID_SIZE) {
        const xRight = baseMidX + d;
        const xLeft = baseMidX - d;
        if (sPt.x < ePt.x) {
          if (xRight < ePt.x) candidates.push([sPt, { x: xRight, y: sPt.y }, { x: xRight, y: ePt.y }, ePt]);
          if (xLeft > sPt.x) candidates.push([sPt, { x: xLeft, y: sPt.y }, { x: xLeft, y: ePt.y }, ePt]);
        } else {
          candidates.push([sPt, { x: xRight, y: sPt.y }, { x: xRight, y: ePt.y }, ePt]);
          candidates.push([sPt, { x: xLeft, y: sPt.y }, { x: xLeft, y: ePt.y }, ePt]);
        }
      }

      // 6. L-shaped 2-segment paths (fallback)
      candidates.push([sPt, { x: ePt.x, y: sPt.y }, ePt]);
      candidates.push([sPt, { x: sPt.x, y: ePt.y }, ePt]);

      // 7. N-shaped 3-segment paths (V-H-V) and 5-segment detours if horizontal exit is blocked
      const baseMidY = snapTo10((sPt.y + ePt.y) / 2);
      for (let dy = 0; dy <= 240; dy += GRID_SIZE) {
        for (const sign of [1, -1]) {
          const my = baseMidY + sign * dy;
          candidates.push([sPt, { x: sPt.x, y: my }, { x: ePt.x, y: my }, ePt]);
          for (const dx1 of [10, 20, 30, -10, -20]) {
            for (const dx2 of [-10, -20, -30, 10, 20]) {
              candidates.push([
                sPt,
                { x: sPt.x + dx1, y: sPt.y },
                { x: sPt.x + dx1, y: my },
                { x: ePt.x + dx2, y: my },
                { x: ePt.x + dx2, y: ePt.y },
                ePt,
              ]);
            }
          }
        }
      }

      // 8. Guaranteed fallback: bend-penalised grid search (Dijkstra) around every foreign pin,
      // foreign wire endpoint/corner and collinear foreign segment, so a re-routed connection never
      // short-circuits another net even in dense circuits. Component bodies are avoided first; only
      // when that is impossible (overlapping parts) may a wire cross a body.
      for (const avoidBodies of bodyRects.length > 0 ? [true, false] : [false]) {
        for (const cand of candidates) {
          if (isCandidatePathValid(cand, netId, avoidBodies)) {
            chosenPts = cand;
            break;
          }
        }
        if (!chosenPts) {
          const routed = gridRoute(sPt, ePt, netId, avoidBodies);
          if (routed && isCandidatePathValid(routed, netId, avoidBodies)) chosenPts = routed;
        }
        if (chosenPts) break;
      }
    }

    if (!chosenPts) {
      // Fallback to default orthogonal segments
      unsafe.push(item);
      const ortho = getWireOrthogonalSegments(w, sPt, ePt);
      ortho.forEach((os, idx) => {
        const cSeg = createCanonicalSeg(
          { x: os.x1, y: os.y1 },
          { x: os.x2, y: os.y2 },
          {
            isBus: w.isBus,
            bitWidth: w.bitWidth,
            value: w.value,
            hasConflict: w.hasConflict,
            id: ortho.length === 1 && idx === 0 ? w.id : undefined,
          }
        );
        if (cSeg) {
          rawSegs.push(cSeg);
          recordSeg(cSeg, netId);
        }
      });
    } else {
      const segsForWire: CanonicalSeg[] = [];
      for (let i = 0; i < chosenPts.length - 1; i++) {
        const cSeg = createCanonicalSeg(chosenPts[i], chosenPts[i + 1], {
          isBus: w.isBus,
          bitWidth: w.bitWidth,
          value: w.value,
          hasConflict: w.hasConflict,
        });
        if (cSeg) segsForWire.push(cSeg);
      }
      if (segsForWire.length === 1) {
        segsForWire[0].preferredId = w.id;
      }
      for (const cSeg of segsForWire) {
        rawSegs.push(cSeg);
        recordSeg(cSeg, netId);
      }
    }
  }
  return unsafe;
  };

  let order = pendingItems;
  let unsafe = routePending(order);
  if (unsafe.length > 0) {
    let bestOrder = order;
    let bestUnsafe = unsafe.length;
    for (let attempt = 0; attempt < 6 && unsafe.length > 0; attempt++) {
      const failed = new Set(unsafe);
      order = [...unsafe, ...order.filter((item) => !failed.has(item))];
      resetPass2();
      unsafe = routePending(order);
      if (unsafe.length < bestUnsafe) {
        bestUnsafe = unsafe.length;
        bestOrder = order;
      }
    }
    if (unsafe.length > bestUnsafe) {
      resetPass2();
      routePending(bestOrder);
    }
  }

  if (rawSegs.length === 0) return [];

  // Step 1: Collect all split points from actual wire segment endpoints in rawSegs.
  // A component pin only splits a passing wire if at least one wire segment actually
  // terminated at that pin (preventing a wire passing over pin A on its way to pin B from shorting pin A).
  const rawWireEndpoints = new Set<string>();
  const allSplitPoints = new Map<string, WirePoint>();
  for (const s of rawSegs) {
    const k0 = `${s.x0},${s.y0}`;
    const k1 = `${s.x1},${s.y1}`;
    rawWireEndpoints.add(k0);
    rawWireEndpoints.add(k1);
    allSplitPoints.set(k0, { x: s.x0, y: s.y0 });
    allSplitPoints.set(k1, { x: s.x1, y: s.y1 });
  }

  // Step 2: Merge overlapping collinear segments along each line (`doOverlaps` + `doMerges`)
  // Group vertical segments by x, horizontal segments by y
  const vertByX = new Map<number, CanonicalSeg[]>();
  const horzByY = new Map<number, CanonicalSeg[]>();

  for (const s of rawSegs) {
    if (s.isVertical) {
      if (!vertByX.has(s.x0)) vertByX.set(s.x0, []);
      vertByX.get(s.x0)!.push(s);
    } else {
      if (!horzByY.has(s.y0)) horzByY.set(s.y0, []);
      horzByY.get(s.y0)!.push(s);
    }
  }

  const mergedVert: CanonicalSeg[] = [];
  for (const [, segs] of vertByX) {
    segs.sort((a, b) => a.y0 - b.y0 || a.y1 - b.y1);
    let curr = { ...segs[0] };
    for (let i = 1; i < segs.length; i++) {
      const next = segs[i];
      if (next.y0 <= curr.y1) {
        // Overlapping or contiguous collinear vertical segments -> merge into maximal span
        if (next.y1 > curr.y1) curr.y1 = next.y1;
        curr.isBus = curr.isBus || next.isBus;
        curr.bitWidth = Math.max(curr.bitWidth, next.bitWidth);
        if (next.value === 1) curr.value = 1;
        curr.hasConflict = curr.hasConflict || next.hasConflict;
      } else {
        mergedVert.push(curr);
        curr = { ...next };
      }
    }
    mergedVert.push(curr);
  }

  const mergedHorz: CanonicalSeg[] = [];
  for (const [, segs] of horzByY) {
    segs.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1);
    let curr = { ...segs[0] };
    for (let i = 1; i < segs.length; i++) {
      const next = segs[i];
      if (next.x0 <= curr.x1) {
        // Overlapping or contiguous collinear horizontal segments -> merge into maximal span
        if (next.x1 > curr.x1) curr.x1 = next.x1;
        curr.isBus = curr.isBus || next.isBus;
        curr.bitWidth = Math.max(curr.bitWidth, next.bitWidth);
        if (next.value === 1) curr.value = 1;
        curr.hasConflict = curr.hasConflict || next.hasConflict;
      } else {
        mergedHorz.push(curr);
        curr = { ...next };
      }
    }
    mergedHorz.push(curr);
  }

  // Step 3: `doSplits` (Logisim WireRepair.doMergeSet & WireRepair.doSplits)
  // A vertical maximal span at x is split at y (y0 < y < y1) IF AND ONLY IF:
  // - A component pin is at (x, y), OR
  // - A horizontal segment has an endpoint at (x, y), OR
  // - A horizontal segment passes through (x, y) AND (x, y) was an explicit endpoint in rawSegs!
  // Wait: That last condition handles 4-way connected junctions! If (x, y) was an endpoint of a segment
  // AND both a horizontal and vertical span pass through/touch (x, y), then (x, y) is a connected junction!
  const horzTouchAt = (x: number, y: number): boolean => {
    const hList = mergedHorz.filter((h) => h.y0 === y && x >= h.x0 && x <= h.x1);
    return hList.length > 0;
  };
  const vertTouchAt = (x: number, y: number): boolean => {
    const vList = mergedVert.filter((v) => v.x0 === x && y >= v.y0 && y <= v.y1);
    return vList.length > 0;
  };

  const finalSegs: CanonicalSeg[] = [];

  for (const v of mergedVert) {
    const splitYs = new Set<number>([v.y0, v.y1]);
    for (let y = v.y0 + GRID_SIZE; y < v.y1; y += GRID_SIZE) {
      const key = `${v.x0},${y}`;
      if (pinAtLoc.has(key) && rawWireEndpoints.has(key)) {
        splitYs.add(y);
      } else if (allSplitPoints.has(key) && horzTouchAt(v.x0, y)) {
        splitYs.add(y);
      }
    }
    const sortedYs = Array.from(splitYs).sort((a, b) => a - b);
    for (let i = 0; i < sortedYs.length - 1; i++) {
      finalSegs.push({
        ...v,
        y0: sortedYs[i],
        y1: sortedYs[i + 1],
        preferredId: sortedYs.length === 2 ? v.preferredId : undefined,
      });
    }
  }

  for (const h of mergedHorz) {
    const splitXs = new Set<number>([h.x0, h.x1]);
    for (let x = h.x0 + GRID_SIZE; x < h.x1; x += GRID_SIZE) {
      const key = `${x},${h.y0}`;
      if (pinAtLoc.has(key) && rawWireEndpoints.has(key)) {
        splitXs.add(x);
      } else if (allSplitPoints.has(key) && vertTouchAt(x, h.y0)) {
        splitXs.add(x);
      }
    }
    const sortedXs = Array.from(splitXs).sort((a, b) => a - b);
    for (let i = 0; i < sortedXs.length - 1; i++) {
      finalSegs.push({
        ...h,
        x0: sortedXs[i],
        x1: sortedXs[i + 1],
        preferredId: sortedXs.length === 2 ? h.preferredId : undefined,
      });
    }
  }

  // Convert canonical segments back into CircuitWire objects
  const usedIds = new Set<string>();
  return finalSegs.map((s, idx) => {
    const k0 = `${s.x0},${s.y0}`;
    const k1 = `${s.x1},${s.y1}`;
    const pin0 = pinAtLoc.get(k0);
    const pin1 = pinAtLoc.get(k1);

    let id = s.preferredId;
    if (!id || usedIds.has(id)) {
      id = `wire_${s.x0}_${s.y0}_${s.x1}_${s.y1}_${idx}`;
    }
    usedIds.add(id);

    return {
      id,
      fromCompId: pin0 ? pin0.compId : '',
      fromPinId: pin0 ? pin0.pinId : `loc_${s.x0}_${s.y0}`,
      toCompId: pin1 ? pin1.compId : '',
      toPinId: pin1 ? pin1.pinId : `loc_${s.x1}_${s.y1}`,
      startPoint: { x: s.x0, y: s.y0 },
      endPoint: { x: s.x1, y: s.y1 },
      value: s.value,
      hasConflict: s.hasConflict,
      isBus: s.isBus,
      bitWidth: s.bitWidth,
    };
  });
};

/**
 * Dynamically computes all true solder dot junctions in the circuit (Logisim CircuitWires.draw).
 * In Logisim, solder dots appear ONLY where 3 or more wire segments terminate/meet at a grid point.
 * - Open wire end (1 segment) -> NO dot
 * - 90° corner (2 segments) -> NO dot
 * - Wire crossing without split (0 endpoints at intersection) -> NO dot
 * - T-junction (3 segments) or 4-way split junction (4 segments) -> SOLDER DOT!
 */
export const computeCircuitJunctions = (
  wires: CircuitWire[],
  getWireStart: (w: CircuitWire) => WirePoint,
  getWireEnd: (w: CircuitWire, start: WirePoint) => WirePoint,
  _findPin?: (pinId: string) => CircuitPin | null | undefined
): CircuitJunction[] => {
  const allSegments: WireSegment[] = [];
  const endpointPoints = new Map<string, WirePoint>();
  const pointWireValues = new Map<string, { value: LogicValue; hasConflict: boolean; isBus: boolean }>();

  const keyOf = (x: number, y: number) => `${x},${y}`;

  for (const w of wires) {
    const startPt = getWireStart(w);
    const endPt = getWireEnd(w, startPt);
    const segs = getWireOrthogonalSegments(w, startPt, endPt);

    for (const s of segs) {
      allSegments.push(s);
      const k1 = keyOf(s.x1, s.y1);
      const k2 = keyOf(s.x2, s.y2);

      if (!endpointPoints.has(k1)) endpointPoints.set(k1, { x: s.x1, y: s.y1 });
      if (!endpointPoints.has(k2)) endpointPoints.set(k2, { x: s.x2, y: s.y2 });

      const prev1 = pointWireValues.get(k1);
      pointWireValues.set(k1, {
        value: prev1?.value === 1 || w.value === 1 ? 1 : 0,
        hasConflict: !!prev1?.hasConflict || !!w.hasConflict,
        isBus: !!prev1?.isBus || !!w.isBus,
      });

      const prev2 = pointWireValues.get(k2);
      pointWireValues.set(k2, {
        value: prev2?.value === 1 || w.value === 1 ? 1 : 0,
        hasConflict: !!prev2?.hasConflict || !!w.hasConflict,
        isBus: !!prev2?.isBus || !!w.isBus,
      });
    }
  }

  const pointDirs = new Map<string, Set<'N' | 'S' | 'E' | 'W'>>();
  for (const [key] of endpointPoints) {
    pointDirs.set(key, new Set());
  }

  for (const s of allSegments) {
    if (s.isVertical) {
      const minY = Math.min(s.y1, s.y2);
      const maxY = Math.max(s.y1, s.y2);
      const x = s.x1;

      pointDirs.get(keyOf(x, minY))?.add('S');
      pointDirs.get(keyOf(x, maxY))?.add('N');

      for (const [key, pt] of endpointPoints) {
        if (pt.x === x && pt.y > minY && pt.y < maxY) {
          pointDirs.get(key)?.add('N');
          pointDirs.get(key)?.add('S');
        }
      }
    } else {
      const minX = Math.min(s.x1, s.x2);
      const maxX = Math.max(s.x1, s.x2);
      const y = s.y1;

      pointDirs.get(keyOf(minX, y))?.add('E');
      pointDirs.get(keyOf(maxX, y))?.add('W');

      for (const [key, pt] of endpointPoints) {
        if (pt.y === y && pt.x > minX && pt.x < maxX) {
          pointDirs.get(key)?.add('E');
          pointDirs.get(key)?.add('W');
        }
      }
    }
  }

  const junctions: CircuitJunction[] = [];
  for (const [key, dirs] of pointDirs) {
    if (dirs.size >= 3) {
      const pt = endpointPoints.get(key)!;
      const wireInfo = pointWireValues.get(key) || { value: 0, hasConflict: false, isBus: false };
      junctions.push({
        x: pt.x,
        y: pt.y,
        value: wireInfo.value,
        hasConflict: wireInfo.hasConflict,
        isBus: wireInfo.isBus,
      });
    }
  }

  return junctions;
};

/**
 * Re-attaches wires after pins of components changed location in place (rotation, gate input count change).
 * `pinRemap` maps an OLD pin location ("x,y") to the id of the pin that now owns that connection
 * (`null` = the pin is gone; its wires stay as open ends, like Logisim).
 * Every wire chain that ran from a remapped pin through plain 2-way corners up to its anchor (a pin, a
 * junction or an open end) is removed and re-routed net-aware from the pin's new location to that anchor,
 * so no dangling stubs are left at the old corners.
 */
export const rerouteWiresToRemappedPins = (
  rawWires: CircuitWire[],
  oldComps: CircuitComponentInstance[],
  newComps: CircuitComponentInstance[],
  pinRemap: Map<string, string | null>
): CircuitWire[] => {
  const keyOf = (pt: WirePoint) => `${pt.x},${pt.y}`;
  const wires = repairWires(rawWires, oldComps);

  const newPinLoc = new Map<string, { compId: string; loc: WirePoint }>();
  for (const comp of newComps) {
    for (const pin of [...comp.inputs, ...comp.outputs]) newPinLoc.set(pin.id, { compId: comp.id, loc: snapPt10(pin) });
  }
  const oldPinAt = new Map<string, { compId: string; pinId: string }>();
  for (const comp of oldComps) {
    for (const pin of [...comp.inputs, ...comp.outputs]) oldPinAt.set(keyOf(snapPt10(pin)), { compId: comp.id, pinId: pin.id });
  }

  // Remapped locations whose pin really moved (a pin that keeps its spot keeps its wires untouched)
  const movedTo = new Map<string, string>();
  for (const [oldKey, newPinId] of pinRemap) {
    if (!newPinId) continue;
    const np = newPinLoc.get(newPinId);
    if (np && keyOf(np.loc) !== oldKey) movedTo.set(oldKey, newPinId);
  }
  if (movedTo.size === 0) return repairWires(wires, newComps);

  const ends = wires.map((w) => ({ s: snapPt10(w.startPoint!), e: snapPt10(w.endPoint!) }));
  const atLoc = new Map<string, number[]>();
  ends.forEach(({ s, e }, i) => {
    for (const k of [keyOf(s), keyOf(e)]) {
      if (!atLoc.has(k)) atLoc.set(k, []);
      atLoc.get(k)!.push(i);
    }
  });

  const removed = new Set<number>();
  const extra: CircuitWire[] = [];
  for (const [startKey, newPinId] of movedTo) {
    for (const first of atLoc.get(startKey) || []) {
      if (removed.has(first)) continue;
      const chain = [first];
      let prevIdx = first;
      let curKey = keyOf(ends[first].s) === startKey ? keyOf(ends[first].e) : keyOf(ends[first].s);
      let cur = keyOf(ends[first].s) === startKey ? ends[first].e : ends[first].s;
      for (;;) {
        if (oldPinAt.has(curKey)) break;
        const neigh = (atLoc.get(curKey) || []).filter((i) => i !== prevIdx);
        if (neigh.length !== 1 || removed.has(neigh[0]) || chain.includes(neigh[0])) break;
        const nxt = neigh[0];
        chain.push(nxt);
        prevIdx = nxt;
        const ne = ends[nxt];
        if (keyOf(ne.s) === curKey) {
          cur = ne.e;
        } else {
          cur = ne.s;
        }
        curKey = keyOf(cur);
      }
      chain.forEach((i) => removed.add(i));

      const w0 = wires[first];
      const startPin = newPinLoc.get(newPinId)!;
      // Anchor on another remapped pin (e.g. both ends on the same rotated part) follows that pin as well
      const anchorPinId = movedTo.get(curKey) ?? (pinRemap.has(curKey) ? pinRemap.get(curKey) : oldPinAt.get(curKey)?.pinId);
      const anchorPin = anchorPinId ? newPinLoc.get(anchorPinId) : undefined;
      extra.push({
        ...w0,
        id: `${w0.id}_rr`,
        fromCompId: startPin.compId,
        fromPinId: newPinId,
        toCompId: anchorPin ? anchorPin.compId : '',
        toPinId: anchorPin ? anchorPinId! : `loc_${cur.x}_${cur.y}`,
        startPoint: undefined,
        endPoint: anchorPin ? undefined : cur,
        waypoints: undefined,
        branchPoint: undefined,
        elbowX: undefined,
      });
    }
  }

  return repairWires([...wires.filter((_, i) => !removed.has(i)), ...extra], newComps);
};

/**
 * Computes ONE rigid (dx, dy) shared by every component in a multi-selection drag
 * (Logisim MoveTool semantics). Previously every component was snapped/clamped on its own,
 * so a group pushed against the canvas edge (or with off-grid members) got different deltas,
 * which distorted the selection and broke the wires between co-moving components.
 */
export const computeGroupDragDeltas = (
  offsets: Map<string, { x: number; y: number }>,
  initialComps: CircuitComponentInstance[],
  coords: WirePoint,
  primaryId: string | null | undefined,
  snap: boolean
): Map<string, { dx: number; dy: number }> => {
  const result = new Map<string, { dx: number; dy: number }>();
  const compMap = new Map(initialComps.map((c) => [c.id, c]));
  const ids = Array.from(offsets.keys()).filter((id) => compMap.has(id));
  if (ids.length === 0) return result;

  const leadId = primaryId && offsets.has(primaryId) && compMap.has(primaryId) ? primaryId : ids[0];
  const off = offsets.get(leadId)!;
  const lead = compMap.get(leadId)!;
  const q = (v: number) => (snap ? Math.round(v / GRID_SIZE) * GRID_SIZE : Math.round(v));

  let dx = q(coords.x - off.x) - lead.x;
  let dy = q(coords.y - off.y) - lead.y;

  let minX = Infinity;
  let minY = Infinity;
  for (const id of ids) {
    const c = compMap.get(id)!;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
  }
  if (minX + dx < 10) dx = 10 - minX;
  if (minY + dy < 10) dy = 10 - minY;

  for (const id of ids) result.set(id, { dx, dy });
  return result;
};

/**
 * Translates and routes wires when one or more components are dragged on the canvas.
 * - Any connected wire cluster attached ONLY to the moving component(s) (such as open wire stubs
 *   or wires between two co-moving components) translates rigidly 1:1 by (dx, dy).
 * - Any wire path connecting a moving component pin to a stationary component pin
 *   adjusts its orthogonal corner(s) smoothly so the pin remains connected without detaching.
 */
export const translateWiresForMovedComponents = (
  rawInitialWires: CircuitWire[],
  initialComps: CircuitComponentInstance[],
  movedCompDeltas: Map<string, { dx: number; dy: number }>,
  selectedWireIds?: Set<string>
): CircuitWire[] => {
  if (movedCompDeltas.size === 0 || rawInitialWires.length === 0) return rawInitialWires;

  // Ensure all initial wires are normalized into straight segments with startPoint & endPoint
  const needsNormalize = rawInitialWires.some((w) => !w.startPoint || !w.endPoint || (w.waypoints && w.waypoints.length > 0));
  const initialWires = needsNormalize ? repairWires(rawInitialWires, initialComps) : rawInitialWires;

  const keyOf = (pt: WirePoint) => `${pt.x},${pt.y}`;

  // Map initial pins by coordinate
  const movingPinDeltaAtLoc = new Map<string, { dx: number; dy: number }>();
  const stationaryPinLocs = new Set<string>();

  for (const comp of initialComps) {
    const delta = movedCompDeltas.get(comp.id);
    for (const pin of [...comp.inputs, ...comp.outputs]) {
      const sp = snapPt10(pin);
      const k = keyOf(sp);
      if (delta) {
        movingPinDeltaAtLoc.set(k, delta);
      } else {
        stationaryPinLocs.add(k);
      }
    }
  }

  const pinIdAtLoc = new Map<string, { compId: string; pinId: string }>();
  for (const comp of initialComps) {
    for (const pin of [...comp.inputs, ...comp.outputs]) {
      pinIdAtLoc.set(keyOf(snapPt10(pin)), { compId: comp.id, pinId: pin.id });
    }
  }
  const removedWire = new Set<number>();
  const rigidGroups: Array<{ indices: number[]; delta: { dx: number; dy: number } }> = [];

  // Build adjacency of wire indices by shared endpoint coordinates
  const locToWireIndices = new Map<string, number[]>();
  const wireEndpoints: Array<{ s: WirePoint; e: WirePoint }> = initialWires.map((w, idx) => {
    const s = w.startPoint ? snapPt10(w.startPoint) : { x: 0, y: 0 };
    const e = w.endPoint ? snapPt10(w.endPoint) : s;
    const ks = keyOf(s);
    const ke = keyOf(e);
    if (!locToWireIndices.has(ks)) locToWireIndices.set(ks, []);
    locToWireIndices.get(ks)!.push(idx);
    if (!locToWireIndices.has(ke)) locToWireIndices.set(ke, []);
    locToWireIndices.get(ke)!.push(idx);
    return { s, e };
  });

  // Find connected components (clusters) of wires
  const visitedWire = new Set<number>();
  const resultWires: CircuitWire[] = initialWires.map((w) => ({ ...w }));
  const extraWires: CircuitWire[] = [];

  for (let i = 0; i < initialWires.length; i++) {
    if (visitedWire.has(i)) continue;

    // BFS to collect this connected wire cluster
    const clusterIndices: number[] = [];
    const queue: number[] = [i];
    visitedWire.add(i);

    let touchesStationaryPin = false;
    let uniformMovingDelta: { dx: number; dy: number } | null = null;
    let hasConflictingDeltas = false;

    while (queue.length > 0) {
      const wIdx = queue.shift()!;
      clusterIndices.push(wIdx);
      const { s, e } = wireEndpoints[wIdx];

      for (const pt of [s, e]) {
        const k = keyOf(pt);
        if (stationaryPinLocs.has(k)) {
          touchesStationaryPin = true;
        }
        const mDelta = movingPinDeltaAtLoc.get(k);
        if (mDelta) {
          if (!uniformMovingDelta) {
            uniformMovingDelta = mDelta;
          } else if (uniformMovingDelta.dx !== mDelta.dx || uniformMovingDelta.dy !== mDelta.dy) {
            hasConflictingDeltas = true;
          }
        }

        const neighbors = locToWireIndices.get(k) || [];
        for (const nIdx of neighbors) {
          if (!visitedWire.has(nIdx)) {
            visitedWire.add(nIdx);
            queue.push(nIdx);
          }
        }
      }
    }

    // Case A: Entire wire cluster is attached ONLY to uniformly moving component(s) (no stationary pins!)
    // Translate the entire wire cluster rigidly 1:1 with the component!
    // A selected wire that hangs free (touches no pin at all) moves with the selection too, like Logisim.
    if (
      !uniformMovingDelta &&
      !touchesStationaryPin &&
      selectedWireIds &&
      clusterIndices.some((idx) => selectedWireIds.has(initialWires[idx].id))
    ) {
      uniformMovingDelta = movedCompDeltas.values().next().value ?? null;
    }
    if (uniformMovingDelta && !touchesStationaryPin && !hasConflictingDeltas) {
      rigidGroups.push({ indices: [...clusterIndices], delta: uniformMovingDelta });
      clusterIndices.forEach((i) => removedWire.add(i));
      continue;
    }

    // Case B: Wire cluster connects moving pin(s) to stationary pin(s).
    // Every wire CHAIN that starts at a moving pin (pin -> corner -> corner ... -> anchor, where the
    // anchor is a pin, a junction or an open end) is detached and re-routed net-aware by `repairWires`
    // from the pin's NEW location to the anchor. Untouched parts of the net keep the user's routing.
    // (The previous corner-slide / bridge approach could lay wires collinearly over other nets,
    // which Logisim's overlap merging turned into short circuits.)
    if (uniformMovingDelta || hasConflictingDeltas) {
      const inCluster = new Set(clusterIndices);
      const otherEnd = (idx: number, k: string): WirePoint => {
        const { s, e } = wireEndpoints[idx];
        return keyOf(s) === k ? e : s;
      };
      for (const wIdx of clusterIndices) {
        for (const startPt of [wireEndpoints[wIdx].s, wireEndpoints[wIdx].e]) {
          const startKey = keyOf(startPt);
          const startDelta = movingPinDeltaAtLoc.get(startKey);
          if (!startDelta || removedWire.has(wIdx)) continue;

          // Walk the chain through plain 2-way corners
          const chain: number[] = [wIdx];
          let prevIdx = wIdx;
          let cur = otherEnd(wIdx, startKey);
          for (;;) {
            const kc = keyOf(cur);
            if (pinIdAtLoc.has(kc)) break;
            const neigh = (locToWireIndices.get(kc) || []).filter((i) => i !== prevIdx);
            if (neigh.length !== 1) break;
            const nxt = neigh[0];
            if (!inCluster.has(nxt) || removedWire.has(nxt) || chain.includes(nxt)) break;
            chain.push(nxt);
            prevIdx = nxt;
            cur = otherEnd(nxt, kc);
          }
          const endKey = keyOf(cur);
          chain.forEach((i) => removedWire.add(i));

          const endDelta = movingPinDeltaAtLoc.get(endKey);
          const endIsPin = pinIdAtLoc.has(endKey);
          const endIsOpen =
            !endIsPin && (locToWireIndices.get(endKey) || []).filter((i) => !chain.includes(i)).length === 0;

          if (endIsOpen || (endDelta && endDelta.dx === startDelta.dx && endDelta.dy === startDelta.dy)) {
            // Dangling stub or chain between two co-moving pins -> rigid translation (validated below)
            rigidGroups.push({ indices: chain, delta: startDelta });
            continue;
          }

          const w0 = initialWires[wIdx];
          const startPin = pinIdAtLoc.get(startKey)!;
          const endPt = endDelta ? { x: cur.x + endDelta.dx, y: cur.y + endDelta.dy } : cur;
          const endPin = endIsPin ? pinIdAtLoc.get(endKey)! : null;
          extraWires.push({
            ...w0,
            id: `${w0.id}_rt`,
            fromCompId: startPin.compId,
            fromPinId: startPin.pinId,
            toCompId: endPin ? endPin.compId : '',
            toPinId: endPin ? endPin.pinId : `loc_${endPt.x}_${endPt.y}`,
            startPoint: undefined,
            endPoint: endPin ? undefined : endPt,
            waypoints: undefined,
            branchPoint: undefined,
            elbowX: undefined,
          });
        }
      }
    }
  }

  const keptWires = resultWires.filter((_, i) => !removedWire.has(i));

  // Rigidly translated wire groups keep their shape ONLY if they land on free space.
  // If a translated segment would overlap / touch a stationary wire or a foreign pin
  // (which Logisim would treat as a connection), the group is re-routed pin-to-pin instead.
  if (rigidGroups.length > 0) {
    const staticSegs = keptWires
      .filter((w) => w.startPoint && w.endPoint)
      .map((w) => ({ a: snapPt10(w.startPoint!), b: snapPt10(w.endPoint!) }));
    const newPinAt = new Map<string, string>(); // moved/stationary pin location -> pinId
    for (const comp of initialComps) {
      const d = movedCompDeltas.get(comp.id) || { dx: 0, dy: 0 };
      for (const pin of [...comp.inputs, ...comp.outputs]) {
        const sp = snapPt10(pin);
        newPinAt.set(keyOf({ x: sp.x + d.dx, y: sp.y + d.dy }), pin.id);
      }
    }
    const onSeg = (p: WirePoint, a: WirePoint, b: WirePoint) =>
      (a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
      (a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
    const collinearOverlap = (a: WirePoint, b: WirePoint, c: WirePoint, d: WirePoint) => {
      if (a.x === b.x && c.x === d.x && a.x === c.x) {
        return Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
      }
      if (a.y === b.y && c.y === d.y && a.y === c.y) {
        return Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
      }
      return false;
    };

    for (const g of rigidGroups) {
      const { dx, dy } = g.delta;
      const ownPinKeys = new Set<string>();
      const ownPins: Array<{ compId: string; pinId: string }> = [];
      const moved = g.indices.map((i) => {
        const { s, e } = wireEndpoints[i];
        for (const p of [s, e]) {
          const info = pinIdAtLoc.get(keyOf(p));
          const newKey = keyOf({ x: p.x + dx, y: p.y + dy });
          if (info && !ownPinKeys.has(newKey)) {
            ownPinKeys.add(newKey);
            ownPins.push(info);
          }
        }
        return { i, a: { x: s.x + dx, y: s.y + dy }, b: { x: e.x + dx, y: e.y + dy } };
      });

      let clash = false;
      for (const m of moved) {
        for (const st of staticSegs) {
          if (
            collinearOverlap(m.a, m.b, st.a, st.b) ||
            onSeg(m.a, st.a, st.b) || onSeg(m.b, st.a, st.b) ||
            onSeg(st.a, m.a, m.b) || onSeg(st.b, m.a, m.b)
          ) {
            clash = true;
            break;
          }
        }
        if (clash) break;
        for (const [k] of newPinAt) {
          if (ownPinKeys.has(k)) continue;
          const [px, py] = k.split(',').map(Number);
          if (onSeg({ x: px, y: py }, m.a, m.b)) {
            clash = true;
            break;
          }
        }
        if (clash) break;
      }

      if (!clash || ownPins.length < 2) {
        for (const m of moved) {
          extraWires.push({
            ...initialWires[m.i],
            fromCompId: '',
            fromPinId: `loc_${m.a.x}_${m.a.y}`,
            toCompId: '',
            toPinId: `loc_${m.b.x}_${m.b.y}`,
            startPoint: m.a,
            endPoint: m.b,
            waypoints: undefined,
          });
        }
      } else {
        // Star re-route from the first pin to every other pin of this group's net
        const root = ownPins[0];
        for (let k = 1; k < ownPins.length; k++) {
          extraWires.push({
            ...initialWires[g.indices[0]],
            id: `${initialWires[g.indices[0]].id}_rr${k}`,
            fromCompId: root.compId,
            fromPinId: root.pinId,
            toCompId: ownPins[k].compId,
            toPinId: ownPins[k].pinId,
            startPoint: undefined,
            endPoint: undefined,
            waypoints: undefined,
            branchPoint: undefined,
            elbowX: undefined,
          });
        }
      }
    }
  }
  if (extraWires.length === 0) return keptWires;

  // Route the detached chains against the moved component pins (net-aware, collision free)
  const movedComps = initialComps.map((c) => {
    const d = movedCompDeltas.get(c.id);
    if (!d) return c;
    const shift = (p: CircuitPin) => ({ ...p, x: p.x + d.dx, y: p.y + d.dy });
    return { ...c, x: c.x + d.dx, y: c.y + d.dy, inputs: c.inputs.map(shift), outputs: c.outputs.map(shift) };
  });
  return repairWires([...keptWires, ...extraWires], movedComps);
};
