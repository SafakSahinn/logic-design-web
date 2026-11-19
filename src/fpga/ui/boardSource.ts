// The boards the dialog can pick: the built-in ones (loaded on demand) and the user's stored ones.
import type { BoardDefinition } from '../board/model';
import { BUILT_IN_BOARDS, findBuiltInBoard, loadBuiltInBoard } from '../board/catalog';
import { readUserBoard } from './userBoards';

/** The board the map dialog starts with when a circuit has no mapping yet */
export const DEFAULT_BOARD_NAME = 'BASYS3';

export const BUILT_IN_BOARD_NAMES: readonly string[] = BUILT_IN_BOARDS.map((b) => b.name);

/** A board by name: a built-in board, or else a stored user board (their names never clash: saveUserBoard refuses) */
export async function loadBoardByName(name: string): Promise<BoardDefinition | undefined> {
  const entry = findBuiltInBoard(name);
  if (entry) return loadBuiltInBoard(entry.file);
  return readUserBoard(name);
}
