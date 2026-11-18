// SoC JTAG UART body, after evo's JtagUart.paintInstance: a top strip split into "Keyboard" (0..150) and "TTY"
// (150..200) with the part's title to the right, the Reset / clock / IRQ pin marks, and the bus bar (40,41,220x18):
// green with the bus name, red when not connected.
import type { ReactNode } from 'react';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { DrawContext } from '../registry';
import { fit } from '../shared/cpu/palette';
import { socManager } from '../shared/socRuntime';
import { BODY_HEIGHT, BODY_WIDTH, jtagUartState } from './model';
import { t } from './text';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function drawSocJtagUart(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const s = jtagUartState(comp);
  const dark = ctx.cadTheme === 'dark';
  const bus = s.busId ? socManager.getBus(s.busId) : undefined;
  const bar = bus ? (dark ? '#15803d' : '#4ade80') : dark ? '#b91c1c' : '#f87171';
  const barInk = dark ? '#f8fafc' : '#0f172a';
  const small = `text-[9px] font-mono select-none ${ctx.gateTextClass}`;
  const text = `text-[10px] font-mono select-none ${ctx.gateTextClass}`;
  const barText = bus ? bus.name : s.busId ? t('body.missing') : t('body.notConnected');
  const line = { stroke: ctx.strokeColor, strokeWidth: 1 };
  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={BODY_WIDTH} height={BODY_HEIGHT} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      <line x1={0} y1={20} x2={200} y2={20} {...line} />
      <line x1={150} y1={0} x2={150} y2={20} {...line} />
      <line x1={200} y1={0} x2={200} y2={20} {...line} />
      <text x={75} y={12} textAnchor="middle" dominantBaseline="central" className={text}>
        {t('body.keyboard')}
      </text>
      <text x={175} y={12} textAnchor="middle" dominantBaseline="central" className={text}>
        {t('body.tty')}
      </text>
      <text x={250} y={10} textAnchor="middle" dominantBaseline="central" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {t('body.title')}
      </text>
      <text x={4} y={30} dominantBaseline="central" className={small}>
        Reset
      </text>
      <path d="M0,45 L7,50 L0,55" fill="none" stroke={ctx.strokeColor} strokeWidth={1} />
      <text x={BODY_WIDTH - 4} y={50} textAnchor="end" dominantBaseline="central" className={small}>
        IRQ
      </text>
      <rect x={40} y={41} width={220} height={18} fill={bar} />
      <text x={150} y={50} fill={barInk} fontSize={10} fontFamily={MONO} textAnchor="middle" dominantBaseline="central" className="select-none">
        {fit(barText, 36)}
      </text>
    </g>
  );
}
