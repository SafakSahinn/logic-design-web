// Machine-mode CSR file of the RV32IM core (Aşama 6f). evo's set (mvendorid .. tinfo) plus the counters
// (mcycle, minstret and their user read-only shadows), with the WARL masks of the privileged spec for a
// machine-mode-only hart without a CLINT.
import { CSR_NAMES as N } from './isa';

export const MSTATUS_MIE = 1 << 3;
export const MSTATUS_MPIE = 1 << 7;
/** MPP is hard-wired to machine mode (3) */
export const MSTATUS_MPP = 3 << 11;
export const MIP_MEIP = 1 << 11;
/** RV32 (MXL=1), extensions I and M */
export const MISA_VALUE = 0x40001100;

/** CSRs this core implements, in the order the state view lists them */
export const IMPLEMENTED_CSRS: readonly number[] = [
  N.mstatus, N.misa, N.mie, N.mtvec, N.mscratch, N.mepc, N.mcause, N.mtval, N.mip,
  N.mcycle, N.mcycleh, N.minstret, N.minstreth, N.cycle, N.cycleh, N.time, N.timeh, N.instret, N.instreth,
  N.mvendorid, N.marchid, N.mimpid, N.mhartid, N.mstatush,
  N.dcsr, N.dpc, N.tselect, N.tdata1, N.tdata2, N.tinfo,
];
const IMPLEMENTED = new Set(IMPLEMENTED_CSRS);

/** Plain read/write storage (evo keeps the debug/trigger CSRs as storage, too) */
const STORAGE = [N.mscratch, N.mcause, N.mtval, N.dcsr, N.dpc, N.tselect, N.tdata1, N.tdata2];

export class CsrFile {
  private store = new Map<number, number>();
  mstatus = 0;
  mie = 0;
  mtvec = 0;
  mepc = 0;
  /** mtvec was written since reset (a trap handler exists) */
  mtvecSet = false;
  cycles = 0;
  instret = 0;
  /** Pending external interrupt from the PLIC (mip.MEIP, read-only to software) */
  meip = false;

  reset(): void {
    this.store.clear();
    for (const c of STORAGE) this.store.set(c, 0);
    this.mstatus = 0;
    this.mie = 0;
    this.mtvec = 0;
    this.mepc = 0;
    this.mtvecSet = false;
    this.cycles = 0;
    this.instret = 0;
  }

  constructor() {
    this.reset();
  }

  static implemented(csr: number): boolean {
    return IMPLEMENTED.has(csr);
  }

  /** Read-only by number (bits 11:10 = 3) */
  static readOnly(csr: number): boolean {
    return ((csr >>> 10) & 3) === 3;
  }

  get mip(): number {
    return this.meip ? MIP_MEIP : 0;
  }

  read(csr: number): number {
    switch (csr) {
      case N.mstatus:
        return (this.mstatus | MSTATUS_MPP) >>> 0;
      case N.misa:
        return MISA_VALUE;
      case N.mie:
        return this.mie;
      case N.mtvec:
        return this.mtvec >>> 0;
      case N.mepc:
        return this.mepc >>> 0;
      case N.mip:
        return this.mip;
      case N.mcycle:
      case N.cycle:
      // no CLINT (no real-time clock): time counts the cycles, so rdtime works and only its rate differs
      case N.time:
        return this.cycles % 0x100000000 >>> 0;
      case N.mcycleh:
      case N.cycleh:
      case N.timeh:
        return Math.floor(this.cycles / 0x100000000) >>> 0;
      case N.minstret:
      case N.instret:
        return this.instret % 0x100000000 >>> 0;
      case N.minstreth:
      case N.instreth:
        return Math.floor(this.instret / 0x100000000) >>> 0;
      case N.mvendorid:
      case N.marchid:
      case N.mimpid:
      case N.mhartid:
      case N.mstatush:
      case N.tinfo:
        return 0;
      default:
        return (this.store.get(csr) ?? 0) >>> 0;
    }
  }

  /** Writes a writable, implemented CSR (the caller checks access); fields are WARL */
  write(csr: number, value: number): void {
    const v = value >>> 0;
    switch (csr) {
      case N.mstatus:
        this.mstatus = v & (MSTATUS_MIE | MSTATUS_MPIE);
        return;
      case N.mie:
        this.mie = v & ((1 << 3) | (1 << 7) | (1 << 11));
        return;
      case N.mtvec:
        // modes 0 (direct) and 1 (vectored); mode values 2 and 3 are reserved
        this.mtvec = (v & ~3) | (v & 1);
        this.mtvecSet = true;
        return;
      case N.mepc:
        this.mepc = v & ~3;
        return;
      case N.mcycle:
        this.cycles = Math.floor(this.cycles / 0x100000000) * 0x100000000 + v;
        return;
      case N.mcycleh:
        this.cycles = (v % 0x200000) * 0x100000000 + (this.cycles % 0x100000000);
        return;
      case N.minstret:
        this.instret = Math.floor(this.instret / 0x100000000) * 0x100000000 + v;
        return;
      case N.minstreth:
        this.instret = (v % 0x200000) * 0x100000000 + (this.instret % 0x100000000);
        return;
      case N.misa:
      case N.mip:
      case N.mstatush:
        return; // WARL: no writable fields
      default:
        if (this.store.has(csr)) this.store.set(csr, v);
    }
  }
}
