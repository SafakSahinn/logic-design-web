// Shared pieces of a processor body, after evo's CpuDrawSupport: the register file, a titled hex register, the
// execution trace (newest on top), the grey box of a hidden state, and at the bottom the bus bar (green with the bus
// name, red when not connected) and the run-state bar with evo's start / pause button.
import type { ReactNode } from 'react';
import { socHex as hex, socManager } from '../socRuntime';
import { Txt } from '../../socBus/traceRow';
import { requestSimulation, type DrawContext } from '../../registry';
import { UNKNOWN, UX, UY, fit, runStateColor } from './palette';
import type { CpuCoreLike, CpuPartUi, CpuTraceEntry } from './types';
import { BLOCK, HexBox, Panel, type Palette } from './widgets';

/** evo's register file panel at (UX, UY): 32 rows of "<name> <value> <abi name>"; the last written one highlighted */
export function RegisterFile(props: {
  c: Palette;
  title: string;
  name(i: number): string;
  abi(i: number): string;
  /** Value of register i, or null when unknown */
  value(i: number): number | null;
  lastWritten: number;
}): ReactNode {
  const { c } = props;
  const rows: ReactNode[] = [];
  for (let i = 0; i < 32; i++) {
    const y = UY + 16 + i * 15;
    const marked = props.lastWritten === i;
    const v = props.value(i);
    rows.push(
      <g key={i}>
        <Txt x={UX + 20} y={y + 6} fill={c.ink}>
          {props.name(i)}
        </Txt>
        <HexBox x={UX + 40} y={y} text={v === null ? UNKNOWN : hex(v)} fill={marked ? c.mark : c.box} ink={marked ? c.markInk : c.value} c={c} />
        <Txt x={UX + 140} y={y + 6} fill={c.ink}>
          {props.abi(i)}
        </Txt>
      </g>,
    );
  }
  return (
    <Panel x={UX} y={UY} w={160} h={495} title={props.title} c={c}>
      {rows}
    </Panel>
  );
}

/** evo's drawHexReg: a block-wide panel with a title and one value, `x` / `y` relative to the state area */
export function HexReg(props: { c: Palette; x: number; y: number; title: string; value: number | null; ink?: string }): ReactNode {
  const { c } = props;
  const x = UX + props.x;
  const y = UY + props.y;
  return (
    <Panel x={x} y={y} w={BLOCK} h={30} title={props.title} c={c}>
      <HexBox x={x + 1} y={y + 16} w={BLOCK - 2} text={props.value === null ? UNKNOWN : hex(props.value)} fill={c.box} ink={props.ink ?? c.value} c={c} />
    </Panel>
  );
}

/** evo's drawTrace at (170, 40) of the state area: pc, opcode and disassembly of the last instructions */
export function TracePanel(props: { c: Palette; ui: CpuPartUi; trace: readonly CpuTraceEntry[]; rows: number }): ReactNode {
  const { c, ui } = props;
  const tx = UX + 170;
  const ty = UY + 40;
  const rows: ReactNode[] = [];
  props.trace.slice(0, props.rows).forEach((e, i) => {
    const y = ty + 30 + i * 20;
    const ink = e.error ? c.error : c.ink;
    rows.push(
      <g key={i}>
        <HexBox x={tx + 5} y={y + 1} h={18} text={hex(e.pc)} fill={c.box} ink={e.error ? c.error : c.line} c={c} />
        <HexBox x={tx + 10 + BLOCK} y={y + 1} h={18} text={e.word === null ? UNKNOWN : hex(e.word)} fill={c.box} ink={e.error ? c.error : c.line} c={c} />
        <Txt x={tx + 15 + 2 * BLOCK} y={y + 10} fill={ink} anchor="start" bold size={10}>
          {fit(e.text + (e.trap !== undefined ? `  ⇒ ${ui.t('body.trap', { cause: e.trap })}` : ''), 38)}
        </Txt>
      </g>,
    );
  });
  return (
    <Panel x={tx} y={ty} w={415} h={455} title={ui.t('body.trace')} c={c}>
      <rect x={tx + 5} y={ty + 15} width={BLOCK} height={15} fill={c.box} />
      <rect x={tx + 10 + BLOCK} y={ty + 15} width={BLOCK} height={15} fill={c.box} />
      <rect x={tx + 15 + 2 * BLOCK} y={ty + 15} width={395 - 2 * BLOCK} height={15} fill={c.box} />
      <Txt x={tx + 5 + BLOCK / 2} y={ty + 22} fill={c.ink}>
        {ui.t('body.pc')}
      </Txt>
      <Txt x={tx + 10 + BLOCK + BLOCK / 2} y={ty + 22} fill={c.ink}>
        {ui.t('body.opcode')}
      </Txt>
      <Txt x={tx + 215 + BLOCK} y={ty + 22} fill={c.ink}>
        {ui.t('body.asm')}
      </Txt>
      {rows.length === 0 ? (
        <Txt x={tx + 207} y={ty + 240} fill={c.ink} size={10}>
          {ui.t('body.emptyTrace')}
        </Txt>
      ) : (
        rows
      )}
    </Panel>
  );
}

/** evo's grey box over the whole state area when the state is not shown */
export function HiddenState(props: { c: Palette; ui: CpuPartUi }): ReactNode {
  const { c } = props;
  return (
    <g>
      <rect x={UX} y={UY} width={590} height={590} fill={c.grey} />
      <Txt x={UX + 295} y={UY + 295} fill={c.ink} size={11}>
        {props.ui.t('body.hidden')}
      </Txt>
    </g>
  );
}

/** evo's SocBusInfo (50, 600, 280, 20) and SocUpSimulationState (340, 600, 270, 20) bars */
export function CpuBars(props: { c: Palette; ui: CpuPartUi; ctx: DrawContext; busId: string; core: CpuCoreLike | undefined }): ReactNode {
  const { c, ui, ctx, busId, core } = props;
  const bus = busId ? socManager.getBus(busId) : undefined;
  const runState = core?.runState ?? 'running';
  const barText = bus ? bus.name : busId ? ui.t('body.busMissing') : ui.t('body.notConnected');
  const third = 90;
  const sx = 340;
  const sy = 600;
  const onButton = (e: { stopPropagation(): void }) => {
    // as the built-in switches: the first click selects the part, a click on the selected part pokes it
    if (!ctx.isSelected || !core) return;
    e.stopPropagation();
    core.toggleRun();
    requestSimulation();
  };
  const tag = { [`data-${ui.tag}`]: 'run' };
  return (
    <g>
      <rect x={50} y={600} width={280} height={20} fill={bus ? c.ok : c.bad} />
      <Txt x={190} y={610} fill={c.barInk} size={10}>
        {fit(barText, 44)}
      </Txt>
      <Txt x={sx + third / 2} y={sy + 10} fill={c.ink} size={10}>
        {ui.t('body.simState')}
      </Txt>
      <rect x={sx + third} y={sy} width={third} height={20} fill="none" stroke={c.line} strokeWidth={0.8} />
      <Txt x={sx + third * 1.5} y={sy + 10} fill={runStateColor(c, runState)} size={10} bold>
        {ui.t(`run.${runState}`)}
      </Txt>
      <g {...tag} className={ctx.isSelected ? 'cursor-pointer' : undefined} onClick={onButton}>
        <rect x={sx + 2 * third} y={sy} width={third} height={20} fill={c.button} />
        <Txt x={sx + third * 2.5} y={sy + 10} fill={c.buttonInk} size={10} bold>
          {runState === 'running' ? ui.t('body.pause') : ui.t('body.start')}
        </Txt>
      </g>
    </g>
  );
}
