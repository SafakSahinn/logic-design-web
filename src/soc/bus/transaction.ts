// One SoC bus transaction (Aşama 6e). Same type, access and error codes as Logisim-evolution's SocBusTransaction,
// so traces and CPU behaviour (6f/6g) match evo.

/** Transaction type bits */
export const READ_TRANSACTION = 1;
export const WRITE_TRANSACTION = 2;
export const ATOMIC_TRANSACTION = 4;

/** Access widths */
export const BYTE_ACCESS = 1;
export const HALF_WORD_ACCESS = 2;
export const WORD_ACCESS = 3;
export type SocAccess = typeof BYTE_ACCESS | typeof HALF_WORD_ACCESS | typeof WORD_ACCESS;

/** Error codes (the numbers are evo's) */
export const SocBusError = {
  none: 0,
  noResponse: 1,
  noSlaves: 2,
  multipleSlaves: 3,
  nonAtomicReadWrite: 4,
  noBusConnected: 5,
  misalignedAddress: 6,
  accessTypeNotSupported: 7,
  readOnlyAccess: 8,
  writeOnlyAccess: 9,
  registerDoesNotExist: 10,
} as const;
export type SocBusErrorCode = (typeof SocBusError)[keyof typeof SocBusError];

/** i18n key (namespace "soc") of each error code: "bus.error.<name>" and "bus.errorShort.<name>" */
export function busErrorName(code: number): string {
  for (const [name, value] of Object.entries(SocBusError)) if (value === code) return name;
  return 'unknown';
}

export class SocTransaction {
  /** Unsigned 32-bit address */
  readonly address: number;
  /** Unsigned value written (only the bits of the access width are used) */
  readonly writeData: number;
  readonly type: number;
  readonly access: SocAccess;
  /** Name of the master that started it (a part name, or a tool such as "elf" / "Assembler") */
  readonly master: string;
  readData = 0;
  /** Name of the slave that answered, set by the slave */
  responder: string | null = null;
  error: SocBusErrorCode = SocBusError.none;
  /** Hidden transactions (program loading) are neither traced nor passed to sniffers */
  hidden = false;

  constructor(type: number, address: number, writeData: number, access: SocAccess, master: string) {
    this.type = type;
    this.address = address >>> 0;
    this.writeData = writeData >>> 0;
    this.access = access;
    this.master = master;
  }

  get isRead(): boolean {
    return (this.type & READ_TRANSACTION) !== 0;
  }
  get isWrite(): boolean {
    return (this.type & WRITE_TRANSACTION) !== 0;
  }
  get isAtomic(): boolean {
    return (this.type & ATOMIC_TRANSACTION) !== 0;
  }
  get hasError(): boolean {
    return this.error !== SocBusError.none;
  }
}

/** Number of bytes an access moves */
export function accessBytes(access: SocAccess): number {
  return access === BYTE_ACCESS ? 1 : access === HALF_WORD_ACCESS ? 2 : 4;
}
