/**
 * Conversion of the Logisim 2.7.1-rule RAM / ROM parts of older project files (Aşama 7a-3).
 *
 * Every memory now follows Logisim-evolution's rules. A RAM / ROM saved before that carries no
 * `memFlavor: 'evolution'` mark (2.7.1 was the default) and is converted when its circuit is opened, keeping its
 * place, contents and wires (pins keep their ids and spots):
 * - ROM: the select pin (sel) goes, and the wire on it up to its first junction or pin.
 * - RAM, separate bus: evolution's separate controlled bus (OE = 0 floats like 2.7.1), rising edge, read at once.
 * - RAM, combined bus: evolution's bidirectional bus, rising edge, read at once; 2.7.1 stored when ld (now OE) was
 *   0, so a NOT gate from OE to the new WE pin keeps that (added only when OE is wired).
 * - RAM, asynchronous bus: bidirectional bus with a low-level trigger (stores while WE = 0); a wire joins WE to OE
 *   (2.7.1 stored while ld was 0).
 * - The clear pin stays only where it is wired (2.7.1 always had one). The select pin goes like the ROM's.
 */
import type { CircuitComponentInstance, CircuitPin, CircuitWire, CustomSubcircuit } from '../types/circuit';
import { configureRam, createComponentInstance, pinKey, updatePinPositions, type RamConfig } from './circuitEngine';
import { repairWires, rerouteWiresToRemappedPins, snapPt10, snapTo10 } from './wiringEngine';

export type LegacyRamBus = 'combined' | 'asynch' | 'separate';

/** What the conversion did, for the note shown when a file is opened */
export interface LegacyMemoryReport {
  /** RAM / ROM parts converted */
  converted: number;
  /** of them, parts whose wired select pin was removed */
  selectCut: number;
  /** NOT gates added (combined-bus RAMs) */
  inverters: number;
  /** WE-OE wires added (asynchronous RAMs) */
  links: number;
}

export const emptyLegacyReport = (): LegacyMemoryReport => ({ converted: 0, selectCut: 0, inverters: 0, links: 0 });

export function addLegacyReports(a: LegacyMemoryReport, b: LegacyMemoryReport): LegacyMemoryReport {
  return { converted: a.converted + b.converted, selectCut: a.selectCut + b.selectCut, inverters: a.inverters + b.inverters, links: a.links + b.links };
}

/** A RAM / ROM of an older file that still follows the 2.7.1 rules */
export function isLegacyMemory(c: CircuitComponentInstance): boolean {
  return (c.type === 'ram' || c.type === 'rom') && c.state?.memFlavor !== 'evolution';
}

/** evolution settings closest to a 2.7.1 RAM's data bus (2.7.1 always read at once) */
export function legacyRamSettings(bus: LegacyRamBus | undefined, clearPin: boolean): { patch: Partial<RamConfig>; asyncRead: boolean } {
  if (bus === 'separate') return { patch: { dataBus: 'controlled', trigger: 'rising', byteEnables: false, clearPin }, asyncRead: true };
  if (bus === 'asynch') return { patch: { dataBus: 'bidir', trigger: 'low', byteEnables: false, clearPin }, asyncRead: false };
  return { patch: { dataBus: 'bidir', trigger: 'rising', byteEnables: false, clearPin }, asyncRead: true };
}

const pinOf = (c: CircuitComponentInstance, key: string): CircuitPin | undefined =>
  [...c.inputs, ...c.outputs].find((p) => pinKey(c, p) === key);

/**
 * A NOT gate from OE to WE beside the RAM's control edge: halfway between the two pins, 70px out from the body,
 * pointing from OE to WE (its wires are routed like any wire without points)
 */
function weInverter(ram: CircuitComponentInstance, oe: CircuitPin, we: CircuitPin): CircuitComponentInstance {
  const a = pinOf(ram, 'a')!;
  const d = pinOf(ram, 'd')!;
  const body = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
  const mid = { x: (oe.x + we.x) / 2, y: (oe.y + we.y) / 2 };
  const ox = mid.x - body.x;
  const oy = mid.y - body.y;
  const out = Math.abs(ox) > Math.abs(oy) ? { x: Math.sign(ox), y: 0 } : { x: 0, y: Math.sign(oy) || 1 };
  const centre = { x: mid.x + 70 * out.x, y: mid.y + 70 * out.y };
  const ax = we.x - oe.x;
  const ay = we.y - oe.y;
  const rotation: 0 | 90 | 180 | 270 = Math.abs(ax) >= Math.abs(ay) ? (ax >= 0 ? 0 : 180) : ay >= 0 ? 90 : 270;
  const gate = createComponentInstance('not', snapTo10(centre.x - 35), snapTo10(centre.y - 30), 'WE = OE\'', `${ram.id}_we_not`);
  return updatePinPositions({ ...gate, rotation });
}

/**
 * Converts the 2.7.1-rule RAM / ROM parts of one circuit (a sheet or an IC's inside). Returns the same arrays
 * when there is none.
 */
