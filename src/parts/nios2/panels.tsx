// The bottom panel of the Nios II's state area: evo's IRQ panel (with IRQ inputs) or the other control registers
// (without), both ending with the status line (halt message or a custom instruction waiting for done).
import type { ReactNode } from 'react';
import type { Nios2Core } from '../../soc';
import { UNKNOWN, UX, UY, fit } from '../shared/cpu/palette';
import { BLOCK, HexBox, Panel, type Palette } from '../shared/cpu/widgets';
import { Txt } from '../socBus/traceRow';
import { hex, t } from './text';

/** The bottom panel of the state area (evo's drawIRQs at (0, 500), 585 x 90) */
const PY = UY + 500;

/** evo's drawIRQs: per IRQ (right to left) its number, its level and its ienable bit, then the OR of both rows */
export function IrqPanel(props: { c: Palette; core: Nios2Core | undefined; irqs: number; status: string; error: boolean }): ReactNode {
  const { c, core } = props;
  const lines = core?.irqLines ?? 0;
  const mask = core?.ienable ?? 0;
  const cells: ReactNode[] = [];
  for (let i = 0; i < props.irqs; i++) {
    const x = UX + 568 - i * 17;
    const cx = x + 8;
    cells.push(
      <g key={i}>
        <Txt x={cx} y={PY + 11} fill={c.ink} size={8}>
          {String(i)}
        </Txt>
        <rect x={x} y={PY + 20} width={15} height={15} fill={c.box} stroke={c.line} strokeWidth={0.8} />
        <Txt x={cx} y={PY + 27.5} fill={c.value}>
          {(lines >>> i) & 1 ? '1' : '0'}
        </Txt>
        <line x1={cx} y1={PY + 35} x2={cx} y2={PY + 37} stroke={c.line} strokeWidth={0.8} />
        <rect x={x} y={PY + 37} width={15} height={15} fill={c.box} stroke={c.line} strokeWidth={0.8} />
        <Txt x={cx} y={PY + 44.5} fill={c.value}>
          {(mask >>> i) & 1 ? '1' : '0'}
        </Txt>
        <line x1={cx} y1={PY + 52} x2={cx} y2={PY + 54} stroke={c.line} strokeWidth={0.8} />
      </g>,
    );
  }
  const pending = core ? core.ipending !== 0 : false;
  return (
    <g>
      <rect x={UX} y={PY} width={585} height={90} fill={c.panel} stroke={c.line} strokeWidth={1} />
      {cells}
      <Txt x={UX + 2} y={PY + 27.5} fill={c.ink} anchor="start">
        {t('body.irqs')}
      </Txt>
      <Txt x={UX + 2} y={PY + 44.5} fill={c.ink} anchor="start">
        {t('body.mask')}
      </Txt>
      <rect x={UX + 41} y={PY + 54} width={542} height={15} fill="none" stroke={c.line} strokeWidth={0.8} />
      <Txt x={UX + 312} y={PY + 61.5} fill={c.ink}>
        ≥1
      </Txt>
      <line x1={UX + 312} y1={PY + 69} x2={UX + 312} y2={PY + 71} stroke={c.line} strokeWidth={0.8} />
      <rect x={UX + 304} y={PY + 71} width={15} height={15} fill={c.box} stroke={c.line} strokeWidth={0.8} />
      <Txt x={UX + 311.5} y={PY + 78.5} fill={pending ? c.pc : c.value} bold>
        {pending ? '1' : '0'}
      </Txt>
      <Txt x={UX + 4} y={PY + 79} fill={props.error ? c.error : c.ink} anchor="start" size={9}>
        {fit(props.status, 50)}
      </Txt>
      <Txt x={UX + 581} y={PY + 79} fill={c.ink} anchor="end" size={9}>
        {`exception ${core ? hex(core.exception) : UNKNOWN}`}
      </Txt>
    </g>
  );
}

/** Without IRQ inputs: the other control registers and the status line */
export function ControlPanel(props: { c: Palette; core: Nios2Core | undefined; status: string; error: boolean }): ReactNode {
  const { c, core } = props;
  const regs: [string, number | undefined][] = [
    ['ienable', core?.ienable],
    ['ipending', core?.ipending],
    ['exception', core?.exception],
  ];
  return (
    <Panel x={UX} y={PY} w={585} h={90} title={t('body.control')} c={c}>
      {regs.map(([name, v], i) => (
        <g key={name}>
          <Txt x={UX + 5 + i * 83 + BLOCK / 2} y={PY + 24} fill={c.ink}>
            {name}
          </Txt>
          <HexBox x={UX + 5 + i * 83} y={PY + 31} text={v === undefined ? UNKNOWN : hex(v)} fill={c.box} ink={c.value} c={c} />
        </g>
      ))}
      <Txt x={UX + 6} y={PY + 70} fill={props.error ? c.error : c.ink} anchor="start" size={10}>
        {fit(props.status, 92)}
      </Txt>
    </Panel>
  );
}
