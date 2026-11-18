// SoC VGA body, after evo's SocVga.paintInstance: the title centred in the top margin, the picture in the middle
// (5 from the sides, 20 from the top) and the bus bar in the bottom margin: green with the bus name, red when not
// connected. The body follows the mode in use (vgaPartSize).
import type { ReactNode } from 'react';
import { VGA_MARGIN, vgaPartSize } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { DrawContext } from '../registry';
import { fit } from '../shared/cpu/palette';
import { socManager } from '../shared/socRuntime';
import { vgaState } from './model';
import { vgaShownMode } from './runtime';
import { VgaScreen } from './screen';
import { t } from './text';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function drawSocVga(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const s = vgaState(comp);
  const { width, height } = vgaPartSize(vgaShownMode(comp));
  const dark = ctx.cadTheme === 'dark';
  const bus = s.busId ? socManager.getBus(s.busId) : undefined;
  const bar = bus ? (dark ? '#15803d' : '#4ade80') : dark ? '#b91c1c' : '#f87171';
  const barInk = dark ? '#f8fafc' : '#0f172a';
  const barText = bus ? bus.name : s.busId ? t('body.missing') : t('body.notConnected');
  const screenW = width - VGA_MARGIN.left - VGA_MARGIN.right;
  const screenH = height - VGA_MARGIN.top - VGA_MARGIN.bottom;
  // about 6 px per character of the 10 px monospace font
  const chars = Math.max(4, Math.floor(screenW / 6));
  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={width} height={height} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      <text x={width / 2} y={10} textAnchor="middle" dominantBaseline="central" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {fit(t('body.title'), chars)}
      </text>
      {/* black under the picture: what an export without the live canvas shows */}
      <rect x={VGA_MARGIN.left} y={VGA_MARGIN.top} width={screenW} height={screenH} fill="#000" />
      <VgaScreen vgaKey={comp.id} x={VGA_MARGIN.left} y={VGA_MARGIN.top} width={screenW} height={screenH} />
      <rect x={VGA_MARGIN.left} y={height - VGA_MARGIN.bottom + 1} width={screenW} height={VGA_MARGIN.bottom - 2} fill={bar} />
      <text x={width / 2} y={height - VGA_MARGIN.bottom / 2} fill={barInk} fontSize={10} fontFamily={MONO} textAnchor="middle" dominantBaseline="central" className="select-none">
        {fit(barText, chars)}
      </text>
    </g>
  );
}
