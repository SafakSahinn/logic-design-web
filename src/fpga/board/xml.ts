// Reader and writer of the Logisim-evolution board XML (evo fpga/file/BoardReaderClass, BoardWriterClass and
// FpgaIoInformationContainer). The writer follows evo's output (attribute order, 3-space indent, the three
// comments) so an evo board file read and written back is the same file.
import {
  boardIoHasRotation,
  type BoardDefinition,
  type BoardFpga,
  type BoardIo,
  type BoardIoKind,
  type BoardPicture,
  type BoardRotation,
  type BoardVendor,
  type DriveStrength,
  type IoStandard,
  type LedArrayDrive,
  type PullBehavior,
  type ScanningDrive,
  BOARD_IO_KINDS,
  DRIVE_STRENGTHS,
  IO_STANDARDS,
  LED_ARRAY_DRIVES,
  PULL_BEHAVIORS,
  SCANNING_DRIVES,
} from './model';
import { BoardPictureError, decodeBoardPicture, encodeBoardPicture } from './picture';

export type BoardXmlErrorCode =
  | 'notXml'
  | 'missingBoardInformation'
  | 'missingFpgaParameters'
  | 'badFpgaParameter'
  | 'unknownVendor'
  | 'badPicture'
  | 'badBoardName'
  | 'pictureNotJpeg';

