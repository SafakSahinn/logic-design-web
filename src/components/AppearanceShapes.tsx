import React from 'react';
import type { AppearanceDynamicShape, AppearanceFont, AppearancePaint, AppearanceShape, CircuitComponentInstance } from '../types/circuit';
import { formatBits } from '../types/logic';
import { TWO_PIN_LED_DEFAULTS, matrixDots, getIoConfig, rgbLedBits, segmentsLit, ttyScreen, twoPinLedColor, twoPinLedState } from '../utils/circuitEngine';
import { DYNAMIC_DEFAULTS, ledBarFacing, registerText } from '../utils/dynamicElements';
import { appearanceTextBox } from '../utils/subcircuitAppearance';

/**
 * Draws the shapes of a subcircuit appearance (evolution draw shapes) as SVG. On the dark canvas pure black
 * and pure white swap, so evolution's black-on-white drawings stay readable (the Text part does the same with
 * its default colour).
 */

/** Java logical font names -> CSS stacks; other families are tried by name first */
export function appearanceFontCss(family: string): string {
  const css: Record<string, string> = {
    SansSerif: 'Arial, Helvetica, sans-serif',
    Serif: '"Times New Roman", Times, serif',
    Monospaced: '"Courier New", Courier, monospace',
    Dialog: 'Arial, Helvetica, sans-serif',
    DialogInput: '"Courier New", Courier, monospace',
    'Courier 10 Pitch': '"Courier 10 Pitch", "Courier New", Courier, monospace',
  };
  return css[family] ?? `"${family}", Arial, sans-serif`;
}

/** #rrggbb or #rrggbbaa -> colour and opacity; black and white swap on the dark canvas */
function color(c: string | undefined, fallback: string, dark: boolean): { c: string; o?: number } {
  let v = (c ?? fallback).toLowerCase();
  let o: number | undefined;
  if (/^#[0-9a-f]{8}$/.test(v)) {
    o = parseInt(v.slice(7, 9), 16) / 255;
    v = v.slice(0, 7);
  }
  if (dark) {
    if (v === '#000000') v = '#e2e8f0';
    else if (v === '#ffffff') v = '#0f172a';
  }
  return { c: v, o };
}

function paintProps(s: AppearancePaint, dark: boolean): React.SVGProps<SVGElement> {
  const type = s.paint ?? 'stroke';
  const props: React.SVGProps<SVGElement> = {};
  if (type === 'fill') props.stroke = 'none';
  else {
    const st = color(s.stroke, '#000000', dark);
    props.stroke = st.c;
    if (st.o !== undefined) props.strokeOpacity = st.o;
    props.strokeWidth = s.strokeWidth ?? 1;
  }
  if (type === 'stroke') props.fill = 'none';
  else {
    const f = color(s.fill, '#ffffff', dark);
    props.fill = f.c;
    if (f.o !== undefined) props.fillOpacity = f.o;
  }
  return props;
}

/**
 * The part a dynamic element shows: `target` for its settings (the live part, else the definition's own) and
 * `live` when the IC has simulated state for it (null = drawn as evolution does without a simulation)
 */
export interface DynamicTarget {
  target: CircuitComponentInstance | null;
  live: CircuitComponentInstance | null;
}
export type DynamicResolver = (s: AppearanceDynamicShape) => DynamicTarget;

const LED_ON: Record<string, string> = { green: '#22c55e', red: '#ef4444', blue: '#3b82f6', yellow: '#eab308' };
const ERROR_COLOR = '#c00000';

function fontProps(f: AppearanceFont) {
  return { fontFamily: appearanceFontCss(f.family), fontSize: f.size, fontWeight: f.bold ? 'bold' : 'normal', fontStyle: f.italic ? 'italic' : 'normal' };
}

/** Text drawn like GraphicsUtil.drawText: x by text-anchor, y = the top / middle / bottom of the text */
function alignedText(key: string, text: string, x: number, y: number, h: 'left' | 'center' | 'right', v: 'top' | 'middle' | 'bottom', font: AppearanceFont, fill: string) {
  const ascent = font.size * 0.8;
  const descent = font.size * 0.2;
  const baseline = v === 'top' ? y + ascent : v === 'bottom' ? y - descent : y + (ascent - descent) / 2;
  return (
    <text key={key} x={x} y={baseline} textAnchor={h === 'left' ? 'start' : h === 'right' ? 'end' : 'middle'} fill={fill} {...fontProps(font)} className="select-none" style={{ whiteSpace: 'pre' }}>
      {text}
    </text>
  );
}

