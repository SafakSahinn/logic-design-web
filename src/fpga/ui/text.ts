// Texts of the FPGA dialog that depend on the board or the mapping, in the current language.
import i18n from '../../i18n';
import type { BoardDefinition, BoardIo } from '../board/model';
import { boardIoPin } from '../board/model';
import type { MappablePart, PinTarget } from '../map/model';
import { findBoardIo, isInternalResource, ioPinLabel } from '../map/model';

const NS = 'fpga';
export const ft = (key: string, values?: Record<string, unknown>) => i18n.t(`${NS}:${key}`, values ?? {});

/** A resource's own label, or its kind */
export function resourceName(io: BoardIo): string {
  return io.label?.trim() || ft(`ioKind.${io.kind}`);
}

export function ioPinText(io: BoardIo, index: number): string {
  const { key, values } = ioPinLabel(io, index);
  return ft(key, values);
}

/** The FPGA pin behind a resource pin ('' for an LED array / multiplexed display, whose driver takes the pins) */
export function fpgaPinOf(io: BoardIo, index: number): string {
  return isInternalResource(io) ? '' : (boardIoPin(io, index)?.pin ?? '');
}

/** Where a part pin goes, for the lists */
export function targetText(target: PinTarget | null | undefined, board: BoardDefinition | null): string {
  if (!target) return ft('ui.target.none');
  if (target.kind === 'open') return ft('ui.target.open');
  if (target.kind === 'const') return ft('ui.target.const', { value: target.value });
  const io = board ? findBoardIo(board, target.io) : undefined;
  if (!io) return ft('ui.target.missing', { key: target.io });
  const fpga = fpgaPinOf(io, target.pin);
  return fpga ? `${resourceName(io)} · ${ioPinText(io, target.pin)} (${fpga})` : `${resourceName(io)} · ${ioPinText(io, target.pin)}`;
}

/** The name a part is listed with: its own label, else its first port */
export function partTitle(part: MappablePart): string {
  return part.label || part.pins[0]?.port || part.type;
}

/** The part's ports, e.g. "sw[3:0], btn" */
export function partPorts(part: MappablePart): string {
  const seen = new Map<string, number>();
  for (const p of part.pins) seen.set(p.port, p.width);
  return [...seen.entries()].map(([port, w]) => (w > 1 ? `${port}[${w - 1}:0]` : port)).join(', ');
}
