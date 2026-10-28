import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import { getTopLevelPorts, type PortDecl } from './hdlGenerator';

export interface FpgaBoardProfile {
  id: string;
  name: string;
  vendor: 'Xilinx' | 'Intel' | 'Lattice';
  fpgaChip: string;
  format: 'xdc' | 'qsf' | 'pcf';
  clockPin: string;
  clockFreqMhz: number;
  switchPins: string[];
  buttonPins: string[];
  ledPins: string[];
  sevenSegPins: {
    segments: string[]; // a, b, c, d, e, f, g, dp
    anodes: string[];   // an0, an1, an2, an3...
  };
}

export const FPGA_BOARDS: FpgaBoardProfile[] = [
  {
    id: 'basys3',
    name: 'Digilent Basys 3 (Artix-7)',
    vendor: 'Xilinx',
    fpgaChip: 'xc7a35tcpg236-1',
    format: 'xdc',
    clockPin: 'W5',
    clockFreqMhz: 100,
    switchPins: ['V17', 'V16', 'W16', 'W17', 'W15', 'V15', 'W14', 'W13', 'V2', 'T3', 'T2', 'R3', 'W2', 'U1', 'T1', 'R2'],
    buttonPins: ['U18', 'T18', 'W19', 'T17', 'U17'], // Center, Up, Left, Right, Down
    ledPins: ['U16', 'E19', 'U19', 'V19', 'W18', 'U15', 'U14', 'V14', 'V13', 'V3', 'W3', 'U3', 'P3', 'N3', 'P1', 'L1'],
    sevenSegPins: {
      segments: ['W7', 'W6', 'U8', 'V8', 'U5', 'V5', 'U7', 'V7'], // CA, CB, CC, CD, CE, CF, CG, DP
      anodes: ['U2', 'U4', 'V4', 'W4'],
    },
  },
  {
    id: 'nexys_a7',
    name: 'Digilent Nexys A7-100T (Artix-7)',
    vendor: 'Xilinx',
    fpgaChip: 'xc7a100tcsg324-1',
    format: 'xdc',
    clockPin: 'E3',
    clockFreqMhz: 100,
    switchPins: ['J15', 'L16', 'M13', 'R15', 'R17', 'T18', 'U18', 'R13', 'T8', 'U8', 'R16', 'T13', 'H6', 'U12', 'U11', 'V10'],
    buttonPins: ['N17', 'M18', 'P17', 'M17', 'P18'],
    ledPins: ['H17', 'K15', 'J13', 'N14', 'R18', 'V17', 'U17', 'U16', 'V16', 'T15', 'U14', 'T16', 'V15', 'V14', 'V12', 'V11'],
    sevenSegPins: {
      segments: ['T10', 'R10', 'K16', 'K13', 'P15', 'T11', 'L18', 'H15'],
      anodes: ['J17', 'J18', 'T19', 'J14', 'P14', 'T14', 'K2', 'U13'],
    },
  },
  {
    id: 'de10_lite',
    name: 'Terasic DE10-Lite (Altera/Intel MAX 10)',
    vendor: 'Intel',
    fpgaChip: '10M50DAF484C7G',
    format: 'qsf',
    clockPin: 'PIN_P11',
    clockFreqMhz: 50,
    switchPins: ['PIN_C10', 'PIN_C11', 'PIN_D12', 'PIN_C12', 'PIN_A12', 'PIN_B12', 'PIN_A13', 'PIN_A14', 'PIN_B14', 'PIN_F15'],
    buttonPins: ['PIN_B8', 'PIN_A7'],
    ledPins: ['PIN_A8', 'PIN_A9', 'PIN_A10', 'PIN_B10', 'PIN_D13', 'PIN_C13', 'PIN_E14', 'PIN_D14', 'PIN_A11', 'PIN_B11'],
    sevenSegPins: {
      segments: ['PIN_C14', 'PIN_E15', 'PIN_C15', 'PIN_C16', 'PIN_E16', 'PIN_D17', 'PIN_C17', 'PIN_D15'],
      anodes: ['PIN_C18', 'PIN_D18', 'PIN_E18', 'PIN_B16', 'PIN_A17', 'PIN_A18'],
    },
  },
  {
    id: 'pynq_z2',
    name: 'TUL PYNQ-Z2 (Zynq-7020)',
    vendor: 'Xilinx',
    fpgaChip: 'xc7z020clg400-1',
    format: 'xdc',
    clockPin: 'H16',
    clockFreqMhz: 125,
    switchPins: ['M20', 'M19'],
    buttonPins: ['D19', 'D20', 'L20', 'L19'],
    ledPins: ['R14', 'P14', 'N16', 'M14'],
    sevenSegPins: {
      segments: ['W14', 'Y14', 'T11', 'T10', 'V16', 'W16', 'V12', 'W13'],
      anodes: ['P18', 'N17', 'M17', 'P17'],
    },
  },
];

/**
 * Generate synthesis-ready FPGA pin constraints file (.xdc for Vivado or .qsf for Quartus).
 * Port names come from the HDL generator so the constraints always match the exported module.
 * Board resources are handed out in order and never reused; ports left over are listed as unassigned.
 */
