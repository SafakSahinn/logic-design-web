// Open vs vendor flow (Aşama 6k-5). Some boards can be built two ways: the Xilinx 7-series boards with openXC7 or
// with an installed Vivado. The build panel offers the choice for those boards and remembers it per board; the
// default is the open flow. A board only one flow can build simply uses that one. Kept apart from the panel so it
// can be tested without React.
import type { OpenFlowPlanResult, VendorFlowFamily } from '../flow';
import type { VendorKind, VendorStatus } from '../../tools/vendor';

export type FlowChoice = 'open' | 'vendor';

/** localStorage key of the remembered choices: { [board name]: "open" | "vendor" } */
export const FLOW_CHOICE_KEY = 'lds.fpga.flowChoice';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The remembered choice for a board, or null */
export function loadFlowChoice(boardName: string, store: Store | null = storage()): FlowChoice | null {
  if (!store) return null;
  try {
    const raw = store.getItem(FLOW_CHOICE_KEY);
    const all: unknown = raw ? JSON.parse(raw) : null;
    if (!all || typeof all !== 'object' || Array.isArray(all)) return null;
    const v = Object.prototype.hasOwnProperty.call(all, boardName) ? (all as Record<string, unknown>)[boardName] : null;
    return v === 'open' || v === 'vendor' ? v : null;
  } catch {
    return null;
  }
}

export function saveFlowChoice(boardName: string, choice: FlowChoice, store: Store | null = storage()): void {
  if (!store) return;
  try {
    let all: unknown = {};
    try {
      const raw = store.getItem(FLOW_CHOICE_KEY);
      all = raw ? JSON.parse(raw) : {};
    } catch {
      // unreadable: replaced below
    }
    if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
    // A plain object without a prototype, so a board named "__proto__" is only a key
    const next: Record<string, FlowChoice> = Object.assign(Object.create(null) as Record<string, FlowChoice>, all);
    next[boardName] = choice;
    store.setItem(FLOW_CHOICE_KEY, JSON.stringify(next));
  } catch {
    // ignore: the default is used next time
  }
}

/** The install kinds that can run a vendor flow (Quartus: Prime or II 13.0, the run picks one per part) */
export function vendorKindsFor(family: VendorFlowFamily): VendorKind[] {
  return family === 'quartus' ? ['quartus', 'quartusLegacy'] : [family];
}

/** True when an install for the family was found; null when not known (web, or not asked yet) */
export function vendorInstalled(family: VendorFlowFamily | null, status: VendorStatus | null): boolean | null {
  if (!family || !status) return null;
  return vendorKindsFor(family).some((k) => (status[k]?.length ?? 0) > 0);
}

export interface FlowSelection {
  /** The flow the panel plans */
  flow: FlowChoice;
  /** True when both flows can build the board: the panel shows the choice */
  choosable: boolean;
}

/**
 * Which flow to plan for a board.
 * - open: the open flow's plan (or why it cannot plan)
 * - vendorFamily: the board's vendor flow (vendorFlowFamily), null when it has none
 * - vendorSupported: the vendor flows can run here (the desktop app)
 * - stored: the remembered choice for the board
 * - openToolsMissing: the open flow's tools are not installed (openXC7 on the desktop)
 * - vendorFound: an install of the vendor tool was found
 */
export function selectFlow(args: {
  open: OpenFlowPlanResult;
  vendorFamily: VendorFlowFamily | null;
  vendorSupported: boolean;
  stored: FlowChoice | null;
  openToolsMissing: boolean;
  vendorFound: boolean | null;
}): FlowSelection {
  const { open, vendorFamily, vendorSupported, stored, openToolsMissing, vendorFound } = args;
  const vendorPossible = vendorSupported && vendorFamily !== null;
  // The open flow has no build for this board at all (Quartus / ISE boards, the CMOD A7-15T's xc7a15t)
  const openImpossible = !open.ok && (open.reason === 'notSupported' || open.reason === 'unknownPart');
  if (!vendorPossible) return { flow: 'open', choosable: false };
  if (openImpossible) return { flow: 'vendor', choosable: false };
  if (stored) return { flow: stored, choosable: true };
  // Not chosen yet: the open flow, unless only the vendor tool is installed here
  return { flow: openToolsMissing && vendorFound === true ? 'vendor' : 'open', choosable: true };
}
