// SoC VGA display (Aşama 6h), after Logisim-evolution's SocVga / VgaState. The part has no pins; it is three things
// on one bus:
//   slave    a 4-byte mode register (word access only). read: the mask of the modes software may select
//            (bit i = mode i allowed); write: a one-hot mask selects that mode, any other value (or a mode that is not
//            allowed) falls back to the initial display mode. Either way the mode now counts as set by software.
//   sniffer  every visible write into the frame buffer (one 0xRRGGBB word per pixel, row by row, from the buffer
//            address) updates the pixel at once
//   master   when the picture must be rebuilt (new mode, new buffer address, new bus, simulation reset) the part reads
//            the whole frame buffer with hidden word reads (reload()); a pixel whose read fails is black
// The engine keeps the pixels in a Uint32Array plus a version and a dirty row range, so the part redraws only what
// changed and only when something changed.
//
// Deviations from evo, on purpose:
//   - canHandle compares unsigned addresses at both ends (evo's end used the signed start address, so a register near
//     the top of the address space never answered)
//   - a soft mode write is compared with the mode in use (evo compared with the mode of the state's creation, which
//     goes stale when the initial mode attribute changes)
//   - a byte / half-word write into the buffer merges into its byte lanes as a memory does (evo stored the whole write
//     value as the pixel); pixels are found by word index, so an unaligned buffer address still matches what a reload
//     reads
import type { SocSlave, SocSniffer } from '../bus/bus';
import {
  HALF_WORD_ACCESS,
  READ_TRANSACTION,
  SocBusError,
  SocTransaction,
  WORD_ACCESS,
  type SocAccess,
} from '../bus/transaction';

export const VGA_REGISTER_SIZE = 4;

/** Display modes in evo's order (the index is the mode number, bit i of the mode register is mode i) */
export const VGA_MODES: readonly { readonly name: string; readonly width: number; readonly height: number }[] = [
  { name: '160x120', width: 160, height: 120 },
  { name: '320x240', width: 320, height: 240 },
  { name: '640x480', width: 640, height: 480 },
  { name: '800x600', width: 800, height: 600 },
  { name: '1024x768', width: 1024, height: 768 },
];
export type VgaMode = 0 | 1 | 2 | 3 | 4;

/** Frame of the part around the picture (evo's LEFT/RIGHT/TOP/BOTTOM_MARGIN) */
export const VGA_MARGIN = { left: 5, right: 5, top: 20, bottom: 20 } as const;

/** Size of the part in a mode: margins + picture */
export function vgaPartSize(mode: number): { width: number; height: number } {
  const m = VGA_MODES[clampVgaMode(mode)];
  return { width: VGA_MARGIN.left + m.width + VGA_MARGIN.right, height: VGA_MARGIN.top + m.height + VGA_MARGIN.bottom };
}

/** A mode number from untrusted input, else 0 (evo's getModeIndex) */
export const clampVgaMode = (v: unknown): VgaMode =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < VGA_MODES.length ? v : 0) as VgaMode;

/** Mode number of a mode name ("640x480"), or undefined */
export function vgaModeByName(name: string): VgaMode | undefined {
  const i = VGA_MODES.findIndex((m) => m.name === name);
  return i < 0 ? undefined : (i as VgaMode);
}

export interface SocVgaConfig {
  /** Unsigned address of the mode register (evo does not align it) */
  startAddress: number;
  /** Unsigned address of the first pixel word */
  bufferAddress: number;
  /** Initial display mode ("DisplayMode"), used until software selects one */
  displayMode: VgaMode;
  /** Modes software may select ("soft160x120" ... "soft1024x768"); flat fields so configs compare field by field */
  soft160x120: boolean;
  soft320x240: boolean;
  soft640x480: boolean;
  soft800x600: boolean;
  soft1024x768: boolean;
}

export const VGA_SOFT_KEYS = ['soft160x120', 'soft320x240', 'soft640x480', 'soft800x600', 'soft1024x768'] as const;

export const VGA_DEFAULT_CONFIG: Readonly<SocVgaConfig> = {
  startAddress: 0,
  bufferAddress: 0,
  displayMode: 0,
  soft160x120: true,
  soft320x240: true,
  soft640x480: true,
  soft800x600: false,
  soft1024x768: false,
};

