// Board mappings kept with a project (project file, autosave): one per sheet, read back defensively (Aşama 6i-5).
// They are brought up to date with the design when used (reconcileMapping), so only their shape is checked here.
import type { BoardMapping, PinTarget } from './model';

function readTarget(t: unknown): PinTarget | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if (o.kind === 'open') return { kind: 'open' };
  if (o.kind === 'const' && (o.value === 0 || o.value === 1)) return { kind: 'const', value: o.value };
  if (o.kind === 'pin' && typeof o.io === 'string' && /^\d+_\d+$/.test(o.io) && Number.isInteger(o.pin) && (o.pin as number) >= 0)
    return { kind: 'pin', io: o.io, pin: o.pin as number };
  return null;
}

/** A stored mapping, or null when it is not one */
export function readBoardMapping(raw: unknown): BoardMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.board !== 'string' || !o.board || !o.parts || typeof o.parts !== 'object' || Array.isArray(o.parts)) return null;
  const parts: BoardMapping['parts'] = {};
  for (const [id, list] of Object.entries(o.parts as Record<string, unknown>)) {
    if (Array.isArray(list)) parts[id] = list.map(readTarget);
  }
  return { board: o.board, parts };
}

/** The stored mappings of the sheets that exist (keyed by sheet id); anything malformed is left out */
export function readSheetMappings(raw: unknown, sheetIds: Iterable<string>): Record<string, BoardMapping> {
  const out: Record<string, BoardMapping> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const ids = new Set(sheetIds);
  for (const [id, m] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(id)) continue;
    const mapping = readBoardMapping(m);
    if (mapping) out[id] = mapping;
  }
  return out;
}
