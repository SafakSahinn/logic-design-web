// Entry point of the component registry: importing this module registers every part.
//
// Each part module registers itself (registerPart + registerNamespace) when it is imported, so a new part
// is added by one import line here. The old code imports the registry from this file, never from
// ./registry directly, so the parts are always registered before the catalog is built.

import './blifCircuit';
import './vhdlEntity';

export {
  allParts,
  getPart,
  mergePartCatalog,
  partName,
  partNamespace,
  partOfCirc,
  partSize,
  partText,
  partTextOptional,
  partToolboxName,
  partsInGroup,
  registerPart,
  toolboxGroupTitle,
  PART_TOOLBOX_GROUPS,
} from './registry';
export type {
  CircLibrary,
  CircPoint,
  DrawContext,
  HdlContext,
  HdlLang,
  PartCirc,
  PartAttrEdit,
  PartAttribute,
  PartAttrKind,
  PartAttrOption,
  PartAttrValue,
  PartDefinition,
  PartEditorProps,
  SimContext,
  ToolboxGroup,
} from './registry';
export { PART_IDS, type PartId } from './ids';
