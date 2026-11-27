import type { AppearanceDynamicShape, AppearanceShape, CircuitComponentInstance, CircuitPin, CircuitWire, ComponentType, CustomSubcircuit, SubcircuitPortDefinition } from '../../types/circuit';
import { getLogicalConnections, snapTo10 } from '../../utils/wiringEngine';
import {
  ALU_OP_BITS,
  ARITH_PINS,
  ARITH_TYPES,
  FLIP_FLOP_TYPES,
  HEX_7SEG_MAP,
  MEM_TYPES,
  RAM_TYPES,
  bitSelectorSelectWidth,
  getArithConfig,
  getArithMode,
  getCounterMax,
  getGateWidth,
  getMemConfig,
  getPlexerConfig,
  getRamConfig,
  getSplitterConfig,
  getTrigger,
  getIoConfig,
  getIo5cConfig,
  KEYBOARD_DEFAULT_BUFFER,
  TELNET_DEFAULT_BUFFER,
  TELNET_DEFAULT_PORT,
  TTY_DEFAULT_BG,
  TTY_DEFAULT_COLOR,
  TTY_DEFAULT_COLS,
  TTY_DEFAULT_ROWS,
  ttyScreen,
  getIo5Config,
  getVideoConfig,
  VIDEO_COLOR_MODELS,
  getImageConfig,
  getTextConfig,
  textFontString,
  decodeTextFont,
  textLayout,
  textStandardString,
  TEXT_DEFAULT_COLOR,
  IMAGE_DEFAULT_SIZE,
  imageNaturalSize,
  binToBcdBits,
  KEYPAD_DEFAULT_CUSTOM,
  pinKey,
  ramPinWidth,
  splitterThreads,
  COMPONENT_CATALOG,
} from '../../utils/circuitEngine';
import { getSubcircuitDefinition, subcircuitPortWidth } from '../../utils/subcircuitManager';
import { appearanceShapeToSvg, subcircuitAppearanceShapes, subcircuitLayout, type AppearanceSvgElement } from '../../utils/subcircuitAppearance';
import { DYNAMIC_ELEMENT_OF, DYNAMIC_FACTORY, dynamicPathString, dynamicShapeToSvg, type DynamicPathStep } from '../../utils/dynamicElements';
import { solveKMap } from '../../utils/kmapSolver';
import { evoMapLabel, evoPartPins, mappedPartIds, writeBoardmap, type CircMapNote, type EvoMapUnit } from './boardmap';
import type { BoardDefinition } from '../../fpga/board/model';
import type { BoardMapping } from '../../fpga/map/model';
import { memToRawText } from '../../utils/memImage';
import {
  ARITH_MODE_PARTS,
  EVO_ONLY_ARITH,
  LOGISIM_ARITH_MODE,
  LOGISIM_ARITH_NAME,
  LOGISIM_MEM_NAME,
  LOGISIM_RAM_NAME,
  LOGISIM_IO_NAME,
  logisimIoPorts,
  logisimIo5Ports,
  io5FacingOf,
  LOGISIM_BFH_NAME,
  logisimBfhPorts,
  LOGISIM_IO5C_NAME,
  logisimColor,
  logisimIo5cPorts,
  LOGISIM_VIDEO_CURSOR,
  LOGISIM_VIDEO_NAME,
  LOGISIM_VIDEO_RESET,
  LOGISIM_IMAGE_NAME,
  LOGISIM_TEXT_NAME,
  logisimVideoBounds,
  logisimVideoPorts,
  logisimArithPorts,
  logisimMemPorts,
  logisimDefaultPortOffsets,
  logisimPlexerPortKeys,
  logisimGateLoc271,
  logisimPlexerPorts,
  logisimRamPorts,
  logisimTransistorPorts,
  logisimPlaOutput,
  logisimPassSwitchInput,
  logisimTwoPinLedPorts,
  logisimEvoBuzzerPorts,
  logisimEvoBuzzerBox,
  logisimOscPorts,
  logisimOscBox,
  logisimTwoWayPorts,
  logisimSplitterEnds,
  type LogisimPlexer,
  type LogisimRamLook,
} from './logisimCircImporter';
import type { LogicValue } from '../../types/logic';
import { isTtlType, ttlChipOf, ttlEvoOffset, ttlEvoPin, ttlEvoRemapped, ttlInKey, ttlPorts, ttlRcOf } from '../../utils/ttlChips';
import { circOf, type CircLibrary } from './partCirc';
import './parts';
import { TWO_PIN_LED_DEFAULTS, getEvoBuzzerConfig, getOscConfig, pgStateCount, getClockConfig, getExtraSwitchConfig, getPlaConfig, getPlaRomConfig, getPorConfig, getSliderConfig, getTtlConfig, plaRomContents, plaTableText, porSizeOf } from '../../utils/circuitEngine';

/** Library number of evolution's #TTL in the exported file */
const TTL_LIB = 6;
/** Library number of evolution's #BFH-Praktika (Aşama 5b) in the exported file */
const BFH_LIB = 7;
/** Library number of Logisim's #Base (its Text; evolution's Image, Aşama 5e) in the exported file */
const BASE_LIB = 8;
/** Library number of evolution's #Input/Output-Extra (Aşama 5h) in the exported file */
const EXTRA_LIB = 9;
/** Library number of evolution's #HDL-IP (its BLIF circuit, Aşama 6a) in the exported file */
const HDL_LIB = 10;
/** Library number of evolution's #TCL (its TCL Generic, Aşama 6d) in the exported file */
const TCL_LIB = 11;
/** Library number of evolution's #Soc (its SoC bus and memory, Aşama 6e) in the exported file */
const SOC_LIB = 12;
/** Library number of each Logisim library a component-registry part (src/parts) can be written to */
const CIRC_LIB_NUMBER: Record<CircLibrary, number> = {
  '#Wiring': 0,
  '#Gates': 1,
  '#Plexers': 2,
  '#Arithmetic': 3,
  '#Memory': 4,
  '#I/O': 5,
  '#TTL': TTL_LIB,
  '#BFH-Praktika': BFH_LIB,
  '#Base': BASE_LIB,
  '#Input/Output-Extra': EXTRA_LIB,
  '#HDL-IP': HDL_LIB,
  '#TCL': TCL_LIB,
  '#Soc': SOC_LIB,
};

/*
 * Logisim 2.7 (.circ) export.
 *
 * Every part is first expanded into Logisim primitives (gates, NOT, controlled buffer, flip-flops,
 * constants, pins, clocks, splitters, bit extenders / selectors, subcircuits); blocks Logisim has no
 * exact equivalent for (adders, plexers, decoders, ALU, registers, ...) become small gate / flip-flop
 * networks with the same behaviour as our simulator. Primitives are laid out on a grid and connected
 * with Logisim tunnels named after their net, so no wire can accidentally touch another part's pin.
 * Pin offsets were measured in Logisim 2.7.1 (gates: output at loc, inputs at -(size+bubble+xor) with
 * the AbstractGate spacing; flip-flops: Q (0,0), Q' (0,20), D/T (-40,20), clock (-40,0) or (-40,10) for
 * J-K, reset (-10,30), preset (-30,30)). Open inputs follow the simulator's Logisim rules: on primitives
 * they stay unconnected, on gate networks they become x (or the fixed level the simulator reads for
 * them). Checked in Logisim 2.7.1: primitives, presets and ICs match exactly; a gate network cannot
 * always reproduce a block's x (AND(0, x) = 0, a per-bit register still loads the defined bits of a
 * partly open word).
 *
 * Bit widths: every tunnel carries the width of the pin it stands for, so a net whose pins disagree on
 * the width is a width error in Logisim too (same-named tunnels of different widths). Parts whose width
 * follows their net (probe, pull resistor) take the net's width. Every IC definition becomes its own
 * <circuit> (ports = Pins in port order, Logisim's default appearance) used as a subcircuit.
 */

// ODD / EVEN: Logisim's Odd Parity / Even Parity gates (AND geometry, no output bubble)
type GateKind = 'AND' | 'OR' | 'NAND' | 'NOR' | 'XOR' | 'XNOR' | 'ODD' | 'EVEN';
type OutMode = '01' | '0Z' | 'Z1';
type Prim =
  // width: data bits (1 unless a canvas gate is wider); negated: input slots from 0; xor: multi-input XOR rule
  | { kind: 'gate'; type: GateKind; ins: string[]; out: string; mode?: OutMode; width?: number; negated?: number[]; xor?: 'odd' | 'one' }
  | { kind: 'not'; in: string; out: string; mode?: OutMode; width?: number }
  | { kind: 'buf'; in: string; out: string; mode?: OutMode; width?: number }
  | { kind: 'tri'; in: string; en: string; out: string; inv?: boolean; width?: number }
  | { kind: 'ff'; type: 'D' | 'T' | 'JK'; a?: string; b?: string; clk?: string; q?: string; qn?: string; reset?: string; preset?: string }
  | { kind: 'const'; value: number; out: string; width?: number }
  | { kind: 'inpin'; label: string; out: string; width?: number; tristate?: boolean }
  | { kind: 'clock'; label: string; out: string; high: number; low: number; phase: number }
  // width undefined: the width of the net (a probe follows it)
  | { kind: 'outpin'; label: string; in: string; width?: number }
  | { kind: 'pull'; value: 0 | 1 | 'X'; at: string }
  | { kind: 'splitter'; combined: string; ends: string[]; bitEnd: number[]; appear: 'left' | 'right' | 'center'; endWidth: number[] }
  | { kind: 'extender'; in: string; ext: string | null; out: string; inW: number; outW: number; type: string }
  | { kind: 'selector'; data: string; sel: string; out: string; dataW: number; groupW: number }
  // facing: the IC's default facing (its appearance's anchor), so the box is drawn as designed
  | { kind: 'sub'; circuit: string; ins: string[]; outs: string[]; inW: number[]; outW: number[]; inOff: Pt[]; outOff: Pt[]; facing: string }
  // A real Logisim plexer (facing east, select bottom-left); nets / widths / sinks in Logisim's port order
  | {
      kind: 'plexer';
      part: LogisimPlexer;
      select: number;
      width: number;
      enable: boolean;
      disabled: '0' | 'Z';
      tristate: boolean;
      nets: string[];
      widths: number[];
      sinks: boolean[];
    }
  // A real Logisim arithmetic part (always east); nets / widths / sinks in logisimArithPorts order
  | { kind: 'arith'; part: ComponentType; attrs: string; inputs: number; nets: string[]; widths: number[]; sinks: boolean[] }
  // A real Logisim memory part (classic look); nets / widths / sinks in memPorts order
  | { kind: 'mem'; part: ComponentType; attrs: string; length: number; parallel: boolean; nets: string[]; widths: number[]; sinks: boolean[] }
  // A real Logisim RAM / ROM / random generator; its connection points relative to loc
  // (box: a body reaching beyond its points, relative to loc, kept clear of the other parts)
  | {
      kind: 'ram';
      part: ComponentType;
      attrs: string;
      // (width unset: the net's, as a probe takes it)
      ports: Array<{ off: Pt; net: string; width?: number; sink: boolean }>;
      lib?: number;
      name?: string;
      box?: { x0: number; y0: number; x1: number; y1: number };
    };

interface Pt {
  x: number;
  y: number;
}

export interface CircExportResult {
  xml: string;
  warnings: string[];
  // For tests / UI: which Logisim pin stands for which canvas pin
  inputs: { label: string; compId: string; pinIndex: number }[];
  outputs: { label: string; compId: string; pinId: string }[];
  /** The board map written into the main circuit (Logisim-evolution <boardmap>), and what it could not carry */
  boardmap?: { written: boolean; notes: CircMapNote[] };
}

export interface CircExportOptions {
  /** The canvas's FPGA board mapping and its board: written as the main circuit's <boardmap> */
  fpga?: { mapping: BoardMapping; board: BoardDefinition };
  /** The simulation's global clock rate (Hz), used by the clocks without their own rate */
  clockHz?: number;
}

/**
 * evo's per-circuit tick frequency for a set of clock rates: evo ticks `freq` times a second (simulator and FPGA
 * tick generator alike) and a clock steps once per tick, while a clock rate here is the rate of a 1-high / 1-low
 * clock, i.e. two ticks per cycle. One value only when every clock runs at the same rate.
 */
export function evoTickFrequency(clockRates: (number | undefined)[], clockHz?: number): number | undefined {
  const rates = new Set(clockRates.map((r) => r ?? clockHz));
  if (!rates.size && clockHz !== undefined) rates.add(clockHz);
  if (rates.size !== 1) return undefined;
  const hz = [...rates][0];
  return hz !== undefined && Number.isFinite(hz) && hz > 0 ? 2 * hz : undefined;
}

/** A double as Java's Double.toString writes small values ("1.0", "0.5") */
const javaDouble = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

// evo's annotation names (Circuit.getAnnotationName) for a mapped part written without a usable label
const EVO_ANNOTATION_NAME: Partial<Record<ComponentType, string>> = { dipSwitch: 'DipSwitch', sevenSegment: 'SevenSegment', rgbLed: 'RGBLED', portIo: 'PortIO' };

// Logisim 2.7.1 memory pins (classic look); the counter's up/down pin is evolution's, written too so evolution
// connects it (Logisim 2.7.1 has no pin there and leaves the tunnel alone)
const memPorts = (part: ComponentType, length: number, parallel: boolean) =>
  logisimMemPorts(part, { width: 1, length, parallel, appearance: 'classic', hasEnable: true, hasUpDown: true });

// Tabs and line breaks as character references: a reader turns raw ones in an attribute value into spaces
const xmlEsc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');

// Where the port Pins of an IC's own circuit go: inputs facing east (west edge of the box), outputs
// facing west (east edge), each column ordered by y, so Logisim's default appearance keeps port order
const PORT_IN_X = 40;
const PORT_OUT_X = 80;
const portY = (i: number) => 100 + 20 * i;

interface SubcircuitInfo {
  circuit: string;
  inOff: Pt[];
  outOff: Pt[];
  facing: string;
}

/** One appearance element as a line of the file */
const svgXml = (e: AppearanceSvgElement) => {
  const attrs = e.attrs.map(([k, v]) => ` ${k}="${xmlEsc(v)}"`).join('');
  return e.text === undefined ? `<${e.tag}${attrs}/>` : `<${e.tag}${attrs}>${xmlEsc(e.text)}</${e.tag}>`;
};

/**
 * Parts written as one Logisim part whose Logisim-evolution factory has a label attribute (asked from evolution's
 * own factories). Evolution's arithmetic parts, plexers, constant, splitter, bit extender / selector, pull resistor,
 * joystick, keyboard, TTY, real-time clock, RGB Video and BFH converters have none. Logisim 2.7.1 has none on its
 * 7-segment / hex digit displays, LED matrix, RAM and ROM either: it skips the attribute and reads the rest alike.
 */
const LABELLED_PARTS = new Set<ComponentType>([
  'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'oddParity', 'evenParity', 'not', 'buffer', 'triState', 'controlledInverter', 'pla',
  'plaRom', 'passSwitch', 'twoWaySwitch', 'slider', 'programmableGenerator', 'twoPinLed', 'evoBuzzer', 'digitalOscilloscope',
  'sevenSegment', 'hexDigit', 'dotMatrix', 'ledBar', 'dipSwitch', 'rgbLed', 'matrixKeypad', 'portIo', 'telnet',
  // (inside an IC; on the canvas they are the circuit's output Pins)
  'led', 'probe',
  'subcircuit',
]);
const hasLogisimLabel = (type: ComponentType) =>
  LABELLED_PARTS.has(type) || MEM_TYPES.has(type) || RAM_TYPES.has(type) || isTtlType(type) || !!circOf(type)?.labelled;

