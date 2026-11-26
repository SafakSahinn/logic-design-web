// Component registry (Aşama 6.0b).
//
// Every part added from Aşama 6 on is one module under src/parts/<id>/ that describes itself with a
// PartDefinition and calls registerPart(). The old code reaches these parts only through the `default`
// case of its per-type switch blocks, so a new part never touches the old cases.
//
// Dependency rule: part modules must not import circuitEngine, LogisimSimulator or the other old modules.
// Everything a hook needs from them is handed in through its context object. Only `import type` of the
// shared types is allowed. This keeps the old code depending on the registry and never the other way.
import type { ComponentType, ReactNode } from 'react';
import i18n, { registerNamespace } from '../i18n';
import type { CircuitComponentInstance, CircuitWire, ComponentCategory, ComponentMetadata, PinDefinition } from '../types/circuit';
import type { SignalValue } from '../types/logic';
import type { PartId } from './ids';
import en from './locales/en.json';
import tr from './locales/tr.json';

/** i18n namespace of the registry's own texts (toolbox group titles) */
const REGISTRY_NAMESPACE = 'parts';
registerNamespace(REGISTRY_NAMESPACE, { en, tr });

/** Groups of the desktop toolbox a built-in part list already has */
export type BuiltInToolboxGroup = 'wiring' | 'gates' | 'plexers' | 'arithmetic' | 'memory' | 'displays' | 'audio';
/** Groups only registry parts fill; listed after the built-in groups, in this order, when they have parts */
export const PART_TOOLBOX_GROUPS = ['hdl', 'soc'] as const;
export type ToolboxGroup = BuiltInToolboxGroup | (typeof PART_TOOLBOX_GROUPS)[number];

/** What a part's simulate() gets from one step of simulateCircuitStep */
export interface SimContext {
  /** Values of the input pins, in pin order (a wide pin gives its summary; its bits are in comp.inputs[i].bits) */
  raw: SignalValue[];
  /** Sets a 1-bit output */
  setOut(index: number, value: SignalValue): void;
  /** Sets an output from its bits, LSB first (a 1-bit output takes one bit) */
  setBitsOut(index: number, bits: SignalValue[]): void;
  /** The pin is wired to something (a wire or another pin) */
  isConnected(pinId: string): boolean;
  /**
   * The simulation's tick count (the clocks' tick; 0 without clocks or after a reset). Logisim parts that act
   * "on a new tick" compare it with the tick they last acted on.
   */
  tick: number;
  /**
   * Number of the current simulation run: the same for every step of one run (or for the manual single steps of
   * one tick), new for the next run. A part can tell "inputs still settling after a tick" from a later change.
   */
  run: number;
}

/** What a part's draw() gets from the canvas renderer (the same colours the built-in parts use) */
export interface DrawContext {
  /** The canvas colour scheme */
  cadTheme: 'light' | 'dark';
  isSelected: boolean;
  /** Body outline colour and width; both change while the part is selected */
  strokeColor: string;
  strokeWidth: number;
  /** Body fill (an SVG paint: a colour or the canvas's gate gradient) */
  fillColor: string;
  /** Tailwind fill class for text on the body */
  gateTextClass: string;
}

export type PartAttrValue = string | number;

/** Editor of an attribute row in the attribute panel (a subset of the built-in kinds) */
export type PartAttrKind =
  | 'select' // drop-down list
  | 'buttons' // row of toggle buttons
  | 'hex' // hexadecimal text field
  | 'int' // decimal integer text field (32-bit signed)
  | 'text' // free text field, see maxLength
  | 'multiline' // free text box, line breaks kept
  | 'info' // read-only value (a number is shown as a bit width)
  | 'flags' // row of on/off buttons; value = selected option values joined by ',', set takes '+v' / '-v'
  | 'editor'; // the part's own React editor (PartAttribute.editor), for what the kinds above cannot show

export interface PartAttrOption {
  value: PartAttrValue;
  /** Shown as is (numbers, signal names); use labelKey for words */
  label?: string;
  /** i18n key in the part's namespace, e.g. "attributes.mode.options.fast" */
  labelKey?: string;
  /** i18n key of the option's tooltip in the part's namespace */
  titleKey?: string;
  /** Colour swatch drawn instead of the label */
  swatch?: string;
}