/** DynamicElement.drawLabel: the shown part's label beside or on the element */
function dynamicLabel(s: AppearanceDynamicShape, target: CircuitComponentInstance | null, dark: boolean) {
  const text = target?.label?.trim();
  if (!s.label || !text) return null;
  const font = s.labelFont ?? DYNAMIC_DEFAULTS.labelFont;
  const fill = color(s.labelColor, DYNAMIC_DEFAULTS.labelColor, dark).c;
  const { x, y, width: w, height: h } = s;
  switch (s.label) {
    case 'top':
      return alignedText('lbl', text, x + w / 2, y - 1, 'center', 'bottom', font, fill);
    case 'bottom':
      return alignedText('lbl', text, x + w / 2, y + h + 1, 'center', 'top', font, fill);
    case 'left':
      return alignedText('lbl', text, x - 1, y + h / 2, 'right', 'middle', font, fill);
    case 'right':
      return alignedText('lbl', text, x + w + 1, y + h / 2, 'left', 'middle', font, fill);
    default:
      return alignedText('lbl', text, x + w / 2, y + h / 2, 'center', 'middle', font, fill);
  }
}

/** One dot of a dot matrix / LED bar (DotMatrixBaseShape.drawShape), in the unturned frame */
function matrixDot(key: number, x: number, y: number, shape: string, scale: number, sx: number, sy: number, fill: string) {
  if (shape === 'square') return <rect key={key} x={x} y={y} width={scale * sx} height={scale * sy} fill={fill} />;
  if (shape === 'padded') {
    const pad = Math.floor(scale / 6);
    return <rect key={key} x={x + pad * sx} y={y + pad} width={(scale - pad * 2) * sx} height={(scale - pad * 2) * sy} fill={fill} />;
  }
  const pad = Math.round(scale / 10);
  const w = (scale - 2 * pad) * sx;
  const h = (scale - 2 * pad) * sy;
  return <ellipse key={key} cx={x + pad * sx + w / 2} cy={y + pad * sy + h / 2} rx={w / 2} ry={h / 2} fill={fill} />;
}

const SEGMENTS = [
  [1, 0, 3, 1],
  [4, 1, 1, 3],
  [4, 5, 1, 3],
  [1, 8, 3, 1],
  [0, 5, 1, 3],
  [0, 1, 1, 3],
  [1, 4, 3, 1],
];

