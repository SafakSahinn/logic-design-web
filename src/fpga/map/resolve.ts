// What every part pin of a mapping comes to on the board: the FPGA pin behind it and how the generated top
// level must treat it (Aşama 6i-4 builds the wrapper and the constraints from this).
import type { BoardDefinition, BoardIo, DriveStrength, IoStandard, PullBehavior } from '../board/model';
import { boardIoPin } from '../board/model';
import type { BoardMapping, MapPartPin, MappablePart, PinDir } from './model';
import { findBoardIo, ioLogicalPinCount, ioLogicalPinDir, isInternalResource } from './model';

export type ResolvedTarget =
  /** An FPGA pin of the board */
  | {
      kind: 'fpga';
      io: BoardIo;
      ioPin: number;
      fpgaPin: string;
      ioDir: PinDir;
      /** The resource is on at 0: the top level inverts the signal (evo isExternalInverted) */
      activeLow: boolean;
      pull: PullBehavior;
      ioStandard: IoStandard;
      drive: DriveStrength;
    }
  /** A logical pin of an LED array / multiplexed display: the top level's driver for that resource takes it */
  | { kind: 'internal'; io: BoardIo; ioPin: number }
  | { kind: 'open' }
  | { kind: 'const'; value: 0 | 1 }
  /** Not mapped, or mapped on something the board does not have (the design rule check reports it) */
  | { kind: 'none' };

export interface ResolvedPin {
  part: MappablePart;
  /** Index of the pin in the part */
  index: number;
  pin: MapPartPin;
  target: ResolvedTarget;
}

/** Every pin of every part, resolved on the board */
export function resolveMapping(board: BoardDefinition, parts: MappablePart[], mapping: BoardMapping): ResolvedPin[] {
  const result: ResolvedPin[] = [];
  for (const part of parts) {
    const targets = mapping.parts[part.compId] ?? [];
    part.pins.forEach((pin, index) => {
      const t = targets.length === part.pins.length ? targets[index] : null;
      let target: ResolvedTarget = { kind: 'none' };
      if (t?.kind === 'open') target = { kind: 'open' };
      else if (t?.kind === 'const') target = { kind: 'const', value: t.value };
      else if (t?.kind === 'pin') {
        const io = findBoardIo(board, t.io);
        if (io && t.pin >= 0 && t.pin < ioLogicalPinCount(io)) {
          if (isInternalResource(io)) target = { kind: 'internal', io, ioPin: t.pin };
          else {
            const fp = boardIoPin(io, t.pin);
            if (fp)
              target = {
                kind: 'fpga',
                io,
                ioPin: t.pin,
                fpgaPin: fp.pin,
                ioDir: ioLogicalPinDir(io, t.pin) ?? fp.dir,
                activeLow: io.activeLow,
                pull: io.pull,
                ioStandard: io.ioStandard,
                drive: io.drive,
              };
          }
        }
      }
      result.push({ part, index, pin, target });
    });
  }
  return result;
}

/** The FPGA pins a resource occupies once anything is mapped on it (all of them for an LED array / display) */
export function occupiedFpgaPins(io: BoardIo, ioPin: number): string[] {
  if (isInternalResource(io)) return [...io.inputPins, ...io.outputPins, ...io.ioPins];
  const p = boardIoPin(io, ioPin);
  return p ? [p.pin] : [];
}
