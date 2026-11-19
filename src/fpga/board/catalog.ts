// Built-in boards: the board files under src/fpga/boards, loaded on demand (each file is 30-160 kB, mostly the
// photo, so none of them goes into the main bundle). boards/index.json lists them without loading a file.
import index from '../boards/index.json';
import type { BoardDefinition, BoardVendor } from './model';
import { parseBoardXml } from './xml';

export interface BuiltInBoardEntry {
  /** File name without .xml */
  file: string;
  /** Board name (the file's root element; the boardname of a .circ map) */
  name: string;
  vendor: BoardVendor;
  family: string;
  part: string;
  /** Board oscillator frequency in Hz */
  clockHz: number;
  /** evo = shipped with Logisim-evolution v5.0.0 (GPL-3.0); lds = made for Logic Design Studio */
  origin: 'evo' | 'lds';
}

export const BUILT_IN_BOARDS: readonly BuiltInBoardEntry[] = index as BuiltInBoardEntry[];

const loaders = import.meta.glob<string>('../boards/*.xml', { query: '?raw', import: 'default' });
const cache = new Map<string, Promise<BoardDefinition>>();

/** Looks a built-in board up by its board name (as a .circ boardmap names it) */
export function findBuiltInBoard(name: string): BuiltInBoardEntry | undefined {
  return BUILT_IN_BOARDS.find((b) => b.name === name);
}

/** Loads and parses a built-in board; the result is shared, so callers must not change it */
export function loadBuiltInBoard(file: string): Promise<BoardDefinition> {
  let pending = cache.get(file);
  if (!pending) {
    const load = loaders[`../boards/${file}.xml`];
    if (!load) return Promise.reject(new Error(`unknown built-in board ${file}`));
    pending = load().then((text) => parseBoardXml(text).board);
    // A failed load is not cached, so a later call can try again
    pending.catch(() => cache.delete(file));
    cache.set(file, pending);
  }
  return pending;
}
