import type { Radix, SignalValue } from './logic';

export type ComponentCategory = 'inputs' | 'gates' | 'outputs' | 'combinational' | 'sequential' | 'custom';

export type ComponentType =
  // Inputs
  | 'switch'
  | 'pushbutton'
  | 'clock'
  | 'vcc'
  | 'gnd'
  | 'constant'
  | 'tunnel'
  | 'pullResistor'
  | 'dipSwitch4'
  | 'asciiKeyboard'
  // Basic Gates
  | 'not'
  | 'buffer'
  | 'and'
  | 'or'
  | 'nand'
  | 'nor'
  | 'xor'
  | 'xnor'
  | 'triState'
  | 'controlledInverter'
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
  | 'splitter'
  | 'bitExtender'
  | 'bitSelector'
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
  /** Bit width of the pin (Logisim BitWidth); unset = 1 */
  width?: number;
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
  /** Bit width of the pin; unset = 1 */
  width?: number;
  /** Bits of a pin wider than 1, LSB first (`value` then holds summarizeBits of them) */
  bits?: SignalValue[];
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
    /** Switch wider than 1 bit: its value as an unsigned number (bit i = input bit i) */
    inputValue?: number;
    /** Constant: its value as an unsigned number (Logisim 'value'); unset = 1 */
    constValue?: number;
    /** Probe: display base (Logisim 'radix'); unset = binary */
    radix?: Radix;
    /** Set on an input source inside an IC: it drives this value from outside (x/E included) instead of `on` */
    portValue?: SignalValue;
    /** Same for a wide input source inside an IC: the bits (LSB first) driven from outside instead of `inputValue` */
    portBits?: SignalValue[];
    frequencyHz?: number;
    /** Clock's own rate chosen in its toolbar; unset = follow the global clock speed */
    clockRateHz?: number;
    lastClockTick?: number;
    ledColor?: 'green' | 'red' | 'blue' | 'yellow';
    /** Splitter: end of each incoming bit, LSB first (0 = none, 1..fanout; Logisim bit0..bitN); unset = default spread of 2 bits */
    splitBitEnd?: number[];
    /** Splitter: side the ends sit on relative to the combined end (Logisim 'appear'); unset = left */
    splitAppear?: 'left' | 'right' | 'center';
    /** Bit extender: how the extra high bits are filled (Logisim 'type'); unset = zero */
    extendType?: 'zero' | 'one' | 'sign' | 'input';
    /** Pull resistor: level an otherwise undriven net is pulled to (Logisim 'pull'); unset = 0 */
    pullValue?: 0 | 1 | 'X';
    /** Gate output value (Logisim 'out'): 0Z = open collector, Z1 = open emitter; unset = 01 */
    outputMode?: '01' | '0Z' | 'Z1';
    /** Gate inputs (0-based) whose value is inverted before the gate reads it (Logisim 'negateN'); unset = none */
    negated?: number[];
    /** XOR/XNOR with more than two inputs: odd = parity (odd number of 1s), one = exactly one 1 (Logisim 'xor'); unset = odd */
    xorMode?: 'odd' | 'one';
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
  /** Bit width of the port, taken from the inner pin when packaged (Logisim: the inner Pin's width); unset = 1 */
  width?: number;
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
  /** Bit width of the wire's net, taken from the pins on it (unset = 1) */
  width?: number;
  /** Bits of a net wider than 1, LSB first (`value` then holds summarizeBits of them) */
  bits?: SignalValue[];
  /** Pins of different widths meet on this net (Logisim "Incompatible widths"); the net reads x */
  widthError?: boolean;
  /** Distinct pin widths meeting on a width-error net, ascending (shown as "Uyumsuz genişlik: 8 / 4") */
  widthList?: number[];
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

// Truth-table output cell as in Logisim-evolution: '-' = don't care (output X or Z),
// 'E' = conflicting drivers, '@' = the circuit oscillates for this row
export type TruthTableEntry = 0 | 1 | '-' | 'E' | '@';

// One truth-table column = one bit. A part wider than 1 bit gives one column per bit, MSB first
// (Logisim-evolution Analyze: "A[2] A[1] A[0]"); its columns share `group` (the part's name) and `width`.
export interface TruthTableColumn {
  id: string;
  name: string;
  /** Part the bit belongs to (input switch, output LED/probe or logic part) */
  compId?: string;
  /** Bit index within the part's pin (0 = LSB); 0 for 1-bit parts */
  bit?: number;
  /** Set on the columns of a part wider than 1 bit: the part's name, shown as a header over its bits */
  group?: string;
  width?: number;
}

export interface TruthTableData {
  inputs: TruthTableColumn[];
  outputs: TruthTableColumn[];
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
    outputValues: TruthTableEntry[];
    isCurrentState?: boolean;
  }[];
  // Caveats shown above the table (inputs left out, stateful parts)
  notes?: string[];
}
