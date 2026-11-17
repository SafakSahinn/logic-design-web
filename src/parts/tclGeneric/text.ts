// Texts of the TCL Generic part in the current UI language.
import i18n from '../../i18n';
import type { HdlError } from '../../hdl';
import { partNamespace } from '../registry';
import { PART_ID } from './id';
import type { TclScriptError } from './model';

export const NS = partNamespace(PART_ID);

export const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${NS}:${key}`, params);

/** An interface (VHDL reader) error with its line; codes with a text under "hdlErrors" are translated */
export function interfaceErrorText(e: Error): string {
  const { code, params, line } = e as Partial<HdlError>;
  const message = code && i18n.exists(`${NS}:hdlErrors.${code}`) ? t(`hdlErrors.${code}`, params) : e.message.replace(/^line \d+: /, '');
  return line === undefined ? message : t('errorAt', { line, message });
}

/** A script error as one sentence: where it happened, the line and Tcl's message (or the limit it hit) */
export function scriptErrorText(e: TclScriptError): string {
  const message = e.limit ? t(`limits.${e.limit}`) : e.message;
  const text = t(`scriptErrors.${e.phase}`, { message });
  return e.line === undefined ? text : t('errorAt', { line: e.line, message: text });
}
