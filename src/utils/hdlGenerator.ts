import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import { getLogicalConnections } from './wiringEngine';

function sanitizeName(name: string): string {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || 'node';
}

function getSignalName(
  compId: string,
  pinId: string,
  components: CircuitComponentInstance[],
  pinNameMap: Map<string, string>
): string {
  if (pinNameMap.has(pinId)) {
    return pinNameMap.get(pinId)!;
  }
  const comp = components.find((c) => c.id === compId);
  const cName = sanitizeName(comp?.label || comp?.type || 'comp');
  const shortPin = pinId.replace(`${compId}_`, '');
  const sigName = `w_${cName}_${shortPin}`;
  pinNameMap.set(pinId, sigName);
  return sigName;
}

export function generateVerilog(
  circuitName: string,
  components: CircuitComponentInstance[],
  canvasWires: CircuitWire[]
): string {
  // Driver lookups need pin-to-pin connections; canvas wires are positional segments
  const wires = getLogicalConnections(components, canvasWires);
  const modName = sanitizeName(circuitName || 'digital_circuit');
  const timestamp = new Date().toISOString();

  // 1. Identify primary input components & output components
  const inputComps = components.filter((c) =>
    ['switch', 'pushbutton', 'clock', 'vcc', 'gnd', 'dipSwitch4'].includes(c.type)
  );
  const outputComps = components.filter((c) =>
    ['led', 'probe', 'buzzer', 'sevenSegment', 'hexDisplay', 'ledBar4'].includes(c.type)
  );
  const internalComps = components.filter(
    (c) => !inputComps.includes(c) && !outputComps.includes(c)
  );

  const pinNameMap = new Map<string, string>();
  const inputPorts: string[] = [];
  const outputPorts: string[] = [];

  // Register input ports
  inputComps.forEach((c) => {
    const baseName = sanitizeName(c.label || c.type);
    if (c.type === 'clock') {
      const pName = baseName.includes('clk') ? baseName : `clk_${baseName}`;
      inputPorts.push(`input wire ${pName}`);
      pinNameMap.set(c.outputs[0]?.id, pName);
    } else if (c.type === 'dipSwitch4') {
      const pName = `in_${baseName}`;
      inputPorts.push(`input wire [3:0] ${pName}`);
      c.outputs.forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}[${idx}]`);
      });
    } else if (c.type === 'asciiKeyboard') {
      const pName = `kbd_${baseName}`;
      inputPorts.push(`input wire [6:0] ${pName}_data`);
      inputPorts.push(`input wire ${pName}_strobe`);
      c.outputs.slice(0, 7).forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}_data[${idx}]`);
      });
      if (c.outputs[7]) {
        pinNameMap.set(c.outputs[7].id, `${pName}_strobe`);
      }
    } else if (c.type === 'switch' || c.type === 'pushbutton') {
      const pName = `in_${baseName}`;
      inputPorts.push(`input wire ${pName}`);
      pinNameMap.set(c.outputs[0]?.id, pName);
    } else if (c.type === 'vcc') {
      pinNameMap.set(c.outputs[0]?.id, "1'b1");
    } else if (c.type === 'gnd') {
      pinNameMap.set(c.outputs[0]?.id, "1'b0");
    }
  });

  // Register output ports
  outputComps.forEach((c) => {
    const baseName = sanitizeName(c.label || c.type);
    if (c.type === 'led' || c.type === 'probe' || c.type === 'buzzer') {
      const pName = `out_${baseName}`;
      outputPorts.push(`output wire ${pName}`);
      pinNameMap.set(c.inputs[0]?.id, pName);
    } else if (c.type === 'ledBar4') {
      const pName = `out_${baseName}`;
      outputPorts.push(`output wire [3:0] ${pName}`);
      c.inputs.forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}[${idx}]`);
      });
    } else if (c.type === 'sevenSegment') {
      const pName = `out_seg_${baseName}`;
      outputPorts.push(`output wire [6:0] ${pName}`);
      c.inputs.forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}[${idx}]`);
      });
    } else if (c.type === 'hexDisplay') {
      const pName = `out_hex_${baseName}`;
      outputPorts.push(`output wire [3:0] ${pName}`);
      c.inputs.forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}[${idx}]`);
      });
    } else if (c.type === 'dotMatrix8x8') {
      const pName = `disp_${baseName}`;
      outputPorts.push(`output wire [7:0] ${pName}_rows`);
      outputPorts.push(`output wire [7:0] ${pName}_cols`);
      c.inputs.slice(0, 8).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_rows[${idx}]`));
      c.inputs.slice(8, 16).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_cols[${idx}]`));
    } else if (c.type === 'rgbMatrix16x16') {
      const pName = `gpu_${baseName}`;
      outputPorts.push(`output wire [3:0] ${pName}_x`);
      outputPorts.push(`output wire [3:0] ${pName}_y`);
      outputPorts.push(`output wire [2:0] ${pName}_rgb`);
      outputPorts.push(`output wire ${pName}_we`);
      c.inputs.slice(0, 4).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_x[${idx}]`));
      c.inputs.slice(4, 8).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_y[${idx}]`));
      c.inputs.slice(8, 11).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_rgb[${idx}]`));
      if (c.inputs[11]) pinNameMap.set(c.inputs[11].id, `${pName}_we`);
    }
  });

  // Helper to find driver signal for an input pin via wires
  const getWireDriver = (pinId: string): string => {
    const w = wires.find((wire) => wire.toPinId === pinId);
    if (!w) return "1'b0";
    if (pinNameMap.has(w.fromPinId)) return pinNameMap.get(w.fromPinId)!;
    return getSignalName(w.fromCompId, w.fromPinId, components, pinNameMap);
  };

  // 2. Build internal wires declarations and logic
  const internalWires = new Set<string>();
  const logicLines: string[] = [];
  const sequentialBlocks: string[] = [];

  internalComps.forEach((comp) => {
    const inSignals = comp.inputs.map((p) => getWireDriver(p.id));
    const outSignals = comp.outputs.map((p) => {
      const outName = getSignalName(comp.id, p.id, components, pinNameMap);
      if (
        !Array.from(outputPorts).some((op) => op.includes(outName)) &&
        !outName.startsWith("1'b")
      ) {
        internalWires.add(outName);
      }
      return outName;
    });

    switch (comp.type) {
      case 'not':
        logicLines.push(`  assign ${outSignals[0]} = ~${inSignals[0]};`);
        break;
      case 'and':
        logicLines.push(`  assign ${outSignals[0]} = ${inSignals.join(' & ')};`);
        break;
      case 'or':
        logicLines.push(`  assign ${outSignals[0]} = ${inSignals.join(' | ')};`);
        break;
      case 'nand':
        logicLines.push(`  assign ${outSignals[0]} = ~(${inSignals.join(' & ')});`);
        break;
      case 'nor':
        logicLines.push(`  assign ${outSignals[0]} = ~(${inSignals.join(' | ')});`);
        break;
      case 'xor':
        logicLines.push(`  assign ${outSignals[0]} = ${inSignals.join(' ^ ')};`);
        break;
      case 'xnor':
        logicLines.push(`  assign ${outSignals[0]} = ~(${inSignals.join(' ^ ')});`);
        break;
      case 'halfAdder':
        logicLines.push(`  assign ${outSignals[0]} = ${inSignals[0]} ^ ${inSignals[1]}; // Sum`);
        logicLines.push(`  assign ${outSignals[1]} = ${inSignals[0]} & ${inSignals[1]}; // Carry`);
        break;
      case 'fullAdder':
        logicLines.push(
          `  assign {${outSignals[1]}, ${outSignals[0]}} = ${inSignals[0]} + ${inSignals[1]} + ${inSignals[2]}; // Cout, Sum`
        );
        break;
      case 'halfSubtractor':
        logicLines.push(`  assign ${outSignals[0]} = ${inSignals[0]} ^ ${inSignals[1]}; // Diff`);
        logicLines.push(`  assign ${outSignals[1]} = ~${inSignals[0]} & ${inSignals[1]}; // Borrow`);
        break;
      case 'fullSubtractor':
        logicLines.push(
          `  assign {${outSignals[1]}, ${outSignals[0]}} = ${inSignals[0]} - ${inSignals[1]} - ${inSignals[2]}; // Bout, Diff`
        );
        break;
      case 'mux2':
        logicLines.push(`  assign ${outSignals[0]} = ${inSignals[2]} ? ${inSignals[1]} : ${inSignals[0]};`);
        break;
      case 'mux4':
        logicLines.push(
          `  assign ${outSignals[0]} = (${inSignals[5]} ? (${inSignals[4]} ? ${inSignals[3]} : ${inSignals[2]}) : (${inSignals[4]} ? ${inSignals[1]} : ${inSignals[0]}));`
        );
        break;
      case 'decoder2to4':
        logicLines.push(`  assign ${outSignals[0]} = ${inSignals[0]} & ~${inSignals[2]} & ~${inSignals[1]};`);
        logicLines.push(`  assign ${outSignals[1]} = ${inSignals[0]} & ~${inSignals[2]} & ${inSignals[1]};`);
        logicLines.push(`  assign ${outSignals[2]} = ${inSignals[0]} & ${inSignals[2]} & ~${inSignals[1]};`);
        logicLines.push(`  assign ${outSignals[3]} = ${inSignals[0]} & ${inSignals[2]} & ${inSignals[1]};`);
        break;
      case 'decoder3to8':
        for (let i = 0; i < 8; i++) {
          const bit0 = i & 1 ? inSignals[1] : `~${inSignals[1]}`;
          const bit1 = i & 2 ? inSignals[2] : `~${inSignals[2]}`;
          const bit2 = i & 4 ? inSignals[3] : `~${inSignals[3]}`;
          logicLines.push(`  assign ${outSignals[i]} = ${inSignals[0]} & (${bit2} & ${bit1} & ${bit0});`);
        }
        break;
      case 'dFlipFlop': {
        const regQ = `r_${sanitizeName(comp.label || 'dff')}_q`;
        sequentialBlocks.push(`  reg ${regQ} = 1'b0;
  always @(posedge ${inSignals[1]}) begin
    ${regQ} <= ${inSignals[0]};
  end
  assign ${outSignals[0]} = ${regQ};
  assign ${outSignals[1]} = ~${regQ};`);
        break;
      }
      case 'counter4': {
        const regCnt = `r_${sanitizeName(comp.label || 'cnt')}_val`;
        sequentialBlocks.push(`  reg [3:0] ${regCnt} = 4'b0000;
  always @(posedge ${inSignals[0]} or posedge ${inSignals[1]}) begin
    if (${inSignals[1]})
      ${regCnt} <= 4'b0000;
    else
      ${regCnt} <= ${regCnt} + 1'b1;
  end
  assign ${outSignals[0]} = ${regCnt}[0];
  assign ${outSignals[1]} = ${regCnt}[1];
  assign ${outSignals[2]} = ${regCnt}[2];
  assign ${outSignals[3]} = ${regCnt}[3];`);
        break;
      }
      case 'ram16x4': {
        const ramBlock = `mem_${sanitizeName(comp.label || 'ram')}`;
        sequentialBlocks.push(`  reg [3:0] ${ramBlock} [0:15];
  wire [3:0] addr_${sanitizeName(comp.id)} = {${inSignals[3]}, ${inSignals[2]}, ${inSignals[1]}, ${inSignals[0]}};
  wire [3:0] din_${sanitizeName(comp.id)} = {${inSignals[7]}, ${inSignals[6]}, ${inSignals[5]}, ${inSignals[4]}};
  always @(posedge ${inSignals[8]}) begin
    if (${inSignals[9]}) begin
      ${ramBlock}[addr_${sanitizeName(comp.id)}] <= din_${sanitizeName(comp.id)};
    end
  end
  assign {${outSignals[3]}, ${outSignals[2]}, ${outSignals[1]}, ${outSignals[0]}} = ${ramBlock}[addr_${sanitizeName(comp.id)}];`);
        break;
      }
      case 'subcircuit': {
        const subName = (comp.state.subcircuitCode || comp.state.subcircuitName || 'Custom_IC')
          .replace(/[^a-zA-Z0-9_]/g, '_');
        const portMaps = [
          ...comp.inputs.map((p, idx) => `    .${p.name.replace(/[^a-zA-Z0-9_]/g, '_') || `in_${idx}`}(${inSignals[idx]})`),
          ...comp.outputs.map((p, idx) => `    .${p.name.replace(/[^a-zA-Z0-9_]/g, '_') || `out_${idx}`}(${outSignals[idx]})`),
        ];
        logicLines.push(`  // Modüler Alt Devre Entegresi: ${comp.label || comp.id}\n  ${subName} inst_${comp.id.replace(/[^a-zA-Z0-9_]/g, '_')} (\n${portMaps.join(',\n')}\n  );`);
        break;
      }
      default:
        if (outSignals.length > 0 && inSignals.length > 0) {
          logicLines.push(`  assign ${outSignals[0]} = ${inSignals[0]}; // ${comp.type}`);
        }
        break;
    }
  });

  // Connect primary output ports from their drivers
  outputComps.forEach((comp) => {
    if (comp.type === 'led' || comp.type === 'probe' || comp.type === 'buzzer') {
      const driver = getWireDriver(comp.inputs[0]?.id);
      const portName = pinNameMap.get(comp.inputs[0]?.id);
      if (portName && portName !== driver) {
        logicLines.push(`  assign ${portName} = ${driver};`);
      }
    } else if (
      comp.type === 'sevenSegment' ||
      comp.type === 'hexDisplay' ||
      comp.type === 'ledBar4' ||
      comp.type === 'dotMatrix8x8' ||
      comp.type === 'rgbMatrix16x16'
    ) {
      comp.inputs.forEach((pin) => {
        const driver = getWireDriver(pin.id);
        const portIndexed = pinNameMap.get(pin.id);
        if (portIndexed) {
          logicLines.push(`  assign ${portIndexed} = ${driver};`);
        }
      });
    }
  });

  const allPorts = [...inputPorts, ...outputPorts];

  return `// =============================================================================
// Generated by LogicDesign Studio HDL Synthesis Engine
// Project: Sıfırdan İşlemciye (From Zero to CPU)
// Module: ${modName}
// Date: ${timestamp}
// Standard: IEEE 1364-2001 (Verilog HDL)
// =============================================================================

\`timescale 1ns / 1ps

module ${modName} (
${allPorts.length > 0 ? allPorts.map((p) => `  ${p}`).join(',\n') : '  // Devrede harici I/O portu yok'}
);

${
  internalWires.size > 0
    ? `  // Dahili Bağlantı Hatları (Internal Wires)\n` +
      Array.from(internalWires)
        .map((w) => `  wire ${w};`)
        .join('\n') +
      '\n'
    : ''
}
${
  logicLines.length > 0
    ? `  // Kombinasyonel Mantık İfadeleri (Continuous Assignments)\n` +
      logicLines.join('\n') +
      '\n'
    : ''
}
${
  sequentialBlocks.length > 0
    ? `  // Ardışıl Mantık Blokları (Sequential Registers & Memory)\n` +
      sequentialBlocks.join('\n\n') +
      '\n'
    : ''
}
endmodule
`;
}

export function generateVHDL(
  circuitName: string,
  components: CircuitComponentInstance[],
  canvasWires: CircuitWire[]
): string {
  // Driver lookups need pin-to-pin connections; canvas wires are positional segments
  const wires = getLogicalConnections(components, canvasWires);
  const entityName = sanitizeName(circuitName || 'digital_circuit');
  const timestamp = new Date().toISOString();

  const inputComps = components.filter((c) =>
    ['switch', 'pushbutton', 'clock', 'vcc', 'gnd', 'dipSwitch4'].includes(c.type)
  );
  const outputComps = components.filter((c) =>
    ['led', 'probe', 'buzzer', 'sevenSegment', 'hexDisplay', 'ledBar4'].includes(c.type)
  );
  const internalComps = components.filter(
    (c) => !inputComps.includes(c) && !outputComps.includes(c)
  );

  const pinNameMap = new Map<string, string>();
  const portDecls: string[] = [];

  inputComps.forEach((c) => {
    const baseName = sanitizeName(c.label || c.type);
    if (c.type === 'clock') {
      const pName = baseName.includes('clk') ? baseName : `clk_${baseName}`;
      portDecls.push(`${pName} : in std_logic`);
      pinNameMap.set(c.outputs[0]?.id, pName);
    } else if (c.type === 'dipSwitch4') {
      const pName = `in_${baseName}`;
      portDecls.push(`${pName} : in std_logic_vector(3 downto 0)`);
      c.outputs.forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}(${idx})`);
      });
    } else if (c.type === 'asciiKeyboard') {
      const pName = `kbd_${baseName}`;
      portDecls.push(`${pName}_data : in std_logic_vector(6 downto 0)`);
      portDecls.push(`${pName}_strobe : in std_logic`);
      c.outputs.slice(0, 7).forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}_data(${idx})`);
      });
      if (c.outputs[7]) {
        pinNameMap.set(c.outputs[7].id, `${pName}_strobe`);
      }
    } else if (c.type === 'switch' || c.type === 'pushbutton') {
      const pName = `in_${baseName}`;
      portDecls.push(`${pName} : in std_logic`);
      pinNameMap.set(c.outputs[0]?.id, pName);
    } else if (c.type === 'vcc') {
      pinNameMap.set(c.outputs[0]?.id, "'1'");
    } else if (c.type === 'gnd') {
      pinNameMap.set(c.outputs[0]?.id, "'0'");
    }
  });

  outputComps.forEach((c) => {
    const baseName = sanitizeName(c.label || c.type);
    if (c.type === 'led' || c.type === 'probe' || c.type === 'buzzer') {
      const pName = `out_${baseName}`;
      portDecls.push(`${pName} : out std_logic`);
      pinNameMap.set(c.inputs[0]?.id, pName);
    } else if (c.type === 'ledBar4') {
      const pName = `out_${baseName}`;
      portDecls.push(`${pName} : out std_logic_vector(3 downto 0)`);
      c.inputs.forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}(${idx})`);
      });
    } else if (c.type === 'sevenSegment') {
      const pName = `out_seg_${baseName}`;
      portDecls.push(`${pName} : out std_logic_vector(6 downto 0)`);
      c.inputs.forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}(${idx})`);
      });
    } else if (c.type === 'hexDisplay') {
      const pName = `out_hex_${baseName}`;
      portDecls.push(`${pName} : out std_logic_vector(3 downto 0)`);
      c.inputs.forEach((pin, idx) => {
        pinNameMap.set(pin.id, `${pName}(${idx})`);
      });
    } else if (c.type === 'dotMatrix8x8') {
      const pName = `disp_${baseName}`;
      portDecls.push(`${pName}_rows : out std_logic_vector(7 downto 0)`);
      portDecls.push(`${pName}_cols : out std_logic_vector(7 downto 0)`);
      c.inputs.slice(0, 8).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_rows(${idx})`));
      c.inputs.slice(8, 16).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_cols(${idx})`));
    } else if (c.type === 'rgbMatrix16x16') {
      const pName = `gpu_${baseName}`;
      portDecls.push(`${pName}_x : out std_logic_vector(3 downto 0)`);
      portDecls.push(`${pName}_y : out std_logic_vector(3 downto 0)`);
      portDecls.push(`${pName}_rgb : out std_logic_vector(2 downto 0)`);
      portDecls.push(`${pName}_we : out std_logic`);
      c.inputs.slice(0, 4).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_x(${idx})`));
      c.inputs.slice(4, 8).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_y(${idx})`));
      c.inputs.slice(8, 11).forEach((pin, idx) => pinNameMap.set(pin.id, `${pName}_rgb(${idx})`));
      if (c.inputs[11]) pinNameMap.set(c.inputs[11].id, `${pName}_we`);
    }
  });

  const getWireDriver = (pinId: string): string => {
    const w = wires.find((wire) => wire.toPinId === pinId);
    if (!w) return "'0'";
    if (pinNameMap.has(w.fromPinId)) return pinNameMap.get(w.fromPinId)!;
    return getSignalName(w.fromCompId, w.fromPinId, components, pinNameMap);
  };

  const internalSignals = new Set<string>();
  const assignments: string[] = [];

  internalComps.forEach((comp) => {
    const inSignals = comp.inputs.map((p) => getWireDriver(p.id));
    const outSignals = comp.outputs.map((p) => {
      const outName = getSignalName(comp.id, p.id, components, pinNameMap);
      if (!Array.from(portDecls).some((op) => op.includes(outName)) && !outName.startsWith("'")) {
        internalSignals.add(outName);
      }
      return outName;
    });

    switch (comp.type) {
      case 'not':
        assignments.push(`  ${outSignals[0]} <= not ${inSignals[0]};`);
        break;
      case 'and':
        assignments.push(`  ${outSignals[0]} <= ${inSignals.join(' and ')};`);
        break;
      case 'or':
        assignments.push(`  ${outSignals[0]} <= ${inSignals.join(' or ')};`);
        break;
      case 'nand':
        assignments.push(`  ${outSignals[0]} <= not (${inSignals.join(' and ')});`);
        break;
      case 'nor':
        assignments.push(`  ${outSignals[0]} <= not (${inSignals.join(' or ')});`);
        break;
      case 'xor':
        assignments.push(`  ${outSignals[0]} <= ${inSignals.join(' xor ')};`);
        break;
      case 'xnor':
        assignments.push(`  ${outSignals[0]} <= not (${inSignals.join(' xor ')});`);
        break;
      case 'halfAdder':
        assignments.push(`  ${outSignals[0]} <= ${inSignals[0]} xor ${inSignals[1]}; -- Sum`);
        assignments.push(`  ${outSignals[1]} <= ${inSignals[0]} and ${inSignals[1]}; -- Carry`);
        break;
      case 'mux2':
        assignments.push(`  ${outSignals[0]} <= ${inSignals[1]} when ${inSignals[2]} = '1' else ${inSignals[0]};`);
        break;
      case 'subcircuit': {
        const subName = (comp.state.subcircuitCode || comp.state.subcircuitName || 'Custom_IC')
          .replace(/[^a-zA-Z0-9_]/g, '_');
        const portMaps = [
          ...comp.inputs.map((p, idx) => `    ${p.name.replace(/[^a-zA-Z0-9_]/g, '_') || `in_${idx}`} => ${inSignals[idx]}`),
          ...comp.outputs.map((p, idx) => `    ${p.name.replace(/[^a-zA-Z0-9_]/g, '_') || `out_${idx}`} => ${outSignals[idx]}`),
        ];
        assignments.push(`  -- Modüler Alt Devre Entegresi: ${comp.label || comp.id}\n  inst_${comp.id.replace(/[^a-zA-Z0-9_]/g, '_')}: entity work.${subName}\n    port map (\n${portMaps.join(',\n')}\n    );`);
        break;
      }
      default:
        if (outSignals.length > 0 && inSignals.length > 0) {
          assignments.push(`  ${outSignals[0]} <= ${inSignals[0]}; -- ${comp.type}`);
        }
        break;
    }
  });

  outputComps.forEach((comp) => {
    if (comp.type === 'led' || comp.type === 'probe' || comp.type === 'buzzer') {
      const driver = getWireDriver(comp.inputs[0]?.id);
      const portName = pinNameMap.get(comp.inputs[0]?.id);
      if (portName && portName !== driver) {
        assignments.push(`  ${portName} <= ${driver};`);
      }
    } else if (
      comp.type === 'sevenSegment' ||
      comp.type === 'hexDisplay' ||
      comp.type === 'ledBar4' ||
      comp.type === 'dotMatrix8x8' ||
      comp.type === 'rgbMatrix16x16'
    ) {
      comp.inputs.forEach((pin) => {
        const driver = getWireDriver(pin.id);
        const portIndexed = pinNameMap.get(pin.id);
        if (portIndexed) {
          assignments.push(`  ${portIndexed} <= ${driver};`);
        }
      });
    }
  });

  return `-- =============================================================================
-- Generated by LogicDesign Studio HDL Synthesis Engine
-- Project: Sıfırdan İşlemciye (From Zero to CPU)
-- Entity: ${entityName}
-- Date: ${timestamp}
-- Standard: IEEE 1076-2008 (VHDL)
-- =============================================================================

library IEEE;
use IEEE.STD_LOGIC_1164.ALL;
use IEEE.NUMERIC_STD.ALL;

entity ${entityName} is
  port (
${portDecls.length > 0 ? portDecls.map((p) => `    ${p}`).join(';\n') : '    -- Harici port bulunamadı'}
  );
end entity ${entityName};

architecture Behavioral of ${entityName} is
${
  internalSignals.size > 0
    ? `  -- Dahili Sinyaller (Internal Signals)\n` +
      Array.from(internalSignals)
        .map((s) => `  signal ${s} : std_logic;`)
        .join('\n') +
      '\n'
    : ''
}
begin
${
  assignments.length > 0
    ? `  -- Mantıksal Sinyal Atamaları (Concurrent Statements)\n` +
      assignments.join('\n') +
      '\n'
    : ''
}
end architecture Behavioral;
`;
}
