import type {
  CircuitComponentInstance,
  CircuitWire,
  CustomSubcircuit,
  SubcircuitPortDefinition,
} from '../types/circuit';
import type { SignalValue } from '../types/logic';
import {
  createComponentInstance,
  simulateCircuit,
  updatePinPositions,
} from './circuitEngine';
import { getInternalWires, snapTo10 } from './wiringEngine';

const SUBCIRCUITS_STORAGE_KEY = 'logicdesign_custom_subcircuits_v1';

// Global runtime registry for fast access during simulation
const runtimeSubcircuits = new Map<string, CustomSubcircuit>();

// Starter built-in custom IC 1: 1-Bit Full Adder
function createDefaultFullAdder(): CustomSubcircuit {
  const swA = { ...createComponentInstance('switch', 40, 60, 'A'), id: 'fa_sw_a' };
  const swB = { ...createComponentInstance('switch', 40, 140, 'B'), id: 'fa_sw_b' };
  const swCin = { ...createComponentInstance('switch', 40, 220, 'Cin'), id: 'fa_sw_cin' };

  const xor1 = { ...createComponentInstance('xor', 180, 80, 'XOR 1'), id: 'fa_xor1' };
  const and1 = { ...createComponentInstance('and', 180, 180, 'AND 1'), id: 'fa_and1' };

  const xor2 = { ...createComponentInstance('xor', 320, 100, 'XOR 2'), id: 'fa_xor2' };
  const and2 = { ...createComponentInstance('and', 320, 200, 'AND 2'), id: 'fa_and2' };

  const or1 = { ...createComponentInstance('or', 440, 220, 'OR 1'), id: 'fa_or1' };

  const ledS = { ...createComponentInstance('led', 560, 100, 'Toplam (S)'), id: 'fa_led_s' };
  const ledCout = { ...createComponentInstance('led', 560, 220, 'Elde (Cout)'), id: 'fa_led_cout' };

  const comps = [swA, swB, swCin, xor1, and1, xor2, and2, or1, ledS, ledCout].map(updatePinPositions);

  const wires: CircuitWire[] = [
    { id: 'w1', fromCompId: 'fa_sw_a', fromPinId: 'fa_sw_a_out', toCompId: 'fa_xor1', toPinId: 'fa_xor1_in0', value: 0 },
    { id: 'w2', fromCompId: 'fa_sw_b', fromPinId: 'fa_sw_b_out', toCompId: 'fa_xor1', toPinId: 'fa_xor1_in1', value: 0 },
    { id: 'w3', fromCompId: 'fa_sw_a', fromPinId: 'fa_sw_a_out', toCompId: 'fa_and1', toPinId: 'fa_and1_in0', value: 0 },
    { id: 'w4', fromCompId: 'fa_sw_b', fromPinId: 'fa_sw_b_out', toCompId: 'fa_and1', toPinId: 'fa_and1_in1', value: 0 },

    { id: 'w5', fromCompId: 'fa_xor1', fromPinId: 'fa_xor1_out', toCompId: 'fa_xor2', toPinId: 'fa_xor2_in0', value: 0 },
    { id: 'w6', fromCompId: 'fa_sw_cin', fromPinId: 'fa_sw_cin_out', toCompId: 'fa_xor2', toPinId: 'fa_xor2_in1', value: 0 },

    { id: 'w7', fromCompId: 'fa_xor1', fromPinId: 'fa_xor1_out', toCompId: 'fa_and2', toPinId: 'fa_and2_in0', value: 0 },
    { id: 'w8', fromCompId: 'fa_sw_cin', fromPinId: 'fa_sw_cin_out', toCompId: 'fa_and2', toPinId: 'fa_and2_in1', value: 0 },

    { id: 'w9', fromCompId: 'fa_xor2', fromPinId: 'fa_xor2_out', toCompId: 'fa_led_s', toPinId: 'fa_led_s_in', value: 0 },

    { id: 'w10', fromCompId: 'fa_and1', fromPinId: 'fa_and1_out', toCompId: 'fa_or1', toPinId: 'fa_or1_in0', value: 0 },
    { id: 'w11', fromCompId: 'fa_and2', fromPinId: 'fa_and2_out', toCompId: 'fa_or1', toPinId: 'fa_or1_in1', value: 0 },
    { id: 'w12', fromCompId: 'fa_or1', fromPinId: 'fa_or1_out', toCompId: 'fa_led_cout', toPinId: 'fa_led_cout_in', value: 0 },
  ];

  const ports: SubcircuitPortDefinition[] = [
    { id: 'p_in_a', name: 'A', type: 'input', targetCompId: 'fa_sw_a', targetPinId: 'fa_sw_a_out' },
    { id: 'p_in_b', name: 'B', type: 'input', targetCompId: 'fa_sw_b', targetPinId: 'fa_sw_b_out' },
    { id: 'p_in_cin', name: 'Cin', type: 'input', targetCompId: 'fa_sw_cin', targetPinId: 'fa_sw_cin_out' },
    { id: 'p_out_s', name: 'S', type: 'output', targetCompId: 'fa_led_s', targetPinId: 'fa_led_s_in' },
    { id: 'p_out_cout', name: 'Cout', type: 'output', targetCompId: 'fa_led_cout', targetPinId: 'fa_led_cout_in' },
  ];

  return {
    id: 'sub_builtin_full_adder',
    name: '1-Bit Tam Toplayıcı',
    chipCode: 'IC-FA01',
    description: 'A, B ve Cin girişlerini toplayarak Toplam (S) ve Elde (Cout) üreten paketli entegre modülü.',
    category: 'custom',
    color: '#3b82f6',
    width: 130,
    height: 94,
    ports,
    components: comps,
    wires,
    createdAt: 1700000000000,
  };
}