export function upgradeLegacyMemories(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): { components: CircuitComponentInstance[]; wires: CircuitWire[]; report: LegacyMemoryReport } {
  const report = emptyLegacyReport();
  if (!components.some(isLegacyMemory)) return { components, wires, report };
  const wired = new Set<string>();
  for (const w of wires) wired.add(w.fromPinId).add(w.toPinId);
  const remap = new Map<string, string | null>();
  const added: CircuitComponentInstance[] = [];
  const addedWires: CircuitWire[] = [];
  const next = components.map((c) => {
    if (!isLegacyMemory(c)) return c;
    report.converted++;
    const isWired = (key: string) => {
      const p = pinOf(c, key);
      return !!p && wired.has(p.id);
    };
    if (isWired('cs')) report.selectCut++;
    let conv: CircuitComponentInstance;
    if (c.type === 'rom') conv = configureRam(c, {});
    else {
      const bus = c.state.ramBus;
      const { patch, asyncRead } = legacyRamSettings(bus, isWired('clr'));
      conv = configureRam(c, patch);
      conv = { ...conv, state: { ...conv.state, ramAsyncRead: asyncRead } };
      const oe = pinOf(conv, 'oe');
      const we = pinOf(conv, 'we');
      if (oe && we && isWired('oe') && bus !== 'separate') {
        const link = (id: string, fromCompId: string, fromPinId: string, toCompId: string, toPinId: string): CircuitWire => ({ id, fromCompId, fromPinId, toCompId, toPinId, value: 0 });
        if (bus === 'asynch') {
          addedWires.push(link(`${c.id}_we_w1`, c.id, oe.id, c.id, we.id));
          report.links++;
        } else {
          const gate = weInverter(conv, oe, we);
          added.push(gate);
          addedWires.push(link(`${c.id}_we_w1`, c.id, oe.id, gate.id, gate.inputs[0].id), link(`${c.id}_we_w2`, gate.id, gate.outputs[0].id, c.id, we.id));
          report.inverters++;
        }
      }
    }
    // Pins keep their spots ('d' and 'dio' share a point: the output's id names it while it stays); a removed
    // pin's wire is taken away below
    const kept = new Set([...conv.inputs, ...conv.outputs].map((p) => p.id));
    for (const p of [...c.outputs, ...c.inputs]) {
      const sp = snapPt10(p);
      const key = `${sp.x},${sp.y}`;
      if (remap.get(key)) continue;
      remap.set(key, kept.has(p.id) ? p.id : null);
    }
    return conv;
  });
  const all = [...next, ...added];
  let outWires = rerouteWiresToRemappedPins(wires, components, all, remap);
  const gone = [...remap].filter(([, id]) => id === null).map(([key]) => key);
  outWires = dropDanglingWires(outWires, all, gone);
  if (addedWires.length) outWires = repairWires([...outWires, ...addedWires], all);
  return { components: all, wires: outWires, report };
}

/**
 * Takes away the wire that led to a removed pin, from its spot up to the first junction or pin. Left as an
 * open end it would sit on the RAM's control edge, where the new WE wiring could touch it and short two nets.
 */
function dropDanglingWires(wires: CircuitWire[], comps: CircuitComponentInstance[], spots: string[]): CircuitWire[] {
  if (!spots.length) return wires;
  const pinSpots = new Set<string>();
  for (const c of comps) for (const p of [...c.inputs, ...c.outputs]) {
    const sp = snapPt10(p);
    pinSpots.add(`${sp.x},${sp.y}`);
  }
  const key = (p: { x: number; y: number }) => {
    const sp = snapPt10(p);
    return `${sp.x},${sp.y}`;
  };
  const ends = (w: CircuitWire) => (w.startPoint && w.endPoint ? [key(w.startPoint), key(w.endPoint)] : null);
  const at = new Map<string, Set<CircuitWire>>();
  for (const w of wires) {
    const e = ends(w);
    if (!e) continue;
    for (const k of e) {
      if (!at.has(k)) at.set(k, new Set());
      at.get(k)!.add(w);
    }
  }
  const removed = new Set<CircuitWire>();
  for (const spot of spots) {
    let k = spot;
    while (!pinSpots.has(k) && at.get(k)?.size === 1) {
      const w = [...at.get(k)!][0];
      removed.add(w);
      const [a, b] = ends(w)!;
      at.get(a)!.delete(w);
      at.get(b)!.delete(w);
      k = a === k ? b : a;
    }
  }
  return removed.size ? wires.filter((w) => !removed.has(w)) : wires;
}

/** The same for a circuit object with components and wires (a project sheet, a saved circuit) */
export function upgradeLegacyCircuit<T extends { components?: CircuitComponentInstance[]; wires?: CircuitWire[] }>(
  circuit: T
): { circuit: T; report: LegacyMemoryReport } {
  const { components, wires, report } = upgradeLegacyMemories(circuit.components ?? [], circuit.wires ?? []);
  return report.converted ? { circuit: { ...circuit, components, wires }, report } : { circuit, report };
}

/** The same for a custom IC's inside */
export function upgradeLegacySubcircuit(def: CustomSubcircuit): { def: CustomSubcircuit; report: LegacyMemoryReport } {
  const { circuit, report } = upgradeLegacyCircuit(def);
  return { def: circuit, report };
}

/** Note for the open toast, '' when nothing was converted */
export function legacyMemoryNote(r: LegacyMemoryReport): string {
  if (!r.converted) return '';
  const extra = [
    r.selectCut ? `${r.selectCut} parçada sel bacağı ve teli kalktı` : '',
    r.inverters ? `${r.inverters} RAM'e yazma için WE = OE' NOT kapısı eklendi` : '',
    r.links ? `${r.links} RAM'in WE bacağı OE'ye bağlandı` : '',
  ].filter(Boolean);
  return `${r.converted} eski kurallı RAM / ROM yeni kurallara çevrildi${extra.length ? ` (${extra.join('; ')})` : ''}`;
}
