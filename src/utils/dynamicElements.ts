import type {
  AppearanceDynamicElement,
  AppearanceDynamicShape,
  AppearanceFont,
  CircuitComponentInstance,
  ComponentType,
  CustomSubcircuit,
} from '../types/circuit';
import { getIo5cConfig, getIoConfig, getMemConfig } from './circuitEngine';
import { peekSubcircuitDefinition } from './subcircuitManager';
import type { AppearanceSvgElement } from './subcircuitAppearance';

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

/**
 * A node of the "show state" tree (evolution's ShowStateDialog.enumerate): a part that can be shown (`children`
 * null) or an IC with such parts somewhere inside it; ICs with nothing to show are left out. Unlike evolution
 * (whose Pin is not a DynamicElementProvider) an output port can be shown too: here it is an LED (`port`), and the
 * drawing already accepts an element for it. Such an element cannot go to a .circ file (the export says so).
 */
export interface DynamicTreeNode {
  comp: CircuitComponentInstance;
  /** Part ids from the top circuit down to this part */
  path: string[];
  children: DynamicTreeNode[] | null;
  /** The part is a port of its circuit */
  port?: boolean;
}

export function dynamicTree(def: CustomSubcircuit): DynamicTreeNode[] {
  const walk = (d: CustomSubcircuit, prefix: string[], depth: number): DynamicTreeNode[] => {
    if (depth > 32) return [];
    const ports = new Set(d.ports.map((p) => p.targetCompId));
    const out: DynamicTreeNode[] = [];
    for (const c of d.components) {
      if (DYNAMIC_ELEMENT_OF[c.type]) out.push({ comp: c, path: [...prefix, c.id], children: null, ...(ports.has(c.id) ? { port: true } : {}) });
      else if (c.type === 'subcircuit') {
        const inner = peekSubcircuitDefinition(c.state.subcircuitId);
        if (!inner) continue;
        const kids = walk(inner, [...prefix, c.id], depth + 1);
        if (kids.length) out.push({ comp: c, path: [...prefix, c.id], children: kids });
      }
    }
    return out;
  };
  return walk(def, [], 0);
}

