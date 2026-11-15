import type {
  AppearanceDynamicElement,
  AppearanceDynamicShape,
  CircuitComponentInstance,
  ComponentType,
  CustomSubcircuit,
} from '../types/circuit';
import { getIo5cConfig, getIoConfig, getMemConfig } from './circuitEngine';
import { peekSubcircuitDefinition } from './subcircuitManager';

/**
 * Dynamic appearance elements, after Logisim-evolution's DynamicElement and its shapes (LedShape, RgbLedShape,
 * SevenSegmentShape, HexDigitShape, RegisterShape, CounterShape, ProbeShape, TtyShape, DotMatrixShape,
 * LedBarShape): a part somewhere inside an IC, reached through a path of part ids, drawn live on the IC body.
 * Evolution offers one for every DynamicElementProvider part; ours are the same parts (the SoC / VGA ones have
 * no counterpart here, and evolution writes the two-pin LED and keypad shapes but cannot read them back).
 */

/** Our part types that can be shown on an IC body, and the element each one gets */
export const DYNAMIC_ELEMENT_OF: Partial<Record<ComponentType, AppearanceDynamicElement>> = {
  led: 'led',
  rgbLed: 'rgbled',
  sevenSegment: 'sevensegment',
  hexDigit: 'hexdigit',
  register: 'register',
  counter: 'counter',
  probe: 'probe',
  tty: 'tty',
  dotMatrix: 'dotmatrix',
  ledBar: 'ledbar',
};

/** Part type each element shows (to check that a path still ends at the right part) */
export const DYNAMIC_ELEMENT_TYPE: Record<AppearanceDynamicElement, ComponentType> = {
  led: 'led',
  rgbled: 'rgbLed',
  sevensegment: 'sevenSegment',
  hexdigit: 'hexDigit',
  register: 'register',
  counter: 'counter',
  probe: 'probe',
  tty: 'tty',
  dotmatrix: 'dotMatrix',
  ledbar: 'ledBar',
};

export const DYNAMIC_DEFAULTS = {
  radius: 5,
  segmentScale: 2,
  matrixScale: 4,
  valueFont: { family: 'Monospaced', size: 10 },
  labelFont: { family: 'SansSerif', size: 7 },
  labelColor: '#404040',
  /** Evolution's DynamicElement.COLOR: the outline of an LED drawn without a simulation */
  idleColor: '#42f498',
} as const;

/** The parts of a definition, or of the IC part's definition */
function innerParts(comp: CircuitComponentInstance): CircuitComponentInstance[] | null {
  if (comp.type !== 'subcircuit') return null;
  return peekSubcircuitDefinition(comp.state.subcircuitId)?.components ?? null;
}

/** The part a path leads to in a definition's own (template) parts; null when the path no longer fits */
export function resolveDynamicTemplate(def: CustomSubcircuit, path: string[]): CircuitComponentInstance | null {
  let parts: CircuitComponentInstance[] | null = def.components;
  let found: CircuitComponentInstance | null = null;
  for (let i = 0; i < path.length; i++) {
    if (!parts) return null;
    found = parts.find((c) => c.id === path[i]) ?? null;
    if (!found) return null;
    if (i < path.length - 1) parts = innerParts(found);
  }
  return found;
}

/** Whether an element still shows a part of the right type (evolution drops it when a part on its path goes) */
export function dynamicShapeValid(def: CustomSubcircuit, s: AppearanceDynamicShape): boolean {
  const t = resolveDynamicTemplate(def, s.path);
  return !!t && t.type === DYNAMIC_ELEMENT_TYPE[s.element];
}

/**
 * The part a path leads to in an IC instance's simulated state (its subcircuitInternal, nested for ICs inside),
 * or null when the instance has no state for it yet (evolution then paints the element as without a simulation)
 */
export function resolveDynamicLive(ic: CircuitComponentInstance, path: string[]): CircuitComponentInstance | null {
  let parts = ic.state.subcircuitInternal?.components;
  let found: CircuitComponentInstance | null = null;
  for (let i = 0; i < path.length; i++) {
    if (!parts) return null;
    found = parts.find((c) => c.id === path[i]) ?? null;
    if (!found) return null;
    if (i < path.length - 1) parts = found.state.subcircuitInternal?.components;
  }
  return found;
}

