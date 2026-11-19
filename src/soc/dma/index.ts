// SoC DMA engine (Aşama 6h). Exported through 'src/soc'.
export {
  SocDma,
  DMA_REGISTER_SIZE,
  DMA_BURST_SIZES,
  DMA_REG,
  DMA_CTRL_START,
  DMA_CTRL_IRQ_EN,
  DMA_CTRL_DST_FIXED,
  DMA_CTRL_SRC_FIXED,
  DMA_STAT_BUSY,
  DMA_STAT_DONE,
  DMA_DEFAULT_CONFIG,
  clampDmaBurstSize,
  normalizeDmaConfig,
  dmaEffectiveBus,
} from './dma';
export type { SocDmaConfig, DmaLevel, DmaInputs, DmaSide, DmaTransact, DmaRegisters } from './dma';