/** Attributes from untrusted input (a file, an old state): missing or bad fields take the defaults */
export function normalizeVgaConfig(c: Partial<SocVgaConfig> | undefined): SocVgaConfig {
  const d = VGA_DEFAULT_CONFIG;
  const addr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) % 2 ** 32 >>> 0 : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    startAddress: addr(c?.startAddress, d.startAddress),
    bufferAddress: addr(c?.bufferAddress, d.bufferAddress),
    displayMode: c?.displayMode === undefined ? d.displayMode : clampVgaMode(c.displayMode),
    soft160x120: bool(c?.soft160x120, d.soft160x120),
    soft320x240: bool(c?.soft320x240, d.soft320x240),
    soft640x480: bool(c?.soft640x480, d.soft640x480),
    soft800x600: bool(c?.soft800x600, d.soft800x600),
    soft1024x768: bool(c?.soft1024x768, d.soft1024x768),
  };
}

/** The mode register as a read returns it: bit i set when software may select mode i */
export function vgaSoftModeMask(c: SocVgaConfig): number {
  let m = 0;
  VGA_SOFT_KEYS.forEach((k, i) => {
    if (c[k]) m |= 1 << i;
  });
  return m;
}

/** Rows changed since the last takeDirty(), inclusive */
export interface VgaDirtyRows {
  first: number;
  last: number;
}

/** Master name of the reload reads (evo's "vgadma") */
export const VGA_RELOAD_MASTER = 'vgadma';

export class SocVga implements SocSlave, SocSniffer {
  readonly key: string;
  private cfg: SocVgaConfig = { ...VGA_DEFAULT_CONFIG };
  private label: () => string;
  /** Mode selected by software, or null while the initial mode applies (evo's modeSetBySoftware) */
  private softMode: VgaMode | null = null;
  private w = 0;
  private h = 0;
  private pix = new Uint32Array(0);
  private reloadNeeded = true;
  private ver = 0;
  private dirtyFirst = -1;
  private dirtyLast = -1;

  constructor(key: string, config: Partial<SocVgaConfig>, name: () => string) {
    this.key = key;
    this.label = name;
    this.cfg = normalizeVgaConfig(config);
    this.resize();
  }

  /**
   * New attributes. A new initial mode applies (and clears the picture) only while software has not selected one;
   * a new buffer address rebuilds the picture from the new buffer.
   */
  configure(config: Partial<SocVgaConfig>): void {
    const old = this.cfg;
    this.cfg = normalizeVgaConfig(config);
    if (this.softMode === null && this.cfg.displayMode !== old.displayMode) this.resize();
    else if (this.cfg.bufferAddress !== old.bufferAddress) this.invalidate();
  }

  get config(): Readonly<SocVgaConfig> {
    return this.cfg;
  }

  /** Simulation reset (a new evo instance state): the initial mode again, the picture rebuilt from the buffer */
  reset(): void {
    this.softMode = null;
    this.resize();
  }

  /** Mode in use */
  get mode(): VgaMode {
    return this.softMode ?? this.cfg.displayMode;
  }
  /** True once software has written the mode register (since construction / reset()) */
  get modeSetBySoftware(): boolean {
    return this.softMode !== null;
  }
  get width(): number {
    return this.w;
  }
  get height(): number {
    return this.h;
  }

  /** Grows on every visible change (pixels, size, a pending reload); the part redraws when it differs */
  get version(): number {
    return this.ver;
  }

  /** Pixels row by row, each 0xRRGGBB (the top byte is always 0). Read-only for callers. */
  pixels(): Readonly<Uint32Array> {
    return this.pix;
  }

  /** The picture must be rebuilt from the frame buffer (call reload()) */
  get needsReload(): boolean {
    return this.reloadNeeded;
  }

  /** Marks the picture for a rebuild (e.g. the part moved to another bus) */
  invalidate(): void {
    if (this.reloadNeeded) return;
    this.reloadNeeded = true;
    this.ver++;
  }

