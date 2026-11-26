// Logisim .circ export / import of the BLIF Circuit part (evo's HDL-IP / "BLIFCircuit"). Verification only.
import i18n from '../../../i18n';
import { blifEntry, blifText, pinsFor, type BlifPartState } from '../../../parts/blifCircuit/model';
import { evoIssues } from '../../../parts/blifCircuit/evo';
import { PART_ID } from '../../../parts/blifCircuit/id';
import { errorText } from '../../../parts/blifCircuit';
import { partNamespace } from '../../../parts/registry';
import type { CircuitComponentInstance } from '../../../types/circuit';
import type { PartCirc } from '../partCirc';

const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${partNamespace(PART_ID)}:${key}`, params);

// evo's GenericInterfaceComponent body
const EVO_WIDTH = 140;
const EVO_PIN_TOP = 40;
const EVO_PIN_GAP = 10;

export const blifCircuitCirc: PartCirc = {
  lib: '#HDL-IP',
  name: 'BLIFCircuit',
  labelled: true,
  exportAttrs: (comp) => ({ content: blifText(comp) }),
  exportWarnings: (comp) => {
    const text = blifText(comp);
    const entry = blifEntry(text);
    const out = evoIssues(text).map((issue) => t(`evo.${issue.code}`, issue));
    if (!entry.ok) out.unshift(t('evo.broken', { message: errorText(entry.error) }));
    return out;
  },
  // evo's GenericInterfaceComponent: loc is the top-left corner, inputs down the west edge and outputs down
  // the east edge 10 apart from y 40, no facing
  ports: (comp) => ({
    inputs: comp.inputs.map((_, i) => ({ x: 0, y: EVO_PIN_TOP + EVO_PIN_GAP * i })),
    outputs: comp.outputs.map((_, i) => ({ x: EVO_WIDTH, y: EVO_PIN_TOP + EVO_PIN_GAP * i })),
  }),
  importAttrs: (comp, attrs, warn) => {
    if (attrs.content === undefined) return comp;
    const text = attrs.content.replace(/\r\n?/g, '\n');
    const next: CircuitComponentInstance = { ...comp, state: { ...comp.state, part: { blif: text } satisfies BlifPartState } };
    const entry = blifEntry(text);
    if (!entry.ok) {
      warn(t('evo.importBroken', { message: errorText(entry.error) }));
      return next;
    }
    const pins = pinsFor(comp, entry.netlist);
    return { ...next, inputs: pins.inputs, outputs: pins.outputs };
  },
};
