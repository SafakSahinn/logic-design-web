// Texts of the SoC Bus part in the current UI language.
import i18n from '../../i18n';
import { SOC_NAMESPACE, busErrorName } from '../../soc';
import { partNamespace } from '../registry';
import { PART_ID } from './id';

export const NS = partNamespace(PART_ID);

export const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${NS}:${key}`, params);

/** A bus error code as evo's short trace text (red on the body) or its full sentence */
export const busErrorText = (code: number, short = false): string =>
  i18n.t(`${SOC_NAMESPACE}:bus.${short ? 'errorShort' : 'error'}.${busErrorName(code)}`);

export { socHex as hex } from '../shared/socRuntime';