export function generateFpgaConstraints(
  boardId: string,
  components: CircuitComponentInstance[],
  wires: CircuitWire[] = [],
  circuitName = 'digital_circuit'
): { content: string; filename: string; boardName: string } {
  const board = FPGA_BOARDS.find((b) => b.id === boardId) || FPGA_BOARDS[0];
  const now = new Date().toISOString();
  const ports = getTopLevelPorts(circuitName, components, wires);
  const isQsf = board.format === 'qsf';
  const c = isQsf ? '#' : '##';

  const pools = {
    switch: [...board.switchPins],
    button: [...board.buttonPins],
    led: [...board.ledPins],
  };
  const sections: { title: string; entries: { port: string; pin: string }[] }[] = [];
  const unassigned: string[] = [];
  const notes: string[] = [];
  let clockPort: string | null = null;

  const bitName = (p: PortDecl, i: number) => (p.width > 1 ? `${p.name}[${i}]` : p.name);
  const assign = (title: string, pool: string[], p: PortDecl) => {
    let section = sections.find((s) => s.title === title);
    if (!section) {
      section = { title, entries: [] };
      sections.push(section);
    }
    for (let i = 0; i < p.width; i++) {
      const pin = pool.shift();
      if (pin) section.entries.push({ port: bitName(p, i), pin });
      else unassigned.push(bitName(p, i));
    }
  };

  let sevenSegUsed = false;
  for (const p of ports) {
    const type = p.source?.type;
    if (type === 'clock') {
      if (!clockPort) clockPort = p.name;
      else unassigned.push(p.name);
    } else if (type === 'switch' || type === 'dipSwitch4') {
      assign('Kayar anahtarlar (Switches)', pools.switch, p);
    } else if (type === 'pushbutton') {
      assign('Butonlar (Push Buttons)', pools.button.length ? pools.button : pools.switch, p);
    } else if (type === 'led' || type === 'probe' || type === 'ledBar4') {
      assign('LED çıkışları', pools.led, p);
    } else if (type === 'sevenSegment' && !sevenSegUsed) {
      sevenSegUsed = true;
      assign('7-segment ekran (a..g, dp)', [...board.sevenSegPins.segments], p);
      notes.push(
        `Kart üzerindeki 7-segment ekranın segment girişleri ve hane seçici (anot) uçları çoğunlukla aktif-düşüktür; ` +
          `bu tasarımda anot çıkışı yok, ekranı yakmak için ilgili anodu 0'a sürün veya segmentleri tersleyin.`
      );
    } else {
      for (let i = 0; i < p.width; i++) unassigned.push(bitName(p, i));
    }
  }

  const lines: string[] = [
    `${c} =============================================================================`,
    `${c} Generated by LogicDesign Studio FPGA Constraints Generator`,
    `${c} Target Board: ${board.name}`,
    `${c} Target Device: ${board.fpgaChip}`,
    `${c} Date: ${now}`,
    `${c} Standard: ${isQsf ? 'Intel Quartus Prime Pin Assignments (.qsf)' : 'Xilinx Vivado Physical Design Constraints (.xdc)'}`,
    `${c} =============================================================================`,
    '',
  ];
  const pinLine = (port: string, pin: string) =>
    isQsf
      ? [`set_location_assignment ${pin} -to ${port}`, `set_instance_assignment -name IO_STANDARD "3.3-V LVTTL" -to ${port}`]
      : [`set_property -dict { PACKAGE_PIN ${pin}   IOSTANDARD LVCMOS33 } [get_ports { ${port} }];`];

  if (clockPort) {
    lines.push(`${c} Saat girişi: kartın ${board.clockFreqMhz} MHz osilatörü (devre bu hızda çalışır)`);
    lines.push(...pinLine(clockPort, board.clockPin));
    if (!isQsf) {
      const periodNs = (1000 / board.clockFreqMhz).toFixed(2);
      lines.push(`create_clock -add -name sys_clk_pin -period ${periodNs} -waveform {0 ${(Number(periodNs) / 2).toFixed(2)}} [get_ports { ${clockPort} }];`);
    }
    lines.push('');
  }
  for (const s of sections) {
    if (s.entries.length === 0) continue;
    lines.push(`${c} ${s.title}`);
    for (const e of s.entries) lines.push(...pinLine(e.port, e.pin));
    lines.push('');
  }
  if (unassigned.length > 0) {
    lines.push(`${c} UYARI: kartta karşılığı kalmayan portlar (elle atayın):`);
    lines.push(...unassigned.map((u) => `${c}   ${u}`), '');
  }
  for (const n of notes) lines.push(`${c} NOT: ${n}`);
  if (notes.length) lines.push('');
  if (ports.length === 0) lines.push(`${c} Devrede harici giriş/çıkış portu yok.`, '');

  if (!isQsf) {
    lines.push(`${c} Bitstream Configuration Options`);
    lines.push(`set_property CONFIG_VOLTAGE 3.3 [current_design]`);
    lines.push(`set_property CFGBVS VCCO [current_design]`);
  }

  return {
    content: lines.join('\n'),
    filename: `${board.id}_pins.${isQsf ? 'qsf' : 'xdc'}`,
    boardName: board.name,
  };
}
