// Texts of the SoC Memory part in the current UI language.
import i18n from '../../i18n';
import { partNamespace } from '../registry';
import { PART_ID } from './id';

export const NS = partNamespace(PART_ID);

export const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${NS}:${key}`, params);

export { socHex as hex } from '../shared/socRuntime';