/** Java's (int) for the size arithmetic below */
const jint = (v: number) => Math.trunc(v);

/**
 * Size of an element showing `target` (evolution's bounds): LED 2r square; 7-segment 6s+2 by 9s+2; register,
 * counter and probe StringUtil.estimateBounds of their widest text (2/3 em a character, 1 em high); terminal
 * 2 x border + its columns / rows (the size TtyShape takes once simulated); dot matrix / LED bar one scale-sized
 * cell a dot (LED bar dots 3 cells tall, turned with the part)
 */
export function dynamicElementSize(
  element: AppearanceDynamicElement,
  target: CircuitComponentInstance | null,
  opt: Pick<AppearanceDynamicShape, 'radius' | 'scale' | 'valueFont'> = {}
): { width: number; height: number } {
  switch (element) {
    case 'led':
    case 'rgbled': {
      const r = opt.radius ?? DYNAMIC_DEFAULTS.radius;
      return { width: 2 * r, height: 2 * r };
    }
    case 'sevensegment':
    case 'hexdigit': {
      const s = opt.scale ?? DYNAMIC_DEFAULTS.segmentScale;
      return { width: 6 * s + 2, height: 9 * s + 2 };
    }
    case 'register':
    case 'counter':
    case 'probe': {
      const size = opt.valueFont?.size ?? DYNAMIC_DEFAULTS.valueFont.size;
      const chars = element === 'probe' ? 8 : Math.ceil((target ? getMemConfig(target).width : 8) / 4);
      return { width: jint((size * chars * 2) / 3), height: size };
    }
    case 'tty': {
      const cfg = target ? getIo5cConfig(target) : { ttyCols: 32, ttyRows: 8 };
      return { width: Math.max(30, 2 * 6 + cfg.ttyCols * 7), height: Math.max(30, 2 * 6 + cfg.ttyRows * 15) };
    }
    case 'dotmatrix':
    case 'ledbar': {
      const s = opt.scale ?? DYNAMIC_DEFAULTS.matrixScale;
      const cfg = target ? getIoConfig(target) : null;
      if (element === 'dotmatrix') return { width: (cfg?.cols ?? 5) * s, height: (cfg?.rows ?? 7) * s };
      const along = (cfg?.size ?? 8) * s;
      const across = 3 * s;
      const rot = target?.rotation ?? 0;
      return rot === 90 || rot === 270 ? { width: across, height: along } : { width: along, height: across };
    }
  }
}

/** A new element for a part at a point (evolution's DynamicElementProvider.createDynamicElement) */
export function createDynamicShape(target: CircuitComponentInstance, path: string[], x: number, y: number): AppearanceDynamicShape | null {
  const element = DYNAMIC_ELEMENT_OF[target.type];
  if (!element) return null;
  return { kind: 'dynamic', element, x, y, ...dynamicElementSize(element, target), path };
}

/** Facing of an LED bar on the body (its own rotation: 0 east, 90 south, 180 west, 270 north) */
export function ledBarFacing(target: CircuitComponentInstance | null): 'east' | 'south' | 'west' | 'north' {
  const rot = target?.rotation ?? 0;
  return rot === 90 ? 'south' : rot === 180 ? 'west' : rot === 270 ? 'north' : 'east';
}

/** Register / counter text: hex digits of the stored value, all f when a bit is not 0 / 1 (Value.toLongValue -1) */
export function registerText(target: CircuitComponentInstance | null, live: boolean): string {
  const width = target ? getMemConfig(target).width : 8;
  const digits = Math.ceil(width / 4);
  if (!live || !target) return '0'.repeat(digits);
  const bits = target.state.seqBits ?? [];
  if (bits.length < width || bits.slice(0, width).some((b) => b !== 0 && b !== 1)) return 'f'.repeat(digits);
  let s = '';
  for (let d = digits - 1; d >= 0; d--) {
    let v = 0;
    for (let k = Math.min(width, 4 * d + 4) - 1; k >= 4 * d; k--) v = v * 2 + (bits[k] as number);
    s += v.toString(16);
  }
  return s;
}
