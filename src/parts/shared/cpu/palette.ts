// Colours of a processor body (evo's yellow panels with blue heads), for the light and dark canvas.
import type { CpuRunState } from './types';
import type { Palette } from './widgets';

export function cpuPalette(dark: boolean): Palette {
  return dark
    ? { panel: '#422006', head: '#1e3a8a', headInk: '#fde047', box: '#0f172a', ink: '#e2e8f0', value: '#93c5fd', line: '#94a3b8', mark: '#2563eb', markInk: '#f8fafc', pc: '#f0abfc', error: '#f87171', grey: '#334155', ok: '#15803d', bad: '#b91c1c', barInk: '#f8fafc', running: '#4ade80', breakpoint: '#e879f9', button: '#475569', buttonInk: '#bfdbfe' }
    : { panel: '#fde047', head: '#1d4ed8', headInk: '#fde047', box: '#ffffff', ink: '#0f172a', value: '#1d4ed8', line: '#334155', mark: '#1d4ed8', markInk: '#ffffff', pc: '#c026d3', error: '#dc2626', grey: '#cbd5e1', ok: '#4ade80', bad: '#f87171', barInk: '#0f172a', running: '#16a34a', breakpoint: '#c026d3', button: '#d1d5db', buttonInk: '#1d4ed8' };
}

/** evo's upStateBounds origin (the state area is 590 x 590 from here) */
export const UX = 50;
export const UY = 10;
/** A register not written since reset (evo) */
export const UNKNOWN = '??????????';

export const fit = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`);

export const runStateColor = (c: Palette, s: CpuRunState): string => (s === 'running' ? c.running : s === 'error' ? c.error : s === 'breakpoint' ? c.breakpoint : c.ink);