/** Result of an attribute edit (see AttrEdit in componentAttributes.ts) */
export interface PartAttrEdit {
  /** The edited part. When its pins changed, the canvas places them again with pinPoints()/the default pins */
  comp: CircuitComponentInstance;
  /** Old pin grid points ("x,y") -> pin id the wires there now follow (null = pin gone, wires stay as open ends) */
  remap?: Map<string, string | null>;
  /** Only the state changed (no pin moved), so the wires stay as they are */
  stateOnly?: boolean;
}

/** What a part's own attribute editor gets (kind 'editor'; only offered for a single selected part) */
export interface PartEditorProps {
  /** The selected part as it is now */
  comp: CircuitComponentInstance;
  /** Applies a value through the attribute's set(), to the newest state of the part (safe after an await) */
  apply(value: PartAttrValue): void;
  /** The canvas colour scheme */
  dark: boolean;
}

/**
 * One row of the part's attribute panel. The row's label comes from the i18n key
 * "attributes.<key>.label" of the part's namespace, its tooltip from "attributes.<key>.title" when present.
 */
export interface PartAttribute {
  key: string;
  kind: PartAttrKind;
  options?: PartAttrOption[] | ((comp: CircuitComponentInstance) => PartAttrOption[]);
  get(comp: CircuitComponentInstance): PartAttrValue;
  /** New part for a value, or null when nothing changes. `wires` are canonical when canonicalWires is set */
  set?(comp: CircuitComponentInstance, value: PartAttrValue, wires: CircuitWire[]): PartAttrEdit | null;
  /** The edit needs canonical (repaired) wires, e.g. to find which input pins are wired */
  canonicalWires?: boolean;
  /** Only offered when exactly one part is selected */
  singleOnly?: boolean;
  /** Shown only for parts where this holds; every selected part must pass */
  visible?(comp: CircuitComponentInstance): boolean;
  /** 'text' fields: the longest text */
  maxLength?: number;
  /** 'editor' rows: the component drawn as the row's value; set to singleOnly as well */
  editor?: ComponentType<PartEditorProps>;
}

export type HdlLang = 'verilog' | 'vhdl';

/**
 * What a part's hdl() gets from the Verilog / VHDL generator: the module's net names for its pins and ways to
 * add lines to the module body. Expressions are in the target language (`lang`).
 */
export interface HdlContext {
  lang: HdlLang;
  /** 1-bit constants of the language (Verilog 1'b0 / 1'b1, VHDL '0' / '1') */
  zero: string;
  one: string;
  /**
   * Value read by input pin `index`: a 1-bit expression, or a vector as wide as the pin. An open pin reads 0
   * and is noted in the output, as for the built-in parts.
   */
  input(index: number): string;
  /** Signal that output pin `index` drives (already declared, as wide as the pin) */
  output(index: number): string;
  /** Drives output pin `index` with an expression */
  assign(index: number, expr: string): void;
  /** Declares an internal signal of the module and returns its unique name */
  signal(hint: string, width?: number): string;
  /** Adds lines to the module body as written (indent them by two spaces) */
  lines(...text: string[]): void;
  /** Adds a comment line to the module body */
  comment(text: string): void;
  /**
   * Name of a helper module (Verilog module / VHDL entity) the part instances. It is written once per file,
   * before the circuit's modules: `render` runs once with the final name. `key` is unique within the part.
   */
  module(key: string, hint: string, render: (lang: HdlLang, name: string) => string): string;
  /** An instance of a module, its ports bound by name to expressions ('' leaves an output unconnected) */
  instance(module: string, hint: string, ports: [port: string, expr: string][]): void;
  /** A note for the export report (already translated, e.g. with partText) */
  warn(text: string): void;
}

