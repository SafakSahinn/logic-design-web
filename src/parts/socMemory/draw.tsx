// SoC Memory body, after evo's SocMemory paint: the title, "Base: 0x…" and "Size: …", and a bar that is green with
// the connected bus's name or red when the memory is not connected (evo's SocBusInfo paint).
import type { ReactNode } from 'react';
import { memSizeText } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partName, type DrawContext } from '../registry';
import { socManager } from '../shared/socRuntime';
import { PART_ID } from './id';
import { BODY_HEIGHT, BODY_WIDTH, memoryState } from './model';
import { hex, t } from './text';

const fit = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`);

export function drawSocMemory(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const s = memoryState(comp);
  const dark = ctx.cadTheme === 'dark';
  const bus = s.busId ? socManager.getBus(s.busId) : undefined;
  const bar = bus ? (dark ? '#15803d' : '#4ade80') : dark ? '#b91c1c' : '#f87171';
  const barInk = dark ? '#f8fafc' : '#0f172a';
  const text = `text-[10px] font-mono select-none ${ctx.gateTextClass}`;
  const barText = bus ? bus.name : s.busId ? t('body.missing') : t('body.notConnected');
  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={BODY_WIDTH} height={BODY_HEIGHT} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      <text x={BODY_WIDTH / 2} y={13} textAnchor="middle" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {partName(PART_ID)}
      </text>
      <text x={80} y={32} textAnchor="middle" className={text}>
        {t('body.base', { value: hex(s.startAddress) })}
      </text>
      <text x={240} y={32} textAnchor="middle" className={text}>
        {t('body.size', { value: memSizeText(s.sizeBits) })}
      </text>
      <rect x={5} y={40} width={310} height={16} fill={bar} />
      <text x={BODY_WIDTH / 2} y={48} fill={barInk} fontSize={10} fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" textAnchor="middle" dominantBaseline="central" className="select-none">
        {fit(barText, 50)}
      </text>
    </g>
  );
}
