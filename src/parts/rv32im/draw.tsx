// RV32IM body, after evo's Rv32imRiscV / RV32imState / CpuDrawSupport paint: the register file (x names, values,
// ABI names; "??????????" for registers not written since reset, the last written one highlighted), the pc, the
// execution trace (newest on top), and at the bottom the bus bar (green with the bus name, red when not connected)
// and the run-state bar with evo's start / pause button. Below the register file, where evo leaves space, the
// machine CSRs and the halt message are shown.
import type { ReactNode } from 'react';
import { ABI_NAMES, CSR_NAMES, TRACE_ENTRIES } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { requestSimulation, type DrawContext } from '../registry';
import { socManager } from '../shared/socRuntime';
import { Txt } from '../socBus/traceRow';
import { BODY_HEIGHT, BODY_WIDTH, CLOCK_Y, IRQ_GAP, IRQ_TOP, RESET_Y, cpuState } from './model';
import { peekCpu } from './runtime';
import { haltText, hex, runStateText, t } from './text';
import { BLOCK, HexBox, Panel, type Palette } from './widgets';

function palette(dark: boolean): Palette {
  return dark
    ? { panel: '#422006', head: '#1e3a8a', headInk: '#fde047', box: '#0f172a', ink: '#e2e8f0', value: '#93c5fd', line: '#94a3b8', mark: '#2563eb', markInk: '#f8fafc', pc: '#f0abfc', error: '#f87171', grey: '#334155', ok: '#15803d', bad: '#b91c1c', barInk: '#f8fafc', running: '#4ade80', breakpoint: '#e879f9', button: '#475569', buttonInk: '#bfdbfe' }
    : { panel: '#fde047', head: '#1d4ed8', headInk: '#fde047', box: '#ffffff', ink: '#0f172a', value: '#1d4ed8', line: '#334155', mark: '#1d4ed8', markInk: '#ffffff', pc: '#c026d3', error: '#dc2626', grey: '#cbd5e1', ok: '#4ade80', bad: '#f87171', barInk: '#0f172a', running: '#16a34a', breakpoint: '#c026d3', button: '#d1d5db', buttonInk: '#1d4ed8' };
}

