// Nios II body, after evo's Nios2 / Nios2State / CpuDrawSupport paint (the state 10 lower than the RV32IM's, below
// the names of the top pins): the register file (r names, values, ABI names; "??????????" for registers not
// written since reset, the last written one highlighted), pc, status, estatus and bstatus, the execution trace
// (newest on top) and, with IRQ inputs, evo's IRQ panel (the IRQ levels, ienable as the mask and their OR). Without
// IRQ inputs, where evo leaves the space empty, ienable / ipending / exception are shown. The halt message (or a
// custom instruction waiting for done) is written at the bottom of that panel. Below: the bus bar and the
// run-state bar with evo's start / pause button.
import type { ReactNode } from 'react';
import { NIOS2_ABI_NAMES, NIOS2_TRACE_ENTRIES, type Nios2Core } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { DrawContext } from '../registry';
import { CpuBars, HexReg, HiddenState, RegisterFile, TracePanel } from '../shared/cpu/body';
import { cpuPalette } from '../shared/cpu/palette';
import { BODY_HEIGHT, BODY_WIDTH, CLOCK_Y, CUSTOM_OUTPUTS, DONE_X, IRQ_GAP, IRQ_TOP, RESET_Y, RESULT_X, STATE_OFFSET, cpuState } from './model';
import { ControlPanel, IrqPanel } from './panels';
import { NIOS2_UI } from './program';
import { peekCpu } from './runtime';
import { haltText, t } from './text';

function statusLine(core: Nios2Core | undefined): string {
  if (!core) return '';
  if (core.halt) return haltText(core.halt);
  return core.customBusy ? t('body.customWait') : '';
}

export function drawNios2(comp: CircuitComponentInstance, ctx: DrawContext): ReactNode {
  const s = cpuState(comp);
  const c = cpuPalette(ctx.cadTheme === 'dark');
  const core = peekCpu(comp.id)?.core;
  const text = `text-[9px] font-mono select-none ${ctx.gateTextClass}`;
  const small = `text-[7px] font-mono select-none ${ctx.gateTextClass}`;

  const state: ReactNode[] = [];
  if (!s.stateVisible) {
    state.push(<HiddenState key="hidden" c={c} ui={NIOS2_UI} />);
  } else {
    const status = statusLine(core);
    const error = core?.runState === 'error';
    state.push(
      <RegisterFile
        key="regs"
        c={c}
        title={t('body.registers')}
        name={(i) => `r${i}`}
        abi={(i) => NIOS2_ABI_NAMES[i]}
        value={(i) => (core ? (core.valid[i] ? core.read(i) : null) : i === 0 ? 0 : null)}
        lastWritten={core?.lastWritten ?? -1}
      />,
      <HexReg key="pc" c={c} x={170} y={0} title={t('body.pc')} value={core ? core.pc : null} ink={c.pc} />,
      <HexReg key="status" c={c} x={275} y={0} title="status" value={core ? core.status : null} />,
      <HexReg key="estatus" c={c} x={380} y={0} title="estatus" value={core ? core.estatus : null} />,
      <HexReg key="bstatus" c={c} x={485} y={0} title="bstatus" value={core ? core.bstatus : null} />,
      <TracePanel key="trace" c={c} ui={NIOS2_UI} trace={core?.trace ?? []} rows={NIOS2_TRACE_ENTRIES} />,
      s.irqWidth > 0 ? (
        <IrqPanel key="irq" c={c} core={core} irqs={s.irqWidth} status={status} error={error} />
      ) : (
        <ControlPanel key="ctl" c={c} core={core} status={status} error={error} />
      ),
    );
  }

  return (
    <g filter="url(#gateShadow)">
      <rect x={0} y={0} width={BODY_WIDTH} height={BODY_HEIGHT} rx={3} fill={ctx.fillColor} stroke={ctx.strokeColor} strokeWidth={ctx.strokeWidth} />
      <g transform={`translate(0,${STATE_OFFSET})`}>
        {state}
        <CpuBars c={c} ui={NIOS2_UI} ctx={ctx} busId={s.busId} core={core} />
      </g>
      {CUSTOM_OUTPUTS.map((p) => (
        <text key={p.id} x={p.x} y={8} textAnchor="middle" className={small}>
          {p.id}
        </text>
      ))}
      <text x={DONE_X} y={8} textAnchor="middle" className={small}>
        done
      </text>
      <text x={RESULT_X} y={8} textAnchor="middle" className={small}>
        result
      </text>
      <text x={4} y={RESET_Y + 3} className={text}>
        {t('pins.reset')}
      </text>
      <path d={`M0,${CLOCK_Y - 5} L7,${CLOCK_Y} L0,${CLOCK_Y + 5}`} fill="none" stroke={ctx.strokeColor} strokeWidth={1} />
      {Array.from({ length: s.irqWidth }, (_, i) => (
        <text key={i} x={4} y={IRQ_TOP + IRQ_GAP * i + 3} className={small}>
          {`IRQ${i}`}
        </text>
      ))}
      <text x={BODY_WIDTH / 2} y={CLOCK_Y + 4} textAnchor="middle" className={`text-[11px] font-mono font-bold select-none ${ctx.gateTextClass}`}>
        {t('body.title')}
      </text>
    </g>
  );
}
