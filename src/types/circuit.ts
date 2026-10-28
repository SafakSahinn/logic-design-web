import type { SignalValue } from './logic';

export type ComponentCategory = 'inputs' | 'gates' | 'outputs' | 'combinational' | 'sequential' | 'custom';

export type ComponentType =
  // Inputs
  | 'switch'
  | 'pushbutton'
  | 'clock'
  | 'vcc'
  | 'gnd'
  | 'tunnel'
  | 'dipSwitch4'
  | 'asciiKeyboard'
  // Basic Gates
  | 'not'
  | 'and'
  | 'or'
  | 'nand'
  | 'nor'
  | 'xor'
  | 'xnor'
  | 'triState'
  // Outputs
  | 'led'
  | 'probe'
  | 'buzzer'
  | 'textLabel'
  | 'sevenSegment'
  | 'hexDisplay'
  | 'ledBar4'
  | 'dotMatrix8x8'
  | 'rgbMatrix16x16'
  // Combinational Blocks
  | 'halfAdder'
  | 'fullAdder'
  | 'halfSubtractor'
  | 'fullSubtractor'
  | 'mux2'
  | 'mux4'
  | 'mux8'
  | 'demux2'
  | 'demux4'
  | 'decoder2to4'
  | 'decoder3to8'
  | 'bcdTo7Seg'
  | 'priorityEncoder4to2'
  | 'comparator4'
  | 'alu4'
  | 'splitter4'
  // Sequential & Memory Elements (Ardışıl Mantık & Bellek)
  | 'dFlipFlop'
  | 'tFlipFlop'
  | 'jkFlipFlop'
  | 'srLatch'
  | 'counter4'
  | 'register4'
  | 'shiftRegister4'
  | 'ram16x4'
  | 'rom16x4'
  // Modular Subcircuits (Özel Alt Devre & IC Paketleme)
  | 'subcircuit';

export interface PinDefinition {
  id: string;
  name: string;
  type: 'input' | 'output';
  relX: number; // px relative to component origin
  relY: number;
}

export interface ComponentMetadata {
  type: ComponentType;
  name: string;
  category: ComponentCategory;
  width: number;
  height: number;
  inputs: PinDefinition[];
  outputs: PinDefinition[];
  description: string;
}

export interface CircuitPin {
  id: string; // e.g. "comp1_in_0"
  name: string;
  type: 'input' | 'output';
  value: SignalValue;
  x: number; // absolute canvas coordinates
  y: number;
}

export interface CircuitComponentInstance {
  id: string;
  type: ComponentType;
  label?: string;
  x: number;
  y: number;
  rotation?: 0 | 90 | 180 | 270;
  inputs: CircuitPin[];
  outputs: CircuitPin[];
  state: {
    on?: boolean;
    /** Set on an input source inside an IC: it drives this value from outside (x/E included) instead of `on` */
    portValue?: SignalValue;
    frequencyHz?: number;
    /** Clock's own rate chosen in its toolbar; unset = follow the global clock speed */
    clockRateHz?: number;
    lastClockTick?: number;
    ledColor?: 'green' | 'red' | 'blue' | 'yellow';
    q?: SignalValue;
    qBar?: SignalValue;
    lastClk?: SignalValue;
    hexVal?: number;
    count?: number;
    regVal?: number;
    regBits?: SignalValue[];
    ramData?: number[];
    romData?: number[];
    aluResult?: number;
    hiZ?: boolean;
    gateInputsCount?: number;
    dipSwitches?: boolean[];
    subcircuitId?: string;
    subcircuitName?: string;
    subcircuitCode?: string;
    // Internal parts of this IC instance as of the last evaluation, so latches/flip-flops inside keep their state
    subcircuitInternal?: { components: CircuitComponentInstance[]; wires: CircuitWire[] };
    // The IC's internal circuit did not settle in its last evaluation
    oscillating?: boolean;
    matrixGrid?: boolean[][];
    rgbPixels?: string[][];
    asciiChar?: string;
    asciiCode?: number;
    strobe?: boolean;
    buzzerNote?: number;
    labelPos?: 'top' | 'bottom' | 'center' | 'hidden';
  };
}

export interface SubcircuitPortDefinition {
  id: string; // pin id on the IC, e.g. "port_in_0"
  name: string; // pin label, e.g. "A", "B", "CLK", "OUT", "C"
  type: 'input' | 'output';
  targetCompId: string; // internal component id (e.g. "sw_A" or "led_out")
  targetPinId: string; // internal pin id
}

export interface CustomSubcircuit {
  id: string; // unique id, e.g. "sub_half_adder_172000"
  name: string; // display name, e.g. "Yarım Toplayıcı (HA)"
  chipCode?: string; // e.g. "IC-HA01"
  description: string;
  category: 'custom';
  color?: string;
  width: number;
  height: number;
  ports: SubcircuitPortDefinition[];
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  createdAt: number;
}

export interface CircuitAnnotation {
  id: string;
  type: 'frame' | 'note';
  title: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: 'blue' | 'emerald' | 'amber' | 'purple' | 'rose' | 'slate';
}

export interface CircuitWire {
  id: string;
  fromCompId: string;
  fromPinId: string;
  toCompId: string;
  toPinId: string;
  value: SignalValue;
  hasConflict?: boolean;
  // Still changing when the simulation gave up settling (Logisim's oscillation points)
  oscillating?: boolean;
  branchPoint?: { x: number; y: number };
  isBus?: boolean;
  bitWidth?: number;
  busValue?: number;
  jointOffset?: number; // Manhattan orta segment ofseti (px)
  elbowX?: number; // Manhattan dirsek X koordinatı
  sourceWireId?: string;
  waypoints?: { x: number; y: number }[];
  elbowY?: number; // Manhattan dirsek Y koordinatı
  endPoint?: { x: number; y: number }; // Serbest tuval bitiş noktası
  startPoint?: { x: number; y: number }; // Serbest tuval başlangıç noktası
}

export interface CircuitPreset {
  id: string;
  name: string;
  category?: 'basic' | 'arithmetic' | 'sequential' | 'bus' | 'music_graphics';
  description: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
}

export interface TruthTableData {
  inputs: { id: string; name: string }[];
  outputs: { id: string; name: string }[];
  booleanExpressions?: { [outputName: string]: string };
  minimalExpressions?: {
    [outputName: string]: {
      expression: string;
      primeImplicants: string[];
      essentialImplicants: string[];
    };
  };
  rows: {
    inputValues: SignalValue[];
    outputValues: SignalValue[];
    isCurrentState?: boolean;
  }[];
  // Caveats shown above the table (inputs left out, stateful parts)
  notes?: string[];
}
