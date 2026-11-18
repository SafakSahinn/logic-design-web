// SoC JTAG UART peripheral (Aşama 6h). Exported through 'src/soc'.
export {
  SocJtagUart,
  JTAG_UART_SIZE,
  JTAG_UART_FIFO_SIZES,
  JTAG_UART_DEFAULT_CONFIG,
  clampJtagUartFifoSize,
  normalizeJtagUartConfig,
} from './jtaguart';
export type { SocJtagUartConfig, JtagUartLevel, JtagUartInputs, JtagUartOutputs } from './jtaguart';
