// One row of the SoC Bus trace (evo's SocBusTransaction paint) and the trace's text style.
import type { ReactNode } from 'react';
import type { SocTransaction } from '../../soc';
import { ROW_HEIGHT } from './model';
import { busErrorText, hex, t } from './text';
import { digitsOf } from './transact';

/** evo's trace box geometry: 630 wide at (5, 25); blocks of 238 with 2px gaps, 14px markers and 78px hex fields */
export const BOX_X = 5;
export const BOX_Y = 25;
export const BOX_W = 630;
const SKIP = 2;
const MARK = 14;
const HEX = 78;
const BLOCK = 238;
const INDEX_W = 158;
const RESPONSE_X = INDEX_W + 235;

export interface TracePalette {
  box: string;
  row: string;
  ink: string;
  line: string;
  error: string;
  atomic: string;
  atomicInk: string;
  write: string;
  read: string;
  flagInk: string;
}
type Palette = TracePalette;

const dataDigits = (t: SocTransaction): number => digitsOf(t.access);

export function Txt(props: { x: number; y: number; fill: string; size?: number; bold?: boolean; anchor?: 'start' | 'middle' | 'end'; children: ReactNode }): ReactNode {
  return (
    <text
      x={props.x}
      y={props.y}
      fill={props.fill}
      fontSize={props.size ?? 9}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      fontWeight={props.bold ? 700 : 400}
      textAnchor={props.anchor ?? 'middle'}
      dominantBaseline="central"
      className="select-none"
    >
      {props.children}
    </text>
  );
}

/** A marker + hex field: [A|0x00000000] */
function Field(props: { x: number; y: number; mark: string; value: string; c: Palette }): ReactNode {
  const { x, y, c } = props;
  const h = ROW_HEIGHT / 2 - 1;
  return (
    <g>
      <rect x={x + SKIP} y={y} width={MARK + HEX} height={h} fill="none" stroke={c.line} strokeWidth={0.8} />
      <line x1={x + SKIP + MARK} y1={y} x2={x + SKIP + MARK} y2={y + h} stroke={c.line} strokeWidth={0.8} />
      <Txt x={x + SKIP + MARK / 2} y={y + h / 2} fill={c.ink}>
        {props.mark}
      </Txt>
      <Txt x={x + SKIP + MARK + HEX / 2} y={y + h / 2} fill={c.ink}>
        {props.value}
      </Txt>
    </g>
  );
}

function Flag(props: { x: number; y: number; on: boolean; text: string; fill: string; ink: string }): ReactNode {
  if (!props.on) return null;
  const h = ROW_HEIGHT / 2 - 1;
  return (
    <g>
      <rect x={props.x} y={props.y} width={MARK} height={h} fill={props.fill} />
      <Txt x={props.x + MARK / 2} y={props.y + h / 2} fill={props.ink} bold>
        {props.text}
      </Txt>
    </g>
  );
}

export function TraceRow(props: { tr: SocTransaction; index: number; y: number; c: Palette }): ReactNode {
  const { tr, y, c } = props;
  const x = BOX_X + 1;
  const half = y + ROW_HEIGHT / 2;
  const noData = t('trace.noData');
  const req = x + INDEX_W;
  const res = x + RESPONSE_X;
  return (
    <g>
      <rect x={x} y={y} width={BOX_W - 2} height={ROW_HEIGHT - 1} fill={c.row} stroke={c.line} strokeWidth={0.8} />
      <Txt x={x + INDEX_W / 2} y={y + 7} fill={c.ink} size={8}>
        {t('trace.index')}
      </Txt>
      <Txt x={x + INDEX_W / 2} y={y + 21} fill={c.ink}>
        {props.index}
      </Txt>
      {/* request */}
      <line x1={req} y1={y} x2={req} y2={y + ROW_HEIGHT - 1} stroke={c.line} strokeWidth={0.8} />
      <Txt x={req + BLOCK / 2} y={y + 7} fill={c.ink}>
        {t('trace.master', { name: tr.master })}
      </Txt>
      <Field x={req} y={half} mark="A" value={hex(tr.address)} c={c} />
      <Field x={req + SKIP + MARK + HEX} y={half} mark="D" value={tr.isWrite ? hex(tr.writeData, dataDigits(tr)) : noData} c={c} />
      <Flag x={req + 2 * (SKIP + MARK + HEX)} y={half} on={tr.isAtomic} text="A" fill={c.atomic} ink={c.atomicInk} />
      <Flag x={req + 2 * (SKIP + MARK + HEX) + SKIP + MARK} y={half} on={tr.isWrite} text="W" fill={c.write} ink={c.flagInk} />
      <Flag x={req + 2 * (SKIP + MARK + HEX) + 2 * (SKIP + MARK)} y={half} on={tr.isRead} text="R" fill={c.read} ink={c.flagInk} />
      {/* response */}
      <line x1={res} y1={y} x2={res} y2={y + ROW_HEIGHT - 1} stroke={c.line} strokeWidth={0.8} />
      {tr.hasError ? (
        <Txt x={res + BLOCK / 2} y={y + ROW_HEIGHT / 2} fill={c.error} size={10} bold>
          {busErrorText(tr.error, true)}
        </Txt>
      ) : (
        <>
          <Txt x={res + BLOCK / 2} y={y + 7} fill={c.ink}>
            {t('trace.slave', { name: tr.responder ?? '' })}
          </Txt>
          <Field x={res} y={half} mark="A" value={hex(tr.address)} c={c} />
          <Field x={res + SKIP + MARK + HEX} y={half} mark="D" value={tr.isRead ? hex(tr.readData, dataDigits(tr)) : noData} c={c} />
        </>
      )}
    </g>
  );
}

