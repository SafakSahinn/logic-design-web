// Texts of the VHDL Entity part in the current UI language.
import i18n from '../../i18n';
import type { HdlError } from '../../hdl';
import { partNamespace } from '../registry';
import { PART_ID } from './id';

export const NS = partNamespace(PART_ID);

export const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${NS}:${key}`, params);

/**
 * The translated text of an error with its line. HdlError and NetlistError carry code/params/line; a code with
 * a text under "hdlErrors" is translated, any other error keeps its English message.
 */
export function errorText(e: Error): string {
  const { code, params, line } = e as Partial<HdlError>;
  const message = code && i18n.exists(`${NS}:hdlErrors.${code}`) ? t(`hdlErrors.${code}`, params) : e.message.replace(/^line \d+: /, '');
  return line === undefined ? message : t('errorAt', { line, message });
}