/** The paintDynamic of each evolution dynamic shape */
export function DynamicShapeSvg({ shape: s, dark, dyn }: { shape: AppearanceDynamicShape; dark: boolean; dyn: DynamicTarget }): React.ReactElement {
  const { target, live } = dyn;
  const { x, y, width: w, height: h } = s;
  const black = color('#000000', '#000000', dark).c;
  // Java draws a width-0 stroke (a new element's) as a hairline
  const sw = Math.max(1, s.strokeWidth ?? 0);
  const label = dynamicLabel(s, target, dark);
  switch (s.element) {
    case 'led':
    case 'rgbled': {
      let fill: string;
      if (s.element === 'led') {
        const on = target?.state.ioOnColor ?? LED_ON[target?.state.ledColor ?? 'green'] ?? '#f00000';
        const want = target?.state.ioActiveLow ? 0 : 1;
        fill = live && live.inputs[0]?.value === want ? on : '#404040';
      } else if (live) {
        const bits = rgbLedBits(live);
        fill = `rgb(${bits & 1 ? 255 : 0}, ${bits & 2 ? 255 : 0}, ${bits & 4 ? 255 : 0})`;
      } else fill = '#c0c0c0';
      const stroke = live ? color('#404040', '#404040', dark).c : DYNAMIC_DEFAULTS.idleColor;
      return (
        <g>
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.max(0, w / 2 - 1)} ry={Math.max(0, h / 2 - 1)} fill={fill} stroke={stroke} strokeWidth={sw} />
          {label}
        </g>
      );
    }
    case 'two-pin-led': {
      // TwoPinLedShape.paintDynamic: the LED in its state's colour (the off colour without a simulation), outlined
      // in the stroke width, and the diode symbol of TwoPinLedShape.drawDiodeSymbol for the part's facing
      const part = target ?? live;
      const fill = part ? twoPinLedColor(part, live ? twoPinLedState(live) : 'off') : TWO_PIN_LED_DEFAULTS.off;
      const cx = x + Math.trunc(w / 2);
      const cy = y + Math.trunc(h / 2);
      const r = Math.trunc(w / 2);
      const jr = (v: number) => Math.floor(v + 0.5);
      const base = jr(0.4 * r);
      const tip = jr(0.2 * r);
      const half = jr(0.45 * r);
      const bar = jr(half * 0.8);
      const off = Math.max(1, Math.trunc(r / 8));
      const rot = part?.rotation ?? 0;
      let sym: React.ReactElement;
      if (rot === 0 || rot === 180) {
        // facing west (ours unturned): the triangle points right; facing east: left
        const d = rot === 0 ? 1 : -1;
        const bx = cx - d * base + off;
        const tx = cx + d * tip + off;
        sym = (
          <>
            <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} />
            <polygon points={`${bx},${cy - half} ${bx},${cy + half} ${tx},${cy}`} />
            <line x1={tx} y1={cy - bar} x2={tx} y2={cy + bar} />
          </>
        );
      } else {
        // facing south (ours turned 90): the triangle points down; facing north: up (evolution shifts it sideways)
        const d = rot === 90 ? 1 : -1;
        const by = cy - d * base;
        const ty = cy + d * tip;
        sym = (
          <>
            <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} />
            <polygon points={`${cx - half + off},${by} ${cx + half + off},${by} ${cx + off},${ty}`} />
            <line x1={cx - bar + off} y1={ty} x2={cx + bar + off} y2={ty} />
          </>
        );
      }
      return (
        <g>
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.max(0, w / 2 - 1)} ry={Math.max(0, h / 2 - 1)} fill={fill} stroke={black} strokeWidth={sw} />
          <g stroke={black} strokeWidth={1} fill={black}>
            {sym}
          </g>
          {label}
        </g>
      );
    }
    case 'sevensegment':
    case 'hexdigit': {
      const scale = s.scale ?? DYNAMIC_DEFAULTS.segmentScale;
      const lit = live ? segmentsLit(live) : null;
      const on = target?.state.ioOnColor ?? '#f00000';
      const fillOf = (i: number) => (lit ? (lit[i] ? on : '#dcdcdc') : '#999999');
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="none" stroke={black} strokeWidth={1} />
          {SEGMENTS.map(([sx, sy, sw2, sh], i) => (
            <rect key={i} x={x + 1 + sx * scale} y={y + 1 + sy * scale} width={sw2 * scale} height={sh * scale} fill={fillOf(i)} />
          ))}
          <ellipse cx={x + 1 + 5.5 * scale} cy={y + 1 + 8.5 * scale} rx={scale / 2} ry={scale / 2} fill={fillOf(7)} />
          {label}
        </g>
      );
    }
    case 'register':
    case 'counter':
    case 'probe': {
      const font = s.valueFont ?? DYNAMIC_DEFAULTS.valueFont;
      let text: string;
      if (s.element === 'probe') {
        if (live) {
          const pin = live.inputs[0];
          text = formatBits(pin?.bits ?? [pin?.value ?? 'Z'], live.state.radix ?? '2');
        } else text = '00000000';
      } else text = registerText(live ?? target, !!live);
      return (
        <g>
          {s.element !== 'probe' && <rect x={x} y={y} width={w} height={h} fill={live ? 'none' : '#c0c0c0'} stroke={black} strokeWidth={1} />}
          {alignedText('val', text, x + w / 2, y + h / 2, 'center', 'middle', font, black)}
          {label}
        </g>
      );
    }
    case 'tty': {
      const rows = live ? ttyScreen(live).rows : [];
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={6} ry={6} fill="#ffff00" stroke="#000000" strokeWidth={2} />
          {rows.map((row, i) => (
            <text key={i} x={x + 6} y={y + 18 + i * 15} fill="#000000" fontFamily={appearanceFontCss('Monospaced')} fontSize={11} className="select-none" style={{ whiteSpace: 'pre' }}>
              {row}
            </text>
          ))}
          {label}
        </g>
      );
    }
    case 'dotmatrix':
    case 'ledbar': {
      const bar = s.element === 'ledbar';
      const scale = s.scale ?? DYNAMIC_DEFAULTS.matrixScale;
      const cfg = target ? getIoConfig(target) : null;
      const cols = bar ? cfg?.size ?? 8 : cfg?.cols ?? 5;
      const rows = bar ? 1 : cfg?.rows ?? 7;
      const sy = bar ? 3 : 1;
      const shape = bar ? 'padded' : target?.state.dotShape ?? 'square';
      const on = target?.state.ioOnColor ?? '#00ff00';
      const dots = live ? matrixDots(live) : null;
      const along = cols * scale;
      const across = rows * scale * sy;
      const facing = bar ? ledBarFacing(target) : 'east';
      const turn =
        facing === 'north'
          ? `translate(${x} ${y + along}) rotate(-90)`
          : facing === 'west'
            ? `translate(${x + along} ${y + across}) rotate(180)`
            : facing === 'south'
              ? `translate(${x + across} ${y}) rotate(90)`
              : `translate(${x} ${y})`;
      const cells: React.ReactNode[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const v = dots ? dots[r * cols + c] : 'E';
          const fill = v === 1 ? on : v === 0 ? '#404040' : ERROR_COLOR;
          cells.push(matrixDot(r * cols + c, c * scale, r * scale * sy, shape, scale, 1, sy, fill));
        }
      return (
        <g>
          <g transform={turn}>
            {cells}
            {!bar && <rect x={0} y={0} width={along} height={across} fill="none" stroke={color('#404040', '#404040', dark).c} strokeWidth={sw} />}
          </g>
          {label}
        </g>
      );
    }
  }
}

