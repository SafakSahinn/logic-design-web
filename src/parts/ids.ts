// Ids of the parts that live in the component registry (Aşama 6+).
//
// Adding a part: create src/parts/<id>/, add its id here and import it in src/parts/index.ts.
// The id becomes a member of ComponentType, so it must not clash with a built-in part type
// (mergePartCatalog() checks this at start-up).
export const PART_IDS = ['blifCircuit', 'vhdlEntity', 'verilogEntity', 'tclGeneric'] as const;

export type PartId = (typeof PART_IDS)[number];
