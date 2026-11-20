// Mapping rules: is every port bit on something, and can the board take the mapping as it is.
import type { BoardDefinition } from '../board/model';
import { boardIoPinCount } from '../board/model';
import type { BoardMapping, MappablePart } from '../map/model';
import { dirCompatible, findBoardIo, ioLogicalPinCount, ioLogicalPinDir, isRgbArray, partPinName } from '../map/model';
import { occupiedFpgaPins } from '../map/resolve';
import type { DrcIssue } from './issue';

const normalPin = (pin: string) => pin.trim().toUpperCase();
const resourceName = (io: { label?: string; kind: string; rect: { x: number; y: number } }) => io.label || `${io.kind} @ ${io.rect.x},${io.rect.y}`;

/** An FPGA pin name as the constraint files can take it (E3, PIN_H6, AB12); spaces around it are trimmed */
const SAFE_PIN = /^\s*[A-Za-z0-9_]+\s*$/;
/** FPGA part, family and package text ("Cyclone IV E", "FBGA 256", "xc7a35tcpg236-1") */
const SAFE_DEVICE_TEXT = /^[A-Za-z0-9 _.-]+$/;

/**
 * Findings about the board itself: resources with no FPGA pin (evo keeps such resources; they cannot be used), and
 * board text that would be written into the constraint files unsafely. .xdc and .qsf files are Tcl the vendor tool
 * runs, so a pin like "E3 [exec ...]" from a downloaded board file must not reach them.
 */
export function checkBoard(board: BoardDefinition): DrcIssue[] {
  const issues: DrcIssue[] = board.components
    .filter((io) => boardIoPinCount(io) === 0)
    .map((io) => ({ code: 'zeroPinResource', severity: 'info' as const, values: { resource: resourceName(io) } }));
  const bad = new Set<string>();
  if (!SAFE_PIN.test(board.fpga.clock.pin)) bad.add(board.fpga.clock.pin);
  for (const io of board.components) {
    for (const pin of [...io.inputPins, ...io.outputPins, ...io.ioPins]) if (!SAFE_PIN.test(pin)) bad.add(pin);
  }
  for (const text of [board.fpga.part, board.fpga.family, board.fpga.package]) if (!SAFE_DEVICE_TEXT.test(text)) bad.add(text);
  for (const text of bad) issues.push({ code: 'unsafeBoardText', severity: 'error', values: { text: JSON.stringify(text) } });
  return issues;
}

export function checkMapping(board: BoardDefinition, parts: MappablePart[], mapping: BoardMapping): DrcIssue[] {
  const issues: DrcIssue[] = [];
  if (mapping.board !== board.name) issues.push({ code: 'otherBoard', severity: 'error', values: { mapped: mapping.board, board: board.name } });

  const known = new Set(parts.map((p) => p.compId));
  const stale = Object.keys(mapping.parts).filter((id) => !known.has(id));
  if (stale.length) issues.push({ code: 'staleParts', severity: 'info', values: { count: stale.length } });

  // Logical pin of a resource -> who has it; FPGA pin -> which resource took it
  const logicalUse = new Map<string, { compId: string; pin: number }[]>();
  const fpgaUse = new Map<string, Set<string>>();

  for (const part of parts) {
    const name = part.label || part.pins[0]?.port || part.type;
    const targets = mapping.parts[part.compId];
    if (targets && targets.length !== part.pins.length) {
      issues.push({ code: 'widthChanged', severity: 'warning', compId: part.compId, values: { name, was: targets.length, now: part.pins.length } });
    }
    const usable = targets && targets.length === part.pins.length ? targets : [];
    let unmapped = 0;
    part.pins.forEach((pin, i) => {
      const t = usable[i];
      const pinName = partPinName(pin);
      if (!t) {
        unmapped++;
        return;
      }
      if (t.kind === 'open') {
        // evo tryOpenMap: only an output (or a bidirectional pin) can be left open
        if (pin.dir === 'in') issues.push({ code: 'openInput', severity: 'error', compId: part.compId, pin: i, values: { pin: pinName } });
        return;
      }
      if (t.kind === 'const') {
        // evo tryConstantMap: only an input takes a constant
        if (pin.dir !== 'in') issues.push({ code: 'constOnOutput', severity: 'error', compId: part.compId, pin: i, values: { pin: pinName } });
        return;
      }
      const io = findBoardIo(board, t.io);
      if (!io) {
        issues.push({ code: 'unknownResource', severity: 'error', compId: part.compId, pin: i, values: { pin: pinName, resource: t.io } });
        return;
      }
      if (boardIoPinCount(io) === 0) {
        issues.push({ code: 'mappedOnZeroPinResource', severity: 'error', compId: part.compId, pin: i, values: { pin: pinName, resource: resourceName(io) } });
        return;
      }
      const ioDir = ioLogicalPinDir(io, t.pin);
      if (!ioDir) {
        issues.push({ code: 'pinOutOfRange', severity: 'error', compId: part.compId, pin: i, values: { pin: pinName, resource: resourceName(io), index: t.pin, count: ioLogicalPinCount(io) } });
        return;
      }
      if (!dirCompatible(pin.dir, ioDir)) {
        issues.push({ code: `direction.${pin.dir}.${ioDir}`, severity: 'error', compId: part.compId, pin: i, values: { pin: pinName, resource: resourceName(io) } });
      }
      const key = `${t.io}:${t.pin}`;
      if (!logicalUse.has(key)) logicalUse.set(key, []);
      logicalUse.get(key)!.push({ compId: part.compId, pin: i });
      const ioKey = `${io.rect.x}_${io.rect.y}`;
      for (const raw of occupiedFpgaPins(io, t.pin)) {
        // pins are compared as the constraint files write them: trimmed (the plan trims), and case-blind
        const fp = normalPin(raw);
        if (!fpgaUse.has(fp)) fpgaUse.set(fp, new Set());
        fpgaUse.get(fp)!.add(ioKey);
        if (fp === normalPin(board.fpga.clock.pin)) issues.push({ code: 'clockPinUsed', severity: 'error', compId: part.compId, pin: i, values: { pin: pinName, fpgaPin: fp } });
      }
    });
    if (unmapped > 0) issues.push({ code: 'unmapped', severity: 'error', compId: part.compId, values: { name, count: unmapped, total: part.pins.length } });
  }

  const partById = new Map(parts.map((p) => [p.compId, p]));
  for (const [key, users] of logicalUse) {
    if (users.length < 2) continue;
    // The three colours of one RGB LED part on one LED of an RGB array share the pin (evo tryCompleteMap)
    const [ioKey] = key.split(':');
    const io = findBoardIo(board, ioKey);
    if (io && isRgbArray(io) && users.length === 3 && users.every((u) => u.compId === users[0].compId)) continue;
    const names = users.map((u) => {
      const part = partById.get(u.compId)!;
      return partPinName(part.pins[u.pin]);
    });
    issues.push({ code: 'pinUsedTwice', severity: 'error', compId: users[1].compId, pin: users[1].pin, values: { pins: names.join(', '), resource: io ? resourceName(io) : ioKey } });
  }
  for (const [fp, ios] of fpgaUse) {
    if (ios.size < 2) continue;
    const names = [...ios].map((k) => {
      const io = findBoardIo(board, k);
      return io ? resourceName(io) : k;
    });
    issues.push({ code: 'fpgaPinShared', severity: 'error', values: { fpgaPin: fp, resources: names.join(', ') } });
  }
  return issues;
}
