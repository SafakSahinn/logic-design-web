// SoC Bus body, after evo's SocBus / SocBusStateInfo / SocBusTransaction paint: the title, the Reset pin name and a
// box of the newest transactions, newest on top. Each row is the running index, the request (master, address,
// written data, atomic / write / read flags) and the response (slave, address, read data, or the short error in red).
import type { ReactNode } from 'react';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partName, type DrawContext } from '../registry';
import { peekSocBus } from '../shared/socRuntime';
import { PART_ID } from './id';
import { BODY_WIDTH, ROW_HEIGHT, busIdOf, busSize, busState } from './model';
import { t } from './text';
import { BOX_W, BOX_X, BOX_Y, TraceRow, Txt, type TracePalette } from './traceRow';

function palette(dark: boolean): TracePalette {
  return dark
    ? { box: '#422006', row: '#0f172a', ink: '#e2e8f0', line: '#94a3b8', error: '#f87171', atomic: '#facc15', atomicInk: '#1e3a8a', write: '#c026d3', read: '#0891b2', flagInk: '#f8fafc' }
    : { box: '#fde047', row: '#ffffff', ink: '#0f172a', line: '#334155', error: '#dc2626', atomic: '#facc15', atomicInk: '#1d4ed8', write: '#e879f9', read: '#67e8f9', flagInk: '#0f172a' };
}

export function drawSocBus(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const { width, height } = busSize(comp);
  const s = busState(comp);
  const c = palette(ctx.cadTheme === 'dark');
  const boxH = s.traceSize * ROW_HEIGHT;
  const bus = peekSocBus(busIdOf(comp));
  const rows = s.traceVisible && bus ? bus.trace.latest(s.traceSize) : [];
  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={width} height={height} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      <text x={BODY_WIDTH / 2} y={14} textAnchor="middle" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {partName(PART_ID)}
      </text>
      <text x={6} y={13} textAnchor="start" className={`text-[9px] font-mono select-none ${ctx.gateTextClass}`}>
        {t('pins.reset')}
      </text>
      <rect x={BOX_X} y={BOX_Y} width={BOX_W} height={boxH} fill={c.box} stroke={c.line} strokeWidth={1} />
      {!s.traceVisible ? (
        <Txt x={BOX_X + BOX_W / 2} y={BOX_Y + boxH / 2} fill={c.ink} size={10}>
          {t('trace.hidden')}
        </Txt>
      ) : rows.length === 0 ? (
        <Txt x={BOX_X + BOX_W / 2} y={BOX_Y + boxH / 2} fill={c.ink} size={10}>
          {t('trace.empty')}
        </Txt>
      ) : (
        rows.map((r, i) => <TraceRow key={r.index} tr={r.t} index={r.index} y={BOX_Y + 1 + i * ROW_HEIGHT} c={c} />)
      )}
    </g>
  );
}