// Starter built-in custom IC 2: 2:1 Multiplexer
function createDefaultMux2(): CustomSubcircuit {
  const swD0 = { ...createComponentInstance('switch', 40, 60, 'D0'), id: 'mux_sw_d0' };
  const swD1 = { ...createComponentInstance('switch', 40, 140, 'D1'), id: 'mux_sw_d1' };
  const swSel = { ...createComponentInstance('switch', 40, 220, 'S'), id: 'mux_sw_sel' };

  const notSel = { ...createComponentInstance('not', 180, 220, 'NOT S'), id: 'mux_not' };
  const and0 = { ...createComponentInstance('and', 280, 70, 'AND D0'), id: 'mux_and0' };
  const and1 = { ...createComponentInstance('and', 280, 170, 'AND D1'), id: 'mux_and1' };
  const orOut = { ...createComponentInstance('or', 420, 120, 'OR Y'), id: 'mux_or' };
  const ledY = { ...createComponentInstance('led', 540, 120, 'Çıkış Y'), id: 'mux_led_y' };

  const comps = [swD0, swD1, swSel, notSel, and0, and1, orOut, ledY].map(updatePinPositions);

  const wires: CircuitWire[] = [
    { id: 'w1', fromCompId: 'mux_sw_sel', fromPinId: 'mux_sw_sel_out', toCompId: 'mux_not', toPinId: 'mux_not_in', value: 0 },
    { id: 'w2', fromCompId: 'mux_sw_d0', fromPinId: 'mux_sw_d0_out', toCompId: 'mux_and0', toPinId: 'mux_and0_in0', value: 0 },
    { id: 'w3', fromCompId: 'mux_not', fromPinId: 'mux_not_out', toCompId: 'mux_and0', toPinId: 'mux_and0_in1', value: 0 },
    { id: 'w4', fromCompId: 'mux_sw_d1', fromPinId: 'mux_sw_d1_out', toCompId: 'mux_and1', toPinId: 'mux_and1_in0', value: 0 },
    { id: 'w5', fromCompId: 'mux_sw_sel', fromPinId: 'mux_sw_sel_out', toCompId: 'mux_and1', toPinId: 'mux_and1_in1', value: 0 },
    { id: 'w6', fromCompId: 'mux_and0', fromPinId: 'mux_and0_out', toCompId: 'mux_or', toPinId: 'mux_or_in0', value: 0 },
    { id: 'w7', fromCompId: 'mux_and1', fromPinId: 'mux_and1_out', toCompId: 'mux_or', toPinId: 'mux_or_in1', value: 0 },
    { id: 'w8', fromCompId: 'mux_or', fromPinId: 'mux_or_out', toCompId: 'mux_led_y', toPinId: 'mux_led_y_in', value: 0 },
  ];

  const ports: SubcircuitPortDefinition[] = [
    { id: 'p_in_d0', name: 'D0', type: 'input', targetCompId: 'mux_sw_d0', targetPinId: 'mux_sw_d0_out' },
    { id: 'p_in_d1', name: 'D1', type: 'input', targetCompId: 'mux_sw_d1', targetPinId: 'mux_sw_d1_out' },
    { id: 'p_in_s', name: 'S', type: 'input', targetCompId: 'mux_sw_sel', targetPinId: 'mux_sw_sel_out' },
    { id: 'p_out_y', name: 'Y', type: 'output', targetCompId: 'mux_led_y', targetPinId: 'mux_led_y_in' },
  ];

  return {
    id: 'sub_builtin_mux2',
    name: '2:1 Çoklayıcı (MUX)',
    chipCode: 'IC-MUX01',
    description: 'S seçim girişine göre D0 veya D1 girişini Y çıkışına aktaran 2:1 seçici mantık bloğu.',
    category: 'custom',
    color: '#8b5cf6',
    width: 124,
    height: 94,
    ports,
    components: comps,
    wires,
    createdAt: 1700000001000,
  };
}

