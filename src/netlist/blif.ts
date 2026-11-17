// BLIF front end: parses Berkeley Logic Interchange Format text into a Netlist.
//
// Supported: .model/.inputs/.outputs/.end, .names covers (on-set or off-set), .latch (re/fe/ah/al), .conn,
// .subckt/.gate of library cells (cells.ts) or of other models in the same file (flattened), # comments
// and '\' line continuations. Ignored: .clock, .cname, .attr, .param, .area, .delay and the other timing
// directives, and the .exdc don't-care network. yosys writes all of this with `write_blif` (with or without
// -icells, -gates, -conn, -cname, -attr, -param, -impltf).
//
// Ports follow Logisim-evolution's BlifParser so .circ files keep their pin order: a name in both .inputs
// and .outputs is an output; single names come first in sorted order, then buses ("a[0]".."a[3]" -> a,
// 4 bits) in sorted order; a one-bit bus keeps its "[0]" name.
import { libraryCell } from './cells';
import { NET_FALSE, NET_TRUE, NET_UNDEF, NetlistError, type Netlist, type NetlistCell, type NetlistPort } from './ir';

/** Widest port, as the app's MAX_BIT_WIDTH */
const MAX_PORT_WIDTH = 32;
/** Cells after flattening; guards against a hierarchy that multiplies out of reach */
const MAX_CELLS = 500_000;

const IGNORED = new Set([
  '.end',
  '.clock',
  '.cname',
  '.attr',
  '.param',
  '.area',
  '.delay',
  '.wire_load_slope',
  '.wire',
  '.input_arrival',
  '.output_required',
  '.default_input_arrival',
  '.default_output_required',
  '.default_input_drive',
  '.default_output_load',
  '.input_drive',
  '.output_load',
  '.max_input_load',
  '.default_max_input_load',
  '.blackbox',
]);

interface Line {
  no: number;
  words: string[];
}

type Item =
  | { kind: 'names'; line: number; nets: string[]; rows: string[]; onSet: boolean }
  | { kind: 'latch'; line: number; words: string[] }
  | { kind: 'conn'; line: number; from: string; to: string }
  | { kind: 'inst'; line: number; type: string; pins: Map<string, string> };

interface Model {
  name: string;
  line: number;
  inputs: string[];
  outputs: string[];
  items: Item[];
}

/** Splits the text into logical lines: comments removed, continuations joined, blank lines dropped */
function logicalLines(text: string): Line[] {
  const out: Line[] = [];
  const raw = text.split(/\r\n|\r|\n/);
  let pending: string[] = [];
  let start = 0;
  raw.forEach((src, i) => {
    let s = src;
    const hash = s.indexOf('#');
    if (hash >= 0) s = s.slice(0, hash);
    const cont = /\\\s*$/.test(s);
    if (cont) s = s.replace(/\\\s*$/, '');
    if (pending.length === 0) start = i + 1;
    pending.push(...s.split(/\s+/).filter((w) => w !== ''));
    if (!cont) {
      if (pending.length) out.push({ no: start, words: pending });
      pending = [];
    }
  });
  if (pending.length) out.push({ no: start, words: pending });
  return out;
}

function fail(code: string, message: string, line: number, params: Record<string, string | number> = {}): never {
  throw new NetlistError(code, message, params, line);
}

