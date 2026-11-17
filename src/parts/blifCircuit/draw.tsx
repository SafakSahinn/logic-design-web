// BLIF Circuit body: the model name on top, pin names along the sides (as evo's GenericInterfaceComponent)
import type { ReactNode } from 'react';
import { partText, type DrawContext } from '../registry';
import type { CircuitComponentInstance } from '../../types/circuit';
import { BODY_WIDTH, PIN_GAP, PIN_TOP, blifEntry, blifText, bodySize } from './model';
import { PART_ID } from './id';

/** Shortens a name to `max` characters, as evo's resizeString does with its "..." */
const fit = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`);

export function drawBlifCircuit(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const { width, height } = bodySize(comp);
  const entry = blifEntry(blifText(comp));
  const title = entry.ok ? entry.netlist.name || 'BLIF' : partText(PART_ID, 'draw.error');
  const titleClass = entry.ok ? ctx.gateTextClass : ctx.cadTheme === 'dark' ? 'fill-red-400' : 'fill-red-600';
  const pinText = `text-[9px] font-mono select-none ${ctx.gateTextClass}`;
  const nameChars = Math.floor((BODY_WIDTH / 2 - 6) / 5.5);
  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={width} height={height} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      <text x={width / 2} y={16} textAnchor="middle" className={`text-[11px] font-mono font-bold select-none ${titleClass}`}>
        {fit(title, 22)}
      </text>
      {comp.inputs.map((p, i) => (
        <text key={p.id} x={5} y={PIN_TOP + PIN_GAP * i + 3} textAnchor="start" className={pinText}>
          {fit(p.name, nameChars)}
        </text>
      ))}
      {comp.outputs.map((p, i) => (
        <text key={p.id} x={width - 5} y={PIN_TOP + PIN_GAP * i + 3} textAnchor="end" className={pinText}>
          {fit(p.name, nameChars)}
        </text>
      ))}
    </g>
  );
}
