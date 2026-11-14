import React from 'react';
import type { AppearancePaint, AppearanceShape } from '../types/circuit';
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

export function AppearanceShapeSvg({ shape: s, dark }: { shape: AppearanceShape; dark: boolean }): React.ReactElement | null {
  switch (s.kind) {
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

export function AppearanceShapesSvg({ shapes, dark }: { shapes: AppearanceShape[]; dark: boolean }): React.ReactElement {
  return (
    <>
      {shapes.map((s, i) => (
        <AppearanceShapeSvg key={i} shape={s} dark={dark} />
      ))}
    </>
  );
}