/** The element with its size recomputed for its part after a radius / scale / value font change (evolution keeps the corner) */
export function resizeDynamicShape(def: CustomSubcircuit, s: AppearanceDynamicShape): AppearanceDynamicShape {
  const size = dynamicElementSize(s.element, resolveDynamicTemplate(def, s.path), s);
  return size.width === s.width && size.height === s.height ? s : { ...s, ...size };
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

// ---- .circ form: the visible-* elements of an <appear> block (DynamicElement.toSvgElement / parseSvgElement) ----

/** Evolution's factory name of the part each element shows (what a path names it by) */
export const DYNAMIC_FACTORY: Record<AppearanceDynamicElement, string> = {
  led: 'LED',
  rgbled: 'RGBLED',
  sevensegment: '7-Segment Display',
  hexdigit: 'Hex Digit Display',
  register: 'Register',
  counter: 'Counter',
  probe: 'Probe',
  tty: 'TTY',
  dotmatrix: 'DotMatrix',
  ledbar: 'LedBar',
};

const DYNAMIC_TAGS = new Set<string>(Object.keys(DYNAMIC_FACTORY).map((e) => `visible-${e}`));

/** The element a visible-* tag reads as (null: one evolution has but we do not: visible-vga, visible-soc-cpu) */
export function dynamicElementOfTag(tag: string): AppearanceDynamicElement | null {
  return DYNAMIC_TAGS.has(tag) ? (tag.slice(8) as AppearanceDynamicElement) : null;
}

/** One step of a path as the file writes it: the part's factory name and location */
export interface DynamicPathStep {
  name: string;
  x: number;
  y: number;
}

/** Java Integer.parseInt of a trimmed string */
function javaInt(v: string): number {
  const t = v.trim();
  if (!/^[-+]?\d+$/.test(t)) throw new Error(`bad integer: ${v}`);
  return parseInt(t, 10);
}

/**
 * DynamicElement.Path.fromSvgString: "/Name(x,y)/Name(x,y)...", a "/" or "\" in a name escaped with a backslash.
 * Throws on a malformed path, as evolution does.
 */
export function parseDynamicPath(s: string): DynamicPathStep[] {
  if (!s.startsWith('/')) throw new Error(`Bad path: ${s}`);
  const parts = s.slice(1).split(/(?<!\\)\//);
  // (Java's split drops trailing empty strings)
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((ss) => {
    const p = ss.lastIndexOf('(');
    const c = ss.lastIndexOf(',');
    const e = ss.lastIndexOf(')');
    if (e !== ss.length - 1 || p <= 0 || c <= p) throw new Error(`Bad path element: ${ss}`);
    return {
      name: ss.slice(0, p).replace(/\\\//g, '/').replace(/\\\\/g, '\\'),
      x: javaInt(ss.slice(p + 1, c)),
      y: javaInt(ss.slice(c + 1, e)),
    };
  });
}

/** DynamicElement.Path.toSvgString */
export function dynamicPathString(steps: DynamicPathStep[]): string {
  return steps.map((st) => `/${st.name.replace(/\\/g, '\\\\').replace(/\//g, '\\/')}(${st.x},${st.y})`).join('');
}

const sameFont = (f: AppearanceFont, d: { family: string; size: number }) =>
  f.family.toLowerCase() === d.family.toLowerCase() && f.size === d.size && !f.bold && !f.italic;

/** SvgReader.getFontAttribute; undefined when it is the default font */
function readFont(attr: (n: string) => string | null, prefix: string, dflt: { family: string; size: number }): AppearanceFont | undefined {
  const size = attr(`${prefix}font-size`);
  const f: AppearanceFont = {
    family: attr(`${prefix}font-family`) || dflt.family,
    size: size && /^[-+]?\d+$/.test(size) ? parseInt(size, 10) : dflt.size,
  };
  if (attr(`${prefix}font-style`) === 'italic') f.italic = true;
  if (attr(`${prefix}font-weight`) === 'bold') f.bold = true;
  return sameFont(f, dflt) ? undefined : f;
}

/** SvgCreator.setFontAttribute */
function writeFont(out: Array<[string, string]>, f: AppearanceFont, prefix: string) {
  out.push([`${prefix}font-family`, f.family], [`${prefix}font-size`, String(f.size)]);
  if (f.italic) out.push([`${prefix}font-style`, 'italic']);
  if (f.bold) out.push([`${prefix}font-weight`, 'bold']);
}

const LABEL_LOCS = new Set(['left', 'right', 'top', 'bottom', 'center']);

/** Integer.valueOf (no trim) */
function strictInt(v: string): number {
  if (!/^[-+]?\d+$/.test(v)) throw new Error(`bad integer: ${v}`);
  return parseInt(v, 10);
}

const scaleDefault = (element: AppearanceDynamicElement) =>
  element === 'sevensegment' || element === 'hexdigit' ? DYNAMIC_DEFAULTS.segmentScale : DYNAMIC_DEFAULTS.matrixScale;
const HAS_RADIUS = new Set<AppearanceDynamicElement>(['led', 'rgbled']);
const HAS_VALUE_FONT = new Set<AppearanceDynamicElement>(['register', 'counter', 'probe']);
const HAS_SCALE = new Set<AppearanceDynamicElement>(['sevensegment', 'hexdigit', 'dotmatrix', 'ledbar']);

/**
 * A visible-* element as evolution reads it (AppearanceSvgReader.createShape, then parseSvgElement): its corner
 * from x / y (Java (int) of a double), the size recomputed for the part it shows (`target`), label, label font
 * and colour, stroke width (none written = 0) and the element's own value-* attribute. Throws on a bad number,
 * as evolution does (it then drops the element).
 */
export function dynamicShapeFromSvg(
  element: AppearanceDynamicElement,
  attr: (n: string) => string | null,
  path: string[],
  target: CircuitComponentInstance
): AppearanceDynamicShape {
  const coord = (n: string) => {
    const t = (attr(n) ?? '').trim().replace(/[dDfF]$/, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) throw new Error(`bad ${n}`);
    return Math.trunc(parseFloat(t));
  };
  const s: AppearanceDynamicShape = { kind: 'dynamic', element, x: coord('x'), y: coord('y'), width: 0, height: 0, path };
  const sw = attr('stroke-width');
  if (sw !== null) s.strokeWidth = javaInt(sw);
  const label = attr('label');
  if (label !== null) {
    const l = label.trim().toLowerCase();
    if (LABEL_LOCS.has(l)) s.label = l as NonNullable<AppearanceDynamicShape['label']>;
  }
  const lf = readFont(attr, '', DYNAMIC_DEFAULTS.labelFont);
  if (lf) s.labelFont = lf;
  const lc = attr('label-color');
  if (lc !== null) {
    // SvgReader.getColor: #rrggbb, anything else black
    const c = /^#[0-9a-fA-F]{6}$/.test(lc) ? lc.toLowerCase() : '#000000';
    if (c !== DYNAMIC_DEFAULTS.labelColor) s.labelColor = c;
  }
  if (HAS_RADIUS.has(element)) {
    const r = attr('value-radius');
    if (r !== null && strictInt(r) !== DYNAMIC_DEFAULTS.radius) s.radius = strictInt(r);
  } else if (HAS_VALUE_FONT.has(element)) {
    const vf = readFont(attr, 'value-', DYNAMIC_DEFAULTS.valueFont);
    if (vf) s.valueFont = vf;
  } else if (HAS_SCALE.has(element)) {
    const sc = attr('value-scale');
    if (sc !== null && strictInt(sc) !== scaleDefault(element)) s.scale = strictInt(sc);
  }
  return { ...s, ...dynamicElementSize(element, target, s) };
}

/**
 * The visible-* element of a shape (DynamicElement.toSvgElement and the shapes' own attributes), `path` its path as
 * the file names the parts; attributes sorted by name, as evolution's XML writer puts them
 */
export function dynamicShapeToSvg(s: AppearanceDynamicShape, path: string): AppearanceSvgElement {
  const attrs: Array<[string, string]> = [
    ['x', String(Math.round(s.x))],
    ['y', String(Math.round(s.y))],
    ['width', String(Math.round(s.width))],
    ['height', String(Math.round(s.height))],
  ];
  if (s.label) attrs.push(['label', s.label]);
  if (s.labelFont && !sameFont(s.labelFont, DYNAMIC_DEFAULTS.labelFont)) writeFont(attrs, s.labelFont, '');
  const lc = s.labelColor?.slice(0, 7).toLowerCase();
  if (lc && lc !== DYNAMIC_DEFAULTS.labelColor) attrs.push(['label-color', lc]);
  // a new or read element without the attribute has width 0, so only 1 is left out
  if ((s.strokeWidth ?? 0) !== 1) attrs.push(['stroke-width', String(s.strokeWidth ?? 0)]);
  attrs.push(['path', path]);
  if (HAS_RADIUS.has(s.element) && s.radius !== undefined && s.radius !== DYNAMIC_DEFAULTS.radius) attrs.push(['value-radius', String(s.radius)]);
  if (HAS_VALUE_FONT.has(s.element) && s.valueFont && !sameFont(s.valueFont, DYNAMIC_DEFAULTS.valueFont)) writeFont(attrs, s.valueFont, 'value-');
  if (HAS_SCALE.has(s.element) && s.scale !== undefined && s.scale !== scaleDefault(s.element)) attrs.push(['value-scale', String(s.scale)]);
  attrs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { tag: `visible-${s.element}`, attrs };
}
