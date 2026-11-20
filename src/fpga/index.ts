// Public entry of the FPGA infrastructure (Aşama 6i). Import from 'src/fpga', not from the inner files.
import i18n, { registerNamespace } from '../i18n';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { BoardXmlError, type BoardXmlWarning } from './board/xml';
import type { BoardIo } from './board/model';
import type { DrcIssue } from './drc/issue';
import type { MapNote } from './map/suggest';
import { ioPinLabel } from './map/model';

export const FPGA_NAMESPACE = 'fpga';
registerNamespace(FPGA_NAMESPACE, { en, tr });

export * from './board/model';
export { BoardXmlError, isValidBoardName, parseBoardXml, writeBoardXml } from './board/xml';
export type { BoardXmlErrorCode, BoardXmlWarning } from './board/xml';
export { BoardPictureError, decodeBoardPicture, encodeBoardPicture } from './board/picture';
export { BUILT_IN_BOARDS, findBuiltInBoard, loadBuiltInBoard } from './board/catalog';
export type { BuiltInBoardEntry } from './board/catalog';

export * from './map/model';
export { occupiedFpgaPins, resolveMapping } from './map/resolve';
export type { ResolvedPin, ResolvedTarget } from './map/resolve';
export { suggestMapping } from './map/suggest';
export type { MapNote } from './map/suggest';
export { hasErrors, sortIssues } from './drc/issue';
export type { DrcIssue, DrcSeverity } from './drc/issue';
export { checkBoard, checkMapping } from './drc/mapping';
export { checkDesign, labelProblem } from './drc/design';

export { buildFpgaProject } from './hdl/project';
export type { FpgaProject, FpgaProjectFile, FpgaProjectInput } from './hdl/project';
export { FPGA_CLOCK, FPGA_TOP_LEVEL_NAME, planTopLevel } from './hdl/plan';
export type { ClockOptions, ClockPlan, PlacedPin, TopLevelPlan } from './hdl/plan';
export { writeTopLevel, formatHz } from './hdl/wrapper';
export { CONSTRAINT_EXTENSION, clockFrequencyText, writeConstraints } from './hdl/constraints';
export type { ConstraintFile } from './hdl/constraints';
export type { HdlLang } from './hdl/drivers';

/** Message of a design rule check finding in the current language */
export function describeDrcIssue(issue: DrcIssue): string {
  return i18n.t(`${FPGA_NAMESPACE}:drc.${issue.code}`, issue.values);
}

/** Text of a mapping suggestion note in the current language */
export function describeMapNote(note: MapNote): string {
  return i18n.t(`${FPGA_NAMESPACE}:note.${note.code}`, note.values);
}

/** Name of a board resource's logical pin in the current language (segment a, LED row 0 column 3 ...) */
export function describeIoPin(io: BoardIo, index: number): string {
  const { key, values } = ioPinLabel(io, index);
  return i18n.t(`${FPGA_NAMESPACE}:${key}`, values);
}

/** Message of a board file error in the current language */
export function describeBoardXmlError(error: BoardXmlError): string {
  return i18n.t(`${FPGA_NAMESPACE}:boardXml.error.${error.code}`, { detail: error.detail ?? '' });
}

/** Message of a board file warning in the current language */
export function describeBoardXmlWarning(warning: BoardXmlWarning): string {
  return i18n.t(`${FPGA_NAMESPACE}:boardXml.warning.${warning.code}`, { element: warning.element ?? '' });
}
