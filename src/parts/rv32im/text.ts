// Texts of the RV32IM part in the current UI language.
import i18n from '../../i18n';
import { RV32IM_NAMESPACE, type HaltInfo, type RunState } from '../../soc';
import { partNamespace } from '../registry';
import { coreHaltText } from '../shared/cpu/program';
import { PART_ID } from './id';

export const NS = partNamespace(PART_ID);

export const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${NS}:${key}`, params);

/** The core's halt message; a bus error name in it is translated through the soc namespace */
export const haltText = (halt: HaltInfo): string => coreHaltText(RV32IM_NAMESPACE, halt);

export const runStateText = (s: RunState): string => t(`run.${s}`);

export { socHex as hex } from '../shared/socRuntime';