// Starter built-in custom IC 3: SR Latch (NAND)
function createDefaultSRLatch(): CustomSubcircuit {
  const swS = { ...createComponentInstance('switch', 40, 60, "S'"), id: 'sr_sw_s', state: { on: true } };
  const swR = { ...createComponentInstance('switch', 40, 180, "R'"), id: 'sr_sw_r', state: { on: true } };

  const nand1 = { ...createComponentInstance('nand', 200, 70, 'NAND 1'), id: 'sr_nand1' };
  const nand2 = { ...createComponentInstance('nand', 200, 170, 'NAND 2'), id: 'sr_nand2' };

  const ledQ = { ...createComponentInstance('led', 360, 70, 'Q'), id: 'sr_led_q' };
  const ledQbar = { ...createComponentInstance('led', 360, 170, "Q'"), id: 'sr_led_qbar' };

  const comps = [swS, swR, nand1, nand2, ledQ, ledQbar].map(updatePinPositions);

  const wires: CircuitWire[] = [
    { id: 'w1', fromCompId: 'sr_sw_s', fromPinId: 'sr_sw_s_out', toCompId: 'sr_nand1', toPinId: 'sr_nand1_in0', value: 1 },
    { id: 'w2', fromCompId: 'sr_nand2', fromPinId: 'sr_nand2_out', toCompId: 'sr_nand1', toPinId: 'sr_nand1_in1', value: 0 },

    { id: 'w3', fromCompId: 'sr_nand1', fromPinId: 'sr_nand1_out', toCompId: 'sr_nand2', toPinId: 'sr_nand2_in0', value: 1 },
    { id: 'w4', fromCompId: 'sr_sw_r', fromPinId: 'sr_sw_r_out', toCompId: 'sr_nand2', toPinId: 'sr_nand2_in1', value: 1 },

    { id: 'w5', fromCompId: 'sr_nand1', fromPinId: 'sr_nand1_out', toCompId: 'sr_led_q', toPinId: 'sr_led_q_in', value: 1 },
    { id: 'w6', fromCompId: 'sr_nand2', fromPinId: 'sr_nand2_out', toCompId: 'sr_led_qbar', toPinId: 'sr_led_qbar_in', value: 0 },
  ];

  const ports: SubcircuitPortDefinition[] = [
    { id: 'p_in_s', name: "S'", type: 'input', targetCompId: 'sr_sw_s', targetPinId: 'sr_sw_s_out' },
    { id: 'p_in_r', name: "R'", type: 'input', targetCompId: 'sr_sw_r', targetPinId: 'sr_sw_r_out' },
    { id: 'p_out_q', name: 'Q', type: 'output', targetCompId: 'sr_led_q', targetPinId: 'sr_led_q_in' },
    { id: 'p_out_qb', name: "Q'", type: 'output', targetCompId: 'sr_led_qbar', targetPinId: 'sr_led_qbar_in' },
  ];

  return {
    id: 'sub_builtin_sr_latch',
    name: "SR Flip-Flop (NAND Mandalı)",
    chipCode: 'IC-SR01',
    description: "Ters mantıklı S' ve R' girişleri ile 1 bit hafıza tutan çapraz bağlı NAND mandalı.",
    category: 'custom',
    color: '#059669',
    width: 124,
    height: 94,
    ports,
    components: comps,
    wires,
    createdAt: 1700000002000,
  };
}

