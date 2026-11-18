// SoC VGA display (Aşama 6h). Exported through 'src/soc'.
export {
  SocVga,
  VGA_REGISTER_SIZE,
  VGA_MODES,
  VGA_MARGIN,
  VGA_SOFT_KEYS,
  VGA_DEFAULT_CONFIG,
  VGA_RELOAD_MASTER,
  vgaPartSize,
  clampVgaMode,
  vgaModeByName,
  normalizeVgaConfig,
  vgaSoftModeMask,
} from './vga';
export type { SocVgaConfig, VgaMode, VgaDirtyRows } from './vga';
