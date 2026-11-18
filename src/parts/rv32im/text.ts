// Texts of the RV32IM part in the current UI language.
import i18n from '../../i18n';
import { RV32IM_NAMESPACE, SOC_NAMESPACE, type HaltInfo, type RunState } from '../../soc';
import { partNamespace } from '../registry';
import { PART_ID } from './id';

export const NS = partNamespace(PART_ID);

export const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${NS}:${key}`, params);

/** The core's halt message; a bus error name in it is translated through the soc namespace */
export function haltText(halt: HaltInfo): string {
  const args: Record<string, unknown> = { ...halt.args };
  if (typeof args.error === 'string') args.error = i18n.t(`${SOC_NAMESPACE}:bus.error.${args.error}`);
  const text = i18n.t(`${RV32IM_NAMESPACE}:${halt.key}`, args);
  // the halt texts name the failing access; the bus error follows them
  return typeof args.error === 'string' ? `${text}: ${args.error}` : text;
}

export const runStateText = (s: RunState): string => t(`run.${s}`);

export { socHex as hex } from '../shared/socRuntime';