export class BoardXmlError extends Error {
  readonly code: BoardXmlErrorCode;
  readonly detail?: string;
  constructor(code: BoardXmlErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

/** Things the reader skipped, as evo does: an unknown element, or a resource with a bad rectangle or pin list */
export interface BoardXmlWarning {
  code: 'unknownComponent' | 'badComponent' | 'noPicture';
  /** Element name of the skipped resource */
  element?: string;
}

// evo's strings, in the order of the model's value lists
const EVO_KIND_NAMES: Record<BoardIoKind, string> = {
  led: 'Led',
  button: 'Button',
  pin: 'Pin',
  sevenSegment: 'SevenSegment',
  sevenSegmentNoDp: 'SevenSegmentNoDp',
  sevenSegmentScanning: 'SevenSegmentScanning',
  dipSwitch: 'DIPSwitch',
  rgbLed: 'RgbLed',
  ledArray: 'LedArray',
  portIo: 'PortIo',
  localBus: 'LocalBus',
};
const EVO_VENDORS: Record<BoardVendor, string> = { altera: 'Altera', xilinx: 'Xilinx', vivado: 'Vivado', openFpga: 'openFPGA' };
const EVO_PULLS = ['Float', 'Pull Up', 'Pull Down'];
const EVO_DRIVES = ['Default', '2 mA', '4 mA', '8 mA', '16 mA', '24 mA'];
const EVO_LED_ARRAY_DRIVES = ['LedDefault', 'LedRowScanning', 'LedColumnScanning', 'RgbDefault', 'RgbRowScanning', 'RgbColScanning'];
const EVO_SCANNING_DRIVES = ['SevenSegDecoded', 'SevenSegScanningActiveLow', 'SevenSegScanningActiveHi'];
const ACTIVE_LOW = 'Active low';

/** Pins evo assumes for a resource whose old-style file gives no direction (IoComponentTypes requirements) */
const LEGACY_INPUTS: Partial<Record<BoardIoKind, number>> = { button: 1, dipSwitch: 8, localBus: 13 };
const LEGACY_OUTPUTS: Partial<Record<BoardIoKind, number>> = {
  led: 1,
  sevenSegment: 8,
  sevenSegmentNoDp: 7,
  rgbLed: 3,
  localBus: 2,
  ledArray: 16,
  sevenSegmentScanning: 9,
};

// Java's Integer.parseInt / parseUnsignedInt / Long.parseLong accept an optional sign and decimal digits only
const parseJavaInt = (s: string | null): number | undefined => (s !== null && /^[+-]?\d{1,10}$/.test(s) ? Number(s) : undefined);
const parseJavaUnsigned = (s: string): number | undefined => (/^\+?\d{1,10}$/.test(s) ? Number(s) : undefined);
const parseJavaLong = (s: string | null): number | undefined =>
  s !== null && /^[+-]?\d{1,18}$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : undefined;

const pullOf = (s: string | null): PullBehavior => PULL_BEHAVIORS[EVO_PULLS.indexOf(s ?? '')] ?? 'float';
// evo writes the default as "Default"; the model's lower-case 'default' never appears in a file
const ioStandardOf = (s: string | null): IoStandard => (s !== 'default' && IO_STANDARDS.includes(s as IoStandard) ? (s as IoStandard) : 'default');
const driveOf = (s: string | null): DriveStrength => DRIVE_STRENGTHS[EVO_DRIVES.indexOf(s ?? '')] ?? 0;

function elementChildren(parent: Element): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

function kindOf(elementName: string): BoardIoKind | undefined {
  const lower = elementName.toLowerCase();
  return BOARD_IO_KINDS.find((k) => EVO_KIND_NAMES[k].toLowerCase() === lower);
}

function readComponent(el: Element, kind: BoardIoKind): BoardIo | undefined {
  let x = -1;
  let y = -1;
  let w = -1;
  let h = -1;
  let rotation: BoardRotation = 0;
  let rows = 4;
  let columns = 4;
  let driveIndex = 0;
  let legacyCount = 0;
  const legacyPins = new Map<number, string>();
  const inputs: string[] = [];
  const outputs: string[] = [];
  const ios: string[] = [];
  let label: string | undefined;
  let ioStandard: IoStandard = 'default';
  let pull: PullBehavior = 'float';
  let drive: DriveStrength = 0;
  let activeLow = false;
  for (const attr of Array.from(el.attributes)) {
    const v = attr.value;
    switch (attr.name) {
      case 'rotation': {
        const r = parseJavaInt(v);
        if (r === undefined) return undefined;
        rotation = r === 90 || r === -90 || r === 180 ? r : 0;
        break;
      }
      case 'LocationX':
        x = parseJavaInt(v) ?? -1;
        break;
      case 'LocationY':
        y = parseJavaInt(v) ?? -1;
        break;
      case 'Width':
        w = parseJavaInt(v) ?? -1;
        break;
      case 'Height':
        h = parseJavaInt(v) ?? -1;
        break;
      case 'Rect_x_y_w_h': {
        const vals = v.split(',');
        if (vals.length === 4) {
          const n = vals.map(parseJavaUnsigned);
          if (n.every((k) => k !== undefined)) [x, y, w, h] = n as number[];
          else x = y = w = h = -1;
        }
        break;
      }
      case 'LedArrayInfo':
      case 'ScanningSevenSegInfo': {
        const vals = v.split(',');
        if (vals.length !== 3) break;
        const isArray = attr.name === 'LedArrayInfo';
        const r = parseJavaUnsigned(vals[0]);
        // The scanning display's second value is -1 when the digits have one select pin each
        const c = isArray ? parseJavaUnsigned(vals[1]) : parseJavaInt(vals[1]);
        if (r === undefined || c === undefined) {
          rows = 4;
          columns = isArray ? 4 : 2;
          driveIndex = 0;
        } else {
          rows = r;
          columns = c;
          driveIndex = Math.max(0, (isArray ? EVO_LED_ARRAY_DRIVES : EVO_SCANNING_DRIVES).indexOf(vals[2]));
        }
        break;
      }
      case 'FPGAPinName':
        legacyCount = 1;
        legacyPins.set(0, v);
        break;
      case 'NrOfPins':
        legacyCount = parseJavaInt(v) ?? 0;
        break;
      case 'Label':
        label = v;
        break;
      case 'FPGAPinDriveStrength':
        drive = driveOf(v);
        break;
      case 'FPGAPinPullBehavior':
        pull = pullOf(v);
        break;
      case 'FPGAPinIOStandard':
        ioStandard = ioStandardOf(v);
        break;
      case 'ActivityLevel':
        activeLow = v === ACTIVE_LOW;
        break;
      case 'InputPinSet':
        inputs.push(...v.split(','));
        break;
      case 'OutputPinSet':
        outputs.push(...v.split(','));
        break;
      case 'BiDirPinSet':
        ios.push(...v.split(','));
        break;
      default:
        if (attr.name.startsWith('FPGAPin_')) {
          const id = parseJavaInt(attr.name.slice('FPGAPin_'.length));
          if (id === undefined) return undefined;
          legacyPins.set(id, v);
        }
    }
  }
  if (x < 0 || y < 0 || w < 1 || h < 1) return undefined;
  let inputPins = inputs;
  let outputPins = outputs;
  let ioPins = ios;
  if (inputs.length + outputs.length + ios.length === 0) {
    // Old files: numbered pins, directions from the kind's default pin counts
    const all: string[] = [];
    for (let i = 0; i < legacyCount; i++) {
      const pin = legacyPins.get(i);
      if (pin === undefined) return undefined;
      all.push(pin);
    }
    const nIn = LEGACY_INPUTS[kind] ?? 0;
    const nOut = LEGACY_OUTPUTS[kind] ?? 0;
    inputPins = all.slice(0, nIn);
    outputPins = all.slice(nIn, nIn + nOut);
    ioPins = all.slice(nIn + nOut);
  }
  const io: BoardIo = {
    kind,
    rect: { x, y, w, h },
    inputPins,
    outputPins,
    ioPins,
    ioStandard,
    pull,
    drive,
    activeLow: kind === 'pin' ? false : activeLow,
    rotation,
  };
  if (label !== undefined) io.label = label;
  if (kind === 'ledArray') io.ledArray = { rows, columns, drive: LED_ARRAY_DRIVES[driveIndex] as LedArrayDrive };
  if (kind === 'sevenSegmentScanning') io.scanning = { digits: rows, selectBits: columns, drive: SCANNING_DRIVES[driveIndex] as ScanningDrive };
  return io;
}

function readFpga(info: Element): BoardFpga {
  let clock: Element | undefined;
  let fpga: Element | undefined;
  let unused: Element | undefined;
  for (const el of elementChildren(info)) {
    if (el.nodeName === 'ClockInformation') clock = el;
    else if (el.nodeName === 'FPGAInformation') fpga = el;
    else if (el.nodeName === 'UnusedPins') unused = el;
  }
  const attr = (el: Element | undefined, name: string) => (el?.hasAttribute(name) ? el.getAttribute(name) : null);
  const required = [
    attr(clock, 'Frequency'),
    attr(clock, 'FPGApin'),
    attr(clock, 'PullBehavior'),
    attr(clock, 'IOStandard'),
    attr(unused, 'PullBehavior'),
    attr(fpga, 'Vendor'),
    attr(fpga, 'Part'),
    attr(fpga, 'Family'),
    attr(fpga, 'Package'),
    attr(fpga, 'Speedgrade'),
  ];
  if (required.some((v) => v === null)) throw new BoardXmlError('missingFpgaParameters');
  const frequency = parseJavaLong(attr(clock, 'Frequency'));
  if (frequency === undefined || frequency < 0) throw new BoardXmlError('badFpgaParameter', 'Frequency');
  const vendorName = (attr(fpga, 'Vendor') as string).toLowerCase();
  const vendor = (Object.keys(EVO_VENDORS) as BoardVendor[]).find((v) => EVO_VENDORS[v].toLowerCase() === vendorName);
  if (!vendor) throw new BoardXmlError('unknownVendor', attr(fpga, 'Vendor') as string);
  const jtagPos = parseJavaInt(attr(fpga, 'JTAGPos') ?? '1');
  if (jtagPos === undefined) throw new BoardXmlError('badFpgaParameter', 'JTAGPos');
  const flashPos = parseJavaInt(attr(fpga, 'FlashPos') ?? '2');
  if (flashPos === undefined) throw new BoardXmlError('badFpgaParameter', 'FlashPos');
  return {
    vendor,
    family: attr(fpga, 'Family') as string,
    part: attr(fpga, 'Part') as string,
    package: attr(fpga, 'Package') as string,
    speedGrade: attr(fpga, 'Speedgrade') as string,
    usbTmc: attr(fpga, 'USBTMC') === 'true',
    jtagPos,
    flashName: attr(fpga, 'FlashName') ?? '',
    flashPos,
    clock: {
      pin: attr(clock, 'FPGApin') as string,
      frequency,
      pull: pullOf(attr(clock, 'PullBehavior')),
      ioStandard: ioStandardOf(attr(clock, 'IOStandard')),
    },
    unusedPull: pullOf(attr(unused, 'PullBehavior')),
  };
}

function readPicture(el: Element): BoardPicture {
  let codeTable: string | null = null;
  let pixels: string | null = null;
  let width = 0;
  let height = 0;
  for (const child of elementChildren(el)) {
    if (child.nodeName === 'CompressionCodeTable' && child.hasAttribute('TableData')) codeTable = child.getAttribute('TableData');
    if (child.nodeName === 'PictureDimension') {
      if (child.hasAttribute('Width')) width = parseJavaInt(child.getAttribute('Width')) ?? 0;
      if (child.hasAttribute('Height')) height = parseJavaInt(child.getAttribute('Height')) ?? 0;
    }
    if (child.nodeName === 'PixelData' && child.hasAttribute('PixelRGB')) pixels = child.getAttribute('PixelRGB');
  }
  if (codeTable === null || pixels === null || width <= 0 || height <= 0) throw new BoardXmlError('badPicture');
  try {
    const picture = decodeBoardPicture(codeTable, pixels, width, height);
    return picture.format === 'jpeg'
      ? { format: 'jpeg', width, height, jpeg: picture.jpeg }
      : { format: 'rgb', width, height, rgb: picture.rgb };
  } catch (e) {
    if (e instanceof BoardPictureError) throw new BoardXmlError('badPicture', e.code);
    throw e;
  }
}

/** Reads a board file. Throws BoardXmlError when evo could not read it either. */
export function parseBoardXml(text: string): { board: BoardDefinition; warnings: BoardXmlWarning[] } {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    throw new BoardXmlError('notXml');
  }
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0) throw new BoardXmlError('notXml');
  const sections = elementChildren(root);
  const infos = sections.filter((s) => s.nodeName === 'BoardInformation');
  if (infos.length !== 1) throw new BoardXmlError('missingBoardInformation');
  const fpga = readFpga(infos[0]);
  const warnings: BoardXmlWarning[] = [];
  const pictures = sections.filter((s) => s.nodeName === 'BoardPicture');
  let picture: BoardPicture | undefined;
  if (pictures.length === 1) picture = readPicture(pictures[0]);
  else warnings.push({ code: 'noPicture' });
  const components: BoardIo[] = [];
  // IOComponents, and the separate sections of older files, each read once if present exactly once (as evo)
  for (const sectionName of ['PinsInformation', 'ButtonsInformation', 'LEDsInformation', 'IOComponents']) {
    const matches = sections.filter((s) => s.nodeName === sectionName);
    if (matches.length !== 1) continue;
    for (const el of elementChildren(matches[0])) {
      const kind = kindOf(el.nodeName);
      if (!kind) {
        warnings.push({ code: 'unknownComponent', element: el.nodeName });
        continue;
      }
      const io = readComponent(el, kind);
      if (io) components.push(io);
      else warnings.push({ code: 'badComponent', element: el.nodeName });
    }
  }
  const board: BoardDefinition = { name: root.nodeName, fpga, components };
  if (picture) board.picture = picture;
  return { board, warnings };
}

