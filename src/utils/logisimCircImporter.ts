import type { CircuitComponentInstance, CircuitWire, ComponentType } from '../types/circuit';
import { createComponentInstance, updatePinPositions } from './circuitEngine';

export interface ImportedCircuitSheet {
  name: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  // What could not be imported exactly (skipped parts, multi-bit pins, negated inputs ...)
  warnings: string[];
}

export type ImportedLogisimCircuit = ImportedCircuitSheet;

/**
 * Maps standard CAD / .circ circuit component names to LogicDesign Studio component types.
 */
function mapCircCompType(name: string, isOutputPin: boolean, constantVal?: string): ComponentType | null {
  const n = name.trim().toLowerCase();

  if (n === 'and gate') return 'and';
  if (n === 'or gate') return 'or';
  if (n === 'not gate') return 'not';
  if (n === 'nand gate') return 'nand';
  if (n === 'nor gate') return 'nor';
  if (n === 'xor gate') return 'xor';
  if (n === 'xnor gate') return 'xnor';
  if (n === 'controlled buffer') return 'triState';
  if (n === 'controlled inverter') return 'controlledInverter';
  if (n === 'buffer') return 'buffer';

  if (n === 'pin') {
    return isOutputPin ? 'probe' : 'switch';
  }
  if (n === 'clock') return 'clock';
  if (n === 'tunnel') return 'tunnel';
  if (n === 'pull resistor') return 'pullResistor';
  if (n === 'constant') {
    return constantVal === '0' || constantVal === '0x0' ? 'gnd' : 'vcc';
  }
  if (n === 'probe') return 'probe';
  if (n === 'led') return 'led';
  if (n.includes('7-segment') || n === 'seven segment') return 'sevenSegment';
  if (n.includes('hex digit') || n === 'hex display') return 'hexDisplay';
  if (n.includes('buzzer') || n === 'speaker') return 'buzzer';
  if (n.includes('dot matrix') || n === 'dotmatrix') return 'dotMatrix8x8';
  if (n.includes('rgb') || n.includes('video') || n.includes('screen')) return 'rgbMatrix16x16';
  if (n.includes('keyboard') || n === 'tty') return 'asciiKeyboard';
  if (n.includes('dip switch') || n === 'dipswitch') return 'dipSwitch4';

  // Combinational
  if (n === 'adder') return 'fullAdder';
  if (n === 'subtractor') return 'fullSubtractor';
  if (n === 'multiplexer' || n === 'mux') return 'mux2';
  if (n === 'demultiplexer' || n === 'demux') return 'demux2';
  if (n === 'decoder') return 'decoder2to4';
  if (n === 'comparator') return 'comparator4';
  if (n === 'alu' || n.includes('arithmetic logic unit')) return 'alu4';
  if (n === 'splitter') return 'splitter4';

  // Sequential
  if (n.includes('d flip-flop') || n === 'd flip flop') return 'dFlipFlop';
  if (n.includes('j-k flip-flop') || n === 'jk flip flop') return 'jkFlipFlop';
  if (n.includes('t flip-flop') || n === 't flip flop') return 'tFlipFlop';
  if (n === 's-r flip-flop' || n === 'sr latch') return 'srLatch';
  if (n === 'register') return 'register4';
  if (n === 'counter') return 'counter4';
  if (n.includes('shift register')) return 'shiftRegister4';
  if (n === 'ram') return 'ram16x4';
  if (n === 'rom') return 'rom16x4';

  return null;
}

/**
 * Parses coordinates string "(x,y)" into { x: number, y: number }
 */
function parseCoord(coordStr: string | null): { x: number; y: number } | null {
  if (!coordStr) return null;
  const match = coordStr.match(/\((-?\d+),\s*(-?\d+)\)/);
  if (!match) return null;
  return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
}

interface Pt {
  x: number;
  y: number;
}

const GATE_TYPES: ComponentType[] = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'];

// Logisim draws every part facing east by default; other facings turn the part around its anchor (loc)
const FACING_ROTATION: Record<string, 0 | 90 | 180 | 270> = { east: 0, south: 90, west: 180, north: 270 };