function parseModels(text: string): Model[] {
  const models: Model[] = [];
  let model: Model | undefined;
  let names: Extract<Item, { kind: 'names' }> | undefined;
  let skipping = false; // inside .exdc
  const current = (line: number): Model => {
    if (!model) {
      // a file may start without .model; its name is then empty
      model = { name: '', line, inputs: [], outputs: [], items: [] };
      models.push(model);
    }
    return model;
  };

  for (const { no, words } of logicalLines(text)) {
    const head = words[0];
    if (!head.startsWith('.')) {
      if (skipping) continue;
      if (!names) fail('stray', `unexpected text "${head}"`, no, { text: head });
      const nIn = names.nets.length - 1;
      const pattern = nIn === 0 ? '' : words[0];
      const value = nIn === 0 ? words[0] : words[1];
      if (words.length !== (nIn === 0 ? 1 : 2) || pattern.length !== nIn || !/^[01-]*$/.test(pattern) || (value !== '0' && value !== '1'))
        fail('badRow', `bad cover row "${words.join(' ')}" for ${nIn} inputs`, no, { row: words.join(' '), inputs: nIn });
      const onSet = value === '1';
      if (names.rows.length && names.onSet !== onSet) fail('mixedCover', 'cover mixes rows for output 1 and output 0', no);
      names.onSet = onSet;
      names.rows.push(pattern);
      continue;
    }
    names = undefined;
    if (head === '.model') {
      skipping = false;
      model = { name: words[1] ?? '', line: no, inputs: [], outputs: [], items: [] };
      models.push(model);
      continue;
    }
    if (head === '.end') {
      skipping = false;
      model = undefined;
      continue;
    }
    if (head === '.exdc') {
      skipping = true;
      continue;
    }
    if (skipping || IGNORED.has(head)) continue;
    const m = current(no);
    switch (head) {
      case '.inputs':
        m.inputs.push(...words.slice(1));
        break;
      case '.outputs':
        m.outputs.push(...words.slice(1));
        break;
      case '.names':
        if (words.length < 2) fail('badNames', '.names needs an output', no);
        // a cover with no rows is constant 0
        names = { kind: 'names', line: no, nets: words.slice(1), rows: [], onSet: true };
        m.items.push(names);
        break;
      case '.latch':
        m.items.push({ kind: 'latch', line: no, words: words.slice(1) });
        break;
      case '.conn':
        if (words.length !== 3) fail('badConn', '.conn needs two nets', no);
        m.items.push({ kind: 'conn', line: no, from: words[1], to: words[2] });
        break;
      case '.subckt':
      case '.gate': {
        if (words.length < 2) fail('badSubckt', `${head} needs a cell type`, no);
        const pins = new Map<string, string>();
        for (const w of words.slice(2)) {
          const eq = w.indexOf('=');
          if (eq <= 0 || eq === w.length - 1) fail('badPin', `bad pin connection "${w}"`, no, { text: w });
          const pin = w.slice(0, eq);
          if (pins.has(pin)) fail('duplicatePin', `pin ${pin} connected twice`, no, { pin });
          pins.set(pin, w.slice(eq + 1));
        }
        m.items.push({ kind: 'inst', line: no, type: words[1], pins });
        break;
      }
      case '.search':
        fail('unsupported', `${head} is not supported`, no, { directive: head });
        break;
      default:
        fail('unknownDirective', `unknown directive ${head}`, no, { directive: head });
    }
  }
  return models;
}

/** The model no other model instantiates (the first such one) */
function topModel(models: Model[]): Model {
  const used = new Set<string>();
  const byName = new Set(models.map((m) => m.name));
  for (const m of models) for (const it of m.items) if (it.kind === 'inst' && byName.has(it.type)) used.add(it.type);
  return models.find((m) => !used.has(m.name)) ?? models[0];
}

const GLOBAL_NETS = new Set([NET_FALSE, NET_TRUE, NET_UNDEF]);

/** Flattens `top` and the models it instantiates into netlist cells */
function flatten(models: Model[], top: Model): NetlistCell[] {
  const byName = new Map<string, Model>();
  for (const m of models) if (!byName.has(m.name)) byName.set(m.name, m);
  const cells: NetlistCell[] = [];
  let unique = 0;

  const expand = (model: Model, map: (net: string) => string, stack: string[]): void => {
    for (const it of model.items) {
      if (cells.length > MAX_CELLS) fail('tooLarge', `more than ${MAX_CELLS} cells`, it.line, { max: MAX_CELLS });
      switch (it.kind) {
        case 'names': {
          const nets = it.nets.map(map);
          cells.push({ kind: 'lut', inputs: nets.slice(0, -1), output: nets[nets.length - 1], rows: it.rows, onSet: it.onSet });
          break;
        }
        case 'conn':
          cells.push({ kind: 'lut', inputs: [map(it.from)], output: map(it.to), rows: ['1'], onSet: true });
          break;
        case 'latch':
          cells.push(latchCell(it.words, it.line, map));
          break;
        case 'inst': {
          const sub = byName.get(it.type);
          if (sub) {
            if (stack.includes(sub.name)) fail('recursive', `model ${sub.name} instantiates itself`, it.line, { model: sub.name });
            const formals = new Set([...sub.inputs, ...sub.outputs]);
            for (const pin of it.pins.keys())
              if (!formals.has(pin)) fail('unknownPin', `model ${sub.name} has no pin ${pin}`, it.line, { pin, cell: sub.name });
            const prefix = `${sub.name}#${unique++}/`;
            const actual = new Map([...it.pins].map(([pin, net]) => [pin, map(net)]));
            expand(sub, (net) => (GLOBAL_NETS.has(net) ? net : (actual.get(net) ?? prefix + net)), [...stack, sub.name]);
            break;
          }
          const lib = libraryCell(it.type, new Map([...it.pins].map(([pin, net]) => [pin, map(net)])));
          if (!lib) fail('unknownCell', `unknown cell type ${it.type}`, it.line, { cell: it.type });
          if ('issue' in lib)
            fail(lib.issue.code, `cell ${it.type}: ${lib.issue.code === 'missingPin' ? 'missing' : 'unknown'} pin ${lib.issue.pin}`, it.line, {
              pin: lib.issue.pin,
              cell: it.type,
            });
          cells.push(...lib.cells);
          break;
        }
      }
    }
  };
  expand(top, (net) => net, [top.name]);
  return cells;
}