/**
 * Initialize subcircuit registry from built-ins and localStorage
 */
export function initSubcircuits(): CustomSubcircuit[] {
  const defaults = [createDefaultFullAdder(), createDefaultMux2(), createDefaultSRLatch()];
  defaults.forEach((def) => runtimeSubcircuits.set(def.id, def));

  try {
    const raw = localStorage.getItem(SUBCIRCUITS_STORAGE_KEY);
    if (raw) {
      const parsed: CustomSubcircuit[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && item.id) runtimeSubcircuits.set(item.id, item);
        });
      }
    }
  } catch (e) {
    console.error('Failed to load subcircuits from localStorage', e);
  }

  return Array.from(runtimeSubcircuits.values());
}

/**
 * Get all available subcircuit definitions
 */
export function getAllSubcircuits(): CustomSubcircuit[] {
  if (runtimeSubcircuits.size === 0) {
    return initSubcircuits();
  }
  return Array.from(runtimeSubcircuits.values());
}

/**
 * Lookup a subcircuit by its ID
 */
export function getSubcircuitDefinition(id: string): CustomSubcircuit | undefined {
  if (!runtimeSubcircuits.has(id)) {
    initSubcircuits();
  }
  return runtimeSubcircuits.get(id);
}

/**
 * Save / persist a new or updated custom subcircuit
 */
