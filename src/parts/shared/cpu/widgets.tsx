// Building blocks of a processor body (evo's CpuDrawSupport boxes): a titled yellow panel and a hex value box.
import type { ReactNode } from 'react';
import { Txt } from '../../socBus/traceRow';

/** Width of a hex value box (evo's block width) */
export const BLOCK = 80;

export interface Palette {
  panel: string;
  head: string;
  headInk: string;
  box: string;
  ink: string;
  value: string;
  line: string;
  mark: string;
  markInk: string;
  pc: string;
  error: string;
  grey: string;
  ok: string;
  bad: string;
  barInk: string;
  running: string;
  breakpoint: string;
  button: string;
  buttonInk: string;
}


export function Panel(props: { x: number; y: number; w: number; h: number; title: string; c: Palette; children?: ReactNode }): ReactNode {
  const { x, y, w, h, c } = props;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={c.panel} stroke={c.line} strokeWidth={1} />
      <rect x={x} y={y} width={w} height={15} fill={c.head} />
      <Txt x={x + w / 2} y={y + 7.5} fill={c.headInk} bold>
        {props.title}
      </Txt>
      {props.children}
    </g>
  );
}

export function HexBox(props: { x: number; y: number; w?: number; h?: number; text: string; fill: string; ink: string; c: Palette }): ReactNode {
  const { x, y, c } = props;
  const w = props.w ?? BLOCK;
  const h = props.h ?? 13;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={props.fill} stroke={c.line} strokeWidth={0.8} />
      <Txt x={x + w / 2} y={y + h / 2} fill={props.ink}>
        {props.text}
      </Txt>
    </g>
  );
}