// ---- writer ----

const escapeAttr = (s: string) =>
  s.replace(/[&<>"\r\n\t]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\r': '&#13;', '\n': '&#10;', '\t': '&#9;' })[c] as string);

/** One empty element; attributes sorted like evo's DOM serializer (by UTF-16 code unit) */
function emptyElement(indent: string, name: string, attrs: Record<string, string>): string {
  const keys = Object.keys(attrs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `${indent}<${name}${keys.map((k) => ` ${k}="${escapeAttr(attrs[k])}"`).join('')}/>`;
}

/** An XML name evo can use as the root element (and that survives a .circ boardname attribute) */
export function isValidBoardName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) && !/^xml/i.test(name);
}

function componentAttrs(io: BoardIo): Record<string, string> {
  const a: Record<string, string> = { Rect_x_y_w_h: `${io.rect.x},${io.rect.y},${io.rect.w},${io.rect.h}` };
  if (io.label !== undefined) a.Label = io.label;
  if (io.kind === 'ledArray') {
    const la = io.ledArray ?? { rows: 4, columns: 4, drive: 'ledDefault' as const };
    a.LedArrayInfo = `${la.rows},${la.columns},${EVO_LED_ARRAY_DRIVES[LED_ARRAY_DRIVES.indexOf(la.drive)]}`;
  }
  if (io.kind === 'sevenSegmentScanning') {
    const sc = io.scanning ?? { digits: 4, selectBits: 2, drive: 'decoded' as const };
    a.ScanningSevenSegInfo = `${sc.digits},${sc.selectBits},${EVO_SCANNING_DRIVES[SCANNING_DRIVES.indexOf(sc.drive)]}`;
  }
  if (boardIoHasRotation(io.kind) && io.rotation !== 0) a.rotation = String(io.rotation);
  if (io.inputPins.length) a.InputPinSet = io.inputPins.join(',');
  if (io.outputPins.length) a.OutputPinSet = io.outputPins.join(',');
  if (io.ioPins.length) a.BiDirPinSet = io.ioPins.join(',');
  if (io.drive !== 0) a.FPGAPinDriveStrength = EVO_DRIVES[DRIVE_STRENGTHS.indexOf(io.drive)];
  if (io.pull !== 'float') a.FPGAPinPullBehavior = EVO_PULLS[PULL_BEHAVIORS.indexOf(io.pull)];
  if (io.ioStandard !== 'default') a.FPGAPinIOStandard = io.ioStandard;
  if (io.activeLow && io.kind !== 'pin') a.ActivityLevel = ACTIVE_LOW;
  return a;
}

/**
 * Writes a board file as evo's board editor does. A board without a JPEG picture is written without the
 * BoardPicture section (evo cannot open such a file; the board editor adds the picture before exporting).
 */
export function writeBoardXml(board: BoardDefinition, newline = '\n'): string {
  if (!isValidBoardName(board.name)) throw new BoardXmlError('badBoardName', board.name);
  if (board.picture && board.picture.format !== 'jpeg') throw new BoardXmlError('pictureNotJpeg');
  const f = board.fpga;
  const i1 = '   ';
  const i2 = '      ';
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<${board.name}>`,
    `${i1}<BoardInformation>`,
    `${i2}<!--This section decribes the FPGA and its clock-->`,
    emptyElement(i2, 'ClockInformation', {
      Frequency: String(f.clock.frequency),
      FPGApin: f.clock.pin.toUpperCase(),
      PullBehavior: EVO_PULLS[PULL_BEHAVIORS.indexOf(f.clock.pull)],
      IOStandard: f.clock.ioStandard === 'default' ? 'Default' : f.clock.ioStandard,
    }),
    emptyElement(i2, 'FPGAInformation', {
      Vendor: EVO_VENDORS[f.vendor].toUpperCase(),
      Part: f.part,
      Family: f.family,
      Package: f.package,
      Speedgrade: f.speedGrade,
      USBTMC: String(f.usbTmc),
      JTAGPos: String(f.jtagPos),
      FlashName: f.flashName,
      FlashPos: String(f.flashPos),
    }),
    emptyElement(i2, 'UnusedPins', { PullBehavior: EVO_PULLS[PULL_BEHAVIORS.indexOf(f.unusedPull)] }),
    `${i1}</BoardInformation>`,
    `${i1}<IOComponents>`,
    `${i2}<!--This section describes all Components present on the boards-->`,
    ...board.components.map((io) => emptyElement(i2, EVO_KIND_NAMES[io.kind], componentAttrs(io))),
    `${i1}</IOComponents>`,
  ];
  if (board.picture?.format === 'jpeg') {
    const { codeTable, pixels } = encodeBoardPicture(board.picture.jpeg);
    lines.push(
      `${i1}<BoardPicture>`,
      `${i2}<!--This section hold the board picture-->`,
      emptyElement(i2, 'PictureDimension', { Width: String(board.picture.width), Height: String(board.picture.height) }),
      emptyElement(i2, 'CompressionCodeTable', { TableData: codeTable }),
      emptyElement(i2, 'PixelData', { PixelRGB: pixels }),
      `${i1}</BoardPicture>`,
    );
  }
  lines.push(`</${board.name}>`, '');
  return lines.join(newline);
}
