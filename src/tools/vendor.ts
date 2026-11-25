// Vendor FPGA tool installs (Aşama 6k-1): what the desktop app found and the "where is it" setting.
// Exists only in the desktop app (window.ldsTool from electron/preload.cjs). The page never sends a path: choosing
// opens the main process's own folder dialog, and only a folder with a known vendor executable is stored.
import { getLdsTool } from './nativeBackend';

/** Install kinds: Quartus Prime and Quartus II 13.0 cover different families, so they are told apart */
export type VendorKind = 'vivado' | 'quartus' | 'quartusLegacy' | 'ise';

export const VENDOR_KINDS: readonly VendorKind[] = ['vivado', 'quartus', 'quartusLegacy', 'ise'];

export interface VendorInstall {
  exe: string;
  /** From the install's folder names ("2026.1", "25.1std", "13.0sp1", "14.7"), or null */
  version: string | null;
  /** "settings": the folder the user picked; "auto": found by the app */
  source: 'settings' | 'auto';
}

/** Per kind, the install a run uses first, then the others found */
export type VendorStatus = Record<VendorKind, VendorInstall[]>;

export interface VendorCheckResult {
  ok: boolean;
  notInstalled?: boolean;
  /** Printed nothing after it started (ISE: build.vendorHint.iseStartupHang) */
  stalled?: boolean;
  exe?: string;
  version?: string | null;
  exitCode?: number;
  /** The first line on success, the output on failure */
  output?: string;
  message?: string;
}

export type VendorChooseResult = { cancelled: true } | { notFound: true } | { kind: VendorKind; exe: string; version: string | null };

interface VendorBridge {
  vendorStatus(): Promise<VendorStatus | null>;
  vendorCheck(kind: VendorKind): Promise<VendorCheckResult>;
  vendorChoose(): Promise<VendorChooseResult>;
  vendorClear(kind: VendorKind): Promise<boolean>;
  vendorHwServer?(): Promise<boolean | null>;
}

function bridge(): VendorBridge | null {
  const b = getLdsTool() as unknown as Partial<VendorBridge> | null;
  return b && typeof b.vendorStatus === 'function' ? (b as VendorBridge) : null;
}

/** Vendor flows run only in the desktop app */
export const vendorToolsSupported = (): boolean => bridge() !== null;

export async function vendorStatus(): Promise<VendorStatus | null> {
  const b = bridge();
  return b ? b.vendorStatus() : null;
}

export async function checkVendorInstall(kind: VendorKind): Promise<VendorCheckResult> {
  const b = bridge();
  return b ? b.vendorCheck(kind) : { ok: false, notInstalled: true };
}

/** Opens the desktop app's folder dialog; the kind is found from the folder's contents */
export async function chooseVendorFolder(): Promise<VendorChooseResult> {
  const b = bridge();
  return b ? b.vendorChoose() : { cancelled: true };
}

export async function clearVendorFolder(kind: VendorKind): Promise<boolean> {
  const b = bridge();
  return b ? b.vendorClear(kind) : false;
}

/**
 * Whether Vivado's hw_server runs now (it keeps the JTAG cable, so openFPGALoader finds none). null when it cannot
 * be told (web, not Windows). The app only looks: it never stops the process.
 */
export async function hwServerRunning(): Promise<boolean | null> {
  const b = bridge();
  if (!b || typeof b.vendorHwServer !== 'function') return null;
  try {
    const r = await b.vendorHwServer();
    return typeof r === 'boolean' ? r : null;
  } catch {
    return null;
  }
}
