// The Logisim .circ link of the registry parts (Aşama 7a-2). The app no longer reads or writes .circ files; this
// bridge lives on only for the tests that check the app against Logisim-evolution and is removed in 7h.
// Nothing under src/ outside src/verify may import it.
import type { PartId } from '../../parts';
import type { CircuitComponentInstance } from '../../types/circuit';

/** Logisim libraries a part can be written to (the exporter gives each its library number) */
export type CircLibrary =
  | '#Wiring'
  | '#Gates'
  | '#Plexers'
  | '#Arithmetic'
  | '#Memory'
  | '#I/O'
  | '#TTL'
  | '#BFH-Praktika'
  | '#Base'
  | '#Input/Output-Extra'
  | '#HDL-IP'
  | '#TCL'
  | '#Soc';

/** A point relative to the Logisim part's loc, the part facing east */
export interface CircPoint {
  x: number;
  y: number;
}

/**
 * How a part maps to one Logisim component. The part is always written facing east and wired with a
 * tunnel on each connected pin's point; on import the file's facing turns it.
 */
export interface PartCirc {
  lib: CircLibrary;
  /** Component name in that library */
  name: string;
  /** The part's label is written as Logisim's "label" attribute (and read back) */
  labelled?: boolean;
  /**
   * For parts sharing one Logisim component name: on import the part takes a component only when this
   * returns true for its attributes. Parts without it take the components no such part claimed.
   */
  claims?(attrs: Record<string, string>): boolean;
  /** Logisim attributes to write, without facing and label */
  exportAttrs?(comp: CircuitComponentInstance): Record<string, string>;
  /** Texts for the export report (already translated, e.g. with partText) */
  exportWarnings?(comp: CircuitComponentInstance): string[];
  /**
   * Logisim connection point of each pin, facing east, in comp.inputs / comp.outputs order; null = the pin has
   * none in Logisim. On import it is called with the part importAttrs() made.
   */
  ports(comp: CircuitComponentInstance): { inputs: (CircPoint | null)[]; outputs: (CircPoint | null)[] };
  /**
   * The Logisim body relative to loc, facing east, when it reaches beyond the pins (or has none): export keeps
   * the other parts clear of it.
   */
  box?(comp: CircuitComponentInstance): { x0: number; y0: number; x1: number; y1: number };
  /**
   * The part with the file's attributes applied; `comp` is a new default part. Unreadable values keep the
   * default and give a translated text to `warn`. When it changes the pins, the importer places them again.
   */
  importAttrs?(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance;
}

const handlers = new Map<PartId, PartCirc>();

/** Called once per part by ./parts/index.ts */
export function registerPartCirc(partId: PartId, circ: PartCirc): void {
  if (handlers.has(partId)) throw new Error(`Part "${partId}" has two .circ handlers`);
  handlers.set(partId, circ);
}

/** The .circ handler of a registry part type; undefined = not exportable */
export function circOf(type: string): PartCirc | undefined {
  return handlers.get(type as PartId);
}

/** The registry part type a Logisim component (library description + component name + attributes) stands for */
export function partOfCirc(lib: string, name: string, attrs: Record<string, string> = {}): PartId | undefined {
  const named = [...handlers].filter(([, c]) => c.lib === lib && c.name === name.trim());
  return (named.find(([, c]) => c.claims?.(attrs) === true) ?? named.find(([, c]) => !c.claims))?.[0];
}
