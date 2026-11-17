// BLIF Circuit part: its state, the compiled-netlist cache, pin layout and the run state codec.
import { NetlistError, compileNetlist, parseBlif, type CompiledNetlist, type Netlist, type NetlistPort } from '../../netlist';
import type { CircuitComponentInstance, CircuitPin, PinDefinition } from '../../types/circuit';
import { BODY_WIDTH, PIN_GAP, PIN_TOP, pinsFor as pinsForPorts } from '../shared/netlistPart';

export { BODY_WIDTH, PIN_GAP, PIN_TOP, bodyHeight, bodySize, decodeRun, encodeRun, pinPoints, pinsMatch } from '../shared/netlistPart';

/** What the part keeps in comp.state.part */
export interface BlifPartState {
  /** The BLIF text, as the user wrote it */
  blif: string;
  /** Simulation state of the compiled text (see encodeRun); unset = power-on */
  run?: string;
}

/** Shown for a new part: a half adder, as yosys `write_blif` writes one */
export const DEFAULT_BLIF = `# yosys -p "synth -flatten -top half_adder; write_blif out.blif"
.model half_adder
.inputs a b
.outputs s c
.names a b s
10 1
01 1
.names a b c
11 1
.end
`;

export type BlifEntry = { ok: true; netlist: Netlist; compiled: CompiledNetlist } | { ok: false; error: NetlistError };

/** Compiled texts, most recently used last; parts with the same text share one entry */
const cache = new Map<string, BlifEntry>();
const CACHE_SIZE = 64;

export function blifEntry(text: string): BlifEntry {
  const hit = cache.get(text);
  if (hit) {
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  let entry: BlifEntry;
  try {
    const netlist = parseBlif(text);
    entry = { ok: true, netlist, compiled: compileNetlist(netlist) };
  } catch (e) {
    entry = { ok: false, error: e instanceof NetlistError ? e : new NetlistError('internal', String(e)) };
  }
  cache.set(text, entry);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return entry;
}

export function partState(comp: CircuitComponentInstance): BlifPartState {
  const s = comp.state.part as BlifPartState | undefined;
  return s && typeof s.blif === 'string' ? s : { blif: DEFAULT_BLIF };
}

export const blifText = (comp: CircuitComponentInstance): string => partState(comp).blif;

/** Default pins of the part: those of DEFAULT_BLIF */
export function defaultPins(): { inputs: PinDefinition[]; outputs: PinDefinition[] } {
  const entry = blifEntry(DEFAULT_BLIF);
  if (!entry.ok) throw entry.error;
  const def = (p: NetlistPort, i: number, type: 'input' | 'output'): PinDefinition => ({
    id: `${type === 'input' ? 'in' : 'out'}${i}`,
    name: p.name,
    type,
    relX: type === 'input' ? 0 : BODY_WIDTH,
    relY: PIN_TOP + PIN_GAP * i,
    ...(p.bits.length > 1 ? { width: p.bits.length } : {}),
  });
  return {
    inputs: entry.netlist.inputs.map((p, i) => def(p, i, 'input')),
    outputs: entry.netlist.outputs.map((p, i) => def(p, i, 'output')),
  };
}

/**
 * Pins for the netlist's ports. A pin whose name and direction survive keeps its id (its wires follow it);
 * the others get new ids. Positions are placed again by the caller.
 */
export function pinsFor(comp: CircuitComponentInstance, netlist: Netlist): { inputs: CircuitPin[]; outputs: CircuitPin[] } {
  const shape = (p: NetlistPort) => ({ name: p.name, width: p.bits.length });
  return pinsForPorts(comp, netlist.inputs.map(shape), netlist.outputs.map(shape));
}
