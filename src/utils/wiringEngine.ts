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
 * Computes the 1 or 2 orthogonal segments produced by Logisim's WiringTool
 * between `start` and `cur` given locked `direction`.
 */
export const getLogisimWiringToolSegments = (
  start: WirePoint,
  cur: WirePoint,
  direction: LogisimWireDirection
): Array<{ e0: WirePoint; e1: WirePoint }> => {
  const s = snapPt10(start);
  const c = snapPt10(cur);

  if (s.x === c.x && s.y === c.y) return [];

  if (s.x === c.x || s.y === c.y) {
    return [{ e0: s, e1: c }];
  }

  const m: WirePoint =
    direction === DIR_HORIZONTAL
      ? { x: c.x, y: s.y }
      : { x: s.x, y: c.y };

  const out: Array<{ e0: WirePoint; e1: WirePoint }> = [];
  if (s.x !== m.x || s.y !== m.y) out.push({ e0: s, e1: m });
  if (m.x !== c.x || m.y !== c.y) out.push({ e0: m, e1: c });
  return out;
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

  const isCandidatePathValid = (pts: WirePoint[], netId: string): boolean => {
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

  // Pass 2: Route legacy/preset wires with collision avoidance
  for (const item of resolvedEndpoints) {
    if (item.isCanonical) continue;
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

      for (const cand of candidates) {
        if (isCandidatePathValid(cand, netId)) {
          chosenPts = cand;
          break;
        }
      }
    }

    if (!chosenPts) {
      // Fallback to default orthogonal segments
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

  if (rawSegs.length === 0) return [];

  // Step 1: Collect all split points (all segment endpoints + all component pin locations)
  // Note: Before merging collinear segments, we record where perpendicular wires or pins exist.
  const allSplitPoints = new Map<string, WirePoint>();
  for (const [k] of pinAtLoc) {
    const [px, py] = k.split(',').map(Number);
    allSplitPoints.set(k, { x: px, y: py });
  }
  for (const s of rawSegs) {
    allSplitPoints.set(`${s.x0},${s.y0}`, { x: s.x0, y: s.y0 });
    allSplitPoints.set(`${s.x1},${s.y1}`, { x: s.x1, y: s.y1 });
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
      if (pinAtLoc.has(key)) {
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
      if (pinAtLoc.has(key)) {
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
 * Translates and routes wires when one or more components are dragged on the canvas.
 * - Any connected wire cluster attached ONLY to the moving component(s) (such as open wire stubs
 *   or wires between two co-moving components) translates rigidly 1:1 by (dx, dy).
 * - Any wire path connecting a moving component pin to a stationary component pin
 *   adjusts its orthogonal corner(s) smoothly so the pin remains connected without detaching.
 */
export const translateWiresForMovedComponents = (
  rawInitialWires: CircuitWire[],
  initialComps: CircuitComponentInstance[],
  movedCompDeltas: Map<string, { dx: number; dy: number }>
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
    if (uniformMovingDelta && !touchesStationaryPin && !hasConflictingDeltas) {
      const { dx, dy } = uniformMovingDelta;
      for (const wIdx of clusterIndices) {
        const w0 = initialWires[wIdx];
        const { s, e } = wireEndpoints[wIdx];
        resultWires[wIdx] = {
          ...w0,
          startPoint: { x: s.x + dx, y: s.y + dy },
          endPoint: { x: e.x + dx, y: e.y + dy },
          waypoints: undefined,
        };
      }
      continue;
    }

    // Case B: Wire cluster connects moving pin(s) to stationary pin(s)
    // Adjust segments attached to each moving pin orthogonally
    if (uniformMovingDelta || hasConflictingDeltas) {
      for (const wIdx of clusterIndices) {
        const w0 = initialWires[wIdx];
        const { s, e } = wireEndpoints[wIdx];
        const ks = keyOf(s);
        const ke = keyOf(e);
        const deltaS = movingPinDeltaAtLoc.get(ks);
        const deltaE = movingPinDeltaAtLoc.get(ke);

        if (!deltaS && !deltaE) continue;

        const isStartMoving = !!deltaS;
        const movingPt = isStartMoving ? s : e;
        const otherPt = isStartMoving ? e : s;
        const delta = (deltaS || deltaE)!;
        const newPinPt = { x: movingPt.x + delta.dx, y: movingPt.y + delta.dy };
        const otherKey = keyOf(otherPt);
        const otherNeighbors = (locToWireIndices.get(otherKey) || []).filter((idx) => idx !== wIdx);

        // If `otherPt` is a simple 2-wire corner (connected to exactly 1 perpendicular wire and not a pin):
        if (otherNeighbors.length === 1 && !stationaryPinLocs.has(otherKey) && !movingPinDeltaAtLoc.has(otherKey)) {
          const perpIdx = otherNeighbors[0];
          const perpEnds = wireEndpoints[perpIdx];
          const perpHasMovingPin =
            movingPinDeltaAtLoc.has(keyOf(perpEnds.s)) || movingPinDeltaAtLoc.has(keyOf(perpEnds.e));
          const isWVertical = s.x === e.x;
          const isPerpVertical = perpEnds.s.x === perpEnds.e.x;

          if (!perpHasMovingPin && isWVertical !== isPerpVertical) {
            // Slide the orthogonal corner `otherPt`!
            const newCorner = isWVertical
              ? { x: newPinPt.x, y: otherPt.y }
              : { x: otherPt.x, y: newPinPt.y };

            resultWires[wIdx] = {
              ...w0,
              fromCompId: '',
              fromPinId: `loc_${(isStartMoving ? newPinPt : newCorner).x}_${(isStartMoving ? newPinPt : newCorner).y}`,
              toCompId: '',
              toPinId: `loc_${(isStartMoving ? newCorner : newPinPt).x}_${(isStartMoving ? newCorner : newPinPt).y}`,
              startPoint: isStartMoving ? newPinPt : newCorner,
              endPoint: isStartMoving ? newCorner : newPinPt,
            };

            const isPerpStartAtCorner = keyOf(perpEnds.s) === otherKey;
            const pNewS = isPerpStartAtCorner ? newCorner : perpEnds.s;
            const pNewE = isPerpStartAtCorner ? perpEnds.e : newCorner;
            resultWires[perpIdx] = {
              ...initialWires[perpIdx],
              fromCompId: '',
              fromPinId: `loc_${pNewS.x}_${pNewS.y}`,
              toCompId: '',
              toPinId: `loc_${pNewE.x}_${pNewE.y}`,
              startPoint: pNewS,
              endPoint: pNewE,
            };
            continue;
          }
        }

        // Otherwise, connect `newPinPt` to `otherPt` orthogonally
        if (newPinPt.x === otherPt.x || newPinPt.y === otherPt.y) {
          const newS = isStartMoving ? newPinPt : otherPt;
          const newE = isStartMoving ? otherPt : newPinPt;
          resultWires[wIdx] = {
            ...w0,
            fromCompId: '',
            fromPinId: `loc_${newS.x}_${newS.y}`,
            toCompId: '',
            toPinId: `loc_${newE.x}_${newE.y}`,
            startPoint: newS,
            endPoint: newE,
          };
        } else {
          const wasHorizontal = s.y === e.y;
          // If `otherPt` is a stationary pin, route via the midpoint so the perpendicular segment
          // never runs along the face of the gate across adjacent pins!
          if (stationaryPinLocs.has(otherKey)) {
            if (wasHorizontal) {
              const midX = snapTo10((newPinPt.x + otherPt.x) / 2);
              if (midX !== newPinPt.x && midX !== otherPt.x) {
                const c1 = { x: midX, y: newPinPt.y };
                const c2 = { x: midX, y: otherPt.y };
                resultWires[wIdx] = {
                  ...w0,
                  fromCompId: '',
                  fromPinId: `loc_${newPinPt.x}_${newPinPt.y}`,
                  toCompId: '',
                  toPinId: `loc_${c1.x}_${c1.y}`,
                  startPoint: newPinPt,
                  endPoint: c1,
                };
                extraWires.push(
                  {
                    ...w0,
                    id: `${w0.id}_bridge1`,
                    fromCompId: '',
                    fromPinId: `loc_${c1.x}_${c1.y}`,
                    toCompId: '',
                    toPinId: `loc_${c2.x}_${c2.y}`,
                    startPoint: c1,
                    endPoint: c2,
                  },
                  {
                    ...w0,
                    id: `${w0.id}_bridge2`,
                    fromCompId: '',
                    fromPinId: `loc_${c2.x}_${c2.y}`,
                    toCompId: '',
                    toPinId: `loc_${otherPt.x}_${otherPt.y}`,
                    startPoint: c2,
                    endPoint: otherPt,
                  }
                );
                continue;
              }
            } else {
              const midY = snapTo10((newPinPt.y + otherPt.y) / 2);
              if (midY !== newPinPt.y && midY !== otherPt.y) {
                const c1 = { x: newPinPt.x, y: midY };
                const c2 = { x: otherPt.x, y: midY };
                resultWires[wIdx] = {
                  ...w0,
                  fromCompId: '',
                  fromPinId: `loc_${newPinPt.x}_${newPinPt.y}`,
                  toCompId: '',
                  toPinId: `loc_${c1.x}_${c1.y}`,
                  startPoint: newPinPt,
                  endPoint: c1,
                };
                extraWires.push(
                  {
                    ...w0,
                    id: `${w0.id}_bridge1`,
                    fromCompId: '',
                    fromPinId: `loc_${c1.x}_${c1.y}`,
                    toCompId: '',
                    toPinId: `loc_${c2.x}_${c2.y}`,
                    startPoint: c1,
                    endPoint: c2,
                  },
                  {
                    ...w0,
                    id: `${w0.id}_bridge2`,
                    fromCompId: '',
                    fromPinId: `loc_${c2.x}_${c2.y}`,
                    toCompId: '',
                    toPinId: `loc_${otherPt.x}_${otherPt.y}`,
                    startPoint: c2,
                    endPoint: otherPt,
                  }
                );
                continue;
              }
            }
          }

          const corner = wasHorizontal
            ? { x: otherPt.x, y: newPinPt.y }
            : { x: newPinPt.x, y: otherPt.y };

          resultWires[wIdx] = {
            ...w0,
            fromCompId: '',
            fromPinId: `loc_${newPinPt.x}_${newPinPt.y}`,
            toCompId: '',
            toPinId: `loc_${corner.x}_${corner.y}`,
            startPoint: newPinPt,
            endPoint: corner,
          };
          extraWires.push({
            ...w0,
            id: `${w0.id}_bridge`,
            fromCompId: '',
            fromPinId: `loc_${corner.x}_${corner.y}`,
            toCompId: '',
            toPinId: `loc_${otherPt.x}_${otherPt.y}`,
            startPoint: corner,
            endPoint: otherPt,
          });
        }
      }
    }
  }

  return [...resultWires, ...extraWires];
};