export function saveCustomSubcircuit(subDef: CustomSubcircuit): void {
  runtimeSubcircuits.set(subDef.id, subDef);
  try {
    // Only persist non-builtins or custom-saved ones
    const all = Array.from(runtimeSubcircuits.values());
    localStorage.setItem(SUBCIRCUITS_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.error('Failed to save subcircuits to localStorage', e);
  }
}

/**
 * Delete a custom subcircuit definition
 */
export function deleteCustomSubcircuit(id: string): void {
  runtimeSubcircuits.delete(id);
  try {
    const all = Array.from(runtimeSubcircuits.values());
    localStorage.setItem(SUBCIRCUITS_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.error('Failed to delete subcircuit from localStorage', e);
  }
}

/**
 * Create a new CircuitComponentInstance of type 'subcircuit' on the canvas
 */
export function createSubcircuitInstance(
  subDef: CustomSubcircuit,
  x: number,
  y: number,
  customLabel?: string
): CircuitComponentInstance {
  const compId = `comp_sub_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const inPorts = subDef.ports.filter((p) => p.type === 'input');
  const outPorts = subDef.ports.filter((p) => p.type === 'output');

  // Same body width as updatePinPositions/the renderer use for every subcircuit chip (subDef.width is
  // only a library hint); otherwise the outputs would sit off the chip until the next pin update
  const width = 120;

  // Position inputs along the left edge strictly locked to 20px multiples (10px grid)
  const inputs = inPorts.map((port, idx) => {
    const relY = 20 * (idx + 1);
    return {
      id: `${compId}_${port.id}`,
      name: port.name,
      type: 'input' as const,
      value: 0 as SignalValue,
      x: x,
      y: y + relY,
    };
  });

  // Position outputs along the right edge strictly locked to 20px multiples (10px grid)
  const outputs = outPorts.map((port, idx) => {
    const relY = 20 * (idx + 1);
    return {
      id: `${compId}_${port.id}`,
      name: port.name,
      type: 'output' as const,
      value: 0 as SignalValue,
      x: x + width,
      y: y + relY,
    };
  });

  return {
    id: compId,
    type: 'subcircuit',
    label: customLabel || subDef.name,
    x,
    y,
    inputs,
    outputs,
    state: {
      subcircuitId: subDef.id,
      subcircuitName: subDef.name,
      subcircuitCode: subDef.chipCode || 'IC-CUSTOM',
    },
  };
}

/**
 * Evaluate the internal logic of a custom subcircuit given current external input values
 */
export function evaluateSubcircuit(
  subDef: CustomSubcircuit,
  inputVals: SignalValue[],
  previous?: { components: CircuitComponentInstance[]; wires: CircuitWire[] }
): SignalValue[] {
  return evaluateSubcircuitStateful(subDef, inputVals, previous).outputs;
}

/**
 * Same as evaluateSubcircuit, but continues from the instance's previous internal state (when it
 * still matches the definition) and returns the new internal state alongside the outputs.
 */
const PORT_DRIVER_PREFIX = '__port_driver_';

export function evaluateSubcircuitStateful(
  subDef: CustomSubcircuit,
  inputVals: SignalValue[],
  previous?: { components: CircuitComponentInstance[]; wires: CircuitWire[] }
): {
  outputs: SignalValue[];
  internal: { components: CircuitComponentInstance[]; wires: CircuitWire[] };
  oscillating: boolean;
} {
  const inPorts = subDef.ports.filter((p) => p.type === 'input');
  const outPorts = subDef.ports.filter((p) => p.type === 'output');

  // Continue from the stored state if it was made from this definition, else start from the template
  const sameShape =
    !!previous &&
    previous.components.length === subDef.components.length &&
    previous.components.every((c, i) => c.id === subDef.components[i].id && c.type === subDef.components[i].type);
  const source = sameShape ? previous!.components : subDef.components;

  // Deep clone components and wires to avoid mutating the template / previous state
  const intComps: CircuitComponentInstance[] = source.map((c) => ({
    ...c,
    inputs: c.inputs.map((p) => ({ ...p })),
    outputs: c.outputs.map((p) => ({ ...p })),
    state: { ...c.state },
  }));
  const intWires: CircuitWire[] = (sameShape ? previous!.wires : subDef.wires).map((w) => ({ ...w }));

  // Drive inputs with the outside values as they are, so x and E reach the parts inside like in
  // Logisim (an open port floats inside too)
  inPorts.forEach((port, idx) => {
    const val = inputVals[idx] ?? 'Z';
    const comp = intComps.find((c) => c.id === port.targetCompId);
    if (!comp) return;

    if (comp.type === 'switch' || comp.type === 'pushbutton' || comp.type === 'clock') {
      comp.state.on = val === 1;
      comp.state.portValue = val;
      if (comp.outputs[0]) comp.outputs[0].value = val;
    } else {
      // A bare pin as port: writing its value would be undone by net resolution (an undriven net floats),
      // so put a hidden driver on the pin's location for this evaluation
      const pin = [...comp.inputs, ...comp.outputs].find((p) => p.id === port.targetPinId);
      if (!pin) return;
      intComps.push({
        id: `${PORT_DRIVER_PREFIX}${idx}`,
        type: 'switch',
        label: '',
        x: pin.x,
        y: pin.y,
        inputs: [],
        outputs: [{ id: `${PORT_DRIVER_PREFIX}${idx}_out`, name: 'Q', type: 'output', value: val, x: pin.x, y: pin.y }],
        state: { on: val === 1, portValue: val },
      });
    }
  });

  // Settle the internal circuit; Logisim propagates the whole hierarchy at once, so an oscillation
  // inside is the outer circuit's oscillation too
  const settled = simulateCircuit(intComps, intWires);
  const curComps = settled.components;
  const curWires = settled.wires;

  // Read outputs
  const outputs = outPorts.map((port) => {
    const comp = curComps.find((c) => c.id === port.targetCompId);
    if (!comp) return 0 as SignalValue;
    if (comp.type === 'led' || comp.type === 'probe') {
      return (comp.inputs[0]?.value ?? 0) as SignalValue;
    }
    const pOut = comp.outputs.find((p) => p.id === port.targetPinId);
    if (pOut) return pOut.value;
    const pIn = comp.inputs.find((p) => p.id === port.targetPinId);
    if (pIn) return pIn.value;
    return 0 as SignalValue;
  });
  // The hidden port drivers are rebuilt every evaluation; keep only the IC's own parts as its state
  return {
    outputs,
    internal: { components: curComps.filter((c) => !c.id.startsWith(PORT_DRIVER_PREFIX)), wires: curWires },
    oscillating: !!settled.oscillating,
  };
}

/**
 * Package a selected group of components & wires into a new CustomSubcircuit
 */
export function packageSelectionIntoSubcircuit(
  name: string,
  chipCode: string,
  description: string,
  selectedComponents: CircuitComponentInstance[],
  allWires: CircuitWire[],
  allComponents: CircuitComponentInstance[] = selectedComponents
): CustomSubcircuit {
  // Internal wiring: every wire cluster that only touches pins of the selection, however many segments it
  // has (canvas wires are straight segments whose ends are mostly corners, not pins). The other parts must
  // be known too, or a wire to an unselected part would look internal and its pins never become ports.
  const internalWires = getInternalWires(
    allWires,
    allComponents,
    selectedComponents.map((c) => c.id)
  );
  const internalWireEnds = new Set<string>();
  for (const w of internalWires) {
    if (w.startPoint) internalWireEnds.add(`${snapTo10(w.startPoint.x)},${snapTo10(w.startPoint.y)}`);
    if (w.endPoint) internalWireEnds.add(`${snapTo10(w.endPoint.x)},${snapTo10(w.endPoint.y)}`);
  }

  // Detect input ports: switches, clocks, buttons, or un-driven component inputs
  const inPorts: SubcircuitPortDefinition[] = [];
  let inPortCount = 0;

  selectedComponents.forEach((c) => {
    if (['switch', 'pushbutton', 'clock'].includes(c.type)) {
      inPorts.push({
        id: `port_in_${inPortCount++}`,
        name: c.label || `IN${inPortCount}`,
        type: 'input',
        targetCompId: c.id,
        targetPinId: c.outputs[0]?.id || `${c.id}_out`,
      });
    }
  });

  // Detect output ports: leds, probes, buzzers, or displays
  const outPorts: SubcircuitPortDefinition[] = [];
  let outPortCount = 0;

  selectedComponents.forEach((c) => {
    if (['led', 'probe', 'buzzer'].includes(c.type)) {
      outPorts.push({
        id: `port_out_${outPortCount++}`,
        name: c.label || `OUT${outPortCount}`,
        type: 'output',
        targetCompId: c.id,
        targetPinId: c.inputs[0]?.id || `${c.id}_in`,
      });
    }
  });

  // Fallbacks if no switches/leds were selected (e.g. user selected bare gates)
  if (inPorts.length === 0) {
    selectedComponents.forEach((c) => {
      c.inputs.forEach((p) => {
        // If no internal wire reaches this input, it is an external port
        const isDrivenInternally = internalWireEnds.has(`${snapTo10(p.x)},${snapTo10(p.y)}`);
        if (!isDrivenInternally) {
          inPorts.push({
            id: `port_in_${inPortCount++}`,
            name: p.name || `IN${inPortCount}`,
            type: 'input',
            targetCompId: c.id,
            targetPinId: p.id,
          });
        }
      });
    });
  }

  if (outPorts.length === 0) {
    // Outputs that feed nothing inside the selection; if every output is used internally, offer them all
    const unused = selectedComponents.flatMap((c) =>
      c.outputs.filter((p) => !internalWireEnds.has(`${snapTo10(p.x)},${snapTo10(p.y)}`)).map((p) => ({ c, p }))
    );
    const candidates = unused.length > 0 ? unused : selectedComponents.flatMap((c) => c.outputs.map((p) => ({ c, p })));
    candidates.forEach(({ c, p }) => {
      outPorts.push({
        id: `port_out_${outPortCount++}`,
        name: p.name || `OUT${outPortCount}`,
        type: 'output',
        targetCompId: c.id,
        targetPinId: p.id,
      });
    });
  }

  // IC pins follow the layout on the canvas (top to bottom, then left to right), like Logisim
  const pinPos = (port: SubcircuitPortDefinition) => {
    const comp = selectedComponents.find((c) => c.id === port.targetCompId);
    const pin = comp && [...comp.inputs, ...comp.outputs].find((q) => q.id === port.targetPinId);
    return pin || comp || { x: 0, y: 0 };
  };
  const byPosition = (a: SubcircuitPortDefinition, b: SubcircuitPortDefinition) =>
    pinPos(a).y - pinPos(b).y || pinPos(a).x - pinPos(b).x;
  inPorts.sort(byPosition);
  outPorts.sort(byPosition);
  const ports = [...inPorts, ...outPorts];
  const width = 130;
  const height = Math.max(76, (Math.max(inPorts.length, outPorts.length) + 1) * 22);

  // Shift coordinates relative to minimum bounding box
  const minX = Math.min(...selectedComponents.map((c) => c.x));
  const minY = Math.min(...selectedComponents.map((c) => c.y));

  const dx = 40 - minX;
  const dy = 40 - minY;
  const normalizedComps = selectedComponents.map((c) =>
    updatePinPositions({
      ...c,
      x: c.x + dx,
      y: c.y + dy,
    })
  );
  // Wires move with their parts (connectivity is positional)
  const shift = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  const normalizedWires = internalWires.map((w) => ({
    ...w,
    startPoint: w.startPoint ? shift(w.startPoint) : undefined,
    endPoint: w.endPoint ? shift(w.endPoint) : undefined,
    waypoints: w.waypoints?.map(shift),
    branchPoint: w.branchPoint ? shift(w.branchPoint) : undefined,
    elbowX: w.elbowX !== undefined ? w.elbowX + dx : undefined,
  }));

  const subDef: CustomSubcircuit = {
    id: `sub_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    name: name.trim() || 'Özel Entegre Devre',
    chipCode: chipCode.trim() || `IC-${Math.floor(Math.random() * 900 + 100)}`,
    description: description.trim() || 'Kullanıcı tarafından paketlenmiş özel alt devre.',
    category: 'custom',
    color: '#0284c7',
    width,
    height,
    ports,
    components: normalizedComps,
    wires: normalizedWires,
    createdAt: Date.now(),
  };

  saveCustomSubcircuit(subDef);
  return subDef;
}
