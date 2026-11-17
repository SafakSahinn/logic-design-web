// Texts of the Verilog Entity part in the current UI language.
import i18n from '../../i18n';
import type { HdlError } from '../../hdl';
import { partNamespace } from '../registry';
import { PART_ID } from './id';

export const NS = partNamespace(PART_ID);

export const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${NS}:${key}`, params);

/**
 * The translated text of an error with its line. HdlError and NetlistError carry code/params/line; a code with
 * a text under "hdlErrors" is translated, any other error keeps its English message.
 *
 * Some codes are thrown with different params (verilogEnd: none, {expected} or {module}); such a code may
 * have a text per param set, keyed "<code>_<param names sorted, joined by _>", which wins over the plain one.
 */
export function errorText(e: Error): string {
  const { line } = e as Partial<HdlError>;
  const message = errorMessage(e);
  return line === undefined ? message : t('errorAt', { line, message });
}

/** errorText() without the line */
export function errorMessage(e: Error): string {
  const { code, params = {} } = e as Partial<HdlError>;
  const names = Object.keys(params).sort();
  const keys = code ? [...(names.length > 0 ? [`hdlErrors.${code}_${names.join('_')}`] : []), `hdlErrors.${code}`] : [];
  const key = keys.find((k) => i18n.exists(`${NS}:${k}`));
  return key ? t(key, params) : e.message.replace(/^line \d+: /, '');
}
