// Reads the module headers of tool-written Verilog (ghdl --synth --out=verilog): module name and ports in
// declaration order with their widths. Only the ANSI header style that ghdl writes is understood:
//
//   module name
//     (input  [3:0] a,
//      input  b,
//      output \reg );
import { HdlError } from './types';

export interface VerilogPort {
  name: string;
  direction: 'input' | 'output' | 'inout';
  width: number;
}

export interface VerilogModuleHeader {
  name: string;
  ports: VerilogPort[];
}

/** Removes // and block comments, keeping line breaks */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

/** An identifier: plain, or escaped ("\name " -> "name") */
const IDENT = String.raw`(?:\\\S+|[A-Za-z_][\w$]*)`;
const unescape = (name: string): string => (name.startsWith('\\') ? name.slice(1) : name);

export function parseVerilogHeaders(verilog: string): VerilogModuleHeader[] {
  const text = stripComments(verilog);
  const modules: VerilogModuleHeader[] = [];
  const moduleRe = new RegExp(String.raw`\bmodule\s+(${IDENT})\s*(\(([^;]*)\))?\s*;`, 'g');
  for (const m of text.matchAll(moduleRe)) {
    const ports: VerilogPort[] = [];
    const list = (m[3] ?? '').trim();
    if (list !== '') {
      const portRe = new RegExp(String.raw`^\s*(input|output|inout)\s+(?:(?:wire|reg)\s+)?(?:\[\s*(\d+)\s*:\s*(\d+)\s*\]\s*)?(${IDENT})\s*$`);
      for (const item of list.split(',')) {
        const p = portRe.exec(item);
        if (!p) throw new HdlError('verilogHeader', `cannot read the port "${item.trim()}" of module ${unescape(m[1])}`, { port: item.trim() });
        const width = p[2] === undefined ? 1 : Math.abs(Number(p[2]) - Number(p[3])) + 1;
        ports.push({ name: unescape(p[4]), direction: p[1] as VerilogPort['direction'], width });
      }
    }
    modules.push({ name: unescape(m[1]), ports });
  }
  return modules;
}