  /**
   * Rebuilds every pixel with hidden word reads of the frame buffer through `transact` (the bus of the part); a read
   * that fails gives a black pixel. Does nothing unless needsReload.
   */
  reload(transact: (t: SocTransaction) => void): void {
    if (!this.reloadNeeded) return;
    this.reloadNeeded = false;
    const n = this.w * this.h;
    const base = this.cfg.bufferAddress;
    for (let i = 0; i < n; i++) {
      // the 32-bit address space wraps, as the bus addresses of a program do
      const t = new SocTransaction(READ_TRANSACTION, (base + i * 4) >>> 0, 0, WORD_ACCESS, VGA_RELOAD_MASTER);
      t.hidden = true;
      transact(t);
      this.pix[i] = t.hasError ? 0 : t.readData & 0xffffff;
    }
    this.markRows(0, this.h - 1);
  }

  /** Rows changed since the last call (null when none); a full reload or resize reports every row */
  takeDirty(): VgaDirtyRows | null {
    if (this.dirtyFirst < 0) return null;
    const r = { first: this.dirtyFirst, last: this.dirtyLast };
    this.dirtyFirst = this.dirtyLast = -1;
    return r;
  }

  private markRows(first: number, last: number): void {
    if (this.dirtyFirst < 0 || first < this.dirtyFirst) this.dirtyFirst = first;
    if (last > this.dirtyLast) this.dirtyLast = last;
    this.ver++;
  }

  /** New picture size for the mode in use: a black picture that waits for a reload (evo's sizeChanged) */
  private resize(): void {
    const m = VGA_MODES[this.mode];
    this.w = m.width;
    this.h = m.height;
    this.pix = new Uint32Array(m.width * m.height);
    this.reloadNeeded = true;
    this.markRows(0, this.h - 1);
  }

  // ---- sniffer ----

  /** A visible, successful transaction on the bus: writes into the frame buffer update their pixel */
  sniff(t: SocTransaction): void {
    if (!t.isWrite) return;
    // word index from the buffer's first word, modulo the 2^30 words of the address space (a buffer may wrap past
    // 0xFFFFFFFF to 0x0, as reload() reads it)
    const index = ((t.address >>> 2) - (this.cfg.bufferAddress >>> 2)) & 0x3fffffff;
    if (index >= this.pix.length) return;
    this.pix[index] = mergeLanes(this.pix[index], t.address, t.writeData, t.access) & 0xffffff;
    const row = Math.floor(index / this.w);
    this.markRows(row, row);
  }

  // ---- slave (mode register) ----

  name(): string {
    return this.label();
  }
  startAddress(): number {
    return this.cfg.startAddress;
  }
  sizeInBytes(): number {
    return VGA_REGISTER_SIZE;
  }

  canHandle(t: SocTransaction): boolean {
    return t.address >= this.cfg.startAddress && t.address < this.cfg.startAddress + VGA_REGISTER_SIZE;
  }

  handle(t: SocTransaction): void {
    if (!this.canHandle(t)) return;
    t.responder = this.name();
    if (t.access !== WORD_ACCESS) {
      t.error = SocBusError.accessTypeNotSupported;
      return;
    }
    if (t.isRead) t.readData = vgaSoftModeMask(this.cfg);
    if (t.isWrite) this.writeMode(t.writeData);
  }

  /** evo's mode register write: a one-hot mask of an allowed mode selects it, anything else the initial mode */
  private writeMode(data: number): void {
    let mode: VgaMode = this.cfg.displayMode;
    VGA_SOFT_KEYS.forEach((k, i) => {
      if (data === 1 << i && this.cfg[k]) mode = i as VgaMode;
    });
    const before = this.mode;
    this.softMode = mode;
    if (mode !== before) this.resize();
  }
}

/** A word with the bytes of a write merged in by their lanes (little-endian, as SocMemory) */
function mergeLanes(old: number, address: number, data: number, access: SocAccess): number {
  if (access === WORD_ACCESS) return data >>> 0;
  if (access === HALF_WORD_ACCESS) {
    return ((address >>> 1) & 1 ? (old & 0xffff) | ((data & 0xffff) << 16) : (old & 0xffff0000) | (data & 0xffff)) >>> 0;
  }
  const shift = (address & 3) * 8;
  return ((old & ~(0xff << shift)) | ((data & 0xff) << shift)) >>> 0;
}