export function AppearanceShapeSvg({ shape: s, dark, dyn }: { shape: AppearanceShape; dark: boolean; dyn?: DynamicResolver }): React.ReactElement | null {
  switch (s.kind) {
    case 'dynamic':
      return <DynamicShapeSvg shape={s} dark={dark} dyn={dyn ? dyn(s) : { target: null, live: null }} />;
    case 'rect':
      return <rect x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} ry={s.rx} {...(paintProps(s, dark) as React.SVGProps<SVGRectElement>)} />;
    case 'oval':
      return <ellipse cx={s.x + s.width / 2} cy={s.y + s.height / 2} rx={s.width / 2} ry={s.height / 2} {...(paintProps(s, dark) as React.SVGProps<SVGEllipseElement>)} />;
    case 'line': {
      const st = color(s.stroke, '#000000', dark);
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={st.c} strokeOpacity={st.o} strokeWidth={s.strokeWidth ?? 1} strokeLinecap="round" />;
    }
    case 'poly': {
      const pts = s.points.map((p) => `${p.x},${p.y}`).join(' ');
      const props = paintProps(s, dark) as React.SVGProps<SVGPolygonElement>;
      return s.closed ? <polygon points={pts} strokeLinejoin="round" {...props} /> : <polyline points={pts} strokeLinejoin="round" {...(props as React.SVGProps<SVGPolylineElement>)} />;
    }
    case 'curve':
      return <path d={`M${s.x0},${s.y0} Q${s.cx},${s.cy} ${s.x1},${s.y1}`} {...(paintProps(s, dark) as React.SVGProps<SVGPathElement>)} />;
    case 'text': {
      const b = appearanceTextBox(s);
      const f = color(s.fill, '#000000', dark);
      const anchor = s.halign === 'left' ? 'start' : s.halign === 'right' ? 'end' : 'middle';
      return (
        <text
          x={s.x}
          textAnchor={anchor}
          fill={f.c}
          fillOpacity={f.o}
          fontFamily={appearanceFontCss(s.fontFamily)}
          fontSize={s.fontSize}
          fontWeight={s.bold ? 'bold' : 'normal'}
          fontStyle={s.italic ? 'italic' : 'normal'}
          className="select-none"
          style={{ whiteSpace: 'pre' }}
        >
          {s.text.split('\n').map((line, i) => (
            <tspan key={i} x={s.x} y={b.baseline + i * s.fontSize}>
              {line}
            </tspan>
          ))}
        </text>
      );
    }
    case 'image':
      return (
        <image
          href={s.src}
          x={s.x}
          y={s.y}
          width={Math.max(1, s.width)}
          height={Math.max(1, s.height)}
          preserveAspectRatio={s.scale === 'stretch' ? 'none' : s.scale === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
        />
      );
    default:
      return null;
  }
}

export function AppearanceShapesSvg({ shapes, dark, dyn }: { shapes: AppearanceShape[]; dark: boolean; dyn?: DynamicResolver }): React.ReactElement {
  return (
    <>
      {shapes.map((s, i) => (
        <AppearanceShapeSvg key={i} shape={s} dark={dark} dyn={dyn} />
      ))}
    </>
  );
}
