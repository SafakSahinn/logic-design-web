// Public entry of the FPGA infrastructure (Aşama 6i). Import from 'src/fpga', not from the inner files.
import i18n, { registerNamespace } from '../i18n';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { BoardXmlError, type BoardXmlWarning } from './board/xml';

export const FPGA_NAMESPACE = 'fpga';
registerNamespace(FPGA_NAMESPACE, { en, tr });

export * from './board/model';
export { BoardXmlError, isValidBoardName, parseBoardXml, writeBoardXml } from './board/xml';
export type { BoardXmlErrorCode, BoardXmlWarning } from './board/xml';
export { BoardPictureError, decodeBoardPicture, encodeBoardPicture } from './board/picture';
export { BUILT_IN_BOARDS, findBuiltInBoard, loadBuiltInBoard } from './board/catalog';
export type { BuiltInBoardEntry } from './board/catalog';

/** Message of a board file error in the current language */
export function describeBoardXmlError(error: BoardXmlError): string {
  return i18n.t(`${FPGA_NAMESPACE}:boardXml.error.${error.code}`, { detail: error.detail ?? '' });
}

/** Message of a board file warning in the current language */
export function describeBoardXmlWarning(warning: BoardXmlWarning): string {
  return i18n.t(`${FPGA_NAMESPACE}:boardXml.warning.${warning.code}`, { element: warning.element ?? '' });
}
