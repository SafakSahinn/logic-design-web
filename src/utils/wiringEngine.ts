import type { CircuitWire, CircuitPin } from '../types/circuit';
import type { LogicValue } from '../types/logic';

export const GRID_SIZE = 10;

/**
 * Snap coordinate value to 10px invisible grid
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
 * Decomposes any CircuitWire into strictly orthogonal (Horizontal or Vertical)
 * 10px grid-locked segments. Zero fractional coordinates, zero diagonal kinks.
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
    const pts = [p0, ...wire.waypoints.map(snapPt10), p1];
    let prev = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const curr = pts[i];
      if (prev.x === curr.x || prev.y === curr.y) {
        addSeg(prev, curr);
      } else {
        // Orthogonal 90° corner
        const corner = { x: curr.x, y: prev.y };
        addSeg(prev, corner);
        addSeg(corner, curr);
      }
      prev = curr;
    }
  } else if (p0.x === p1.x || p0.y === p1.y) {
    // Pure straight horizontal or vertical
    addSeg(p0, p1);
  } else if (wire.branchPoint) {
    // Branch leaving parent wire: drop vertically first, then route horizontally into target
    const corner = { x: p0.x, y: p1.y };
    addSeg(p0, corner);
    addSeg(corner, p1);
  } else {
    // Standard gate output-to-input connection
    const rawMidX = wire.elbowX !== undefined ? wire.elbowX : (p0.x + p1.x) / 2;
    const midX = snapTo10(rawMidX);

    if (midX <= p0.x || midX >= p1.x) {
      // Degenerates cleanly to an L-shape
      const corner = { x: p1.x, y: p0.y };
      addSeg(p0, corner);
      addSeg(corner, p1);
    } else {
      // Standard 3-segment Z/S shape with vertical elbow locked strictly to 10px grid
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
 * Dynamically computes all true solder dot junctions in the circuit.
 * Solder dots ONLY appear where 3 or more wire segments meet (T-junction or cross)
 * or where a wire terminates on the body of another wire.
 * Mathematically prevents floating, misplaced, or orphaned solder dots.
 */
export const computeCircuitJunctions = (
  wires: CircuitWire[],
  getWireStart: (w: CircuitWire) => WirePoint,
  getWireEnd: (w: CircuitWire, start: WirePoint) => WirePoint,
  _findPin?: (pinId: string) => CircuitPin | null | undefined
): CircuitJunction[] => {
  const allSegments: WireSegment[] = [];
  const points = new Map<string, WirePoint>();
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

      if (!points.has(k1)) points.set(k1, { x: s.x1, y: s.y1 });
      if (!points.has(k2)) points.set(k2, { x: s.x2, y: s.y2 });

      if (!pointWireValues.has(k1)) {
        pointWireValues.set(k1, { value: w.value, hasConflict: !!w.hasConflict, isBus: !!w.isBus });
      }
      if (!pointWireValues.has(k2)) {
        pointWireValues.set(k2, { value: w.value, hasConflict: !!w.hasConflict, isBus: !!w.isBus });
      }
    }
  }

  const pointDirs = new Map<string, Set<'N' | 'S' | 'E' | 'W'>>();
  for (const [key] of points) {
    pointDirs.set(key, new Set());
  }

  for (const s of allSegments) {
    if (s.isVertical) {
      const minY = Math.min(s.y1, s.y2);
      const maxY = Math.max(s.y1, s.y2);
      const x = s.x1;

      const pTopKey = keyOf(x, minY);
      const pBottomKey = keyOf(x, maxY);
      pointDirs.get(pTopKey)?.add('S');
      pointDirs.get(pBottomKey)?.add('N');

      // Check all other candidate points along vertical segment interior
      for (const [key, pt] of points) {
        if (pt.x === x && pt.y > minY && pt.y < maxY) {
          pointDirs.get(key)?.add('N');
          pointDirs.get(key)?.add('S');
        }
      }
    } else {
      const minX = Math.min(s.x1, s.x2);
      const maxX = Math.max(s.x1, s.x2);
      const y = s.y1;

      const pLeftKey = keyOf(minX, y);
      const pRightKey = keyOf(maxX, y);
      pointDirs.get(pLeftKey)?.add('E');
      pointDirs.get(pRightKey)?.add('W');

      // Check all other candidate points along horizontal segment interior
      for (const [key, pt] of points) {
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
      const pt = points.get(key)!;
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
