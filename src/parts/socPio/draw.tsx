// SoC PIO body, after evo's SocPio.paintInstance: the title at (210,50), an "Input pins" box (40,80,340x40) and an
// "Output pins" / "Bi-directional pins" box (40,0,340x40) with the bit numbers (every bit up to 9 bits, else 0 and
// N-1), the pin names Reset and IRQ, and the bus bar (45,61,330x18): green with the bus name, red when not connected.
import type { ReactNode } from 'react';
import { pioHasInputs, pioHasOutputs } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { DrawContext } from '../registry';
import { socManager } from '../shared/socRuntime';
import { BODY_HEIGHT, BODY_WIDTH, RESET_POINT, bitX, pioHasIrq, pioState } from './model';
import { t } from './text';

const fit = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`);
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function bitNumbers(width: number, y: number, cls: string): ReactNode[] {
  const nums = width > 9 ? [0, width - 1] : Array.from({ length: width }, (_, b) => b);
  // evo draws N-1 at 380 - 10 N (= the pin's x) when the bits do not fit
  return nums.map((b) => (
    <text key={b} x={bitX(b)} y={y} textAnchor="middle" dominantBaseline="central" className={cls}>
      {b}
    </text>
  ));
}

export function drawSocPio(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const s = pioState(comp);
  const dark = ctx.cadTheme === 'dark';
  const bus = s.busId ? socManager.getBus(s.busId) : undefined;
  const bar = bus ? (dark ? '#15803d' : '#4ade80') : dark ? '#b91c1c' : '#f87171';
  const barInk = dark ? '#f8fafc' : '#0f172a';
  const small = `text-[9px] font-mono select-none ${ctx.gateTextClass}`;
  const text = `text-[10px] font-mono select-none ${ctx.gateTextClass}`;
  const barText = bus ? bus.name : s.busId ? t('body.missing') : t('body.notConnected');
  const box = { fill: 'none', stroke: ctx.strokeColor, strokeWidth: 1 };
  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={BODY_WIDTH} height={BODY_HEIGHT} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      {pioHasInputs(s.direction) && (
        <g>
          <rect x={40} y={80} width={340} height={40} {...box} />
          <text x={210} y={95} textAnchor="middle" dominantBaseline="central" className={text}>
            {t('body.inputs')}
          </text>
          {bitNumbers(s.width, 110, small)}
        </g>
      )}
      {pioHasOutputs(s.direction) && (
        <g>
          <rect x={40} y={0} width={340} height={40} {...box} />
          <text x={210} y={25} textAnchor="middle" dominantBaseline="central" className={text}>
            {s.direction === 'bidir' ? t('body.bidirs') : t('body.outputs')}
          </text>
          {bitNumbers(s.width, 10, small)}
        </g>
      )}
      <text x={4} y={RESET_POINT.y} dominantBaseline="central" className={small}>
        Reset
      </text>
      {pioHasIrq(s) && (
        <text x={20} y={10} textAnchor="middle" dominantBaseline="central" className={small}>
          IRQ
        </text>
      )}
      <text x={210} y={50} textAnchor="middle" dominantBaseline="central" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {t('body.title')}
      </text>
      <rect x={45} y={61} width={330} height={18} fill={bar} />
      <text x={210} y={70} fill={barInk} fontSize={10} fontFamily={MONO} textAnchor="middle" dominantBaseline="central" className="select-none">
        {fit(barText, 54)}
      </text>
    </g>
  );
}
