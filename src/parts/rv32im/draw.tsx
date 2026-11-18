// RV32IM body, after evo's Rv32imRiscV / RV32imState / CpuDrawSupport paint: the register file (x names, values,
// ABI names; "??????????" for registers not written since reset, the last written one highlighted), the pc, the
// execution trace (newest on top), and at the bottom the bus bar (green with the bus name, red when not connected)
// and the run-state bar with evo's start / pause button. Below the register file, where evo leaves space, the
// machine CSRs and the halt message are shown.
import type { ReactNode } from 'react';
import { ABI_NAMES, CSR_NAMES, TRACE_ENTRIES } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { DrawContext } from '../registry';
import { CpuBars, HiddenState, HexReg, RegisterFile, TracePanel } from '../shared/cpu/body';
import { UNKNOWN, UX, UY, cpuPalette, fit } from '../shared/cpu/palette';
import { BLOCK, HexBox, Panel } from '../shared/cpu/widgets';
import { Txt } from '../socBus/traceRow';
import { BODY_HEIGHT, BODY_WIDTH, CLOCK_Y, IRQ_GAP, IRQ_TOP, RESET_Y, cpuState } from './model';
import { RV32IM_UI } from './program';
import { peekCpu } from './runtime';
import { haltText, hex, t } from './text';

export function drawRv32im(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const s = cpuState(comp);
  const c = cpuPalette(ctx.cadTheme === 'dark');
  const core = peekCpu(comp.id)?.core;
  const text = `text-[9px] font-mono select-none ${ctx.gateTextClass}`;
  const runState = core?.runState ?? 'running';

  const body: ReactNode[] = [];
  if (!s.stateVisible) {
    body.push(<HiddenState key="hidden" c={c} ui={RV32IM_UI} />);
  } else {
    body.push(
      <RegisterFile
        key="regs"
        c={c}
        title={t('body.registers')}
        name={(i) => `x${i}`}
        abi={(i) => ABI_NAMES[i]}
        value={(i) => (core ? (core.valid[i] ? core.read(i) : null) : i === 0 ? 0 : null)}
        lastWritten={core?.lastWritten ?? -1}
      />,
    );
    body.push(<HexReg key="pc" c={c} x={170} y={0} title={t('body.pc')} value={core ? core.pc : null} ink={c.pc} />);
    body.push(<TracePanel key="trace" c={c} ui={RV32IM_UI} trace={core?.trace ?? []} rows={TRACE_ENTRIES} />);
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

  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={BODY_WIDTH} height={BODY_HEIGHT} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      {body}
      <CpuBars c={c} ui={RV32IM_UI} ctx={ctx} busId={s.busId} core={core} />
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
