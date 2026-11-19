// The user's own boards (made or imported in the board editor), kept in the browser's localStorage as board XML.
// Storage can be missing or full (private window, blocked site data, quota), so every access is guarded and the
// dialog works with the built-in boards alone.
import type { BoardDefinition } from '../board/model';
import { BoardXmlError, parseBoardXml, writeBoardXml } from '../board/xml';

const STORAGE_KEY = 'lds.fpga.userBoards.v1';

interface StoredBoard {
  name: string;
  xml: string;
}

export type SaveUserBoardResult =
  | { ok: true }
  | { ok: false; reason: 'builtInName' | 'storage' }
  | { ok: false; reason: 'xml'; error: BoardXmlError };

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(storage: Storage | null): StoredBoard[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((b): b is StoredBoard => !!b && typeof b === 'object' && typeof b.name === 'string' && typeof b.xml === 'string');
  } catch {
    return [];
  }
}

function writeAll(storage: Storage | null, boards: StoredBoard[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(boards));
    return true;
  } catch {
    return false;
  }
}

/** Names of the stored boards, sorted */
export function listUserBoards(storage: Storage | null = defaultStorage()): string[] {
  return readAll(storage)
    .map((b) => b.name)
    .sort((a, b) => a.localeCompare(b));
}

/** A stored board, read from its XML; undefined when it is not there or no longer readable */
export function readUserBoard(name: string, storage: Storage | null = defaultStorage()): BoardDefinition | undefined {
  const stored = readAll(storage).find((b) => b.name === name);
  if (!stored) return undefined;
  try {
    return parseBoardXml(stored.xml).board;
  } catch {
    return undefined;
  }
}

/**
 * Stores a board under its name (replacing a stored board of the same name). A built-in board's name is refused:
 * a .circ map names its board, and the name must say which board it is.
 */
export function saveUserBoard(board: BoardDefinition, builtInNames: readonly string[], storage: Storage | null = defaultStorage()): SaveUserBoardResult {
  if (builtInNames.includes(board.name)) return { ok: false, reason: 'builtInName' };
  let xml: string;
  try {
    xml = writeBoardXml(board);
    // What is stored must read back
    parseBoardXml(xml);
  } catch (e) {
    if (e instanceof BoardXmlError) return { ok: false, reason: 'xml', error: e };
    throw e;
  }
  const rest = readAll(storage).filter((b) => b.name !== board.name);
  return writeAll(storage, [...rest, { name: board.name, xml }]) ? { ok: true } : { ok: false, reason: 'storage' };
}

/** Removes a stored board; false when storage could not be written */
export function deleteUserBoard(name: string, storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.getItem(STORAGE_KEY);
  } catch {
    // Unreadable storage: writing would drop boards we cannot see
    return false;
  }
  return writeAll(
    storage,
    readAll(storage).filter((b) => b.name !== name),
  );
}
