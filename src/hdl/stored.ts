// StoredNetlist <-> Netlist: the stored BLIF is parsed by the 6a BLIF front end, then its ports are put back
// into the HDL's declaration order (parseBlif sorts them the way evo's BLIF Circuit does).
import { parseBlif, type Netlist, type NetlistPort } from '../netlist';
import { HdlError, type StoredNetlist, type StoredPort } from './types';
import type { VerilogModuleHeader } from './verilogHeader';

/** Finds a stored port among the parsed ones: by name, or as a one-bit bus "name[i]" */
function take(ports: Map<string, NetlistPort>, port: StoredPort): NetlistPort | undefined {
  const exact = ports.get(port.name);
  if (exact) return exact;
  if (port.width !== 1) return undefined;
  for (const [name, p] of ports) if (p.bits.length === 1 && name.startsWith(`${port.name}[`)) return { name: port.name, bits: p.bits };
  return undefined;
}

function order(parsed: NetlistPort[], wanted: StoredPort[], kind: 'input' | 'output'): NetlistPort[] {
  const byName = new Map(parsed.map((p) => [p.name, p]));
  return wanted.map((w) => {
    const p = take(byName, w);
    if (!p) throw new HdlError('portMissing', `the netlist has no ${kind} ${w.name}`, { port: w.name });
    // yosys may leave unused high bits out of the BLIF; they stay unconnected ('')
    if (p.bits.length > w.width) throw new HdlError('portWidth', `${kind} ${w.name} is ${p.bits.length} bits in the netlist, ${w.width} declared`, { port: w.name, width: p.bits.length, declared: w.width });
    const bits = [...p.bits, ...Array.from({ length: w.width - p.bits.length }, () => '')];
    return { name: w.name, bits };
  });
}

/** Parses a stored netlist into the engine's form; throws NetlistError (BLIF) or HdlError (ports) */
export function netlistFromStored(stored: StoredNetlist): Netlist {
  const parsed = parseBlif(stored.blif);
  return {
    ...parsed,
    name: stored.top,
    inputs: order(parsed.inputs, stored.inputs, 'input'),
    outputs: order(parsed.outputs, stored.outputs, 'output'),
  };
}

/** Builds the stored form from yosys' BLIF and the top module's Verilog header */
export function storeNetlist(blif: string, header: VerilogModuleHeader): StoredNetlist {
  const stored: StoredNetlist = {
    blif,
    top: header.name,
    inputs: header.ports.filter((p) => p.direction === 'input').map((p) => ({ name: p.name, width: p.width })),
    outputs: header.ports
      .filter((p) => p.direction !== 'input')
      .map((p) => ({ name: p.name, width: p.width, ...(p.direction === 'inout' ? { inout: true } : {}) })),
  };
  netlistFromStored(stored); // checks that the BLIF has every declared port
  return stored;
}

/** A value read back from a file or the part state is a well-formed StoredNetlist */
export function isStoredNetlist(value: unknown): value is StoredNetlist {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const ports = (list: unknown) =>
    Array.isArray(list) &&
    list.every((p) => p && typeof p === 'object' && typeof (p as StoredPort).name === 'string' && Number.isInteger((p as StoredPort).width) && (p as StoredPort).width >= 1);
  return typeof v.blif === 'string' && typeof v.top === 'string' && ports(v.inputs) && ports(v.outputs);
}
