// SoC DMA body, after evo's SocDma.paintInstance: the title at the top, "Base: <address>" and "Burst: N words/tick"
// on the row at y 30, the transfer status at y 50 once the part has run (idle, done, or the percentage moved), the
// three bus bars CTRL / SRC / DST at y 65 (green with the bus name, red when not connected) and the Reset / clock /
// IRQ pin marks. Unlike evo, an unset source / destination bar shows that it uses the control bus, in that bus's
// colour (evo paints it red, though the transfer does run on the control bus).
import type { ReactNode } from 'react';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { DrawContext } from '../registry';
import { fit } from '../shared/cpu/palette';
import { socManager } from '../shared/socRuntime';
import { BODY_HEIGHT, BODY_WIDTH, dmaState } from './model';
import { peekDma } from './runtime';
import { dmaStatusLine } from './status';
import { hex, t } from './text';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const BAR_W = 100;
const BAR_H = 16;
const BAR_Y = 65;

export function drawSocDma(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const s = dmaState(comp);
  const dark = ctx.cadTheme === 'dark';
  const small = `text-[9px] font-mono select-none ${ctx.gateTextClass}`;
  const text = `text-[10px] font-mono select-none ${ctx.gateTextClass}`;
  const barInk = dark ? '#f8fafc' : '#0f172a';
  const dma = peekDma(comp.id);
  /** One bus bar: `own` is the side's bus id, '' falls back to the control bus when `fallback` is set */
  const bar = (x: number, own: string, label: string, fallback: boolean) => {
    const id = own || (fallback ? s.busId : '');
    const bus = id ? socManager.getBus(id) : undefined;
    const fill = bus ? (dark ? '#15803d' : '#4ade80') : dark ? '#b91c1c' : '#f87171';
    const name = bus ? (own || !fallback ? bus.name : t('body.sameAsCtrl')) : id ? t('body.missing') : t('body.notConnected');
    return (
      <g key={label}>
        <rect x={x} y={BAR_Y} width={BAR_W} height={BAR_H} fill={fill} />
        <text x={x + BAR_W / 2} y={BAR_Y + BAR_H / 2} fill={barInk} fontSize={9} fontFamily={MONO} textAnchor="middle" dominantBaseline="central" className="select-none">
          {fit(name, 17)}
        </text>
        <text x={x + BAR_W / 2} y={BAR_Y + BAR_H + 5} textAnchor="middle" dominantBaseline="central" className={small}>
          {label}
        </text>
      </g>
    );
  };
  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={BODY_WIDTH} height={BODY_HEIGHT} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      <text x={BODY_WIDTH / 2} y={10} textAnchor="middle" dominantBaseline="central" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {t('body.title')}
      </text>
      <text x={BODY_WIDTH / 4} y={30} textAnchor="middle" dominantBaseline="central" className={text}>
        {t('body.base', { address: hex(s.startAddress) })}
      </text>
      <text x={(3 * BODY_WIDTH) / 4} y={30} textAnchor="middle" dominantBaseline="central" className={text}>
        {t('body.burst', { count: s.burstSize })}
      </text>
      {dma && (
        <text x={BODY_WIDTH / 2} y={50} textAnchor="middle" dominantBaseline="central" className={text}>
          {fit(dmaStatusLine(dma.registers()), 52)}
        </text>
      )}
      {bar(5, s.busId, 'CTRL', false)}
      {bar(110, s.srcBusId, 'SRC', true)}
      {bar(215, s.dstBusId, 'DST', true)}
      <text x={4} y={100} dominantBaseline="central" className={small}>
        Reset
      </text>
      <path d="M0,105 L7,110 L0,115" fill="none" stroke={ctx.strokeColor} strokeWidth={1} />
      <text x={BODY_WIDTH - 4} y={100} textAnchor="end" dominantBaseline="central" className={small}>
        IRQ
      </text>
    </g>
  );
}
