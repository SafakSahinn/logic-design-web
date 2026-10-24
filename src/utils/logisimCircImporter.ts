import type { CircuitComponentInstance, CircuitWire, ComponentType } from '../types/circuit';
import { createComponentInstance } from './circuitEngine';

export interface ImportedCircuitSheet {
  name: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
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
  if (n === 'controlled buffer' || n === 'buffer') return 'triState';

  if (n === 'pin') {
    return isOutputPin ? 'probe' : 'switch';
  }
  if (n === 'clock') return 'clock';
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

/**
 * Parses Standard CAD XML (.circ) file and converts to native project sheets.
 */
export function importCircXmlProject(xmlText: string): ImportedCircuitSheet[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

  const circuits = xmlDoc.getElementsByTagName('circuit');
  if (circuits.length === 0) {
    throw new Error('Geçerli bir .circ devre dosyası bulunamadı (circuit etiketi yok).');
  }

  const results: ImportedCircuitSheet[] = [];

  for (let cIdx = 0; cIdx < circuits.length; cIdx++) {
    const circuitElem = circuits[cIdx];
    const circuitName = circuitElem.getAttribute('name') || `Devre ${cIdx + 1}`;

    const rawComps = circuitElem.getElementsByTagName('comp');
    const rawWires = circuitElem.getElementsByTagName('wire');

    const components: CircuitComponentInstance[] = [];
    const compPinMap = new Map<string, { compId: string; pinId: string; pinType: 'input' | 'output'; x: number; y: number }>();

    // Calculate bounding box to normalize coordinates
    let minX = Infinity;
    let minY = Infinity;

    for (let i = 0; i < rawComps.length; i++) {
      const pt = parseCoord(rawComps[i].getAttribute('loc'));
      if (pt) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
      }
    }
    for (let i = 0; i < rawWires.length; i++) {
      const fromPt = parseCoord(rawWires[i].getAttribute('from'));
      const toPt = parseCoord(rawWires[i].getAttribute('to'));
      if (fromPt) {
        if (fromPt.x < minX) minX = fromPt.x;
        if (fromPt.y < minY) minY = fromPt.y;
      }
      if (toPt) {
        if (toPt.x < minX) minX = toPt.x;
        if (toPt.y < minY) minY = toPt.y;
      }
    }

    if (minX === Infinity) minX = 0;
    if (minY === Infinity) minY = 0;

    const offsetX = 80 - Math.min(minX, 0);
    const offsetY = 80 - Math.min(minY, 0);

    // Process components
    for (let i = 0; i < rawComps.length; i++) {
      const compNode = rawComps[i];
      const compName = compNode.getAttribute('name') || '';
      const loc = parseCoord(compNode.getAttribute('loc'));
      if (!loc) continue;

      // Extract attributes like output=true, val=0, label=...
      const attrs = compNode.getElementsByTagName('a');
      let isOutput = false;
      let constVal: string | undefined = undefined;
      let label: string | undefined = undefined;

      for (let a = 0; a < attrs.length; a++) {
        const aName = attrs[a].getAttribute('name');
        const aVal = attrs[a].getAttribute('val') || attrs[a].textContent || '';
        if (aName === 'output' && aVal === 'true') isOutput = true;
        if (aName === 'val') constVal = aVal;
        if (aName === 'label' && aVal) label = aVal;
      }

      const nativeType = mapCircCompType(compName, isOutput, constVal);
      if (!nativeType) continue;

      const normX = Math.round((loc.x + offsetX) / 10) * 10;
      const normY = Math.round((loc.y + offsetY) / 10) * 10;

      const compInstance = createComponentInstance(nativeType, normX, normY);
      if (label) compInstance.label = label;

      components.push(compInstance);

      // Register pins in map
      compInstance.inputs.forEach((p) => {
        compPinMap.set(`${p.x},${p.y}`, { compId: compInstance.id, pinId: p.id, pinType: 'input', x: p.x, y: p.y });
      });
      compInstance.outputs.forEach((p) => {
        compPinMap.set(`${p.x},${p.y}`, { compId: compInstance.id, pinId: p.id, pinType: 'output', x: p.x, y: p.y });
      });
    }

    // Process wires
    const wires: CircuitWire[] = [];
    for (let w = 0; w < rawWires.length; w++) {
      const wireNode = rawWires[w];
      const fromPt = parseCoord(wireNode.getAttribute('from'));
      const toPt = parseCoord(wireNode.getAttribute('to'));
      if (!fromPt || !toPt) continue;

      const normFromX = Math.round((fromPt.x + offsetX) / 10) * 10;
      const normFromY = Math.round((fromPt.y + offsetY) / 10) * 10;
      const normToX = Math.round((toPt.x + offsetX) / 10) * 10;
      const normToY = Math.round((toPt.y + offsetY) / 10) * 10;

      // Find closest pins within 25px radius
      let bestFrom: { compId: string; pinId: string; pinType: 'input' | 'output' } | null = null;
      let bestTo: { compId: string; pinId: string; pinType: 'input' | 'output' } | null = null;
      let minFromDist = 25;
      let minToDist = 25;

      components.forEach((c) => {
        [...c.inputs, ...c.outputs].forEach((p) => {
          const dFrom = Math.hypot(p.x - normFromX, p.y - normFromY);
          if (dFrom < minFromDist) {
            minFromDist = dFrom;
            bestFrom = { compId: c.id, pinId: p.id, pinType: p.type };
          }
          const dTo = Math.hypot(p.x - normToX, p.y - normToY);
          if (dTo < minToDist) {
            minToDist = dTo;
            bestTo = { compId: c.id, pinId: p.id, pinType: p.type };
          }
        });
      });

      // If we found connection between output and input
      if (bestFrom && bestTo) {
        const bf: { compId: string; pinId: string; pinType: 'input' | 'output' } = bestFrom;
        const bt: { compId: string; pinId: string; pinType: 'input' | 'output' } = bestTo;
        if (bf.compId !== bt.compId) {
          const outPin = bf.pinType === 'output' ? bf : bt.pinType === 'output' ? bt : null;
          const inPin = bf.pinType === 'input' ? bf : bt.pinType === 'input' ? bt : null;

          if (outPin && inPin) {
            // Avoid duplicate wires
            const exists = wires.some(
              (ew) => ew.fromPinId === outPin.pinId && ew.toPinId === inPin.pinId
            );
            if (!exists) {
              wires.push({
                id: `wire_circ_${w}_${Math.random().toString(36).substring(2, 6)}`,
                fromCompId: outPin.compId,
                fromPinId: outPin.pinId,
                toCompId: inPin.compId,
                toPinId: inPin.pinId,
                value: 0,
              });
            }
          }
        }
      }
    }

    results.push({
      name: circuitName,
      components,
      wires,
    });
  }

  return results;
}

// Backward-compatible alias
export const importLogisimCirc = importCircXmlProject;