/** .latch <input> <output> [<type> <control>] [<init>] */
function latchCell(words: string[], line: number, map: (net: string) => string): NetlistCell {
  if (words.length < 2) fail('badLatch', '.latch needs an input and an output', line);
  const [d, q] = words;
  let rest = words.slice(2);
  let init: 0 | 1 = 0;
  if (rest.length === 1 || rest.length === 3) {
    const v = rest[rest.length - 1];
    if (!/^[0-3]$/.test(v)) fail('badLatch', `bad latch initial value ${v}`, line);
    init = v === '1' ? 1 : 0; // 2 (don't care) and 3 (unknown) start at 0, as Logisim's flip-flops do
    rest = rest.slice(0, -1);
  }
  if (rest.length === 0) fail('latchNoClock', '.latch without a clock is not supported', line);
  if (rest.length !== 2) fail('badLatch', 'bad .latch line', line);
  const [type, control] = rest;
  if (control === 'NIL') fail('latchNoClock', '.latch without a clock is not supported', line);
  const kinds: Record<string, [edge: boolean, activeHigh: boolean]> = { re: [true, true], fe: [true, false], ah: [false, true], al: [false, false] };
  const kind = kinds[type];
  if (!kind) fail('badLatchType', `latch type ${type} is not supported`, line, { type });
  return {
    kind: 'seq',
    clock: { net: map(control), activeHigh: kind[1] },
    edge: kind[0],
    d: map(d),
    q: map(q),
    syncResetOverEnable: true,
    asyncLoads: [],
    init,
  };
}

/** Groups port names into ports the way Logisim-evolution does (see the file comment) */
function groupPorts(names: string[], line: number): NetlistPort[] {
  const singles: string[] = [];
  const buses = new Map<string, Map<number, string>>();
  for (const name of new Set(names)) {
    const m = /^(.*)\[(\d+)\]$/.exec(name);
    if (m) {
      const bits = buses.get(m[1]) ?? new Map<number, string>();
      bits.set(Number(m[2]), name);
      buses.set(m[1], bits);
    } else singles.push(name);
  }
  // Java's String order is UTF-16 code unit order, which is what the default sort uses
  const ports: NetlistPort[] = singles.sort().map((name) => ({ name, bits: [name] }));
  for (const prefix of [...buses.keys()].sort()) {
    const bits = buses.get(prefix)!;
    const width = Math.max(...bits.keys()) + 1;
    if (width > MAX_PORT_WIDTH) fail('portTooWide', `port ${prefix} is ${width} bits wide (at most ${MAX_PORT_WIDTH})`, line, { port: prefix, width, max: MAX_PORT_WIDTH });
    const nets = Array.from({ length: width }, (_, i) => bits.get(i) ?? '');
    ports.push({ name: width === 1 ? nets[0] : prefix, bits: nets });
  }
  return ports;
}

/** Parses BLIF text; throws NetlistError on anything it cannot represent */
export function parseBlif(text: string): Netlist {
  const models = parseModels(text);
  if (models.length === 0) throw new NetlistError('empty', 'no model in the file');
  const top = topModel(models);
  const outSet = new Set(top.outputs);
  return {
    name: top.name,
    inputs: groupPorts(
      top.inputs.filter((n) => !outSet.has(n)),
      top.line,
    ),
    outputs: groupPorts(top.outputs, top.line),
    cells: flatten(models, top),
  };
}
