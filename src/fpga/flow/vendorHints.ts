// Known failures of the vendor FPGA tools (Aşama 6k-1) and the hint shown for each (build.vendorHint.* in
// src/fpga/locales). The tool's own log stays in the build log; the hint says what to do about it.
import type { ToolErrorKind } from '../../tools/types';

export type VendorTool = 'vivado' | 'quartus' | 'ise';

export type VendorHintKey =
  /** Vivado 2026.1 has no license (exit code 42), or the license file was not found */
  | 'vivadoLicense'
  /** ISE printed nothing at start-up: its network-provider scan hangs (WSL's P9NP provider on Windows 11) */
  | 'iseStartupHang'
  /** Another vendor tool printed nothing at start-up */
  | 'stalled'
  /** Quartus II 13.0 Web Edition: the family (Cyclone I) needs a paid license */
  | 'quartusFamilyLicense'
  /** ISE WebPACK: the device is not in the free edition (xc6slx150t ...) */
  | 'iseDeviceNotInWebpack';

export interface VendorFailure {
  tool: VendorTool;
  /** The tool's exit code, when it ran to the end */
  exitCode?: number;
  /** The runner's error kind, when the run was broken off */
  errorKind?: ToolErrorKind;
  /** What the tool printed (stdout and stderr) */
  log?: string;
}

/** The hint for a failed vendor run, or null when the failure is not one of the known ones */
export function vendorHint({ tool, exitCode, errorKind, log = '' }: VendorFailure): VendorHintKey | null {
  if (errorKind === 'stalled') return tool === 'ise' ? 'iseStartupHang' : 'stalled';
  if (tool === 'vivado' && (exitCode === 42 || /valid license was not found/i.test(log))) return 'vivadoLicense';
  // Quartus II prints some messages in its machine format (msg_tcl_post_message ... EQCU_FAMILY_NOT_LICENSED ... 20005)
  if (tool === 'quartus' && /Error \(20005\)|EQCU_FAMILY_NOT_LICENSED/.test(log)) return 'quartusFamilyLicense';
  if (tool === 'ise' && /Xst:1817\b|Invalid target device/i.test(log)) return 'iseDeviceNotInWebpack';
  return null;
}