export function exportLogisimCirc(circuitName: string, components: CircuitComponentInstance[], wires: CircuitWire[], options: CircExportOptions = {}): CircExportResult {
  const warnings: string[] = [];
  let boardmap: CircExportResult['boardmap'];
  // Evolution's TTL library is declared only when a chip uses it (Logisim 2.7.1 cannot load it)
  let usesTtl = false;
  // Likewise evolution's BFH library (binary to BCD converter, BCD to 7-segment decoder)
  let usesBfh = false;
  // and the Base library, only for a Text or an Image (2.7.1's Base has Text, but no Image)
  let usesBase = false;
  let usesExtra = false;
  let usesHdl = false;
  let usesTcl = false;
  let usesSoc = false;
  let usesImage = false;
  const inputs: CircExportResult['inputs'] = [];
  const outputs: CircExportResult['outputs'] = [];
  // Own rate (or undefined = the global rate) of every clock written, in all circuits
  const clockRates: (number | undefined)[] = [];

  // Circuit names of the file: the canvas first, then one per IC definition
  const circuitNames = new Set<string>();
  const uniqueCircuitName = (base: string) => {
    const b = base.trim() || 'main';
    let n = b;
    for (let i = 2; circuitNames.has(n); i++) n = `${b} (${i})`;
    circuitNames.add(n);
    return n;
  };
  const topName = uniqueCircuitName(circuitName || 'main');
  const circuitXml: string[] = [];
  const subInfo = new Map<string, SubcircuitInfo>();
  // per IC definition: where the parts a dynamic element can name were written in its circuit
  const placedIn = new Map<string, Map<string, DynamicPathStep>>();
  const building = new Set<string>();

  // The <circuit> of an IC definition (built once, inner ICs first)
  const subcircuitFor = (def: CustomSubcircuit, depth: number): SubcircuitInfo | null => {
    const known = subInfo.get(def.id);
    if (known) return known;
    if (building.has(def.id) || depth > 8) return null;
    building.add(def.id);
    const name = uniqueCircuitName(def.name || def.id);
    const inPorts = def.ports.filter((p) => p.type === 'input');
    const outPorts = def.ports.filter((p) => p.type === 'output');
    const style = def.appearance?.style ?? 'chip';
    // the circuit's parts first: a dynamic element of the drawing names its part by where it was written
    const placed = new Map<string, DynamicPathStep>();
    const body = buildCircuit(name, def.components, def.wires, def, depth + 1, placed);
    placedIn.set(def.id, placed);
    let info: SubcircuitInfo;
    let head = '';
    if (style === 'chip' || style === 'classic') {
      // Logisim's default (classic) box, which both Logisim 2.7.1 and evolution build from the port Pins
      const offsets = logisimDefaultPortOffsets([
        ...inPorts.map((_, i) => ({ loc: { x: PORT_IN_X, y: portY(i) }, facing: 'east' })),
        ...outPorts.map((_, i) => ({ loc: { x: PORT_OUT_X, y: portY(i) }, facing: 'west' })),
      ]);
      info = { circuit: name, inOff: offsets.slice(0, inPorts.length), outOff: offsets.slice(inPorts.length), facing: 'east' };
    } else {
      // The appearance as the readers build it from the Pins written here (labelled with the port names), and
      // its drawing in 2.7.1's format: evolution follows the appearance attribute (and ignores a drawing next to
      // a default style), Logisim 2.7.1 knows no such attribute and draws the drawing, so both show the same box
      const xdef: CustomSubcircuit = {
        ...def,
        ports: def.ports.map((p) => {
          const input = p.type === 'input';
          const i = (input ? inPorts : outPorts).indexOf(p);
          const q: SubcircuitPortDefinition = {
            ...p,
            width: subcircuitPortWidth(def, p),
            pinAt: { x: input ? PORT_IN_X : PORT_OUT_X, y: portY(i), facing: input ? 'east' : 'west' },
          };
          delete q.pinLabel;
          return q;
        }),
      };
      const lay = subcircuitLayout(xdef)!;
      const off = (p: SubcircuitPortDefinition) => {
        const at = lay.ports.get(p.id) ?? lay.anchor;
        return { x: at.x - lay.anchor.x, y: at.y - lay.anchor.y };
      };
      info = { circuit: name, inOff: inPorts.map(off), outOff: outPorts.map(off), facing: lay.anchor.facing };
      const portInfo = (id: string) => {
        const p = xdef.ports.find((q) => q.id === id);
        return p?.pinAt ? { pin: { x: p.pinAt.x, y: p.pinAt.y }, isInput: p.type === 'input' } : undefined;
      };
      // Logisim 2.7.1 has no vertical text alignment (its text stands on y): the default boxes' texts are moved to
      // their baseline, with Java's font metrics (ascent size + 1, descent a quarter of the size); only 2.7.1 reads
      // this drawing (a custom one is evolution's too, so it stays as drawn)
      const baselined = (sh: AppearanceShape): AppearanceShape => {
        if (sh.kind !== 'text' || sh.valign === 'baseline') return sh;
        const ascent = sh.fontSize + 1;
        const descent = Math.floor(sh.fontSize / 4 + 0.5);
        const dy = sh.valign === 'top' ? ascent : sh.valign === 'bottom' ? -descent : Math.round((ascent - descent) / 2);
        return { ...sh, y: sh.y + dy, valign: 'baseline' };
      };
      // A dynamic element's path: each part as written (an IC's parts in its own circuit), ending at the part
      // evolution shows with that element; null when one of them did not go to the file as such
      const dynamicPath = (sh: AppearanceDynamicShape): string | null => {
        const steps: DynamicPathStep[] = [];
        let parts: CircuitComponentInstance[] | undefined = def.components;
        let at: Map<string, DynamicPathStep> | undefined = placed;
        for (let i = 0; i < sh.path.length; i++) {
          const c: CircuitComponentInstance | undefined = parts?.find((q) => q.id === sh.path[i]);
          const st = at?.get(sh.path[i]);
          if (!c || !st) return null;
          steps.push(st);
          if (i < sh.path.length - 1) {
            if (c.type !== 'subcircuit') return null;
            parts = c.state.subcircuitId ? getSubcircuitDefinition(c.state.subcircuitId)?.components : undefined;
            at = c.state.subcircuitId ? placedIn.get(c.state.subcircuitId) : undefined;
          }
        }
        return steps.length && steps[steps.length - 1].name === DYNAMIC_FACTORY[sh.element] ? dynamicPathString(steps) : null;
      };
      let dynamicWritten = 0;
      let twoPinLedWritten = 0;
      const drawing = (subcircuitAppearanceShapes(xdef) ?? []).flatMap((sh) => {
        if (sh.kind === 'dynamic') {
          const path = dynamicPath(sh);
          if (path) {
            dynamicWritten++;
            if (sh.element === 'two-pin-led') twoPinLedWritten++;
            return [`      ${svgXml(dynamicShapeToSvg(sh, path))}`];
          }
          warnings.push(`${def.name || def.id}: IC görünümündeki dinamik öğe (${sh.element}) dosyaya yazılamadı; gösterdiği parça Logisim'e o parça olarak aktarılmadı (ör. çıkış portunun LED'i Logisim'de Pin olur).`);
          return [];
        }
        const e = appearanceShapeToSvg(style === 'custom' ? sh : baselined(sh), portInfo, 'logisim');
        return e ? [`      ${svgXml(e)}`] : [];
      });
      if (dynamicWritten)
        warnings.push(`${def.name || def.id}: IC görünümündeki ${dynamicWritten} dinamik öğe yalnız Logisim-evolution'da var; Logisim 2.7.1 dosyayı açarken bunlar için hata gösterir, çizimin kalanını açar.`);
      if (twoPinLedWritten)
        warnings.push(`${def.name || def.id}: IC görünümündeki ${twoPinLedWritten} iki uçlu LED öğesini (visible-two-pin-led) Logisim-evolution yazar ama geri okuyamaz: dosyayı açarken hata gösterir, bu öğeleri atlar ve kalanını açar. Bu program okur.`);
      head =
        `    <a name="appearance" val="${style}"/>\n` +
        (def.appearance?.fixedSize ? '    <a name="circuitnamedboxfixedsize" val="true"/>\n' : '') +
        `    <appear>\n${drawing.join('\n')}\n    </appear>\n`;
    }
    circuitXml.push(`  <circuit name="${xmlEsc(name)}">\n${head}${body}\n  </circuit>`);
    building.delete(def.id);
    subInfo.set(def.id, info);
    return info;
  };

  // Builds the parts of one circuit (the canvas, or an IC definition with its ports as Pins)
  // placed: where each part a dynamic appearance element can name was written (its factory name and location)
  const buildCircuit = (
    circuitName: string,
    comps: CircuitComponentInstance[],
    levelWires: CircuitWire[],
    def: CustomSubcircuit | null,
    depth: number,
    placed?: Map<string, DynamicPathStep>
  ): string => {
    const partOf = new Map<Prim, string>();
    // The label a written part carries (the part's own, see hasLogisimLabel)
    const labelOf = new Map<Prim, string>();
    // The main circuit's written parts that can carry a board map (evo mappable parts), with the part they are
    const mapUnits: { prim: Prim; compId: string; pins: EvoMapUnit['pins']; fallback: string; own: boolean }[] = [];
    const blocks: { prims: Prim[] }[] = [];
    const fixed: Array<{ x: number; y: number; prim: Prim }> = [];

    // --- nets (union-find over net names so aliases like splitter outputs collapse) -------------
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      if (!parent.has(k)) parent.set(k, k);
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(k, r);
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };
    let fresh = 0;
    const newNet = () => `_t${fresh++}`;
    const C0 = '_const0';
    const C1 = '_const1';
    let usesC0 = false;
    let usesC1 = false;
    const constNet = (v: 0 | 1) => {
      if (v) usesC1 = true;
      else usesC0 = true;
      return v ? C1 : C0;
    };
    // A Logisim part's own input that is open on the canvas stays unconnected in the file too (no
    // tunnel), so Logisim reads it exactly like the simulator does (gates ignore it, NOT gives E ...)
    const OPEN = '';
    // An open input of a block built from gates gets its own undriven net (an 'OPEN' tunnel, x in
    // Logisim) so the undefined value stays undefined; inputs the simulator reads as a fixed level
    // when open (carry-in, reset, enable ...) are tied to that constant instead
    const openNets: string[] = [];
    const openNet = () => {
      const n = newNet();
      openNets.push(n);
      return n;
    };

    // Inside an IC the port pins are bound to the nets of the circuit's own port Pins
    const inScope = def !== null;
    const alias = new Map<string, string>();
    if (def) {
      const inPorts = def.ports.filter((p) => p.type === 'input');
      const outPorts = def.ports.filter((p) => p.type === 'output');
      inPorts.forEach((p, i) => {
        const net = `_port_in${i}`;
        alias.set(p.targetPinId, net);
        const tristate = !!def.components.find((c) => c.id === p.targetCompId)?.state.pinTristate;
        fixed.push({ x: PORT_IN_X, y: portY(i), prim: { kind: 'inpin', label: p.name, out: net, width: subcircuitPortWidth(def, p), tristate } });
      });
      outPorts.forEach((p, i) => {
        const net = `_port_out${i}`;
        const target = def.components.find((x) => x.id === p.targetCompId);
        const pinId = target && ['led', 'probe', 'buzzer'].includes(target.type) ? target.inputs[0]?.id : p.targetPinId;
        if (pinId) alias.set(pinId, net);
        fixed.push({ x: PORT_OUT_X, y: portY(i), prim: { kind: 'outpin', label: p.name, in: net, width: subcircuitPortWidth(def, p) } });
      });
    }

    const conns = getLogicalConnections(comps, levelWires);
    const netOfPin = new Map<string, string>();
    const connected = new Set<string>();
    for (const w of conns) {
      netOfPin.set(w.fromPinId, w.fromPinId);
      netOfPin.set(w.toPinId, w.fromPinId);
      connected.add(w.fromPinId);
      connected.add(w.toPinId);
    }
    for (const [pinId, outer] of alias) {
      const n = netOfPin.get(pinId) || pinId;
      netOfPin.set(pinId, n);
      connected.add(pinId);
      union(outer, n);
    }
    // Output pins always get a net; an unconnected input reads `floating` (undefined: x)
    const outNet = (pinId?: string) => (pinId ? netOfPin.get(pinId) || pinId : newNet());
    const inNet = (pinId: string | undefined, floating?: 0 | 1) =>
      pinId && connected.has(pinId) ? netOfPin.get(pinId)! : floating === undefined ? openNet() : constNet(floating);
    const isConn = (pinId?: string) => !!pinId && connected.has(pinId);
    const pinNet = (pinId?: string) => (isConn(pinId) ? netOfPin.get(pinId!)! : OPEN);
    // A bidirectional pin pair (an output and an input of one part on one point: the PIO's io pins, a TTL in/out
    // pin) joins itself, so it looks connected. With nothing else on its net the pin has no wire.
    let netMembers: Map<string, string[]> | undefined;
    const selfOnly = (c: CircuitComponentInstance, p: CircuitPin) => {
      if (alias.has(p.id)) return false;
      if (!netMembers) {
        netMembers = new Map();
        for (const [id, net] of netOfPin) netMembers.set(net, [...(netMembers.get(net) ?? []), id]);
      }
      const members = netMembers.get(netOfPin.get(p.id) ?? '') ?? [];
      const x = snapTo10(p.x), y = snapTo10(p.y);
      return members.every((id) => {
        const q = c.inputs.find((i) => i.id === id) ?? c.outputs.find((o) => o.id === id);
        return !!q && snapTo10(q.x) === x && snapTo10(q.y) === y;
      });
    };

    for (const c of comps) {
      const P: Prim[] = [];
      const g = (type: GateKind, ins: string[], out = newNet()): string => {
        if (ins.length === 1 && (type === 'AND' || type === 'OR')) {
          union(ins[0], out);
          return out;
        }
        // At most 5 inputs per gate (our own gates' limit, so the file also re-imports cleanly):
        // wider ones become a tree of the base operation with the inversion on the last gate
        if (ins.length > 5) {
          const base: GateKind = type === 'NAND' ? 'AND' : type === 'NOR' ? 'OR' : type === 'XNOR' ? 'XOR' : type;
          const groups: string[] = [];
          for (let i = 0; i < ins.length; i += 5) {
            const part = ins.slice(i, i + 5);
            groups.push(part.length === 1 ? part[0] : g(base, part));
          }
          return g(type, groups, out);
        }
        P.push({ kind: 'gate', type, ins, out });
        return out;
      };
      const not = (a: string, out = newNet()) => {
        P.push({ kind: 'not', in: a, out });
        return out;
      };
      let openInputs = 0;
      const ins = (i: number, floating?: 0 | 1) => {
        if (floating === undefined && !isConn(c.inputs[i]?.id)) openInputs++;
        return inNet(c.inputs[i]?.id, floating);
      };
      // Input of a part that is a Logisim primitive itself: open stays open
      const pin = (i: number) => pinNet(c.inputs[i]?.id);
      const out = (i: number) => outNet(c.outputs[i]?.id);
      const label = (c.label || c.type).trim();
      const w0 = (p?: { width?: number }) => p?.width ?? 1;

      switch (c.type) {
        case 'switch':
        case 'pushbutton': {
          // Inside an IC: a switch bound to a port is driven from outside, any other one is a constant
          if (inScope && c.outputs[0] && alias.has(c.outputs[0].id)) break;
          const width = w0(c.outputs[0]);
          const value = width > 1 ? (c.state.inputValue ?? 0) : c.state.on ? 1 : 0;
          if (inScope) P.push({ kind: 'const', value, out: out(0), width });
          else {
            P.push({ kind: 'inpin', label, out: out(0), width, tristate: !!c.state.pinTristate });
            inputs.push({ label, compId: c.id, pinIndex: 0 });
          }
          break;
        }
        case 'clock':
          if (inScope && c.outputs[0] && alias.has(c.outputs[0].id)) break;
          if (inScope) P.push({ kind: 'const', value: 0, out: out(0) });
          else {
            clockRates.push(c.state?.clockRateHz);
            P.push({ kind: 'clock', label, out: out(0), ...getClockConfig(c) });
            inputs.push({ label, compId: c.id, pinIndex: 0 });
          }
          break;
        case 'vcc':
        case 'gnd':
          P.push({ kind: 'const', value: c.type === 'vcc' ? 1 : 0, out: out(0) });
          break;
        case 'constant': {
          const width = w0(c.outputs[0]);
          const v = c.state.constValue ?? 1;
          P.push({ kind: 'const', value: width >= 32 ? v >>> 0 : v % 2 ** width, out: out(0), width });
          break;
        }
        case 'asciiKeyboard':
          c.outputs.forEach((p, i) => {
            const l = `${label}_${p.name}`;
            if (inScope) P.push({ kind: 'const', value: 0, out: out(i) });
            else {
              P.push({ kind: 'inpin', label: l, out: out(i) });
              inputs.push({ label: l, compId: c.id, pinIndex: i });
            }
          });
          break;
        case 'keyboard':
        case 'tty':
        case 'telnet': {
          // The Logisim I/O part on its own connection points (Keyboard and TTY are the same in Logisim 2.7.1 and
          // evolution, Telnet is evolution's). None has a facing: written unrotated, a tunnel on each pin's point
          // (the exporter joins nets by tunnels, so our rotation changes nothing). Logisim leaves defaults out.
          const cfg = getIo5cConfig(c);
          const a = (name: string, val: string | number | boolean) => `<a name="${name}" val="${xmlEsc(String(val))}"/>`;
          let attrs = '';
          if (c.type === 'keyboard') {
            if (cfg.kbdBufLen !== KEYBOARD_DEFAULT_BUFFER) attrs += a('buflen', cfg.kbdBufLen);
            if (getTrigger(c) === 'falling') attrs += a('trigger', 'falling');
          } else if (c.type === 'tty') {
            if (cfg.ttyRows !== TTY_DEFAULT_ROWS) attrs += a('rows', cfg.ttyRows);
            if (cfg.ttyCols !== TTY_DEFAULT_COLS) attrs += a('cols', cfg.ttyCols);
            if (getTrigger(c) === 'falling') attrs += a('trigger', 'falling');
            const color = logisimColor(c.state.ttyColor);
            const bg = logisimColor(c.state.ttyBg);
            if (color && color !== TTY_DEFAULT_COLOR) attrs += a('color', color);
            if (bg && bg !== TTY_DEFAULT_BG) attrs += a('bg', bg);
          } else {
            if (cfg.telnetMode) attrs += a('telnetMode', true);
            if (cfg.telnetPort !== TELNET_DEFAULT_PORT) attrs += a('port', cfg.telnetPort);
            if (cfg.telnetBufLen !== TELNET_DEFAULT_BUFFER) attrs += a('buflen', cfg.telnetBufLen);
          }
          const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
          const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
          for (const { key, off } of logisimIo5cPorts(c.type)) {
            const p = byKey.get(key);
            const isIn = !!p && c.inputs.includes(p);
            const net = !p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN;
            ports.push({ off, net, width: p?.width ?? 1, sink: isIn });
          }
          P.push({ kind: 'ram', part: c.type, attrs, ports, lib: 5, name: LOGISIM_IO5C_NAME[c.type] });
          if ((c.rotation ?? 0) % 360 !== 0)
            warnings.push(`${label}: Logisim'deki parçanın yönü yok; döndürülmeden yazıldı (bağlantılar aynı).`);
          if (c.type === 'telnet')
            warnings.push(`${label}: Logisim-evolution parçası (Telnet); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          if (c.type === 'keyboard' && (c.state.kbdBuf ?? '') !== '')
            warnings.push(`${label}: klavye tamponundaki karakterler dosyaya yazılmadı (Logisim saklamaz), dosya açılınca tampon boş.`);
          if (c.type === 'tty') {
            const scr = ttyScreen(c);
            if (scr.cursorRow > 0 || scr.rows.some((r) => r !== ''))
              warnings.push(`${label}: ekrandaki yazı dosyaya yazılmadı (Logisim saklamaz), dosya açılınca ekran boş.`);
          }
          break;
        }
        case 'rgbVideo': {
          // Evolution's RGB Video (lib 5 I/O, 2.7.1 has none): no facing, so written unrotated with a tunnel on each
          // pin's point; only the settings that differ from evolution's defaults (it leaves those out). Its body
          // (above loc) is kept clear of the other parts.
          const cfg = getVideoConfig(c);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${xmlEsc(String(val))}"/>`;
          let attrs = '';
          // in evolution's order (it writes attributes sorted by name)
          if (cfg.color !== 'rgb888') attrs += a('color', VIDEO_COLOR_MODELS.find((m) => m.id === cfg.color)!.circ);
          if (!cfg.cursor) attrs += a('cursor', LOGISIM_VIDEO_CURSOR[1]);
          if (cfg.height !== 128) attrs += a('height', cfg.height);
          if (cfg.reset === 'sync') attrs += a('reset', LOGISIM_VIDEO_RESET[1]);
          if (cfg.scale !== 2) attrs += a('scale', cfg.scale);
          if (cfg.width !== 128) attrs += a('width', cfg.width);
          const byKey = new Map(c.inputs.map((p) => [pinKey(c, p), p]));
          const ports = logisimVideoPorts().map(({ key, off }) => {
            const p = byKey.get(key);
            return { off, net: p ? pinNet(p.id) : OPEN, width: p?.width ?? 1, sink: true };
          });
          const b = logisimVideoBounds(cfg);
          P.push({ kind: 'ram', part: c.type, attrs, ports, lib: 5, name: LOGISIM_VIDEO_NAME, box: { x0: b.x, y0: b.y, x1: b.x + b.width, y1: 0 } });
          if ((c.rotation ?? 0) % 360 !== 0)
            warnings.push(`${label}: Logisim'deki parçanın yönü yok; döndürülmeden yazıldı (bağlantılar aynı).`);
          warnings.push(`${label}: Logisim-evolution parçası (RGB Video); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          if (c.label?.trim() && c.label.trim() !== 'RGB Video')
            warnings.push(`${label}: Logisim'deki RGB Video'nun etiketi yok; etiket dosyaya yazılmadı.`);
          if (Object.values(c.state.videoPages ?? {}).some((pg) => pg.some((v) => v)))
            warnings.push(`${label}: ekrandaki görüntü dosyaya yazılmadı (Logisim saklamaz), dosya açılınca ekran siyah.`);
          break;
        }
        case 'led':
        case 'probe':
        case 'buzzer':
          if (inScope) {
            // An IC's outputs reach the outside through its ports (the port's part is the circuit's output Pin); any
            // other LED / probe stays a Logisim LED (1 bit, lib I/O) / Probe (lib Wiring), so the IC can show it on
            // its drawing (a dynamic element)
            if (def!.ports.some((q) => q.targetCompId === c.id) || c.type === 'buzzer' || (c.type === 'led' && w0(c.inputs[0]) !== 1)) break;
            const net = pin(0);
            P.push({ kind: 'ram', part: c.type, attrs: '', ports: [{ off: { x: 0, y: 0 }, net, width: c.type === 'led' ? 1 : undefined, sink: true }], lib: c.type === 'led' ? 5 : 0, name: c.type === 'led' ? 'LED' : 'Probe' });
            break;
          }
          c.inputs.forEach((p, i) => {
            const l = c.inputs.length === 1 ? label : `${label}_${p.name}`;
            // A probe follows its net's width; every other display has a fixed width
            P.push({ kind: 'outpin', label: l, in: pin(i), width: c.type === 'probe' ? undefined : w0(p) });
            outputs.push({ label: l, compId: c.id, pinId: p.id });
          });
          break;
        case 'tunnel':
          break;
        case 'textLabel': {
          // Logisim's Text (lib Base, 2.7.1 and evolution): no pins, its text block kept clear of the other parts.
          // The attributes as evolution writes them (sorted by name, text through toStandardString, a multi-line text
          // as the element's content), except the font: always written, since 2.7.1 and evolution differ on its
          // default (plain 12 / bold 16) and both should show the same text. 2.7.1 ignores the colour
          const cfg = getTextConfig(c);
          const text = textStandardString(cfg.text);
          const name = `Metin "${cfg.text.replace(/\s+/g, ' ').slice(0, 30)}" (${c.x},${c.y})`;
          if (text === '') {
            // evolution deletes a Text with no text when it loads the file
            if (cfg.text !== '') warnings.push(`${name}: yazdırılabilir karakteri yok; Logisim onu silerdi, dosyaya yazılmadı.`);
            break;
          }
          const a = (n: string, val: string) => `<a name="${n}" val="${xmlEsc(val)}"/>`;
          let attrs = '';
          if (cfg.color !== TEXT_DEFAULT_COLOR) attrs += a('color', cfg.color);
          attrs += a('font', textFontString(decodeTextFont(cfg.font)));
          if (cfg.halign !== 'center') attrs += a('halign', cfg.halign);
          attrs += text.includes('\n') ? `<a name="text">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a>` : a('text', text);
          if (cfg.valign !== 'base') attrs += a('valign', cfg.valign);
          // (the box out to the grid, so the anchor lands on a grid point: 2.7.1 snaps a Text's location)
          const l = textLayout(cfg);
          const g = (v: number, up: boolean) => (up ? Math.ceil(v / 10) : Math.floor(v / 10)) * 10;
          const box = { x0: g(-l.ax, false), y0: g(-l.ay, false), x1: g(l.width - l.ax, true), y1: g(l.height - l.ay, true) };
          P.push({ kind: 'ram', part: c.type, attrs, ports: [], lib: BASE_LIB, name: LOGISIM_TEXT_NAME, box });
          usesBase = true;
          if ((c.rotation ?? 0) % 360 !== 0) warnings.push(`${name}: Logisim'deki metnin yönü yok; döndürülmeden yazıldı.`);
          if (text !== cfg.text) warnings.push(`${name}: sekme ve denetim karakterleri ile "&#...;" parçaları Logisim'in yazdığı gibi atıldı.`);
          break;
        }
        case 'image': {
          // Evolution's Image (lib Base, 2.7.1 has none): no pins, its frame kept clear of the other parts; the
          // attributes as evolution writes them (sorted by name, license always, the others when not the default)
          const cfg = getImageConfig(c);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${xmlEsc(String(val))}"/>`;
          // evolution's Attribute.toStandardString drops control characters and "&#...;" text (the image source
          // only drops line breaks); a value that ends up empty is the default and is left out
          const attribution = cfg.attribution.replace(/[\u0000-\u001f]/g, '').replace(/&#.*?;/g, '');
          let attrs = '';
          if (attribution !== '') attrs += a('attribution', attribution);
          if (cfg.height !== IMAGE_DEFAULT_SIZE) attrs += a('height', cfg.height);
          if (cfg.src !== '') attrs += a('image', cfg.src.replace(/[\r\n]+/g, ''));
          attrs += a('license', cfg.license);
          if (cfg.scale !== 'fit') attrs += a('scale', cfg.scale);
          if (cfg.width !== IMAGE_DEFAULT_SIZE) attrs += a('width', cfg.width);
          P.push({ kind: 'ram', part: c.type, attrs, ports: [], lib: BASE_LIB, name: LOGISIM_IMAGE_NAME, box: { x0: 0, y0: 0, x1: cfg.width, y1: cfg.height } });
          usesBase = true;
          usesImage = true;
          const name = `Resim (${c.x},${c.y})`;
          if ((c.rotation ?? 0) % 360 !== 0) warnings.push(`${name}: Logisim-evolution'daki resmin yönü yok; döndürülmeden yazıldı.`);
          if (cfg.src && !cfg.src.startsWith('data:image/'))
            warnings.push(`${name}: resim dosya yolu olarak yazıldı ("${cfg.src}"); Logisim-evolution o dosyayı bulamazsa boş çerçeve çizer.`);
          else if (cfg.src && !imageNaturalSize(cfg.src))
            warnings.push(`${name}: gömülü resim PNG, JPEG, GIF ya da BMP değil; Logisim-evolution onu çizemez, boş çerçeve görünür.`);
          break;
        }
        case 'sevenSegment':
        case 'hexDigit':
        case 'dotMatrix':
        case 'ledBar':
        case 'dipSwitch': {
          // The same Logisim part (lib 5 I/O) on its own connection points. Matrices / LED bars go with their
          // inputs bottom-left (the side is only a drawing choice here, and 2.7.1 knows no other); a hex digit's
          // DP gets a tunnel on 2.7.1's point and on evolution's
          const cfg = getIoConfig(c);
          const a = (name: string, val: string | number | boolean) => `<a name="${name}" val="${val}"/>`;
          let attrs = '';
          const facing = (['east', 'south', 'west', 'north'] as const)[((c.rotation ?? 0) / 90) % 4];
          if (c.type === 'sevenSegment' || c.type === 'hexDigit') {
            if (c.type === 'sevenSegment' && c.state.ioActiveLow) attrs += a('active', false);
            if (!cfg.dp) attrs += a('decimalPoint', false);
          } else if (c.type === 'dipSwitch') {
            attrs += a('facing', facing) + a('number', cfg.size);
          } else if (c.type === 'ledBar') {
            attrs += a('matrixcols', cfg.size) + a('inputtype', cfg.ledBarMode === 'oneWire' ? 'row' : 'column');
          } else {
            const shape = { square: 'square', circle: 'circle', padded: 'clusterSegment' }[c.state.dotShape ?? 'square'];
            attrs += a('inputtype', cfg.matrixInput) + a('matrixcols', cfg.cols) + a('matrixrows', cfg.rows) + a('dotshape', shape);
            if (c.state.ioPersist) attrs += a('persist', c.state.ioPersist);
          }
          if (c.state.ioOnColor) attrs += a('color', c.state.ioOnColor);
          const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
          const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
          const flat = { ...cfg, selectLoc: 'bl' as const };
          const sets =
            c.type === 'hexDigit'
              ? [logisimIoPorts(c.type, flat, { evolution: false }), logisimIoPorts(c.type, flat, { evolution: true }).filter((q) => q.key === 'dp')]
              : [logisimIoPorts(c.type, flat, { evolution: true, facing })];
          for (const set of sets) {
            for (const { key, off } of set) {
              const p = byKey.get(key);
              const isIn = !!p && c.inputs.includes(p);
              const net = !p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN;
              ports.push({ off, net, width: p?.width ?? 1, sink: isIn });
            }
          }
          P.push({ kind: 'ram', part: c.type, attrs, ports, lib: 5, name: LOGISIM_IO_NAME[c.type] });
          if (c.type === 'dipSwitch' || c.type === 'ledBar')
            warnings.push(`${label}: Logisim-evolution parçası (${LOGISIM_IO_NAME[c.type]}); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          if (c.type === 'dipSwitch' && (c.state.dipBits ?? 0) !== 0)
            warnings.push(`${label}: anahtar konumları dosyaya yazılmadı (Logisim saklamaz), dosya açılınca hepsi kapalı.`);
          if (c.type === 'dotMatrix' && c.state.dotShape === 'padded')
            warnings.push(`${label}: boşluklu kare nokta şekli yalnız Logisim-evolution'da var; Logisim 2.7.1 bu dosyayı açamaz.`);
          if (c.type === 'dotMatrix' && cfg.matrixInput === 'select' && (cfg.rows === 1 || cfg.cols === 1))
            warnings.push(`${label}: tek satırlı / tek sütunlu seçim girişli matris Logisim-evolution düzeninde yazıldı; Logisim 2.7.1'de tek girişi var.`);
          break;
        }
        case 'binToBcd':
        case 'bcdToSevenSegment': {
          // Evolution's BFH part on its own connection points. It has no facing: written unrotated, a tunnel on
          // each pin's evolution point (the exporter joins nets by tunnels, so our rotation changes nothing)
          usesBfh = true;
          const bits = binToBcdBits(c);
          const attrs = c.type === 'binToBcd' ? `<a name="binvalue" val="${bits}"/>` : '';
          const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
          const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
          for (const { key, off } of logisimBfhPorts(c.type, bits)) {
            const p = byKey.get(key);
            const isIn = !!p && c.inputs.includes(p);
            const net = !p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN;
            ports.push({ off, net, width: p?.width ?? 1, sink: isIn });
          }
          P.push({ kind: 'ram', part: c.type, attrs, ports, lib: BFH_LIB, name: LOGISIM_BFH_NAME[c.type] });
          if ((c.rotation ?? 0) % 360 !== 0)
            warnings.push(`${label}: Logisim-evolution'daki parçanın yönü yok; döndürülmeden yazıldı (bağlantılar aynı).`);
          break;
        }
        case 'rgbLed':
        case 'joystick':
        case 'matrixKeypad':
        case 'portIo':
        case 'realTimeClock': {
          // Logisim-evolution's part (lib 5 I/O) on its own connection points, facing as our rotation. A joystick
          // turned away from east also gets tunnels on east's points, where Logisim 2.7.1 (no facing) has its
          // ports. The clock's 64-bit output goes through a splitter that keeps the low 32 bits.
          const cfg = getIo5Config(c);
          const a = (name: string, val: string | number | boolean) => `<a name="${name}" val="${xmlEsc(String(val))}"/>`;
          const facing = io5FacingOf(c.type, c.rotation);
          let attrs = '';
          if (c.type === 'rgbLed') {
            attrs += a('facing', facing!);
            if (c.state.ioActiveLow) attrs += a('active', false);
          } else if (c.type === 'joystick') {
            if (facing !== 'east') attrs += a('facing', facing!);
            attrs += a('bits', cfg.joyBits);
            if (c.state.ioOnColor) attrs += a('color', c.state.ioOnColor);
          } else if (c.type === 'matrixKeypad') {
            attrs += a('mode', cfg.keypadMode === 'pmod' ? 'pmod_kypd' : 'raw') + a('size', cfg.keypadSize);
            const names = ['keyALabel', 'keyBLabel', 'keyCLabel', 'keyDLabel', 'keyStarLabel', 'keyHashLabel'];
            names.forEach((n, i) => {
              const k = c.state.keypadKeys?.[i];
              if (k && k !== KEYPAD_DEFAULT_CUSTOM[i]) attrs += a(n, k);
            });
          } else if (c.type === 'portIo') {
            const dir = { input: 'onlyinput', output: 'onlyOutput', inoutSingle: 'IOSingleEnable', inoutMulti: 'IOMultiEnable' }[cfg.portDir];
            attrs += a('facing', facing!) + a('number', cfg.portSize) + a('direction', dir);
          } else {
            attrs += a('facing', facing!) + a('timeType', cfg.rtcType === 's' ? 2 : 1) + a('porsize', cfg.rtcSize === 'narrow' ? 2 : 1);
          }
          const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
          const netOf = (key: string) => {
            const p = byKey.get(key);
            const isIn = !!p && c.inputs.includes(p);
            return { p, isIn, net: !p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN };
          };
          const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
          const sets = [logisimIo5Ports(c.type, cfg, facing)];
          if (c.type === 'joystick' && facing !== 'east') sets.push(logisimIo5Ports(c.type, cfg, 'east'));
          for (const set of sets) {
            for (const { key, off } of set) {
              const { p, isIn, net } = netOf(key);
              if (c.type === 'realTimeClock' && net !== OPEN) {
                const wide = newNet();
                ports.push({ off, net: wide, width: 64, sink: false });
                P.push({ kind: 'splitter', combined: wide, ends: [net], bitEnd: Array.from({ length: 64 }, (_, b) => (b < 32 ? 1 : 0)), appear: 'left', endWidth: [32] });
                continue;
              }
              ports.push({ off, net, width: p?.width ?? 1, sink: isIn });
            }
          }
          P.push({ kind: 'ram', part: c.type, attrs, ports, lib: 5, name: LOGISIM_IO_NAME[c.type] });
          if (c.type !== 'joystick')
            warnings.push(`${label}: Logisim-evolution parçası (${LOGISIM_IO_NAME[c.type]}); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          if (c.type === 'realTimeClock')
            warnings.push(`${label}: Logisim-evolution'ın saati 64 bit; çıkışı alt 32 biti alan bir ayırıcıyla (Splitter) bağlandı.`);
          if (c.type === 'portIo' && (c.state.portPokeKnown ?? 0) !== 0)
            warnings.push(`${label}: bacaklara verilen değerler dosyaya yazılmadı (Logisim saklamaz), dosya açılınca hepsi tanımsız.`);
          break;
        }
        case 'and':
        case 'or':
        case 'nand':
        case 'nor':
        case 'xor':
        case 'xnor':
        case 'oddParity':
        case 'evenParity': {
          // Open inputs stay unconnected: Logisim ignores them like the simulator (none connected
          // gives E, a single one passes through); a Logisim gate has at least 2 inputs
          const gIns = c.inputs.map((_, i) => pin(i));
          while (gIns.length < 2) gIns.push(OPEN);
          P.push({
            kind: 'gate',
            type: c.type === 'oddParity' ? 'ODD' : c.type === 'evenParity' ? 'EVEN' : (c.type.toUpperCase() as GateKind),
            ins: gIns,
            out: out(0),
            mode: c.state.outputMode,
            width: getGateWidth(c),
            negated: c.state.negated,
            xor: c.state.xorMode ?? 'odd',
          });
          break;
        }
        case 'not':
          P.push({ kind: 'not', in: pin(0), out: out(0), mode: c.state.outputMode, width: getGateWidth(c) });
          break;
        case 'buffer':
          P.push({ kind: 'buf', in: pin(0), out: out(0), mode: c.state.outputMode, width: getGateWidth(c) });
          break;
        case 'triState':
          P.push({ kind: 'tri', in: pin(0), en: pin(1), out: out(0), width: getGateWidth(c) });
          break;
        case 'pullResistor':
          if (isConn(c.inputs[0]?.id)) P.push({ kind: 'pull', value: c.state.pullValue ?? 0, at: pin(0) });
          break;
        case 'controlledInverter':
          P.push({ kind: 'tri', in: pin(0), en: pin(1), out: out(0), inv: true, width: getGateWidth(c) });
          break;
        case 'transistor':
        case 'transmissionGate': {
          // Logisim's part (lib Wiring) on its own connection points, facing as our rotation. The gate side is
          // written under both names: evolution reads 'selloc', Logisim 2.7.1 'gate', each skips the other's.
          // Every attribute is written out. Neither Logisim gives the part a label
          const facing = (['east', 'south', 'west', 'north'] as const)[((c.rotation ?? 0) / 90) % 4];
          const selloc = c.state.selectLoc ?? 'tr';
          const w = getGateWidth(c);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const attrs =
            (c.type === 'transistor' ? a('type', c.state.transistorType === 'n' ? 'n' : 'p') : '') +
            a('facing', facing) + a('selloc', selloc) + a('gate', logisimGateLoc271(facing, selloc)) + a('width', w);
          const t = logisimTransistorPorts(facing, selloc);
          const ports = [
            { off: { x: 0, y: 0 }, net: out(0), width: w, sink: false },
            { off: t.source, net: pin(0), width: w, sink: true },
            { off: t.gate, net: pin(1), width: 1, sink: true },
            ...(c.type === 'transmissionGate' ? [{ off: t.gate2, net: pin(2), width: 1, sink: true }] : []),
          ];
          P.push({ kind: 'ram', part: c.type, attrs, ports, lib: 0, name: c.type === 'transistor' ? 'Transistor' : 'Transmission Gate' });
          // (once per file)
          if (c.type === 'transistor' && !warnings.some((x) => x.startsWith('Transistör:')))
            warnings.push(`Transistör: tek transistör Logisim 2.7.1'de her seviyeyi geçirir (Logisim-evolution'da ve burada P tipi yalnız 1'i, N tipi yalnız 0'ı); devre 2.7.1'de farklı çalışabilir.`);
          break;
        }
        case 'pla': {
          // Logisim-evolution's part (lib Gates, name PLA): the input on loc, the output 50 ahead by facing, the
          // body 25 to either side of that line. The program is the text evolution writes (one row a line, as the
          // element's text). Evolution reads a missing or empty table as its 2 x 2 default and takes the widths from
          // it, so a program without rows is left out at 2 x 2 and otherwise written as one row giving 0 for every
          // input (the same outputs as no row)
          const facing = (['east', 'south', 'west', 'north'] as const)[((c.rotation ?? 0) / 90) % 4];
          const cfg = getPlaConfig(c);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const rows = cfg.rows.length || (cfg.inWidth === 2 && cfg.outWidth === 2) ? cfg.rows : [{ in: 'x'.repeat(cfg.inWidth), out: '0'.repeat(cfg.outWidth) }];
          const table = plaTableText(rows).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const attrs = a('facing', facing) + a('in_width', cfg.inWidth) + a('out_width', cfg.outWidth) + (table ? `<a name="table">${table}</a>` : '');
          const o = logisimPlaOutput(facing);
          const box = { x0: Math.min(0, o.x) - (o.x ? 0 : 25), y0: Math.min(0, o.y) - (o.y ? 0 : 25), x1: Math.max(0, o.x) + (o.x ? 0 : 25), y1: Math.max(0, o.y) + (o.y ? 0 : 25) };
          P.push({
            kind: 'ram',
            part: c.type,
            attrs,
            ports: [
              { off: { x: 0, y: 0 }, net: pin(0), width: cfg.inWidth, sink: true },
              { off: o, net: out(0), width: cfg.outWidth, sink: false },
            ],
            lib: 1,
            name: 'PLA',
            box,
          });
          // (once per file)
          if (!warnings.some((x) => x.startsWith('PLA:')))
            warnings.push(`PLA: Logisim-evolution parçası; Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          break;
        }
        case 'passSwitch':
        case 'twoWaySwitch': {
          // Logisim-evolution's parts (lib Input/Output-Extra, names Switch / TwoWaySwitch). The switch has its
          // output on loc, the two-way switch the middle of its body. Every attribute is written out; the lever's
          // position is run state that Logisim does not save
          usesExtra = true;
          const cfg = getExtraSwitchConfig(c);
          const rot = ((c.rotation ?? 0) / 90) % 4;
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const color = a('color', (c.state.switchColor ?? '#ffffff').toLowerCase());
          let ports: Array<{ off: Pt; net: string; width: number; sink: boolean }>;
          let attrs: string;
          let box: { x0: number; y0: number; x1: number; y1: number };
          if (c.type === 'passSwitch') {
            const facing = (['east', 'south', 'west', 'north'] as const)[rot];
            attrs = a('facing', facing) + a('width', cfg.width) + color;
            ports = [
              { off: { x: 0, y: 0 }, net: out(0), width: cfg.width, sink: false },
              { off: logisimPassSwitchInput(facing), net: pin(0), width: cfg.width, sink: true },
            ];
            box = facing === 'east' ? { x0: -20, y0: -15, x1: 0, y1: 15 } : facing === 'west' ? { x0: 0, y0: -15, x1: 20, y1: 15 } : facing === 'south' ? { x0: -15, y0: -20, x1: 15, y1: 0 } : { x0: -15, y0: 0, x1: 15, y1: 20 };
          } else {
            const facing = (['east', 'north', 'west', 'south'] as const)[rot];
            attrs = a('mode', cfg.mode) + a('facing', facing) + a('width', cfg.width) + color;
            const t = logisimTwoWayPorts(facing, cfg.mode);
            ports =
              cfg.mode === '1in2out'
                ? [
                    { off: t.common, net: pin(0), width: cfg.width, sink: true },
                    { off: t.pair[0], net: out(0), width: cfg.width, sink: false },
                    { off: t.pair[1], net: out(1), width: cfg.width, sink: false },
                  ]
                : [
                    { off: t.common, net: out(0), width: cfg.width, sink: false },
                    { off: t.pair[0], net: pin(0), width: cfg.width, sink: true },
                    { off: t.pair[1], net: pin(1), width: cfg.width, sink: true },
                  ];
            box = facing === 'east' || facing === 'west' ? { x0: -20, y0: -15, x1: 20, y1: 15 } : { x0: -15, y0: -20, x1: 15, y1: 20 };
          }
          P.push({ kind: 'ram', part: c.type, attrs, ports, lib: EXTRA_LIB, name: c.type === 'passSwitch' ? 'Switch' : 'TwoWaySwitch', box });
          // (once per file)
          if (!warnings.some((x) => x.startsWith('Geçiş / iki yollu anahtar:')))
            warnings.push(`Geçiş / iki yollu anahtar: Logisim-evolution parçası (Input/Output-Extra); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz. Anahtarların konumu dosyaya yazılmaz (Logisim saklamaz), dosya açılınca hepsi açık / ilk tarafta.`);
          break;
        }
        case 'programmableGenerator': {
          // Logisim-evolution's Programmable Generator (lib Input/Output-Extra, _ID "ProgrammableGenerator"): the output
          // on loc, Probe's 20 x 20 body behind it. Every attribute is written out, the durations as evolution's Contents
          // string as it is. Evolution 5.0.0 has the part switched off in its library (it never got its clock ticks): opening
          // such a file it reports each one as missing from the library and leaves it out; this program reads it
          usesExtra = true;
          const facing = (['east', 'south', 'west', 'north'] as const)[((c.rotation ?? 0) / 90) % 4];
          const a = (name: string, val: string | number) => `<a name="${name}" val="${xmlEsc(String(val))}"/>`;
          const attrs = a('facing', facing) + a('nState', pgStateCount(c)) + a('Contents', c.state.pgContents ?? '');
          const box =
            facing === 'east' ? { x0: -20, y0: -10, x1: 0, y1: 10 }
            : facing === 'west' ? { x0: 0, y0: -10, x1: 20, y1: 10 }
            : facing === 'north' ? { x0: -10, y0: 0, x1: 10, y1: 20 }
            : { x0: -10, y0: -20, x1: 10, y1: 0 };
          P.push({ kind: 'ram', part: c.type, attrs, ports: [{ off: { x: 0, y: 0 }, net: out(0), width: 1, sink: false }], lib: EXTRA_LIB, name: 'ProgrammableGenerator', box });
          if (!warnings.some((x) => x.startsWith('Programlanabilir üreteç:')))
            warnings.push(`Programlanabilir üreteç: Logisim-evolution parçası (Input/Output-Extra ProgrammableGenerator) ama Logisim-evolution 5.0.0'da kütüphaneden çıkarılmış (saat tiklerini hiç almadığı için bozuk); evolution dosyayı açarken her üreteç için hata gösterir, üreteçleri atlar ve kalanını açar; 2.7.1 bu dosyayı açamaz. Bu program okur. Üretecin o anki durumu ve tik sayısı yazılmaz, dosya açılınca ilk durumdan başlar.`);
          break;
        }
        case 'slider': {
          // Logisim-evolution's Slider (lib Input/Output-Extra): the output on loc. Evolution's body does not turn: it
          // lies behind loc facing east / west, below / above its middle facing north / south. Every attribute is
          // written out; the knob's position is run state that Logisim does not save
          usesExtra = true;
          const cfg = getSliderConfig(c);
          const facing = (['east', 'south', 'west', 'north'] as const)[((c.rotation ?? 0) / 90) % 4];
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const radix = c.state.radix ?? '2';
          const attrs =
            a('facing', facing) +
            a('width', cfg.width) +
            a('radix', radix === '10s' ? '10signed' : radix === '10u' ? '10unsigned' : radix) +
            a('color', (c.state.switchColor ?? '#ffffff').toLowerCase()) +
            a('Direction', cfg.rtl ? 'right_to_left' : 'left_to_right');
          const box =
            facing === 'east' ? { x0: -275, y0: -15, x1: 0, y1: 15 }
            : facing === 'west' ? { x0: 0, y0: -15, x1: 275, y1: 15 }
            : facing === 'north' ? { x0: -137, y0: 0, x1: 138, y1: 30 }
            : { x0: -137, y0: -30, x1: 138, y1: 0 };
          P.push({ kind: 'ram', part: c.type, attrs, ports: [{ off: { x: 0, y: 0 }, net: out(0), width: cfg.width, sink: false }], lib: EXTRA_LIB, name: 'Slider', box });
          // (once per file)
          if (!warnings.some((x) => x.startsWith('Kaydırıcı:')))
            warnings.push(`Kaydırıcı: Logisim-evolution parçası (Input/Output-Extra); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz. Düğmenin konumu dosyaya yazılmaz (Logisim saklamaz), dosya açılınca çıkış 0. Kuzey / güney yönlü kaydırıcının gövdesi Logisim'de dönmez, yatay çizilir.`);
          break;
        }
        case 'plaRom': {
          // Logisim-evolution's PlaRom (lib Input/Output-Extra): the input on loc, the output 60 to the right, the
          // chip select 30 right and 30 down; the body has no facing. Every attribute is written out, the matrices as
          // evolution's "Contents" text
          usesExtra = true;
          const cfg = getPlaRomConfig(c);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const attrs =
            a('inputs', cfg.inputs) +
            a('and', cfg.terms) +
            a('outputs', cfg.outputs) +
            a('Contents', plaRomContents(cfg)) +
            a('Select', cfg.csHigh ? 'high' : 'low');
          P.push({
            kind: 'ram',
            part: c.type,
            attrs,
            ports: [
              { off: { x: 0, y: 0 }, net: pin(0), width: cfg.inputs, sink: true },
              { off: { x: 60, y: 0 }, net: out(0), width: cfg.outputs, sink: false },
              { off: { x: 30, y: 30 }, net: pin(1), width: 1, sink: true },
            ],
            lib: EXTRA_LIB,
            name: 'PlaRom',
            box: { x0: 0, y0: -30, x1: 60, y1: 30 },
          });
          if (!warnings.some((x) => x.startsWith('PLA ROM:')))
            warnings.push(`PLA ROM: Logisim-evolution parçası (Input/Output-Extra); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz. Logisim'de PLA ROM dönmez: döndürülmüş olanlar dönmemiş yazılır (bağlantılar korunur).`);
          break;
        }
        case 'twoPinLed': {
          // Logisim-evolution's TWOPINLED (lib Input/Output-Extra): loc in the middle of the body, the anode and the
          // cathode 10 to either side. Its default facing, west, has the anode on the left, as ours unturned
          usesExtra = true;
          const facing = (['west', 'south', 'east', 'north'] as const)[((c.rotation ?? 0) / 90) % 4];
          const t = logisimTwoPinLedPorts(facing);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const attrs =
            a('facing', facing) +
            a('color', (c.state.ioOnColor ?? TWO_PIN_LED_DEFAULTS.on).toLowerCase()) +
            a('offcolor', (c.state.ledOffColor ?? TWO_PIN_LED_DEFAULTS.off).toLowerCase()) +
            a('bipolar', c.state.ledBipolar ? 'true' : 'false') +
            a('reversecolor', (c.state.ledReverseColor ?? TWO_PIN_LED_DEFAULTS.reverse).toLowerCase());
          P.push({
            kind: 'ram',
            part: c.type,
            attrs,
            ports: [
              { off: t.anode, net: pin(0), width: 1, sink: true },
              { off: t.cathode, net: pin(1), width: 1, sink: true },
            ],
            lib: EXTRA_LIB,
            name: 'TWOPINLED',
            box: { x0: -10, y0: -10, x1: 10, y1: 10 },
          });
          if (!warnings.some((x) => x.startsWith('İki uçlu LED:')))
            warnings.push(`İki uçlu LED: Logisim-evolution parçası (Input/Output-Extra); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          break;
        }
        case 'digitalOscilloscope': {
          // Logisim-evolution's Digital Oscilloscope (lib Input/Output-Extra): the clock on loc, the inputs below it
          // 30 apart, enable and clear on the bottom edge; the body has no facing. Every attribute is written out. The
          // drawing is run state, not saved (evolution keeps it in its DiagramState only)
          usesExtra = true;
          const cfg = getOscConfig(c);
          const t = logisimOscPorts(cfg.inputs);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const attrs =
            a('inputs', cfg.inputs) +
            a('nState', cfg.states) +
            a('frontlines', cfg.frontLines) +
            a('showclock', cfg.showClock ? 'true' : 'false') +
            a('color', cfg.color);
          P.push({
            kind: 'ram',
            part: c.type,
            attrs,
            ports: t.map((off, i) => ({ off, net: pin(i), width: 1, sink: true })),
            lib: EXTRA_LIB,
            name: 'Digital Oscilloscope',
            box: logisimOscBox(cfg.inputs, cfg.states, cfg.showClock),
          });
          if (!warnings.some((x) => x.startsWith('Dijital osiloskop:')))
            warnings.push(`Dijital osiloskop: Logisim-evolution parçası (Input/Output-Extra Digital Oscilloscope); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz. Logisim'de osiloskop dönmez: döndürülmüş olanlar dönmemiş yazılır (bağlantılar korunur).`);
          if (c.state.oscRows && !warnings.some((x) => x.startsWith('Dijital osiloskop çizimi:')))
            warnings.push(`Dijital osiloskop çizimi: osiloskoptaki dalga çizimi dosyaya yazılmadı (Logisim saklamaz), dosya açılınca osiloskop boş.`);
          break;
        }
        case 'evoBuzzer': {
          // Logisim-evolution's Buzzer (lib Input/Output-Extra): the enable input on loc, the frequency and the volume
          // beside it, the duty cycle behind. Its default facing, west, has the inputs on the left, as ours unturned.
          // Every attribute is written out
          usesExtra = true;
          const facing = (['west', 'north', 'east', 'south'] as const)[((c.rotation ?? 0) / 90) % 4];
          const cfg = getEvoBuzzerConfig(c);
          const t = logisimEvoBuzzerPorts(facing, cfg.selectLoc);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const wave = { sine: 'Sine', square: 'Square', triangle: 'Triangle', sawtooth: 'Sawtooth', noise: 'Noise' }[cfg.wave];
          const attrs =
            a('facing', facing) +
            a('selloc', cfg.selectLoc) +
            a('freq_measure', cfg.dHz ? 'dHz' : 'Hz') +
            a('vol_width', cfg.volWidth) +
            a('waveform', wave) +
            a('channel', cfg.channel === 'left' ? 1 : cfg.channel === 'right' ? 2 : 3) +
            a('smooth_level', cfg.smoothLevel) +
            a('smooth_width', cfg.smoothWidth);
          P.push({
            kind: 'ram',
            part: c.type,
            attrs,
            ports: [
              { off: t.freq, net: pin(0), width: 14, sink: true },
              { off: t.en, net: pin(1), width: 1, sink: true },
              { off: t.vol, net: pin(2), width: cfg.volWidth, sink: true },
              { off: t.pw, net: pin(3), width: 8, sink: true },
            ],
            lib: EXTRA_LIB,
            name: 'Buzzer',
            box: logisimEvoBuzzerBox(facing),
          });
          if (!warnings.some((x) => x.startsWith('Ses üreteci:')))
            warnings.push(`Ses üreteci: Logisim-evolution parçası (Input/Output-Extra Buzzer); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          break;
        }
        case 'powerOnReset': {
          // Logisim-evolution's part (lib Wiring, name POR): its only connection point, the output, is loc; the
          // body lies behind it by facing. Every attribute is written out. It has no label in Logisim
          const facing = (['east', 'south', 'west', 'north'] as const)[((c.rotation ?? 0) / 90) % 4];
          const cfg = getPorConfig(c);
          const { width: bw, height: bh } = porSizeOf(cfg.size);
          const a = (name: string, val: string | number) => `<a name="${name}" val="${val}"/>`;
          const attrs =
            a('facing', facing) +
            a('porsize', cfg.size === 'medium' ? 1 : cfg.size === 'narrow' ? 2 : 3) +
            a('porTransition', cfg.startHigh ? 1 : 2) +
            a('PorHighDuration', cfg.seconds);
          const box =
            facing === 'east'
              ? { x0: -bw, y0: -bh / 2, x1: 0, y1: bh / 2 }
              : facing === 'west'
                ? { x0: 0, y0: -bh / 2, x1: bw, y1: bh / 2 }
                : facing === 'south'
                  ? { x0: -bh / 2, y0: -bw, x1: bh / 2, y1: 0 }
                  : { x0: -bh / 2, y0: 0, x1: bh / 2, y1: bw };
          P.push({ kind: 'ram', part: c.type, attrs, ports: [{ off: { x: 0, y: 0 }, net: out(0), width: 1, sink: false }], lib: 0, name: 'POR', box });
          // (once per file: the part has no label to tell one from another)
          if (!warnings.some((x) => x.startsWith('Açılış sıfırlaması:')))
            warnings.push(`Açılış sıfırlaması: Logisim-evolution parçası (Power-on Reset); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          break;
        }
        case 'doNotConnect': {
          // Logisim-evolution's mark (lib Wiring, name NoConnect) on its pin
          const net = pin(0);
          P.push({ kind: 'ram', part: c.type, attrs: `<a name="width" val="${w0(c.inputs[0])}"/>`, ports: [{ off: { x: 0, y: 0 }, net, width: w0(c.inputs[0]), sink: true }], lib: 0, name: 'NoConnect' });
          if (!warnings.some((x) => x.startsWith('Bağlanmaz işareti:')))
            warnings.push(`Bağlanmaz işareti: Logisim-evolution parçası (Do Not Connect); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          break;
        }
        case 'splitter4':
          // An open bit leaves its output undriven: x in Logisim, as in the simulator
          for (let i = 0; i < 4; i++) if (c.outputs[i] && isConn(c.inputs[i]?.id)) union(pin(i), out(i));
          break;
        case 'splitter': {
          // Logisim splitter: passive and bidirectional like ours, so every end is just a connection
          const { fanout, bitEnd, appear } = getSplitterConfig(c);
          const { endWidth } = splitterThreads(bitEnd, fanout);
          const end = (i: number) => (isConn(c.outputs[i]?.id) ? netOfPin.get(c.outputs[i].id)! : OPEN);
          P.push({ kind: 'splitter', combined: pin(0), ends: Array.from({ length: fanout }, (_, i) => end(i)), bitEnd, appear, endWidth });
          break;
        }
        case 'bitExtender':
          P.push({
            kind: 'extender',
            in: pin(0),
            ext: c.inputs[1] ? pin(1) : null,
            out: out(0),
            inW: w0(c.inputs[0]),
            outW: w0(c.outputs[0]),
            type: c.state.extendType ?? 'zero',
          });
          break;
        case 'bitSelector':
          P.push({ kind: 'selector', data: pin(0), sel: pin(1), out: out(0), dataW: w0(c.inputs[0]), groupW: w0(c.outputs[0]) });
          break;
        case 'multiplexer':
        case 'demultiplexer':
        case 'decoder':
        case 'priorityEncoder': {
          // Logisim has the same part, so it is written as is; open inputs stay open (read as x by both)
          const { select, width, enable } = getPlexerConfig(c);
          const keys = logisimPlexerPortKeys(c.type, select, enable);
          const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
          const nets: string[] = [];
          const widths: number[] = [];
          const sinks: boolean[] = [];
          for (const k of keys) {
            const p = byKey.get(k);
            const isIn = !!p && c.inputs.includes(p);
            nets.push(!p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN);
            widths.push(p?.width ?? 1);
            sinks.push(isIn);
          }
          P.push({
            kind: 'plexer',
            part: c.type,
            select,
            width,
            enable,
            disabled: c.state.plexDisabled ?? '0',
            tristate: !!c.state.plexTristate,
            nets,
            widths,
            sinks,
          });
          break;
        }
        case 'halfAdder': {
          const [a, b] = [ins(0), ins(1)];
          g('XOR', [a, b], out(0));
          g('AND', [a, b], out(1));
          break;
        }
        case 'fullAdder': {
          const [a, b, cin] = [ins(0), ins(1), ins(2, 0)]; // open carry-in = 0, like Logisim's adder
          const x = g('XOR', [a, b]);
          g('XOR', [x, cin], out(0));
          g('OR', [g('AND', [a, b]), g('AND', [cin, x])], out(1));
          break;
        }
        case 'halfSubtractor': {
          const [a, b] = [ins(0), ins(1)];
          g('XOR', [a, b], out(0));
          g('AND', [not(a), b], out(1));
          break;
        }
        case 'fullSubtractor': {
          const [a, b, bin] = [ins(0), ins(1), ins(2, 0)]; // open borrow-in = 0
          const x = g('XOR', [a, b]);
          g('XOR', [x, bin], out(0));
          g('OR', [g('AND', [not(a), b]), g('AND', [not(x), bin])], out(1));
          break;
        }
        case 'bcdTo7Seg': {
          // Constant tables: minimal sum of products per output bit (address bit 0 = LSB)
          const table: number[] = Array.from({ length: 16 }, (_, k) =>
            (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).reduce((acc, s, i) => acc | ((HEX_7SEG_MAP[k][s] ? 1 : 0) << i), 0)
          );
          const addr = [ins(0), ins(1), ins(2), ins(3)];
          const lit: Record<string, string> = { A: addr[3], B: addr[2], C: addr[1], D: addr[0] };
          const negCache: Record<string, string> = {};
          const neg = (v: string) => (negCache[v] ||= not(lit[v]));
          for (let bit = 0; bit < 7; bit++) {
            if (!c.outputs[bit]) continue;
            const values: Record<number, LogicValue> = {};
            // K-map index: A B C D = address bits 3 2 1 0
            for (let k = 0; k < 16; k++) values[k] = ((table[k] >> bit) & 1) as LogicValue;
            const sop = solveKMap(values, 4).simplifiedSOP.trim();
            if (sop === '0' || sop === '1') {
              union(constNet(sop === '1' ? 1 : 0), out(bit));
              continue;
            }
            const terms = sop.split('+').map((t) => {
              const lits = (t.trim().match(/[A-D]'?/g) || []).map((m) => (m.endsWith("'") ? neg(m[0]) : lit[m[0]]));
              return lits.length === 1 ? lits[0] : g('AND', lits);
            });
            if (terms.length === 1) union(terms[0], out(bit));
            else g('OR', terms, out(bit));
          }
          break;
        }
        case 'srLatch': {
          // Level-sensitive latch = flip-flop driven only by its asynchronous set / reset;
          // S=R=1 holds like the simulator, so each only acts while the other is low
          const [s, r] = [ins(0, 0), ins(1, 0)]; // open S / R holds, as 0 does
          P.push({ kind: 'ff', type: 'D', preset: g('AND', [s, not(r)]), reset: g('AND', [r, not(s)]), q: out(0), qn: out(1) });
          break;
        }
        case 'subcircuit': {
          const sdef = c.state.subcircuitId ? getSubcircuitDefinition(c.state.subcircuitId) : undefined;
          const info = sdef ? subcircuitFor(sdef, depth) : null;
          if (!sdef || !info) {
            warnings.push(`${label}: alt devre tanımı ${sdef ? 'kendi içinde kendini kullanıyor' : 'bulunamadı'}, aktarılmadı.`);
            break;
          }
          // An open IC input stays unconnected: the inner Pin floats (x), like the simulator's open port
          const inPorts = sdef.ports.filter((p) => p.type === 'input');
          const outPorts = sdef.ports.filter((p) => p.type === 'output');
          P.push({
            kind: 'sub',
            circuit: info.circuit,
            ins: inPorts.map((_, i) => pin(i)),
            outs: outPorts.map((_, i) => (c.outputs[i] ? out(i) : OPEN)),
            inW: inPorts.map((p) => subcircuitPortWidth(sdef, p)),
            outW: outPorts.map((p) => subcircuitPortWidth(sdef, p)),
            inOff: info.inOff,
            outOff: info.outOff,
            facing: info.facing,
          });
          break;
        }
        case 'alu': {
          // No Logisim counterpart: built from Logisim's own parts, so the file opens in 2.7.1 too. Adder and
          // Subtractor (A, B, carry-in) give ADD / SUB with C, wide gates the logic operations, a signed
          // Comparator's A<B zero-extended SLT, and an 8-way Multiplexer on op picks Y; the flags come from gates
          const { width: w } = getArithConfig(c);
          const [a, b, op] = [ins(0), ins(1), ins(2)];
          const cin = ins(3, 0); // open carry-in = 0, like Logisim's adder
          const arith = (part: ComponentType, net: Record<string, string>, width: (k: string) => number, attrs = '') => {
            const ports = logisimArithPorts(part, 1);
            const inKeys = new Set(ARITH_PINS[part]!.inputs);
            P.push({
              kind: 'arith',
              part,
              attrs: `<a name="width" val="${w}"/>${attrs}`,
              inputs: 1,
              nets: ports.map(({ key }) => net[key] ?? OPEN),
              widths: ports.map(({ key }) => width(key)),
              sinks: ports.map(({ key }) => inKeys.has(key)),
            });
          };
          const dataW = (k: string) => (k === 'a' || k === 'b' || k === 'out' ? w : 1);
          const [sum, cout, diff, bout, lt] = [newNet(), newNet(), newNet(), newNet(), newNet()];
          arith('adder', { a, b, cin, out: sum, cout }, dataW);
          arith('subtractor', { a, b, bin: cin, out: diff, bout }, dataW);
          arith('comparator', { a, b, lt }, dataW, `<a name="mode" val="${LOGISIM_ARITH_MODE.signed}"/>`);
          const wide = (type: GateKind, x: string, y: string) => {
            const o = newNet();
            P.push({ kind: 'gate', type, ins: [x, y], out: o, width: w });
            return o;
          };
          let slt = lt;
          if (w > 1) {
            slt = newNet();
            P.push({ kind: 'extender', in: lt, ext: null, out: slt, inW: 1, outW: w, type: 'zero' });
          }
          const y = out(0);
          const data = [sum, diff, wide('AND', a, b), wide('OR', a, b), wide('XOR', a, b), wide('NOR', a, b), slt, b];
          const muxKeys = logisimPlexerPortKeys('multiplexer', ALU_OP_BITS, false);
          const muxNet: Record<string, string> = { sel: op, out: y };
          data.forEach((d, k) => (muxNet[`in${k}`] = d));
          P.push({
            kind: 'plexer',
            part: 'multiplexer',
            select: ALU_OP_BITS,
            width: w,
            enable: false,
            disabled: '0',
            tristate: false,
            nets: muxKeys.map((k) => muxNet[k]),
            widths: muxKeys.map((k) => (k === 'sel' ? ALU_OP_BITS : w)),
            sinks: muxKeys.map((k) => k !== 'out'),
          });
          // Bits of a bus: every bit, or just the top one
          const split = (bus: string, n: number) => {
            const ends = Array.from({ length: n }, () => newNet());
            P.push({ kind: 'splitter', combined: bus, ends, bitEnd: ends.map((_, i) => i + 1), appear: 'left', endWidth: ends.map(() => 1) });
            return ends;
          };
          const msb = (bus: string) => {
            if (w === 1) return bus;
            const top = newNet();
            P.push({
              kind: 'splitter',
              combined: bus,
              ends: [OPEN, top],
              bitEnd: Array.from({ length: w }, (_, i) => (i === w - 1 ? 2 : 1)),
              appear: 'left',
              endWidth: [w - 1, 1],
            });
            return top;
          };
          const yBits = w === 1 ? [y] : split(y, w);
          if (c.outputs[1]) {
            if (w === 1) not(y, out(1));
            else g('NOR', yBits, out(1));
          }
          if (c.outputs[2]) union(out(2), yBits[w - 1]);
          if (c.outputs[3] || c.outputs[4]) {
            const [o0, o1, o2] = split(op, ALU_OP_BITS);
            const [n1, n2] = [not(o1), not(o2)];
            const isAdd = g('AND', [not(o0), n1, n2]);
            const isSub = g('AND', [o0, n1, n2]);
            if (c.outputs[3]) g('OR', [g('AND', [isAdd, cout]), g('AND', [isSub, bout])], out(3));
            if (c.outputs[4]) {
              const [sa, sb] = [msb(a), msb(b)];
              const vAdd = g('AND', [g('XNOR', [sa, sb]), g('XOR', [msb(sum), sa])]);
              const vSub = g('AND', [g('XOR', [sa, sb]), g('XOR', [msb(diff), sa])]);
              g('OR', [g('AND', [isAdd, vAdd]), g('AND', [isSub, vSub])], out(4));
            }
          }
          warnings.push(
            `${label}: ALU'nun Logisim'de karşılığı yok; toplayıcı, çıkarıcı, karşılaştırıcı, kapılar ve çoklayıcıdan kurulmuş bir devre olarak aktarıldı (geri içe aktarılınca tek ALU değil, bu parçalar gelir).`
          );
          break;
        }
        default:
          if (circOf(c.type)) {
            // Parts of the component registry (Aşama 6+): one Logisim component facing east, a tunnel on each
            // wired pin's point
            const circ = circOf(c.type)!;
            const lib = CIRC_LIB_NUMBER[circ.lib];
            if (lib === TTL_LIB) usesTtl = true;
            if (lib === BFH_LIB) usesBfh = true;
            if (lib === BASE_LIB) usesBase = true;
            if (lib === EXTRA_LIB) usesExtra = true;
            if (lib === HDL_LIB) usesHdl = true;
            if (lib === TCL_LIB) usesTcl = true;
            if (lib === SOC_LIB) usesSoc = true;
            const attrs = Object.entries(circ.exportAttrs?.(c) ?? {})
              .map(([name, val]) => `<a name="${xmlEsc(name)}" val="${xmlEsc(val)}"/>`)
              .join('');
            const points = circ.ports(c);
            const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
            c.inputs.forEach((p, i) => {
              const off = points.inputs[i];
              if (off) ports.push({ off, net: pinNet(p.id), width: p.width ?? 1, sink: true });
            });
            c.outputs.forEach((p, i) => {
              const off = points.outputs[i];
              if (off) ports.push({ off, net: isConn(p.id) && !selfOnly(c, p) ? out(i) : OPEN, width: p.width ?? 1, sink: false });
            });
            const box = circ.box?.(c);
            P.push({ kind: 'ram', part: c.type, attrs, ports, lib, name: circ.name, ...(box ? { box } : {}) });
            warnings.push(...(circ.exportWarnings?.(c) ?? []).map((text) => `${label}: ${text}`));
            break;
          }
          if (isTtlType(c.type)) {
            // Evolution's TTL library (2.7.1 has none): written facing east with its settings, a tunnel on
            // each wired pin's evolution point (7476: evolution's pin of the same name). The flip-flop / counter
            // contents are not stored (evolution keeps no such attribute).
            const chip = ttlChipOf(c.type)!;
            const vccGnd = getTtlConfig(c).vccGnd;
            usesTtl = true;
            const a = (name: string, val: string | boolean) => `<a name="${name}" val="${val}"/>`;
            let attrs = a('VccGndPorts', vccGnd) + a('ShowInternalStructure', c.state.ttlInternal === true);
            if (chip.expire) {
              // 74123: evolution's 1Rext / 1Cext / 2Rext / 2Cext, plain numbers in kΩ / pF
              const rc = ttlRcOf(c.state);
              for (const h of [0, 1]) attrs += a(`${h + 1}Rext`, String(rc.rext[h])) + a(`${h + 1}Cext`, String(rc.cext[h]));
            }
            const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
            const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
            for (const tp of ttlPorts(chip, vccGnd)) {
              const o = byKey.get(tp.key);
              const inp = tp.dir === 'inout' ? byKey.get(ttlInKey(tp.pin)) : tp.dir === 'input' ? o : undefined;
              const outp = tp.dir === 'input' ? undefined : o;
              // An in/out pin's two halves share the point and the net (alone on it: no wire)
              const net =
                outp && isConn(outp.id) ? (selfOnly(c, outp) ? OPEN : out(c.outputs.indexOf(outp))) : inp ? pinNet(inp.id) : OPEN;
              ports.push({ off: ttlEvoOffset(chip, tp.pin), net, width: 1, sink: tp.dir === 'input' });
            }
            P.push({ kind: 'ram', part: c.type, attrs, ports, lib: TTL_LIB, name: chip.id });
            if (ttlEvoRemapped(chip))
              warnings.push(`${label}: Logisim-evolution'ın ${chip.id}'sı VCC/GND'yi varsayılan bacaklarda (${ttlEvoPin(chip, chip.vcc)}/${ttlEvoPin(chip, chip.gnd)}) tutuyor; bağlantılar evolution'daki aynı isimli bacaklara yazıldı.`);
            if (chip.seq && c.state.ttlSeq)
              warnings.push(`${label}: çipin içindeki saklı değerler dosyaya yazılmadı (Logisim saklamaz); dosya açılınca hepsi 0.`);
            break;
          }
          if (RAM_TYPES.has(c.type)) {
            // Logisim has the same part. The random generator is written in the 2.7.1 layout with tunnels on
            // evolution's points too (evolution opens a file without an appearance in its own look and reads them
            // alike). A RAM / ROM follows evolution's rules: written with its evolution attributes and the classic
            // appearance, on evolution's points only.
            const cfg = getRamConfig(c);
            const evo = c.type !== 'random';
            const a = (name: string, val: string | number | boolean) => `<a name="${name}" val="${val}"/>`;
            let attrs = '';
            let looks: LogisimRamLook[];
            if (c.type === 'random') {
              attrs = a('width', cfg.dataWidth) + a('seed', c.state.randomSeed ?? 0) + a('trigger', getTrigger(c) === 'falling' ? 'falling' : 'rising');
              looks = ['logisim', 'evolution'];
            } else {
              attrs = a('addrWidth', cfg.addrWidth) + a('dataWidth', cfg.dataWidth);
              if (c.type === 'ram' || c.type === 'dualRam') {
                const edge = cfg.trigger === 'rising' || cfg.trigger === 'falling';
                attrs += a('enables', 'byte') + a('databus', { bidir: 'bidir', separate: 'bibus', controlled: 'bibusControlled' }[cfg.dataBus]);
                attrs += a('trigger', cfg.trigger) + a('clearpin', cfg.clearPin);
                if (edge) attrs += a('asyncread', !!c.state.ramAsyncRead) + a('readbehav', c.state.ramReadBehavior ?? 'raw');
                if (edge && cfg.dataWidth > 8) attrs += a('byteenables', cfg.byteEnables ? 'byteEnables' : 'NobyteEnables');
              }
              attrs += a('appearance', 'classic');
              if (c.type === 'rom') {
                const body = memToRawText(c.state.memPages ?? {}, 2 ** cfg.addrWidth).replace(/^v2\.0 raw\n/, '');
                attrs += `<a name="contents">addr/data: ${cfg.addrWidth} ${cfg.dataWidth}\n${body}</a>`;
              }
              looks = ['classic'];
            }
            const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
            const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
            for (const look of looks) {
              for (const { key, off } of logisimRamPorts(c.type, cfg, look)) {
                // The bus read-back 'dio' shares the data point (and net) with 'd'
                if (key === 'dio') continue;
                const p = byKey.get(key);
                const isIn = !!p && c.inputs.includes(p);
                const net = !p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN;
                ports.push({ off, net, width: ramPinWidth(c.type, key, cfg), sink: isIn });
              }
            }
            P.push({ kind: 'ram', part: c.type, attrs, ports });
            if ((c.type === 'ram' || c.type === 'dualRam') && Object.values(c.state.memPages ?? {}).some((pg) => pg.some((v) => v)))
              warnings.push(`${label}: RAM içeriği dosyaya yazılmadı (Logisim RAM içeriğini .circ'te saklamaz); gerekiyorsa içerik düzenleyicisinden v2.0 raw dosyası olarak kaydedin.`);
            if (c.type === 'dualRam')
              warnings.push(`${label}: Logisim-evolution 5'in çift portlu RAM'i (DualRAM) olarak yazıldı; Logisim 2.7.1'de ve evolution'ın 5'ten eski sürümlerinde bu parça yok.`);
            else if (evo)
              warnings.push(`${label}: Logisim-evolution kurallı ${c.type === 'ram' ? 'RAM' : 'ROM'} olarak yazıldı; Logisim 2.7.1 bu parçayı kendi düzeniyle açar, bağlantıları tutmaz.`);
            if (c.type === 'random')
              warnings.push(`${label}: Logisim 2.7.1 aynı bağlantılarla açar ama başka bir sayı dizisi üretir (java.util.Random); dizi Logisim-evolution'da tutar.`);
            break;
          }
          if (MEM_TYPES.has(c.type)) {
            // Logisim has the same part: written with every attribute explicit (the defaults differ between
            // versions and parts) and the classic look; open inputs stay open (read alike by both)
            const { width, length, parallel } = getMemConfig(c);
            const trigger = getTrigger(c);
            let attrs = '';
            if (!FLIP_FLOP_TYPES.has(c.type)) attrs += `<a name="width" val="${width}"/>`;
            if (c.type === 'counter') attrs += `<a name="max" val="0x${getCounterMax(c).toString(16)}"/><a name="ongoal" val="${c.state.counterGoal ?? 'wrap'}"/>`;
            if (c.type === 'shiftRegister') attrs += `<a name="length" val="${length}"/><a name="parallel" val="${parallel}"/>`;
            attrs += `<a name="trigger" val="${trigger}"/><a name="appearance" val="classic"/>`;
            const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
            const ports = memPorts(c.type, length, parallel);
            const nets: string[] = [];
            const widths: number[] = [];
            const sinks: boolean[] = [];
            for (const { key } of ports) {
              const p = byKey.get(key);
              const isIn = !!p && c.inputs.includes(p);
              nets.push(!p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN);
              widths.push(p?.width ?? 1);
              sinks.push(isIn);
            }
            P.push({ kind: 'mem', part: c.type, attrs, length, parallel, nets, widths, sinks });
            // What one of the two Logisim versions reads differently
            const wired = (k: string) => isConn(byKey.get(k)?.id);
            if (FLIP_FLOP_TYPES.has(c.type) && wired('en'))
              warnings.push(`${label}: flip-flop'un EN girişi yalnız Logisim 2.7.1'de var; Logisim-evolution bu bağlantıyı yok sayar (hep etkin).`);
            if (c.type === 'counter' && wired('ud'))
              warnings.push(`${label}: sayacın yukarı/aşağı (UD) girişi yalnız Logisim-evolution'da var; Logisim 2.7.1 hep yukarı sayar.`);
            if (c.type === 'counter' && wired('ld'))
              warnings.push(`${label}: Logisim 2.7.1'de LD = 1 iken CT de 0 değilse sayaç yüklemek yerine geri sayar; Logisim-evolution burada olduğu gibi yükler.`);
            break;
          }
          if (ARITH_TYPES.has(c.type)) {
            // Logisim has the same part: written as is with every attribute explicit; open inputs stay open
            const { width, inputs: n } = getArithConfig(c);
            const mode = getArithMode(c);
            let attrs = `<a name="width" val="${width}"/>`;
            if (c.type === 'bitAdder') attrs += `<a name="inputs" val="${n}"/>`;
            if (ARITH_MODE_PARTS.has(c.type)) attrs += `<a name="mode" val="${LOGISIM_ARITH_MODE[mode]}"/>`;
            if (c.type === 'shifter') attrs += `<a name="shift" val="${c.state.shiftType ?? 'll'}"/>`;
            if (c.type === 'bitFinder') attrs += `<a name="type" val="${c.state.findType ?? 'low1'}"/>`;
            const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
            const nets: string[] = [];
            const widths: number[] = [];
            const sinks: boolean[] = [];
            for (const { key } of logisimArithPorts(c.type, n)) {
              const p = byKey.get(key);
              const isIn = !!p && c.inputs.includes(p);
              nets.push(!p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN);
              widths.push(p?.width ?? 1);
              sinks.push(isIn);
            }
            P.push({ kind: 'arith', part: c.type, attrs, inputs: n, nets, widths, sinks });
            // What Logisim 2.7.1 cannot reproduce (Logisim-evolution reads all of it)
            const name = LOGISIM_ARITH_NAME[c.type];
            if (EVO_ONLY_ARITH.has(c.type)) warnings.push(`${label}: ${name} yalnız Logisim-evolution'da var; Logisim 2.7.1 bu parçayı tanımaz.`);
            else if ((c.type === 'multiplier' || c.type === 'divider') && mode !== 'unsigned' && !(c.type === 'multiplier' && width === 32 && mode === 'signed'))
              warnings.push(`${label}: ${name} modu (${mode === 'signed' ? 'işaretli' : 'işaretli × işaretsiz'}) yalnız Logisim-evolution'da var; Logisim 2.7.1 işaretsiz hesaplar.`);
            if (c.type === 'multiplier' && width === 32 && mode === 'unsigned')
              warnings.push(`${label}: Logisim 2.7.1 32 bitlik çarpıcıyı işaretli hesaplar; işaretsiz sonuç Logisim-evolution'da tutar.`);
            if (c.type === 'divider' && width === 32 && mode === 'unsigned')
              warnings.push(`${label}: Logisim 2.7.1'in 32 bitlik bölücüsü, üst girişin en yüksek biti 1 iken farklı sonuç verir; Logisim-evolution'da tutar.`);
            break;
          }
          warnings.push(`${label}: '${c.type}' Logisim'e aktarılamadı.`);
      }
      if (openInputs)
        warnings.push(`${label}: boştaki giriş(ler)i Logisim'e x (sürücüsüz OPEN tüneli) olarak aktarıldı; kapılarla kurulan karşılığı bazı çıkışlarda simülatörden farklı sonuç verebilir.`);
      // The part's own label, on the Logisim part that stands for it (the last one written: a real-time clock's
      // splitter comes first). Logisim's parts have no label by default, so our default name stays out.
      const own = c.label?.trim();
      const main = P[P.length - 1];
      if (own && own !== COMPONENT_CATALOG[c.type]?.name && main && main.kind !== 'inpin' && main.kind !== 'outpin' && main.kind !== 'clock' && hasLogisimLabel(c.type))
        labelOf.set(main, own);
      // The evo parts a board map can name: each input Pin is the next canvas output, each output Pin the next
      // canvas input; an evo I/O part (DIP switch, 7-segment display, RGB LED, port I/O) has its own pin order
      if (!inScope && options.fpga) {
        // a part still named after its catalog entry has no label of its own: evo's annotation name instead
        const ownName = !!own && own !== COMPONENT_CATALOG[c.type]?.name;
        let nIn = 0;
        let nOut = 0;
        for (const q of P) {
          if (q.kind === 'inpin' || q.kind === 'outpin') {
            const pinOf = q.kind === 'inpin' ? c.outputs[nIn++] : c.inputs[nOut++];
            const wide = (q.width ?? pinOf?.width ?? 1) > 1;
            if (pinOf) mapUnits.push({ prim: q, compId: c.id, pins: [{ pinId: pinOf.id }], fallback: q.kind === 'inpin' ? (wide ? 'Input_bus' : 'Input') : wide ? 'Output_bus' : 'Output', own: ownName });
          }
        }
        const evoPins = EVO_ANNOTATION_NAME[c.type] && main?.kind === 'ram' ? evoPartPins(c) : null;
        if (evoPins) mapUnits.push({ prim: main!, compId: c.id, pins: evoPins, fallback: EVO_ANNOTATION_NAME[c.type]!, own: ownName });
      }
      // The part a dynamic appearance element can name (by the written factory name and location)
      const shown = c.type === 'subcircuit' || DYNAMIC_ELEMENT_OF[c.type] ? P.find((q) => q.kind === 'ram' || q.kind === 'mem' || q.kind === 'sub') : undefined;
      if (shown) partOf.set(shown, c.id);
      if (P.length) blocks.push({ prims: P });
    }

    const constPrims: Prim[] = [];
    if (usesC0) constPrims.push({ kind: 'const', value: 0, out: C0 });
    if (usesC1) constPrims.push({ kind: 'const', value: 1, out: C1 });
    if (constPrims.length) blocks.unshift({ prims: constPrims });

    // The board map names its parts by label: a mapped part gets one evo keeps and the key can carry (evo itself
    // labels such parts before it maps them: Circuit.annotate)
    const mapNotes: CircMapNote[] = [];
    const units: EvoMapUnit[] = [];
    if (mapUnits.length && options.fpga) {
      // (the same test writeBoardmap uses: a part whose stored map no longer fits it is not written, so not renamed)
      const mappedIds = mappedPartIds({ circuitName, components: comps, wires: levelWires, mapping: options.fpga.mapping });
      const mapped = (id: string) => mappedIds.has(id);
      const unitOf = new Map(mapUnits.map((u) => [u.prim, u]));
      const labelOfPrim = (p: Prim) => (p.kind === 'inpin' || p.kind === 'outpin' || p.kind === 'clock' ? p.label : labelOf.get(p));
      // every other label of the circuit, the circuit's name and the part names (evo clears such labels)
      const taken = new Set<string>([circuitName.toUpperCase(), 'PIN', 'CLOCK', 'TUNNEL', 'SPLITTER', 'CONSTANT']);
      for (const p of [...fixed.map((f) => f.prim), ...blocks.flatMap((b) => b.prims)]) {
        if ('name' in p && typeof p.name === 'string') taken.add(p.name.toUpperCase());
        const l = labelOfPrim(p);
        const u = unitOf.get(p);
        if (l && !(u && mapped(u.compId))) taken.add(l.toUpperCase());
      }
      for (const u of mapUnits) {
        if (!mapped(u.compId)) continue;
        const was = labelOfPrim(u.prim) ?? '';
        const label = evoMapLabel(u.own ? was.trim() : '', u.fallback, taken);
        if (label !== was) {
          if (u.prim.kind === 'inpin' || u.prim.kind === 'outpin') {
            u.prim.label = label;
            // (the Pin records follow it)
            for (const r of u.prim.kind === 'inpin' ? inputs : outputs) if (r.compId === u.compId && r.label === was) r.label = label;
          } else labelOf.set(u.prim, label);
          mapNotes.push({ code: 'renamed', values: { from: was, to: label } });
        }
        units.push({ compId: u.compId, label, pins: u.pins });
      }
    }

    // --- readable tunnel names: pins keep their label, the rest are numbered ------------------
    const netName = new Map<string, string>();
    const used = new Set<string>();
    const claim = (base: string) => {
      let n = base.replace(/\s+/g, '_') || 'n';
      for (let i = 2; used.has(n); i++) n = `${base}_${i}`;
      used.add(n);
      return n;
    };
    for (const p of [...fixed.map((f) => f.prim), ...blocks.flatMap((b) => b.prims)]) {
      if (p.kind === 'inpin' || p.kind === 'clock') netName.set(find(p.out), netName.get(find(p.out)) || claim(p.label));
    }
    let counter = 0;
    const openRoots = new Set(openNets.map(find));
    const nameOf = (net: string) => {
      const r = find(net);
      if (!netName.has(r)) netName.set(r, claim(r === find(C0) ? 'GND' : r === find(C1) ? 'VCC' : openRoots.has(r) ? 'OPEN' : `n${counter++}`));
      return netName.get(r)!;
    };

    // --- layout -----------------------------------------------------------------------------
    const xml: string[] = [];
    // Tunnels are written last: one whose width follows its net (probe, pull resistor) needs the widths
    // of all the other tunnels of that net
    const tunnels: Array<{ x: number; y: number; net: string; sink: boolean; width?: number }> = [];
    const tunnel = (x: number, y: number, net: string, sink: boolean, width?: number) => {
      if (net !== OPEN) tunnels.push({ x, y, net, sink, width });
    };
    const widthAttr = (w?: number) => (w && w > 1 ? `<a name="width" val="${w}"/>` : '');
    // Logisim gate "Output Value" ('out'); the default 0/1 is left out like Logisim does
    const outAttr = (m?: OutMode) => (m && m !== '01' ? `<a name="out" val="${m}"/>` : '');
    const CELL_W = 220;
    const CELL_H = 110;
    const PER_ROW = 8;
    let cell = 0;
    const gateOffsets = (n: number) => {
      // Logisim AbstractGate input spacing for size 50
      const [ss, sd, sl] = n <= 3 ? [-10, 20, 20] : [-5, 10, 10];
      return Array.from({ length: n }, (_, i) => (n % 2 ? ss * (n - 1) + sd * i : ss * n + sd * i + (i >= n / 2 ? sl : 0)));
    };
    const written = (p: Prim, name: string, x: number, y: number) => {
      const id = partOf.get(p);
      if (id && placed) placed.set(id, { name, x, y });
    };
    const lab = (p: Prim) => (labelOf.has(p) ? `<a name="label" val="${xmlEsc(labelOf.get(p)!)}"/>` : '');
    const emit = (p: Prim, x: number, y: number) => {
      switch (p.kind) {
        case 'gate': {
          const neg = p.type === 'NAND' || p.type === 'NOR' || p.type === 'XNOR' ? 10 : 0;
          const xorBonus = p.type === 'XOR' || p.type === 'XNOR' ? 10 : 0;
          const dx = 50 + neg + xorBonus;
          const w = p.width ?? 1;
          const negated = p.negated ?? [];
          // A negated input (Logisim 'negateN') sits 10 further out, behind its bubble
          const negAttrs = negated.map((i) => `<a name="negate${i}" val="true"/>`).join('');
          xml.push(
            `    <comp lib="1" loc="(${x},${y})" name="${p.type === 'ODD' ? 'Odd Parity' : p.type === 'EVEN' ? 'Even Parity' : `${p.type} Gate`}">${widthAttr(w)}<a name="inputs" val="${p.ins.length}"/><a name="size" val="50"/>${xorBonus ? `<a name="xor" val="${p.xor === 'one' ? '1' : 'odd'}"/>` : ''}${outAttr(p.mode)}${negAttrs}${lab(p)}</comp>`
          );
          gateOffsets(p.ins.length).forEach((dy, i) => tunnel(x - dx - (negated.includes(i) ? 10 : 0), y + dy, p.ins[i], true, w));
          tunnel(x, y, p.out, false, w);
          break;
        }
        case 'not':
          xml.push(`    <comp lib="1" loc="(${x},${y})" name="NOT Gate">${widthAttr(p.width)}${outAttr(p.mode)}${lab(p)}</comp>`);
          tunnel(x - 30, y, p.in, true, p.width ?? 1);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'buf':
          xml.push(`    <comp lib="1" loc="(${x},${y})" name="Buffer">${widthAttr(p.width)}${outAttr(p.mode)}${lab(p)}</comp>`);
          tunnel(x - 20, y, p.in, true, p.width ?? 1);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'tri':
          // Logisim's (wide) controlled inverter is 10 longer than the buffer; the control stays 1 bit
          xml.push(
            (p.width && p.width > 1) || labelOf.has(p)
              ? `    <comp lib="1" loc="(${x},${y})" name="${p.inv ? 'Controlled Inverter' : 'Controlled Buffer'}">${widthAttr(p.width)}${lab(p)}</comp>`
              : `    <comp lib="1" loc="(${x},${y})" name="${p.inv ? 'Controlled Inverter' : 'Controlled Buffer'}"/>`
          );
          tunnel(x - (p.inv ? 30 : 20), y, p.in, true, p.width ?? 1);
          tunnel(x - (p.inv ? 20 : 10), y + 10, p.en, true, 1);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'ff': {
          const name = p.type === 'D' ? 'D Flip-Flop' : p.type === 'T' ? 'T Flip-Flop' : 'J-K Flip-Flop';
          // Classic look: Logisim-evolution would otherwise open it with its own pin layout (2.7.1 ignores it)
          xml.push(`    <comp lib="4" loc="(${x},${y})" name="${name}"><a name="appearance" val="classic"/></comp>`);
          if (p.type === 'JK') {
            if (p.a) tunnel(x - 40, y, p.a, true, 1);
            if (p.b) tunnel(x - 40, y + 20, p.b, true, 1);
            if (p.clk) tunnel(x - 40, y + 10, p.clk, true, 1);
          } else {
            if (p.a) tunnel(x - 40, y + 20, p.a, true, 1);
            if (p.clk) tunnel(x - 40, y, p.clk, true, 1);
          }
          if (p.reset) tunnel(x - 10, y + 30, p.reset, true, 1);
          if (p.preset) tunnel(x - 30, y + 30, p.preset, true, 1);
          if (p.q) tunnel(x, y, p.q, false, 1);
          if (p.qn) tunnel(x, y + 20, p.qn, false, 1);
          break;
        }
        case 'const':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Constant">${widthAttr(p.width)}<a name="value" val="0x${p.value.toString(16)}"/></comp>`);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'inpin':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Pin">${widthAttr(p.width)}<a name="tristate" val="${!!p.tristate}"/><a name="label" val="${xmlEsc(p.label)}"/></comp>`);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'clock':
          // Durations in ticks; the defaults (1 / 1 / 0) stay out. phaseOffset is evolution's, 2.7.1 skips it
          xml.push(
            `    <comp lib="0" loc="(${x},${y})" name="Clock">${p.high !== 1 ? `<a name="highDuration" val="${p.high}"/>` : ''}${p.low !== 1 ? `<a name="lowDuration" val="${p.low}"/>` : ''}${p.phase !== 0 ? `<a name="phaseOffset" val="${p.phase}"/>` : ''}<a name="label" val="${xmlEsc(p.label)}"/></comp>`
          );
          tunnel(x, y, p.out, false, 1);
          break;
        case 'outpin': {
          // The width is filled in with the tunnels (a probe's follows its net)
          const at = xml.length;
          xml.push('');
          tunnel(x, y, p.in, true, p.width);
          const t = tunnels[tunnels.length - 1];
          pendingPins.push({ at, x, y, label: p.label, width: p.width, tunnel: p.in !== OPEN ? t : undefined });
          break;
        }
        case 'pull':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Pull Resistor"><a name="pull" val="${p.value}"/></comp>`);
          tunnel(x, y, p.at, true);
          break;
        case 'splitter': {
          // Logisim's bitN attribute: end index from 0, 'none' = not mapped (ours: end from 1, 0 = none)
          const fanout = p.ends.length;
          const bits = p.bitEnd.map((e, i) => `<a name="bit${i}" val="${e > 0 ? e - 1 : 'none'}"/>`).join('');
          const appear = p.appear === 'left' ? '' : `<a name="appear" val="${p.appear}"/>`;
          xml.push(
            `    <comp lib="0" loc="(${x},${y})" name="Splitter"><a name="fanout" val="${fanout}"/><a name="incoming" val="${p.bitEnd.length}"/>${appear}${bits}</comp>`
          );
          tunnel(x, y, p.combined, false, p.bitEnd.length);
          logisimSplitterEnds('east', p.appear, fanout).forEach((o, i) => {
            if (p.endWidth[i] > 0) tunnel(x + o.x, y + o.y, p.ends[i], true, p.endWidth[i]);
          });
          break;
        }
        case 'extender':
          xml.push(
            `    <comp lib="0" loc="(${x},${y})" name="Bit Extender"><a name="in_width" val="${p.inW}"/><a name="out_width" val="${p.outW}"/><a name="type" val="${p.type}"/></comp>`
          );
          tunnel(x - 40, y, p.in, true, p.inW);
          if (p.ext !== null) tunnel(x - 20, y - 20, p.ext, true, 1);
          tunnel(x, y, p.out, false, p.outW);
          break;
        case 'selector':
          xml.push(`    <comp lib="2" loc="(${x},${y})" name="BitSelector">${widthAttr(p.dataW)}<a name="group" val="${p.groupW}"/></comp>`);
          tunnel(x - 30, y, p.data, true, p.dataW);
          tunnel(x - 10, y + 10, p.sel, true, bitSelectorSelectWidth(p.dataW, p.groupW));
          tunnel(x, y, p.out, false, p.groupW);
          break;
        case 'plexer': {
          // Every attribute is written out: the defaults differ between Logisim versions
          const name = { multiplexer: 'Multiplexer', demultiplexer: 'Demultiplexer', decoder: 'Decoder', priorityEncoder: 'Priority Encoder' }[p.part];
          let attrs = `<a name="select" val="${p.select}"/>`;
          if (p.part === 'multiplexer' || p.part === 'demultiplexer') attrs += widthAttr(p.width);
          if (p.part === 'demultiplexer' || p.part === 'decoder') attrs += `<a name="tristate" val="${p.tristate}"/>`;
          attrs += `<a name="disabled" val="${p.disabled}"/>`;
          if (p.part !== 'priorityEncoder') attrs += `<a name="enable" val="${p.enable}"/>`;
          xml.push(`    <comp lib="2" loc="(${x},${y})" name="${name}">${attrs}</comp>`);
          logisimPlexerPorts(p.part, 'east', 'bl', p.select, p.enable).forEach((o, k) => tunnel(x + o.x, y + o.y, p.nets[k], p.sinks[k], p.widths[k]));
          break;
        }
        case 'arith':
          xml.push(`    <comp lib="3" loc="(${x},${y})" name="${LOGISIM_ARITH_NAME[p.part]}">${p.attrs}</comp>`);
          logisimArithPorts(p.part, p.inputs).forEach(({ off }, k) => tunnel(x + off.x, y + off.y, p.nets[k], p.sinks[k], p.widths[k]));
          break;
        case 'mem':
          written(p, LOGISIM_MEM_NAME[p.part] ?? '', x, y);
          xml.push(`    <comp lib="4" loc="(${x},${y})" name="${LOGISIM_MEM_NAME[p.part]}">${p.attrs}${lab(p)}</comp>`);
          memPorts(p.part, p.length, p.parallel).forEach(({ off }, k) => tunnel(x + off.x, y + off.y, p.nets[k], p.sinks[k], p.widths[k]));
          break;
        case 'ram':
          written(p, p.name ?? LOGISIM_RAM_NAME[p.part] ?? '', x, y);
          xml.push(`    <comp lib="${p.lib ?? 4}" loc="(${x},${y})" name="${xmlEsc(p.name ?? LOGISIM_RAM_NAME[p.part] ?? '')}">${p.attrs}${lab(p)}</comp>`);
          for (const q of p.ports) tunnel(x + q.off.x, y + q.off.y, q.net, q.sink, q.width);
          break;
        case 'sub':
          written(p, p.circuit, x, y);
          xml.push(`    <comp loc="(${x},${y})" name="${xmlEsc(p.circuit)}"${p.facing === 'east' && !labelOf.has(p) ? '/>' : `>${p.facing === 'east' ? '' : `<a name="facing" val="${p.facing}"/>`}${lab(p)}</comp>`}`);
          p.inOff.forEach((o, i) => tunnel(x + o.x, y + o.y, p.ins[i], true, p.inW[i]));
          p.outOff.forEach((o, i) => tunnel(x + o.x, y + o.y, p.outs[i], false, p.outW[i]));
          break;
      }
    };
    const pendingPins: Array<{ at: number; x: number; y: number; label: string; width?: number; tunnel?: (typeof tunnels)[number] }> = [];

    for (const f of fixed) emit(f.prim, f.x, f.y);
    // Rows a primitive needs: wide gates and tall subcircuit boxes take more than one
    const rowsOf = (p: Prim) => {
      if (p.kind === 'gate') return 1 + (p.ins.length > 8 ? Math.ceil((p.ins.length - 8) / 10) : 0);
      if (p.kind === 'sub') {
        const ys = [...p.inOff, ...p.outOff].map((o) => o.y);
        return ys.length ? Math.ceil((Math.max(...ys) - Math.min(...ys, 0) + 40) / CELL_H) : 1;
      }
      if (p.kind === 'splitter') return Math.ceil((10 * p.ends.length + 40) / CELL_H);
      if (p.kind === 'plexer') {
        const ys = logisimPlexerPorts(p.part, 'east', 'bl', p.select, p.enable).map((o) => o.y);
        return Math.ceil((Math.max(...ys, 0) - Math.min(...ys, 0) + 40) / CELL_H);
      }
      if (p.kind === 'arith') {
        const ys = logisimArithPorts(p.part, p.inputs).map((o) => o.off.y);
        return Math.ceil((Math.max(...ys, 0) - Math.min(...ys, 0) + 40) / CELL_H);
      }
      if (p.kind === 'ram') {
        const ys = [...p.ports.map((q) => q.off.y), ...(p.box ? [p.box.y0, p.box.y1] : [])];
        return Math.ceil((Math.max(...ys, 0) - Math.min(...ys, 0) + 40) / CELL_H);
      }
      return 1;
    };
    // A RAM / ROM / random generator: its rightmost point goes on the x of its last cell, as many cells as its
    // width needs (an ordinary part reaches up to 150 left of its cell's x)
    // A drawn IC box likewise (its ports may lie right of its loc, or far left of it)
    const ramSpan = (p: Prim) => {
      if (p.kind !== 'ram' && p.kind !== 'sub') return { cols: 1, shift: 0 };
      const xs = p.kind === 'sub' ? [...p.inOff, ...p.outOff].map((o) => o.x) : [...p.ports.map((q) => q.off.x), ...(p.box ? [p.box.x0, p.box.x1] : [])];
      const right = Math.max(...xs, 0);
      const span = right - Math.min(...xs, 0);
      const cols = 1 + Math.ceil(Math.max(0, span - 150) / CELL_W);
      return { cols, shift: (cols - 1) * CELL_W - right };
    };
    // A shift register reaches right of its loc: it starts SHIFT_LEFT before its cell and takes as many cells
    // as its length needs, so no tunnel lands on another part's pin
    const SHIFT_LEFT = 150;
    const colsOf = (p: Prim) => {
      if (p.kind === 'ram' || p.kind === 'sub') return ramSpan(p).cols;
      if (p.kind !== 'mem' || p.part !== 'shiftRegister') return 1;
      const w = Math.max(...memPorts(p.part, p.length, p.parallel).map((o) => o.off.x));
      return Math.max(1, Math.ceil((w - 50 + 1) / CELL_W));
    };
    for (const b of blocks) {
      // each block starts on a fresh row when it would not fit, so its parts stay together
      if (cell % PER_ROW !== 0 && (cell % PER_ROW) + b.prims.length > PER_ROW && b.prims.length <= PER_ROW) cell += PER_ROW - (cell % PER_ROW);
      for (const p of b.prims) {
        const extraRows = rowsOf(p) - 1;
        // A primitive reaching above its loc (gate inputs, splitter ends, subcircuit ports) is moved down
        const up =
          p.kind === 'sub'
            ? -Math.min(0, ...p.inOff.map((o) => o.y), ...p.outOff.map((o) => o.y))
            : p.kind === 'splitter'
              ? -Math.min(0, ...logisimSplitterEnds('east', p.appear, p.ends.length).map((o) => o.y))
              : p.kind === 'plexer'
                ? -Math.min(0, ...logisimPlexerPorts(p.part, 'east', 'bl', p.select, p.enable).map((o) => o.y)) + 10
                : p.kind === 'arith'
                  ? -Math.min(0, ...logisimArithPorts(p.part, p.inputs).map((o) => o.off.y)) + 10
                  : p.kind === 'mem'
                    ? -Math.min(0, ...memPorts(p.part, p.length, p.parallel).map((o) => o.off.y)) + 10
                    : p.kind === 'ram'
                      ? -Math.min(0, ...p.ports.map((q) => q.off.y), p.box?.y0 ?? 0) + 10
                      : extraRows * 50;
        const cols = colsOf(p);
        if (cols > 1 && (cell % PER_ROW) + cols > PER_ROW) cell += PER_ROW - (cell % PER_ROW);
        const x = 200 + (cell % PER_ROW) * CELL_W - (p.kind === 'mem' && p.part === 'shiftRegister' ? SHIFT_LEFT : 0) + ramSpan(p).shift;
        const y = 120 + Math.floor(cell / PER_ROW) * CELL_H + Math.ceil(up / 10) * 10;
        cell += cols + extraRows * PER_ROW;
        emit(p, x, y);
      }
    }

    // Net widths from the tunnels of a fixed width; the others follow
    const netWidth = new Map<string, number>();
    for (const t of tunnels) if (t.width !== undefined && !netWidth.has(find(t.net))) netWidth.set(find(t.net), t.width);
    for (const t of tunnels) {
      const w = t.width ?? netWidth.get(find(t.net)) ?? 1;
      xml.push(
        `    <comp lib="0" loc="(${t.x},${t.y})" name="Tunnel"><a name="facing" val="${t.sink ? 'east' : 'west'}"/>${widthAttr(w)}<a name="label" val="${xmlEsc(nameOf(t.net))}"/></comp>`
      );
    }
    for (const p of pendingPins) {
      const w = p.width ?? (p.tunnel ? (netWidth.get(find(p.tunnel.net)) ?? 1) : 1);
      xml[p.at] =
        `    <comp lib="0" loc="(${p.x},${p.y})" name="Pin"><a name="facing" val="west"/><a name="output" val="true"/>${widthAttr(w)}<a name="label" val="${xmlEsc(p.label)}"/></comp>`;
    }
    // Logisim-evolution clears, when it loads the file, every label (a tunnel's too) that is the name of a kind of
    // part used in that circuit, ignoring case (Circuit.removeWrongLabels), and stops on a message box for it.
    // A part labelled with its own kind's name (an IC instance keeps its circuit's name by default) loses
    // nothing: that label is left out. Any other such label is renamed, the same way on every tunnel of a net.
    {
      const compRe = /<comp (?:lib="\d+" )?loc="[^"]*" name="([^"]*)"/;
      const labelRe = /<a name="label" val="([^"]*)"\/>/;
      const kinds = new Set<string>();
      const taken = new Set<string>();
      for (const l of xml) {
        const m = compRe.exec(l);
        if (!m) continue;
        kinds.add(m[1].toUpperCase());
        const lb = labelRe.exec(l);
        if (lb) taken.add(lb[1].toUpperCase());
      }
      const renamed = new Map<string, string>();
      const fresh = (label: string) => {
        let n = `${label}_1`;
        for (let i = 2; kinds.has(n.toUpperCase()) || taken.has(n.toUpperCase()); i++) n = `${label}_${i}`;
        taken.add(n.toUpperCase());
        return n;
      };
      for (let k = 0; k < xml.length; k++) {
        const m = compRe.exec(xml[k]);
        const lb = m ? labelRe.exec(xml[k]) : null;
        // (a Pin labelled with its circuit's name loses it as well: Circuit.isCorrectLabel)
        const circuitNamed = !!lb && m?.[1] === 'Pin' && lb[1].toUpperCase() === xmlEsc(circuitName).toUpperCase();
        if (!m || !lb || (!kinds.has(lb[1].toUpperCase()) && !circuitNamed)) continue;
        if (m[1] !== 'Tunnel' && lb[1].toUpperCase() === m[1].toUpperCase()) {
          xml[k] = xml[k].replace(lb[0], '');
          continue;
        }
        // (a tunnel's net keeps one new name; a part's label gets its own)
        const key = m[1] === 'Tunnel' ? `T:${lb[1]}` : `P:${k}`;
        if (!renamed.has(key)) renamed.set(key, fresh(lb[1]));
        const to = renamed.get(key)!;
        xml[k] = xml[k].replace(lb[0], `<a name="label" val="${to}"/>`);
        if (m[1] === 'Pin' && def === null)
          for (const r of [...inputs, ...outputs]) if (xmlEsc(r.label) === lb[1]) r.label = to.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        if (m[1] !== 'Tunnel')
          warnings.push(`"${circuitName}" devresi: "${lb[1]}" etiketi ${circuitNamed ? 'devrenin kendi adı' : 'devrede kullanılan bir parça türünün adı'}; Logisim-evolution onu silerdi, "${to}" olarak yazıldı.`);
      }
    }
    // Logisim-evolution keeps a label on one part per circuit (ignoring case) and none that is the name of the
    // circuit: it clears the others when it loads the file (2.7.1 keeps them all)
    if (labelOf.size) {
      const names = new Set([xmlEsc(circuitName).toUpperCase()]);
      const count = new Map<string, number>();
      for (const l of xml) {
        const m = /<comp (?:lib="\d+" )?loc="[^"]*" name="([^"]*)"/.exec(l);
        if (!m) continue;
        const lb = m[1] === 'Tunnel' ? null : /<a name="label" val="([^"]*)"\/>/.exec(l);
        if (lb) count.set(lb[1].toUpperCase(), (count.get(lb[1].toUpperCase()) ?? 0) + 1);
      }
      const lost = [...new Set(labelOf.values())].filter((l) => names.has(xmlEsc(l).toUpperCase()) || (count.get(xmlEsc(l).toUpperCase()) ?? 0) > 1);
      if (lost.length)
        warnings.push(
          `"${circuitName}" devresi: Logisim-evolution bir devrede aynı etiketi (büyük / küçük harf ayırmadan) yalnız bir parçada tutar, devrenin adıyla aynı etiketi de siler; şu etiket(ler) orada bir parçadan silinir: ${lost.join(', ')}. Logisim 2.7.1 hepsini tutar.`
        );
    }
    if (def === null && options.fpga) {
      const { lines, notes } = writeBoardmap({ circuitName, components: comps, wires: levelWires, mapping: options.fpga.mapping, board: options.fpga.board, units });
      xml.push(...lines);
      boardmap = { written: lines.length > 0, notes: [...mapNotes, ...notes] };
    }
    return xml.join('\n');
  };

  const top = buildCircuit(topName, components, wires, null, 0);
  const circuit = xmlEsc(topName);
  // evo's tick frequency of the main circuit, for its simulator and its FPGA download
  const tick = evoTickFrequency(clockRates, options.clockHz);
  const tickAttrs =
    tick === undefined ? '' : `    <a name="downloadFrequency" val="${javaDouble(tick)}"/>\n    <a name="simulationFrequency" val="${javaDouble(tick)}"/>\n`;
  if (usesTtl)
    warnings.unshift(
      "TTL çipleri Logisim-evolution'ın TTL kütüphanesiyle yazıldı; Logisim 2.7.1'de bu kütüphane yok, dosyayı yalnız Logisim-evolution açar."
    );
  if (usesImage)
    warnings.unshift(
      "Resimler Logisim-evolution'ın Image parçası olarak yazıldı; Logisim 2.7.1'de bu parça yok, dosyayı yalnız Logisim-evolution açar."
    );
  if (usesBfh)
    warnings.unshift(
      "İkili → BCD ve BCD → 7-segment parçaları Logisim-evolution'ın BFH kütüphanesiyle yazıldı; Logisim 2.7.1'de bu kütüphane yok, dosyayı yalnız Logisim-evolution açar."
    );
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<project source="2.7.1" version="1.0">
  This file was exported by LogicDesign Studio.
  <lib desc="#Wiring" name="0"/>
  <lib desc="#Gates" name="1"/>
  <lib desc="#Plexers" name="2"/>
  <lib desc="#Arithmetic" name="3"/>
  <lib desc="#Memory" name="4"/>
  <lib desc="#I/O" name="5"/>${usesTtl ? `\n  <lib desc="#TTL" name="${TTL_LIB}"/>` : ''}${usesBfh ? `\n  <lib desc="#BFH-Praktika" name="${BFH_LIB}"/>` : ''}${usesBase ? `\n  <lib desc="#Base" name="${BASE_LIB}"/>` : ''}${usesExtra ? `\n  <lib desc="#Input/Output-Extra" name="${EXTRA_LIB}"/>` : ''}${usesHdl ? `\n  <lib desc="#HDL-IP" name="${HDL_LIB}"/>` : ''}${usesTcl ? `\n  <lib desc="#TCL" name="${TCL_LIB}"/>` : ''}${usesSoc ? `\n  <lib desc="#Soc" name="${SOC_LIB}"/>` : ''}
  <main name="${circuit}"/>
  <circuit name="${circuit}">
${tickAttrs}${top}
  </circuit>
${circuitXml.join('\n')}
</project>
`;
  return { xml: doc, warnings, inputs, outputs, ...(boardmap ? { boardmap } : {}) };
}
