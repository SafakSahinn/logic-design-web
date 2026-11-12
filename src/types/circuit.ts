import type { Radix, SignalValue } from './logic';

export type ComponentCategory = 'inputs' | 'gates' | 'outputs' | 'combinational' | 'arithmetic' | 'sequential' | 'ttl' | 'custom';

// 7400-series TTL chips (Logisim-evolution std/ttl, Aşama 4); the part type is 'ttl' + the evolution id
export const TTL_CHIP_IDS = [
  '7400', '7402', '7404', '7405', '7408', '7410', '7411', '7413', '7414', '7418', '7419', '7420', '7421', '7424',
  '7427', '7430', '7432', '7434', '7436', '7438', '7447', '7451', '7454', '7458', '7464', '7485', '7486', '7487',
  '74132', '74138', '74139', '74148', '74151', '74153', '74157', '74266', '74283',
  '7474', '7476', '74161', '74194',
] as const;
export type TtlChipId = (typeof TTL_CHIP_IDS)[number];
export type TtlType = `ttl${TtlChipId}`;

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
  // Parametric DIP switch (Logisim-evolution DipSwitch, Aşama 3g)
  | 'dipSwitch'
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
  // Parametric displays (Logisim std/io HexDigit, DotMatrix; evolution LedBar; Aşama 3g)
  | 'hexDigit'
  | 'ledBar'
  | 'dotMatrix'
  | 'rgbMatrix16x16'
  // Combinational Blocks
  | 'halfAdder'
  | 'fullAdder'
  | 'halfSubtractor'
  | 'fullSubtractor'
  | 'bcdTo7Seg'
  | 'multiplexer'
  | 'demultiplexer'
  | 'decoder'
  | 'priorityEncoder'
  | 'adder'
  | 'subtractor'
  | 'multiplier'
  | 'divider'
  | 'negator'
  | 'absolute'
  | 'comparator'
  | 'minMax'
  | 'shifter'
  | 'squareRoot'
  | 'exponentiator'
  | 'bitAdder'
  | 'bitFinder'
  | 'alu'
  | 'splitter4'
  | 'splitter'
  | 'bitExtender'
  | 'bitSelector'
  // Sequential & Memory Elements (Ardışıl Mantık & Bellek)
  | 'srLatch'
  // Parametric memory (Logisim std/memory, Aşama 3e)
  | 'flipFlopD'
  | 'flipFlopT'
  | 'flipFlopJK'
  | 'flipFlopSR'
  | 'register'
  | 'counter'
  | 'shiftRegister'
  // Parametric RAM / ROM / random generator (Logisim std/memory, Aşama 3f)
  | 'ram'
  | 'rom'
  | 'random'
  // Logisim-evolution 5 dual-port RAM (Aşama 3f-5)
  | 'dualRam'
  // Modular Subcircuits (Özel Alt Devre & IC Paketleme)
  | 'subcircuit'
  | TtlType;

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
    /** Plexers (MUX/DEMUX/decoder/priority encoder): output value while disabled by enable 0 (Logisim 'disabled'): 0 or floating (x); unset = 0 */
    plexDisabled?: '0' | 'Z';
    /** Demultiplexer/decoder: unselected outputs float (x) instead of 0 (Logisim 'tristate'); unset = false */
    plexTristate?: boolean;
    /** Switch: three-state input pin (Logisim Pin 'tristate'): starts floating and a click cycles 0 → 1 → Z; unset = false */
    pinTristate?: boolean;
    /** Plexers: select (and enable) pins on the bottom/left side or the top/right side (Logisim 'selloc'); unset = bl */
    selectLoc?: 'bl' | 'tr';
    /** Arithmetic parts: how operands are read (Logisim 'mode'): two's complement, signed A x unsigned B (multiplier), unsigned; unset = signed for the comparator, unsigned otherwise */
    arithMode?: 'signed' | 'signedUnsigned' | 'unsigned';
    /** Shifter: logical left/right, arithmetic right, rotate left/right (Logisim 'shift'); unset = ll */
    shiftType?: 'll' | 'lr' | 'ar' | 'rl' | 'rr';
    /** Bit finder: which bit it looks for (Logisim 'type'); unset = low1 */
    findType?: 'low1' | 'high1' | 'low0' | 'high0';
    /** Flip-flops / register: when the clock acts (Logisim 'trigger'): edges or levels (D, S-R, register); T, J-K, counter and shift register edges only; unset = rising */
    trigger?: 'rising' | 'falling' | 'high' | 'low';
    /** Counter: largest value (Logisim 'max'), unsigned; unset = all bits 1 */
    counterMax?: number;
    /** Counter: what a count past the goal does (Logisim 'ongoal'); unset = wrap */
    counterGoal?: 'wrap' | 'stay' | 'continue' | 'load';
    /** Shift register: parallel load and stage outputs (Logisim 'parallel'); unset = true */
    shiftParallel?: boolean;
    /** Shift register: number of stages (Logisim 'length', 1-32); unset = 8 */
    shiftLength?: number;
    /** Register / counter: stored value, LSB first (x / E bits kept, evolution) */
    seqBits?: SignalValue[];
    /** Shift register: stage values, stage 0 = the one the serial input enters, last = OUT; each LSB first */
    shiftStages?: SignalValue[][];
    /**
     * RAM / ROM: whose rules the part follows. 'logisim' = Logisim 2.7.1 (chip select pin; RAM bus modes
     * combined / asynch / separate, rising edge); 'evolution' = Logisim-evolution (no chip select; RAM write
     * enable pin, trigger, clocked or asynchronous read, byte enables, optional clear pin). Unset = logisim
     */
    memFlavor?: 'logisim' | 'evolution';
    /** RAM, Logisim 2.7.1 flavor: data bus (Logisim 'bus'); unset = combined */
    ramBus?: 'combined' | 'asynch' | 'separate';
    /** RAM, evolution flavor: data bus (evolution 'databus': bidir / bibus / bibusControlled); unset = separate */
    ramDataBus?: 'bidir' | 'separate' | 'controlled';
    /** RAM, evolution flavor: read without the clock (evolution 'asyncread'); unset = false */
    ramAsyncRead?: boolean;
    /** RAM, evolution flavor, clocked read: the value read at the edge is the one after the write ('raw') or before it ('war'); unset = raw */
    ramReadBehavior?: 'raw' | 'war';
    /** RAM, evolution flavor: one byte enable pin per 8 data bits when wider than 8 (evolution 'byteenables'); unset = false */
    ramByteEnables?: boolean;
    /** RAM, evolution flavor: clear pin (evolution 'clearpin'); unset = false */
    ramClearPin?: boolean;
    /** RAM / ROM contents: pages of MEM_PAGE_SIZE words (missing page or word = 0), shared copy-on-write */
    memPages?: Record<string, number[]>;
    /** RAM / ROM: last address shown (Logisim MemState current), -1 = none */
    memCurrent?: number;
    /** Dual-port RAM: last address shown for port 1 (memCurrent is port 0's), -1 = none */
    memCurrentB?: number;
    /** Dual-port RAM: last value seen on port 1's clock (lastClk is port 0's) */
    lastClkB?: SignalValue;
    /** RAM / ROM: outputs as last driven (a memory that does not drive keeps them, like Logisim) */
    memOut?: SignalValue[][];
    /** Random generator: seed (Logisim 'seed', 0 = from the time) */
    randomSeed?: number;
    /** Random generator: 48-bit generator state and the seed it started from, as decimal strings */
    randomCur?: string;
    randomInit?: string;
    /** Random generator: current output value (unsigned 32-bit) */
    randomValue?: number;
    q?: SignalValue;
    qBar?: SignalValue;
    lastClk?: SignalValue;
    regBits?: SignalValue[];
    hiZ?: boolean;
    gateInputsCount?: number;
    subcircuitId?: string;
    subcircuitName?: string;
    subcircuitCode?: string;
    // Internal parts of this IC instance as of the last evaluation, so latches/flip-flops inside keep their state
    subcircuitInternal?: { components: CircuitComponentInstance[]; wires: CircuitWire[] };
    // The IC's internal circuit did not settle in its last evaluation
    oscillating?: boolean;
    /** DIP switch / LED bar: number of switches / segments (Logisim-evolution 'number' / 'matrixcols', 1-32); unset = 8 */
    ioSize?: number;
    /** DIP switch: switch positions, bit i = switch i+1 (unsigned 32-bit); unset = all off */
    dipBits?: number;
    /** LED bar: one 1-bit input per segment or one wide input (evolution 'inputtype' column / row); unset = separated */
    ledBarMode?: 'separated' | 'oneWire';
    /** Dot matrix: columns and rows (Logisim 'matrixcols' / 'matrixrows', 1-32); unset = 5 x 7 */
    matrixCols?: number;
    matrixRows?: number;
    /** Dot matrix: how the inputs drive the dots (Logisim 'inputtype'); unset = column */
    matrixInput?: 'column' | 'row' | 'select';
    /** Dot matrix / LED bar: dot shape (Logisim 'dotshape': circle, square, clusterSegment); unset = square (LED bar: padded) */
    dotShape?: 'circle' | 'square' | 'padded';
    /** Dot matrix / LED bar: Logisim 'persist' (ticks a dot stays lit), kept for .circ files; the simulator has no tick counter and shows 0 */
    ioPersist?: number;
    /** 7-segment / hex digit: decimal point input (evolution 'decimalPoint'); unset = true */
    ioDp?: boolean;
    /** 7-segment: segments light on a 0 (common anode; Logisim 'active' false); unset = active high */
    ioActiveLow?: boolean;
    /** Displays: colour of a lit segment / dot (Logisim 'color'), CSS hex; unset = the part's default */
    ioOnColor?: string;
    /** TTL chip: VCC and GND are pins that must be wired (evolution 'VccGndPorts'); unset = false */
    ttlVccGnd?: boolean;
    /** TTL chip: draw the gates / pin functions inside the package (evolution 'ShowInternalStructure'); unset = false */
    ttlInternal?: boolean;
    /** Sequential TTL chip: stored values (flip-flop Q, counter / register bits) and last clock levels (evolution ClockState) */
    ttlSeq?: { v: SignalValue[]; clk: SignalValue[] };
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
