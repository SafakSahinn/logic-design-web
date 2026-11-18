// SoC PIO peripheral (Aşama 6h). Exported through 'src/soc'.
export {
  SocPio,
  PIO_SIZE,
  PIO_MIN_WIDTH,
  PIO_MAX_WIDTH,
  PIO_DIRECTIONS,
  PIO_CAPTURE_EDGES,
  PIO_IRQ_TYPES,
  PIO_DEFAULT_CONFIG,
  clampPioWidth,
  normalizePioConfig,
  pioHasInputs,
  pioHasOutputs,
  pioGeneratesIrq,
  pioEffectiveIrqType,
} from './pio';
export type { SocPioConfig, PioDirection, PioCaptureEdge, PioIrqType } from './pio';