/** evo's upStateBounds origin */
const UX = 50;
const UY = 10;
const fit = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`);
const UNKNOWN = '??????????';

export function drawRv32im(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const s = cpuState(comp);
  const c = palette(ctx.cadTheme === 'dark');
  const rt = peekCpu(comp.id);
  const core = rt?.core;
  const text = `text-[9px] font-mono select-none ${ctx.gateTextClass}`;
  const bus = s.busId ? socManager.getBus(s.busId) : undefined;
  const runState = core?.runState ?? 'running';
  const stateColor = runState === 'running' ? c.running : runState === 'error' ? c.error : runState === 'breakpoint' ? c.breakpoint : c.ink;

  const body: ReactNode[] = [];
  if (!s.stateVisible) {
    body.push(
      <g key="hidden">
        <rect x={UX} y={UY} width={590} height={590} fill={c.grey} />
        <Txt x={UX + 295} y={UY + 295} fill={c.ink} size={11}>
          {t('body.hidden')}
        </Txt>
      </g>,
    );
  } else {
    // register file
    const regs: ReactNode[] = [];
    for (let i = 0; i < 32; i++) {
      const y = UY + 16 + i * 15;
      const marked = core?.lastWritten === i;
      const valid = core ? core.valid[i] : i === 0;
      regs.push(
        <g key={i}>
          <Txt x={UX + 20} y={y + 6} fill={c.ink}>
            {`x${i}`}
          </Txt>
          <HexBox x={UX + 40} y={y} text={valid ? hex(core ? core.read(i) : 0) : UNKNOWN} fill={marked ? c.mark : c.box} ink={marked ? c.markInk : c.value} c={c} />
          <Txt x={UX + 140} y={y + 6} fill={c.ink}>
            {ABI_NAMES[i]}
          </Txt>
        </g>,
      );
    }
    body.push(
      <Panel key="regs" x={UX} y={UY} w={160} h={495} title={t('body.registers')} c={c}>
        {regs}
      </Panel>,
    );
    // pc
    body.push(
      <Panel key="pc" x={UX + 170} y={UY} w={BLOCK} h={30} title={t('body.pc')} c={c}>
        <HexBox x={UX + 171} y={UY + 16} w={BLOCK - 2} text={core ? hex(core.pc) : UNKNOWN} fill={c.box} ink={c.pc} c={c} />
      </Panel>,
    );
    // trace
    const tx = UX + 170;
    const ty = UY + 40;
    const rows: ReactNode[] = [];
    const trace = core?.trace ?? [];
    trace.slice(0, TRACE_ENTRIES).forEach((e, i) => {
      const y = ty + 30 + i * 20;
      const ink = e.error ? c.error : c.ink;
      rows.push(
        <g key={i}>
          <HexBox x={tx + 5} y={y + 1} h={18} text={hex(e.pc)} fill={c.box} ink={e.error ? c.error : c.line} c={c} />
          <HexBox x={tx + 10 + BLOCK} y={y + 1} h={18} text={e.word === null ? UNKNOWN : hex(e.word)} fill={c.box} ink={e.error ? c.error : c.line} c={c} />
          <Txt x={tx + 15 + 2 * BLOCK} y={y + 10} fill={ink} anchor="start" bold size={10}>
            {fit(e.text + (e.trap !== undefined ? `  ⇒ ${t('body.trap', { cause: e.trap })}` : ''), 38)}
          </Txt>
        </g>,
      );
    });
    body.push(
      <Panel key="trace" x={tx} y={ty} w={415} h={455} title={t('body.trace')} c={c}>
        <rect x={tx + 5} y={ty + 15} width={BLOCK} height={15} fill={c.box} />
        <rect x={tx + 10 + BLOCK} y={ty + 15} width={BLOCK} height={15} fill={c.box} />
        <rect x={tx + 15 + 2 * BLOCK} y={ty + 15} width={395 - 2 * BLOCK} height={15} fill={c.box} />
        <Txt x={tx + 5 + BLOCK / 2} y={ty + 22} fill={c.ink}>
          {t('body.pc')}
        </Txt>
        <Txt x={tx + 10 + BLOCK + BLOCK / 2} y={ty + 22} fill={c.ink}>
          {t('body.opcode')}
        </Txt>
        <Txt x={tx + 215 + BLOCK} y={ty + 22} fill={c.ink}>
          {t('body.asm')}
        </Txt>
        {rows.length === 0 ? (
          <Txt x={tx + 207} y={ty + 240} fill={c.ink} size={10}>
            {t('body.emptyTrace')}
          </Txt>
        ) : (
          rows
        )}
      </Panel>,
    );
    // machine CSRs and the halt message
    const csr = core?.csr;
    const csrs: [string, number][] = [
      ['mstatus', CSR_NAMES.mstatus],
      ['mtvec', CSR_NAMES.mtvec],
      ['mepc', CSR_NAMES.mepc],
      ['mcause', CSR_NAMES.mcause],
      ['mtval', CSR_NAMES.mtval],
      ['mie', CSR_NAMES.mie],
      ['mip', CSR_NAMES.mip],
    ];
    const csrY = UY + 505;
    body.push(
      <Panel key="csr" x={UX} y={csrY} w={585} h={80} title={t('body.csrs')} c={c}>
        {csrs.map(([name, n], i) => (
          <g key={name}>
            <Txt x={UX + 5 + i * 83 + BLOCK / 2} y={csrY + 22} fill={c.ink}>
              {name}
            </Txt>
            <HexBox x={UX + 5 + i * 83} y={csrY + 29} text={csr ? hex(csr.read(n)) : UNKNOWN} fill={c.box} ink={c.value} c={c} />
          </g>
        ))}
        <Txt x={UX + 6} y={csrY + 63} fill={runState === 'error' ? c.error : c.ink} anchor="start" size={10}>
          {fit(core?.halt ? haltText(core.halt) : '', 92)}
        </Txt>
      </Panel>,
    );
  }

  // bus bar (evo's SocBusInfo) and run-state bar (evo's SocUpSimulationState)
  const barText = bus ? bus.name : s.busId ? t('body.busMissing') : t('body.notConnected');
  const third = 90;
  const sx = 340;
  const sy = 600;
  const onButton = (e: { stopPropagation(): void }) => {
    // as the built-in switches: the first click selects the part, a click on the selected part pokes it
    if (!ctx.isSelected || !core) return;
    e.stopPropagation();
    core.toggleRun();
    requestSimulation();
  };

  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={BODY_WIDTH} height={BODY_HEIGHT} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      {body}
      <rect x={50} y={600} width={280} height={20} fill={bus ? c.ok : c.bad} />
      <Txt x={190} y={610} fill={c.barInk} size={10}>
        {fit(barText, 44)}
      </Txt>
      <Txt x={sx + third / 2} y={sy + 10} fill={c.ink} size={10}>
        {t('body.simState')}
      </Txt>
      <rect x={sx + third} y={sy} width={third} height={20} fill="none" stroke={c.line} strokeWidth={0.8} />
      <Txt x={sx + third * 1.5} y={sy + 10} fill={stateColor} size={10} bold>
        {runStateText(runState)}
      </Txt>
      <g data-rv32im="run" className={ctx.isSelected ? 'cursor-pointer' : undefined} onClick={onButton}>
        <rect x={sx + 2 * third} y={sy} width={third} height={20} fill={c.button} />
        <Txt x={sx + third * 2.5} y={sy + 10} fill={c.buttonInk} size={10} bold>
          {runState === 'running' ? t('body.pause') : t('body.start')}
        </Txt>
      </g>
      <text x={4} y={RESET_Y + 3} className={text}>
        {t('pins.reset')}
      </text>
      <path d={`M0,${CLOCK_Y - 5} L7,${CLOCK_Y} L0,${CLOCK_Y + 5}`} fill="none" stroke={ctx.strokeColor} strokeWidth={1} />
      {Array.from({ length: s.irqWidth }, (_, i) => (
        <text key={i} x={4} y={IRQ_TOP + IRQ_GAP * i + 3} className={`text-[7px] font-mono select-none ${ctx.gateTextClass}`}>
          {`IRQ${i}`}
        </text>
      ))}
      <text x={BODY_WIDTH / 2} y={CLOCK_Y + 4} textAnchor="middle" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {t('body.title')}
      </text>
    </g>
  );
}