// Local (east-facing) offset -> canvas offset for a facing
const rotateOffset = (p: Pt, rot: number): Pt => {
  if (rot === 90) return { x: -p.y, y: p.x };
  if (rot === 180) return { x: -p.x, y: -p.y };
  if (rot === 270) return { x: p.y, y: -p.x };
  return p;
};

// Logisim controlled buffer / inverter: data input, then control input (below the body when
// right-handed, above when left-handed). The inverter is 30 long unless its size is narrow (20).
const controlledOffsets = (type: ComponentType, size: number, leftHanded: boolean): Pt[] => {
  const len = type === 'controlledInverter' && size !== 20 ? 30 : 20;
  return [
    { x: -len, y: 0 },
    { x: -(len - 10), y: leftHanded ? -10 : 10 },
  ];
};

// Logisim 2.7 gate input spacing (AbstractGate), checked in Logisim for size 50 and 2..5 inputs
const gateInputOffsets = (inputs: number, size: number): number[] => {
  let ss: number, sd: number, sl: number;
  if (inputs <= 3) {
    if (size < 40) [ss, sd, sl] = [-5, 10, 10];
    else if (size < 60 || inputs <= 2) [ss, sd, sl] = [-10, 20, 20];
    else [ss, sd, sl] = [-15, 30, 30];
  } else if (inputs === 4 && size >= 60) [ss, sd, sl] = [-5, 20, 0];
  else [ss, sd, sl] = [-5, 10, 10];
  return Array.from({ length: inputs }, (_, i) =>
    inputs % 2 ? ss * (inputs - 1) + sd * i : ss * inputs + sd * i + (i >= inputs / 2 ? sl : 0)
  );
};
// Flip-flop connection points relative to loc (Q at loc), measured in Logisim 2.7.1
const FF_POINTS: Record<string, { inputs: Pt[]; outputs: Pt[] }> = {
  dFlipFlop: { inputs: [{ x: -40, y: 20 }, { x: -40, y: 0 }], outputs: [{ x: 0, y: 0 }, { x: 0, y: 20 }] }, // D, CLK
  tFlipFlop: { inputs: [{ x: -40, y: 20 }, { x: -40, y: 0 }, { x: -10, y: 30 }], outputs: [{ x: 0, y: 0 }, { x: 0, y: 20 }] }, // T, CLK, reset
  jkFlipFlop: { inputs: [{ x: -40, y: 0 }, { x: -40, y: 10 }, { x: -40, y: 20 }], outputs: [{ x: 0, y: 0 }, { x: 0, y: 20 }] }, // J, CLK, K
  srLatch: { inputs: [{ x: -40, y: 0 }, { x: -40, y: 20 }], outputs: [{ x: 0, y: 0 }, { x: 0, y: 20 }] }, // S, R (clock dropped)
};

/**
 * Parses Standard CAD XML (.circ) file and converts to native project sheets.
 *
 * Logisim stores a wire as many straight segments that only touch the parts at their pin locations, and
 * Logisim parts have other sizes than ours. So the importer rebuilds the electrical nets from the wire
 * geometry (segments joined at endpoints, or an endpoint on another segment), finds which Logisim pin
 * location each net reaches, and connects the matching pins of our parts. repairWires then routes them.
 */