export interface PartDefinition {
  id: PartId;
  /** Palette tab; not 'custom', whose tab lists the user's ICs instead of the catalog */
  category: Exclude<ComponentCategory, 'custom'>;
  /** Group of the desktop toolbox the part is listed in */
  group: ToolboxGroup;
  /** Default body size, unrotated */
  width: number;
  height: number;
  /** Default pins; pin names are signal names and are not translated */
  inputs: PinDefinition[];
  outputs: PinDefinition[];
  /**
   * Computes the outputs from the inputs. The component is a fresh shallow copy for this step: replace
   * comp.state.part with a new value instead of mutating the old one (the previous step may share it).
   */
  simulate?(comp: CircuitComponentInstance, ctx: SimContext): void;
  /**
   * Draws the unrotated body as SVG in the part's own box (origin top-left, width x height from size());
   * the canvas applies rotation and draws pins and labels. Lives in the part's draw.tsx.
   * Without it the part is drawn as a plain box with its name.
   */
  draw?(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode;
  /** Body size when it depends on the part's attributes; defaults to width x height */
  size?(comp: CircuitComponentInstance): { width: number; height: number };
  /**
   * Pin places in the unrotated body, in comp.inputs / comp.outputs order, when they depend on the part's
   * attributes; defaults to the relX / relY of the default pins. The canvas rotates and snaps them.
   */
  pinPoints?(comp: CircuitComponentInstance): { inputs: { x: number; y: number }[]; outputs: { x: number; y: number }[] };
  /** Rows of the attribute panel, in order; the label-position row is added after them */
  attributes?: PartAttribute[];
  /**
   * Writes the part's behaviour into the Verilog / VHDL module through `ctx`; every output pin should be
   * driven. Without it the part is reported as not convertible and its outputs are tied to 0.
   */
  hdl?(comp: CircuitComponentInstance, ctx: HdlContext): void;
  /**
   * Puts the part's run state back to power-on when the circuit is reset (test vectors). `comp` is already a
   * copy of the part with its own state object: assign to comp.state fields.
   */
  resetState?(comp: CircuitComponentInstance): void;
  /**
   * A new part was made from the catalog (or a file importer made a default one): give it what must be unique per
   * part, e.g. an id other parts refer to. Returns the part to use; `comp` is the fresh default and may be changed.
   */
  create?(comp: CircuitComponentInstance): CircuitComponentInstance;
  /**
   * The part was copied (copy/paste, duplicate, a duplicated sheet): `comp` is the copy with its new component id
   * and its own state object. Give it new unique ids where the original's must not be shared (evo's copyInto), and
   * record each change in `ctx.renamed` so that copies referring to the old id follow it (relink).
   */
  copied?(comp: CircuitComponentInstance, ctx: CopyContext): CircuitComponentInstance;
  /**
   * After all copies of one copy action went through copied(): `renamed` maps the ids that changed (old -> new).
   * A copy that refers to another part by such an id (a SoC slave naming its bus) switches to the new one.
   */
  relink?(comp: CircuitComponentInstance, renamed: ReadonlyMap<string, string>): CircuitComponentInstance;
  /**
   * Called once at the start of every top-level simulation run with all parts of this type in the circuit (also
   * with none), before the first step. Parts that keep shared run-time objects outside the circuit (SoC buses and
   * their slaves) bring them in line with the circuit here: register new parts, drop deleted ones.
   */
  syncRun?(comps: CircuitComponentInstance[]): void;
}

const parts = new Map<string, PartDefinition>();

// Parts whose outputs change outside an edit (e.g. a runtime finished loading) ask the canvas to simulate again.
const simulationListeners = new Set<() => void>();

/** The canvas listens here and runs the simulation again on each request; returns the unsubscribe function */
export function onSimulationRequest(listener: () => void): () => void {
  simulationListeners.add(listener);
  return () => {
    simulationListeners.delete(listener);
  };
}

/** Asks the canvas to simulate the circuit again */
export function requestSimulation(): void {
  for (const listener of simulationListeners) listener();
}

/** A new part of a registered type after its create() hook (the part itself for other types) */
export function createPart(comp: CircuitComponentInstance): CircuitComponentInstance {
  return parts.get(comp.type)?.create?.(comp) ?? comp;
}

/** What a copied() hook knows about the copy action it is part of */
export interface CopyContext {
  /**
   * The parts that stay in the circuit the copies go to (not the copies themselves). An id held by none of them is
   * free, so a copy may keep it: a cut-and-pasted bus keeps its id and its slaves left behind stay connected.
   */
  others: readonly CircuitComponentInstance[];
  /** Ids changed by copied() hooks, old -> new; read by the relink() hooks */
  renamed: Map<string, string>;
}

/**
 * The copies of one copy action (paste, duplicate, a duplicated sheet) after the copied() hooks, then the relink()
 * hooks of all of them, so that copies referring to each other by part-owned ids stay together. `others` are the
 * parts that stay in the target circuit.
 */
export function copyParts(copies: readonly CircuitComponentInstance[], others: readonly CircuitComponentInstance[]): CircuitComponentInstance[] {
  const ctx: CopyContext = { others, renamed: new Map() };
  const out = copies.map((c) => parts.get(c.type)?.copied?.(c, ctx) ?? c);
  if (ctx.renamed.size === 0) return out;
  return out.map((c) => parts.get(c.type)?.relink?.(c, ctx.renamed) ?? c);
}

/** Runs the syncRun() hook of every registered part that has one, with that type's parts of the circuit */
export function syncPartsForRun(components: readonly CircuitComponentInstance[]): void {
  let byType: Map<string, CircuitComponentInstance[]> | null = null;
  for (const def of parts.values()) {
    if (!def.syncRun) continue;
    if (!byType) {
      byType = new Map();
      for (const c of components) {
        const list = byType.get(c.type);
        if (list) list.push(c);
        else byType.set(c.type, [c]);
      }
    }
    def.syncRun(byType.get(def.id) ?? []);
  }
}

/** i18n namespace of a part: its dictionaries are registered under "part.<id>" */
export function partNamespace(id: PartId): string {
  return `part.${id}`;
}

export function registerPart(def: PartDefinition): void {
  if (parts.has(def.id)) throw new Error(`Part "${def.id}" is registered twice`);
  parts.set(def.id, def);
}

export function getPart(type: string): PartDefinition | undefined {
  return parts.get(type);
}

export function allParts(): PartDefinition[] {
  return [...parts.values()];
}

/** Body size of a registered part, unrotated */
export function partSize(def: PartDefinition, comp: CircuitComponentInstance): { width: number; height: number } {
  return def.size?.(comp) ?? { width: def.width, height: def.height };
}

/** The registered parts listed in a toolbox group, in registration order */
export function partsInGroup(group: ToolboxGroup): PartId[] {
  return [...parts.values()].filter((d) => d.group === group).map((d) => d.id);
}

/** Title of a group only registry parts fill, in the current UI language */
export function toolboxGroupTitle(group: (typeof PART_TOOLBOX_GROUPS)[number]): string {
  return i18n.t(`${REGISTRY_NAMESPACE}:groups.${group}`);
}

/**
 * Toolbox entry of a registered part: its name and the short badge from "meta.badge" (when the part has one),
 * or undefined for a type that is not a registered part.
 */
export function partToolboxName(type: string): { label: string; badge?: string } | undefined {
  const def = parts.get(type);
  return def && { label: partName(def.id), badge: partTextOptional(def.id, 'meta.badge') };
}

/** Display name of a part in the current UI language */
export function partName(id: PartId): string {
  return partText(id, 'meta.name');
}

/** Text of a part's i18n key in the current UI language */
export function partText(id: PartId, key: string): string {
  return i18n.t(`${partNamespace(id)}:${key}`);
}

/** Like partText, but undefined when the key has no text (optional texts such as tooltips) */
export function partTextOptional(id: PartId, key: string): string | undefined {
  const full = `${partNamespace(id)}:${key}`;
  return i18n.exists(full) ? i18n.t(full) : undefined;
}

/** Catalog entry of a registered part; name and description follow the current UI language */
function partMetadata(def: PartDefinition): ComponentMetadata {
  const ns = partNamespace(def.id);
  return {
    type: def.id,
    category: def.category,
    width: def.width,
    height: def.height,
    inputs: def.inputs,
    outputs: def.outputs,
    get name() {
      return partName(def.id);
    },
    get description() {
      return i18n.t(`${ns}:meta.description`);
    },
  };
}

/** The built-in catalog extended with the registered parts; a part id equal to a built-in type is an error */
export function mergePartCatalog<T extends Record<string, ComponentMetadata>>(
  builtIn: T,
): T & Record<PartId, ComponentMetadata> {
  const merged: Record<string, ComponentMetadata> = { ...builtIn };
  for (const def of parts.values()) {
    if (def.id in builtIn) throw new Error(`Part id "${def.id}" clashes with a built-in part type`);
    merged[def.id] = partMetadata(def);
  }
  return merged as T & Record<PartId, ComponentMetadata>;
}
