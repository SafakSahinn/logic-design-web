// VHDL Entity body: the entity name on top, pin names along the sides (as evo's GenericInterfaceComponent),
// and a dot in the top-right corner while the netlist is not the text's (amber: stale, red: failed, grey: none).
import type { ReactNode } from 'react';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { DrawContext } from '../registry';
import { BODY_WIDTH, PIN_GAP, PIN_TOP, bodySize } from '../shared/netlistPart';
import { partState, preview, synthStatus } from './model';

/** Shortens a name to `max` characters, as evo's resizeString does with its "..." */
const fit = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`);

const DOT: Record<string, { light: string; dark: string }> = {
  stale: { light: '#d97706', dark: '#fbbf24' },
  failed: { light: '#dc2626', dark: '#f87171' },
  none: { light: '#94a3b8', dark: '#64748b' },
};

export function drawVhdlEntity(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const { width, height } = bodySize(comp);
  const s = partState(comp);
  const status = synthStatus(s);
  const p = preview(s);
  const title = status === 'ok' && s.netlist ? s.netlist.top : p.ok ? p.entity.name : 'VHDL';
  const pinText = `text-[9px] font-mono select-none ${ctx.gateTextClass}`;
  const nameChars = Math.floor((BODY_WIDTH / 2 - 6) / 5.5);
  const dot = DOT[status];
  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={width} height={height} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      <text x={width / 2} y={16} textAnchor="middle" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {fit(title, 20)}
      </text>
      {dot && <circle cx={width - 8} cy={8} r={3.5} fill={ctx.cadTheme === 'dark' ? dot.dark : dot.light} />}
      {comp.inputs.map((pin, i) => (
        <text key={pin.id} x={5} y={PIN_TOP + PIN_GAP * i + 3} textAnchor="start" className={pinText}>
          {fit(pin.name, nameChars)}
        </text>
      ))}
      {comp.outputs.map((pin, i) => (
        <text key={pin.id} x={width - 5} y={PIN_TOP + PIN_GAP * i + 3} textAnchor="end" className={pinText}>
          {fit(pin.name, nameChars)}
        </text>
      ))}
    </g>
  );
}