export function importCircXmlProject(xmlText: string): ImportedCircuitSheet[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

  const circuits = xmlDoc.getElementsByTagName('circuit');
  if (circuits.length === 0) {
    throw new Error('Geçerli bir .circ devre dosyası bulunamadı (circuit etiketi yok).');
  }

  const results: ImportedCircuitSheet[] = [];
  const circuitNames = new Set(Array.from(circuits).map((c) => c.getAttribute('name') || ''));
  // Logisim parts that carry no logic
  const DECORATIVE = new Set(['text', 'probe text']);

  for (let cIdx = 0; cIdx < circuits.length; cIdx++) {
    const circuitElem = circuits[cIdx];
    const circuitName = circuitElem.getAttribute('name') || `Devre ${cIdx + 1}`;

    // Only direct children: a <circuit> never nests, but be safe against stray matches
    const rawComps = Array.from(circuitElem.getElementsByTagName('comp'));
    const rawWires = Array.from(circuitElem.getElementsByTagName('wire'));

    // 1. Wire segments and nets (union-find over grid points)
    const segs: Array<{ a: Pt; b: Pt }> = [];
    for (const wireNode of rawWires) {
      const a = parseCoord(wireNode.getAttribute('from'));
      const b = parseCoord(wireNode.getAttribute('to'));
      if (a && b && (a.x !== b.x || a.y !== b.y)) segs.push({ a, b });
    }
    const key = (p: Pt) => `${p.x},${p.y}`;
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      if (!parent.has(k)) parent.set(k, k);
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let c = k;
      while (parent.get(c) !== r) {
        const n = parent.get(c)!;
        parent.set(c, r);
        c = n;
      }
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const onSeg = (p: Pt, s: { a: Pt; b: Pt }) =>
      (s.a.x === s.b.x && p.x === s.a.x && p.y >= Math.min(s.a.y, s.b.y) && p.y <= Math.max(s.a.y, s.b.y)) ||
      (s.a.y === s.b.y && p.y === s.a.y && p.x >= Math.min(s.a.x, s.b.x) && p.x <= Math.max(s.a.x, s.b.x));
    const endpoints = new Map<string, Pt>();
    for (const s of segs) {
      union(key(s.a), key(s.b));
      endpoints.set(key(s.a), s.a);
      endpoints.set(key(s.b), s.b);
    }
    // An endpoint lying on another segment connects to it (Logisim splits the wire there)
    for (const p of endpoints.values()) {
      for (const s of segs) if (onSeg(p, s)) union(key(p), key(s.a));
    }
    // Net of a Logisim pin location: an endpoint there, or a segment passing over it
    const netAt = (p: Pt): string | null => {
      if (endpoints.has(key(p))) return find(key(p));
      for (const s of segs) if (onSeg(p, s)) return find(key(s.a));
      return null;
    };

    // 2. Parts: create ours and remember which Logisim pin location belongs to which of our pins
    const components: CircuitComponentInstance[] = [];
    const skipped = new Map<string, number>();
    const warnings: string[] = [];
    const attach: Array<{ at: Pt; compId: string; pinId: string; isOutput: boolean }> = [];
    // Our parts are bigger than Logisim's (an AND gate is 80px instead of 50px), spread the layout out
    const SCALE = 1.6;
    const scaled = (p: Pt): Pt => ({ x: Math.round((p.x * SCALE) / 10) * 10, y: Math.round((p.y * SCALE) / 10) * 10 });

    // Pass 1: read every part, and collect the connection points of the non-gate ones so a gate input
    // counts as used when a wire, a tunnel or another part's pin touches it
    type RawPart = {
      compName: string;
      loc: Pt;
      nativeType: ComponentType;
      label?: string;
      rot: number;
      size: number;
      inputsAttr: number;
      xorMode?: string;
      leftHanded: boolean;
      pull?: string;
      where: string;
    };
    const parts: RawPart[] = [];
    const occupied = new Set<string>();
    const local = (loc: Pt, off: Pt, rot: number): Pt => {
      const r = rotateOffset(off, rot);
      return { x: loc.x + r.x, y: loc.y + r.y };
    };
    for (let i = 0; i < rawComps.length; i++) {
      const compNode = rawComps[i];
      const compName = compNode.getAttribute('name') || '';
      const loc = parseCoord(compNode.getAttribute('loc'));
      if (!loc) continue;

      const attrs = compNode.getElementsByTagName('a');
      let isOutput = false;
      let constVal: string | undefined = undefined;
      let label: string | undefined = undefined;
      let facing = 'east';
      let size = 0;
      let width = 1;
      let inputsAttr = 0;
      let xorMode: string | undefined;
      let leftHanded = false;
      let pull: string | undefined;
      const negated: number[] = [];
      for (let a = 0; a < attrs.length; a++) {
        const aName = attrs[a].getAttribute('name');
        const aVal = attrs[a].getAttribute('val') || attrs[a].textContent || '';
        if (aName === 'output' && aVal === 'true') isOutput = true;
        if (aName === 'val' || aName === 'value') constVal = aVal;
        if (aName === 'label' && aVal) label = aVal;
        if (aName === 'facing') facing = aVal;
        if (aName === 'size') size = parseInt(aVal, 10) || 0;
        if (aName === 'width') width = parseInt(aVal, 10) || 1;
        if (aName === 'inputs') inputsAttr = parseInt(aVal, 10) || 0;
        if (aName === 'xor') xorMode = aVal;
        if (aName === 'control') leftHanded = aVal === 'left';
        if (aName === 'pull') pull = aVal;
        const neg = aName?.match(/^negate(\d+)$/);
        if (neg && aVal === 'true') negated.push(Number(neg[1]) + 1);
      }

      const nativeType = mapCircCompType(compName, isOutput, constVal);
      if (!nativeType) {
        if (!DECORATIVE.has(compName.trim().toLowerCase())) {
          const why = circuitNames.has(compName) ? `${compName} (alt devre örneği)` : compName || '(adsız)';
          skipped.set(why, (skipped.get(why) || 0) + 1);
        }
        continue;
      }
      const where = `${compName}${label ? ` "${label}"` : ''} (${loc.x},${loc.y})`;
      if (width > 1) warnings.push(`${where}: ${width} bitlik, tek bit olarak alındı.`);
      if (negated.length > 0) warnings.push(`${where}: ${negated.join(', ')}. giriş(ler)deki tersleme dairesi alınmadı, araya NOT kapısı ekleyin.`);
      const rot = FACING_ROTATION[facing] ?? 0;
      parts.push({ compName, loc, nativeType, label, rot, size, inputsAttr, xorMode, leftHanded, pull, where });

      occupied.add(key(loc)); // every Logisim part has a connection at loc (gate output, pin, Q ...)
      const ff = FF_POINTS[nativeType];
      if (ff) for (const off of [...ff.inputs, ...ff.outputs]) occupied.add(key(local(loc, off, rot)));
      if (nativeType === 'triState' || nativeType === 'controlledInverter') {
        for (const off of controlledOffsets(nativeType, size, leftHanded)) occupied.add(key(local(loc, off, rot)));
      }
    }
    const used = (p: Pt) => netAt(p) !== null || occupied.has(key(p));
    let privatePoints = 0; // fake coordinates that only join the parts of one split gate

    // Pass 2: our parts, pinned to the exact Logisim connection points
    for (const part of parts) {
      const { loc, nativeType, label, rot, size, inputsAttr, xorMode, leftHanded, pull, where } = part;
      const anchor = scaled(loc);
      const isGate = GATE_TYPES.includes(nativeType);

      const isControlled = nativeType === 'triState' || nativeType === 'controlledInverter';
      if (isGate || nativeType === 'not' || nativeType === 'buffer' || isControlled) {
        let inputPoints: Pt[];
        if (isGate) {
          const isXor = nativeType === 'xor' || nativeType === 'xnor';
          const bubble = nativeType === 'nand' || nativeType === 'nor' || nativeType === 'xnor' ? 10 : 0;
          const gsize = size || 50;
          // No 'inputs' attribute: Logisim 2.7 defaults to 5; every smaller count uses a subset of those points
          const n = inputsAttr || 5;
          const axis = gsize + (isXor ? 10 : 0) + bubble;
          inputPoints = gateInputOffsets(n, gsize).map((dy) => local(loc, { x: -axis, y: dy }, rot)).filter(used);
          if (isXor && inputPoints.length > 2 && xorMode !== 'odd') {
            warnings.push(`${where}: Logisim bu XOR'u "yalnızca bir giriş 1" olarak hesaplar; burada tek sayıda 1 (parite) kuralı kullanılır.`);
          }
        } else if (isControlled) {
          inputPoints = controlledOffsets(nativeType, size, leftHanded).map((off) => local(loc, off, rot));
        } else if (nativeType === 'buffer') {
          inputPoints = [local(loc, { x: -20, y: 0 }, rot)]; // Logisim buffer is 20 long, no size attribute
        } else {
          inputPoints = [local(loc, { x: -(size || 30), y: 0 }, rot)];
        }

        // Our gates take at most 5 inputs: wider Logisim gates become groups of the base operation
        // feeding the original gate (inversion stays on the last one), joined by private connection points
        if (isGate && inputPoints.length > 5) {
          const base: ComponentType = nativeType === 'nand' ? 'and' : nativeType === 'nor' ? 'or' : nativeType === 'xnor' ? 'xor' : nativeType;
          const feeds: Pt[] = [];
          for (let gi = 0; gi * 5 < inputPoints.length; gi++) {
            const group = inputPoints.slice(gi * 5, gi * 5 + 5);
            if (group.length === 1) {
              feeds.push(group[0]);
              continue;
            }
            let sub = createComponentInstance(base, 0, 0);
            sub.inputs = group.map((_, k) => ({ id: `${sub.id}_in${k}`, name: String.fromCharCode(65 + k), type: 'input' as const, value: 0 as const, x: 0, y: 0 }));
            sub.state = { ...sub.state, gateInputsCount: group.length };
            sub = updatePinPositions(sub);
            sub = updatePinPositions({ ...sub, x: anchor.x - 200 - sub.outputs[0].x, y: anchor.y + gi * 120 - sub.outputs[0].y });
            components.push(sub);
            group.forEach((pt, k) => attach.push({ at: pt, compId: sub.id, pinId: sub.inputs[k].id, isOutput: false }));
            const link = { x: -1e6 - privatePoints++, y: -1e6 };
            attach.push({ at: link, compId: sub.id, pinId: sub.outputs[0].id, isOutput: true });
            feeds.push(link);
          }
          inputPoints = feeds;
        }

        let inst = createComponentInstance(nativeType, 0, 0);
        if (isGate && inputPoints.length > 2) {
          const n = Math.min(5, inputPoints.length);
          inst.inputs = Array.from({ length: n }).map((_, k) => ({
            id: `${inst.id}_in${k}`,
            name: String.fromCharCode(65 + k),
            type: 'input' as const,
            value: 0 as const,
            x: 0,
            y: 0,
          }));
          inst.state = { ...inst.state, gateInputsCount: n };
        }
        inst.rotation = rot as 0 | 90 | 180 | 270;
        inst = updatePinPositions(inst);
        // Put our output pin exactly on the (scaled) Logisim anchor
        const out = inst.outputs[0];
        inst = updatePinPositions({ ...inst, x: anchor.x - out.x, y: anchor.y - out.y });
        if (label) inst.label = label;
        components.push(inst);

        attach.push({ at: loc, compId: inst.id, pinId: inst.outputs[0].id, isOutput: true });
        inputPoints.slice(0, inst.inputs.length).forEach((pt, k) => {
          attach.push({ at: pt, compId: inst.id, pinId: inst.inputs[k].id, isOutput: false });
        });
        continue;
      }

      let inst = updatePinPositions(createComponentInstance(nativeType, 0, 0));
      const pins = [...inst.inputs, ...inst.outputs];
      if (nativeType === 'tunnel') {
        // Logisim tunnel: one connection point at loc; ours joins every tunnel with the same label
        const pin = inst.inputs[0];
        inst = updatePinPositions({ ...inst, x: anchor.x - pin.x, y: anchor.y - pin.y, label: label || 'Tünel' });
        components.push(inst);
        attach.push({ at: loc, compId: inst.id, pinId: inst.inputs[0].id, isOutput: false });
        continue;
      }
      if (pins.length === 1) {
        // Single-pin parts (pins, probes, LEDs, clocks, constants): the Logisim loc IS the pin
        inst = updatePinPositions({ ...inst, x: anchor.x - pins[0].x, y: anchor.y - pins[0].y });
        if (label) inst.label = label;
        // Logisim's pull attribute: 0 (default), 1 or X
        if (nativeType === 'pullResistor') inst.state = { ...inst.state, pullValue: pull === '1' ? 1 : pull === 'X' ? 'X' : 0 };
        components.push(inst);
        const pin = [...inst.inputs, ...inst.outputs][0];
        attach.push({ at: loc, compId: inst.id, pinId: pin.id, isOutput: pin.type === 'output' });
        continue;
      }

      const ff = FF_POINTS[nativeType];
      if (ff) {
        // Flip-flops: exact Logisim points (Q at loc)
        inst = updatePinPositions({ ...inst, x: anchor.x - inst.outputs[0].x, y: anchor.y - inst.outputs[0].y });
        if (label) inst.label = label;
        components.push(inst);
        ff.inputs.forEach((off, k) => inst.inputs[k] && attach.push({ at: local(loc, off, rot), compId: inst.id, pinId: inst.inputs[k].id, isOutput: false }));
        ff.outputs.forEach((off, k) => inst.outputs[k] && attach.push({ at: local(loc, off, rot), compId: inst.id, pinId: inst.outputs[k].id, isOutput: true }));
        if (nativeType === 'srLatch') warnings.push(`${where}: Logisim'deki saatli S-R flip-flop, saatsiz SR mandal olarak alındı.`);
        const extra = nativeType === 'tFlipFlop' ? [{ x: -30, y: 30 }] : [{ x: -10, y: 30 }, { x: -30, y: 30 }];
        if (extra.some((off) => netAt(local(loc, off, rot)) !== null)) warnings.push(`${where}: preset / reset girişleri alınmadı.`);
        continue;
      }

      // Other chips: their Logisim geometry is not modelled; connect wire endpoints near each of our pins
      inst = updatePinPositions({ ...inst, x: anchor.x, y: anchor.y });
      if (label) inst.label = label;
      components.push(inst);
      warnings.push(`${where}: bağlantıları yaklaşık olarak kuruldu, kontrol edin.`);
      for (const pin of [...inst.inputs, ...inst.outputs]) {
        let best: Pt | null = null;
        let bestD = 30;
        for (const p of endpoints.values()) {
          const sp = scaled(p);
          const d = Math.hypot(sp.x - pin.x, sp.y - pin.y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best) attach.push({ at: best, compId: inst.id, pinId: pin.id, isOutput: pin.type === 'output' });
      }
    }

    // 3. One star of pin-to-pin connections per net, driven from an output pin when there is one
    const byNet = new Map<string, typeof attach>();
    for (const at of attach) {
      const net = netAt(at.at) ?? `pin:${key(at.at)}`; // parts touching pin-to-pin without a wire
      if (!byNet.has(net)) byNet.set(net, []);
      byNet.get(net)!.push(at);
    }
    const wires: CircuitWire[] = [];
    let wireNo = 0;
    for (const members of byNet.values()) {
      const unique = members.filter((m, i) => members.findIndex((o) => o.pinId === m.pinId) === i);
      if (unique.length < 2) continue;
      const driver = unique.find((m) => m.isOutput) || unique[0];
      for (const m of unique) {
        if (m === driver) continue;
        wires.push({
          id: `wire_circ_${cIdx}_${wireNo++}`,
          fromCompId: driver.compId,
          fromPinId: driver.pinId,
          toCompId: m.compId,
          toPinId: m.pinId,
          value: 0,
        });
      }
    }

    // 3b. Our parts are larger than Logisim's and some have extra pins (a tunnel's second pin), so a pin
    // can land on another part's pin; the simulator joins pins sharing a grid point, which would short
    // nets. Connections are explicit wires here, so nudge such parts down until their pins are clear.
    const pinPoint = (p: Pt) => `${Math.round(p.x / 10) * 10},${Math.round(p.y / 10) * 10}`;
    const taken = new Map<string, string>();
    for (let k = 0; k < components.length; k++) {
      let comp = components[k];
      for (let tries = 0; tries < 40; tries++) {
        const pts = [...comp.inputs, ...comp.outputs].map(pinPoint);
        if (!pts.some((pt) => taken.has(pt) && taken.get(pt) !== comp.id)) break;
        comp = updatePinPositions({ ...comp, y: comp.y + 10 });
      }
      components[k] = comp;
      for (const p of [...comp.inputs, ...comp.outputs]) taken.set(pinPoint(p), comp.id);
    }

    // 4. Keep everything on the positive canvas with a margin
    if (components.length > 0) {
      const minX = Math.min(...components.map((c) => Math.min(c.x, ...[...c.inputs, ...c.outputs].map((p) => p.x))));
      const minY = Math.min(...components.map((c) => Math.min(c.y, ...[...c.inputs, ...c.outputs].map((p) => p.y))));
      const dx = Math.round((60 - minX) / 10) * 10;
      const dy = Math.round((60 - minY) / 10) * 10;
      for (let k = 0; k < components.length; k++) {
        components[k] = updatePinPositions({ ...components[k], x: components[k].x + dx, y: components[k].y + dy });
      }
    }

    skipped.forEach((count, what) => warnings.unshift(`Desteklenmeyen bileşen atlandı: ${what}${count > 1 ? ` ×${count}` : ''}`));

    results.push({
      name: circuitName,
      components,
      wires,
      warnings,
    });
  }

  return results;
}

// Backward-compatible alias
export const importLogisimCirc = importCircXmlProject;
