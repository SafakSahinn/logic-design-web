// Run-time side of the SoC VGA part: one SocVga per component id, outside the circuit (a SocSlaveCache, as the
// PIOs), attached to its bus as a slave (the mode register) and a sniffer (frame buffer writes) at once.
//
// The picture is rebuilt lazily: whenever the engine needs a reload (a new mode, buffer address, bus, simulation
// reset) the next refresh() reads the frame buffer over the bus the part is attached to. In the browser each VGA
// keeps one offscreen canvas that only refresh-and-paint (surface()) updates, from the engine's dirty rows: that is
// the engine's single takeDirty() consumer, and every body that shows the VGA copies from it.
import { SocVga, type SocBus, type SocVgaConfig } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { SocSlaveCache, socManager, type SocSlaveEntry } from '../shared/socRuntime';
import { vgaConfig, vgaName, vgaState } from './model';

/** A VGA that knows its bus and paints itself into an offscreen canvas */
export class VgaRuntime extends SocVga {
  /** "<connected>:<bus id>" of the last check; a change means another bus (or the bus came or went) */
  private busKey = '';
  /** The bus object and its generation at the last check: another object, new slaves or a hidden write rebuild */
  private busObj: SocBus | undefined;
  private busGen = -1;
  private canvas: HTMLCanvasElement | null = null;
  private image: ImageData | null = null;

  /**
   * The picture rebuilds from the buffer when the bus changed: another bus (or it appeared / went away), another bus
   * object under the same id, a slave attached / detached, or a hidden write (a program load) the sniffer never saw.
   */
  checkBus(): void {
    const a = socManager.attachmentOf(this.key);
    const key = a ? `${a.connected ? 1 : 0}:${a.busId}` : '';
    const bus = a?.connected ? socManager.getBus(a.busId) : undefined;
    const gen = bus?.generation ?? -1;
    if (key === this.busKey && bus === this.busObj && gen === this.busGen) return;
    this.busKey = key;
    this.busObj = bus;
    this.busGen = gen;
    this.invalidate();
  }

  /** Brings the picture up to date: checks the bus, then reloads the frame buffer when needed and a bus is there */
  refresh(): void {
    this.checkBus();
    if (!this.needsReload) return;
    const a = socManager.attachmentOf(this.key);
    if (a?.connected) this.reload((t) => socManager.transact(a.busId, t));
  }

  /**
   * The picture as a canvas of width x height (browser only, null without a DOM): refresh(), then the rows that
   * changed since the last call are copied in. Compare `version` to tell whether it changed.
   */
  surface(): HTMLCanvasElement | null {
    this.refresh();
    if (typeof document === 'undefined') return null;
    const w = this.width;
    const h = this.height;
    if (!this.canvas) this.canvas = document.createElement('canvas');
    const g = this.canvas.getContext('2d');
    if (!g) return null;
    let first: number;
    let last: number;
    const dirty = this.takeDirty();
    if (!this.image || this.image.width !== w || this.image.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.image = g.createImageData(w, h);
      first = 0;
      last = h - 1;
    } else if (dirty) {
      first = dirty.first;
      last = dirty.last;
    } else return this.canvas;
    // 0xRRGGBB -> RGBA bytes (little-endian words: 0xAABBGGRR)
    const px = this.pixels();
    const out = new Uint32Array(this.image.data.buffer);
    for (let i = first * w, end = (last + 1) * w; i < end; i++) {
      const p = px[i];
      out[i] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
    }
    g.putImageData(this.image, 0, 0, 0, first, w, last - first + 1);
    return this.canvas;
  }
}

export type VgaEntry = SocSlaveEntry<SocVgaConfig>;

const vgas = new SocSlaveCache<VgaRuntime, SocVgaConfig>({
  create: (key, config, name) => new VgaRuntime(key, config, name),
  configure: (v, config) => v.configure(config),
  reset: (v) => v.reset(),
  // the mode register and the frame buffer sniffer in one attachment (attachSlave alone would drop the sniffer)
  attach: (busId, v) => {
    socManager.attachSlaveAndSniffer(busId, v);
    v.checkBus();
  },
});

/** The cache entry of a part (syncRun() and tests use this one) */
export function vgaEntry(comp: CircuitComponentInstance): VgaEntry {
  const s = vgaState(comp);
  return { key: comp.id, busId: s.busId, name: vgaName(comp), config: vgaConfig(comp), epoch: s.epoch ?? 0 };
}

/** The VGA of a part, created on first use; new attributes keep the picture where they can, a new epoch resets it */
export const vgaObject = (e: VgaEntry): VgaRuntime => vgas.object(e);

/** The VGA of a part when one exists (drawing, size, status) */
export const peekVga = (key: string): VgaRuntime | undefined => vgas.peek(key);

/** Attaches exactly these parts' VGAs to their buses; parts no longer in the circuit are detached */
export const syncVgas = (entries: readonly VgaEntry[]): void => vgas.sync(entries);

/**
 * Mode the part shows, which sets its size: the one software selected, else the initial mode attribute (read from the
 * part, so a new attribute shows at once, before the next simulation run hands it to the engine)
 */
export function vgaShownMode(comp: CircuitComponentInstance): number {
  const v = peekVga(comp.id);
  return v?.modeSetBySoftware ? v.mode : vgaState(comp).displayMode;
}

/** Test hook */
export const resetVgaRuntimeForTests = (): void => vgas.clear();
