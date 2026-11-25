// "Build and program" (Aşama 6j-4): runs the open-source flow (yosys + nextpnr-ecp5 + ecppack for Lattice ECP5,
// yosys + nextpnr-xilinx + fasm2frames + xc7frames2bit for Xilinx 7-series, 6j-6) for the circuit's board mapping, streams the tools' output into a log, and then writes the bitstream to the board with
// openFPGALoader (desktop) or saves it as a file (web, where no USB programmer can run).
//
// Shown in the FPGA map dialog and in the FPGA tab of the HDL window. The flow and the programmer are planned and
// run by src/fpga/flow; the tools run through src/tools (native programs on the desktop, WASM builds elsewhere,
// after the user agrees to their download). A flash write is confirmed by the desktop main process; when the user
// says no there, the run ends as "cancelled" and is shown as a declined write, not as an error.
//
// A flash write is never broken off by the panel: Cancel is disabled while it runs, and leaving the panel (another
// tab, closing the dialog) lets it finish instead of killing openFPGALoader halfway, which would leave the board's
// flash half written. Any other run is cancelled when the panel goes away. The desktop runner (electron/toolRunner.cjs)
// keeps the same rule for a page reload.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, CheckCircle2, Circle, Copy, Download, Hammer, Loader2, MinusCircle, Search, Square, Trash2, Upload, XCircle } from 'lucide-react';
import type { CircuitComponentInstance, CircuitWire } from '../../types/circuit';
import {
  describeToolStatus,
  hwServerRunning,
  prepareTool,
  runTool,
  toolStatus,
  useToolDownloadConsent,
  vendorToolsSupported,
  type ToolId,
  type VendorStatus,
} from '../../tools';
import type { BoardDefinition } from '../board/model';
import {
  canWriteFlash,
  flowErrorLines,
  planDetect,
  planOpenFlow,
  planProgram,
  planVendorFlow,
  planIseProgram,
  planQuartusProgram,
  planVivadoProgram,
  runFlow,
  vendorFlowFamily,
  runProgram,
  saveBitstream,
  type FlowResult,
  type FlowStageId,
  type ProgramResult,
  type ProgramTarget,
} from '../flow';
import type { HdlLang } from '../hdl/drivers';
import type { BoardMapping } from '../map/model';
import { describeDrcIssue } from '../index';
import {
  bitstreamKey,
  runErrorMessage as runErrorText,
  vendorMissingMessage,
  withHwServerHint,
  withVendorHint,
  type BuildMessage,
  type StepTool,
} from './buildMessages';
import { loadFlowChoice, saveFlowChoice, selectFlow, vendorInstalled, vendorKindsFor, type FlowChoice } from './flowChoice';
import { VendorToolsSection } from './VendorToolsSection';

export interface FpgaBuildPanelProps {
  circuitName: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  board: BoardDefinition;
  mapping: BoardMapping;
  lang: HdlLang;
  /** When given, the panel shows its own Verilog / VHDL choice */
  onLangChange?: (lang: HdlLang) => void;
  fullSpeed: boolean;
  /** When given, the panel shows its own "clocks at full speed" choice */
  onFullSpeedChange?: (fullSpeed: boolean) => void;
  /** Rate of a clock part without a rate of its own (the simulator's global clock), Hz */
  defaultClockHz: number;
  dark: boolean;
}

type StepId = 'prepare' | FlowStageId | 'program' | 'detect';
type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
interface Step {
  id: StepId;
  state: StepState;
}
type Message = BuildMessage;
/** Where programming can happen: openFPGALoader installed, desktop without it, or no native tools (web) */
type Programmer = 'native' | 'missing' | 'web';
/** Where the Xilinx 7-series tools run: openXC7 installed, desktop without it, or the web (no WASM build exists) */
type Xc7Tools = 'native' | 'missing' | 'web';

/** The log keeps the last lines only: a yosys run alone prints thousands */
const MAX_LOG_LINES = 20_000;

/** The vendor tools a flow stage can need, as the messages name them */
const VENDOR_TOOL_NAMES: Partial<Record<ToolId, string>> = { vivado: 'Vivado', quartus: 'Quartus', ise: 'ISE' };

export function FpgaBuildPanel(props: FpgaBuildPanelProps) {
  const { circuitName, components, wires, board, mapping, lang, onLangChange, fullSpeed, onFullSpeedChange, defaultClockHz, dark } = props;
  const { t } = useTranslation('fpga');
  const { confirmDownload, downloadDialog } = useToolDownloadConsent(dark);

  // --- What this machine can run ---
  const [probe, setProbe] = useState<{ canRunGhdl: boolean; programmer: Programmer; xc7: Xc7Tools } | null>(null);
  useEffect(() => {
    let live = true;
    const safe = (tool: ToolId) => toolStatus(tool).catch(() => null);
    const xc7Tools: ToolId[] = ['nextpnr-xilinx', 'fasm2frames', 'xc7frames2bit'];
    Promise.all([safe('ghdl'), safe('openfpgaloader'), ...xc7Tools.map(safe)]).then(([ghdl, loader, ...xc7]) => {
      if (!live) return;
      // "web" only when the build has no native backend at all; a failed check on the desktop counts as missing
      const where = (s: Awaited<ReturnType<typeof safe>>) => (s?.available ? 'native' : s?.reason === 'web-unsupported' ? 'web' : 'missing');
      // openXC7 is usable only when all three tools are (fasm2frames also needs its Python)
      const xc7State: Xc7Tools = xc7.every((s) => s?.available) ? 'native' : xc7.some((s) => s?.reason === 'web-unsupported') ? 'web' : 'missing';
      // GHDL runs natively only (it has no WASM build)
      setProbe({ canRunGhdl: !!ghdl?.available && ghdl.backend === 'native', programmer: where(loader), xc7: xc7State });
    });
    return () => {
      live = false;
    };
  }, []);

  // --- Vendor tools (desktop): the installs found, and the open / vendor choice for boards with both flows ---
  const vendorFamily = useMemo(() => vendorFlowFamily(board), [board]);
  const vendorHere = vendorToolsSupported() && vendorFamily !== null;
  // Filled by the "Vendor tools" section, which reads it on mount and after every change
  const [vendorSt, setVendorSt] = useState<VendorStatus | null>(null);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [storedChoice, setStoredChoice] = useState<{ board: string; choice: FlowChoice | null }>(() => ({ board: board.name, choice: loadFlowChoice(board.name) }));
  const flowChoice = storedChoice.board === board.name ? storedChoice.choice : loadFlowChoice(board.name);
  const chooseFlow = (choice: FlowChoice) => {
    saveFlowChoice(board.name, choice);
    setStoredChoice({ board: board.name, choice });
  };

  // --- The plan for the current circuit ---
  const plannedSel = useMemo(() => {
    if (!probe) return null;
    try {
      const input = { circuitName, components, wires, board, mapping, lang, clock: { fullSpeed, defaultHz: defaultClockHz }, describe: describeDrcIssue };
      const open = planOpenFlow(input, { canRunGhdl: probe.canRunGhdl });
      // A board the open flow cannot build (the CMOD A7-15T's xc7a15t, every Quartus and ISE board) is built with
      // the installed vendor tool on the desktop; a board both can build (the other Vivado boards) uses the
      // remembered choice, the open flow by default
      const sel = selectFlow({
        open,
        vendorFamily,
        vendorSupported: vendorToolsSupported(),
        stored: flowChoice,
        openToolsMissing: open.ok && open.plan.family === 'xc7' && probe.xc7 === 'missing',
        vendorFound: vendorInstalled(vendorFamily, vendorSt),
      });
      return { result: sel.flow === 'vendor' ? planVendorFlow(input) : open, choosable: sel.choosable, flow: sel.flow };
    } catch {
      return null;
    }
  }, [probe, circuitName, components, wires, board, mapping, lang, fullSpeed, defaultClockHz, vendorFamily, flowChoice, vendorSt]);
  const planned = plannedSel?.result ?? null;
  // A built bitstream belongs to exactly these project files
  const planKey = useMemo(() => (planned?.ok ? bitstreamKey(planned.plan) : null), [planned]);

  // --- Run state ---
  const [busy, setBusy] = useState<null | 'build' | 'program' | 'detect'>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [message, setMessageState] = useState<Message | null>(null);
  // A message whose hint points to the "Vendor tools" section (a vendor tool not found) opens it
  const setMessage = (m: Message | null) => {
    setMessageState(m);
    if (m?.openVendorTools) setVendorOpen(true);
  };
  const [built, setBuilt] = useState<{ key: string; bitstream: Uint8Array; fileName: string } | null>(null);
  const [chosenTarget, setTarget] = useState<ProgramTarget>('sram');
  // A board built with Vivado is programmed with Vivado too (its own hw_server; SRAM only, see planVivadoProgram),
  // one built with Quartus with quartus_pgm (an FPGA's SRAM, or a CPLD's own memory: see planQuartusProgram), one
  // built with ISE with iMPACT (the same two cases: planIseProgram)
  const vivadoFlow = !!planned?.ok && planned.plan.family === 'vivado';
  const quartusFlow = !!planned?.ok && planned.plan.family === 'quartus';
  const iseFlow = !!planned?.ok && planned.plan.family === 'ise';
  const vendorFlow = vivadoFlow || quartusFlow || iseFlow;
  // A CPLD (MAX 7000, MAX II / V, CoolRunner-II) has no SRAM load: programming writes its memory for good
  const cpldFlow = (quartusFlow || iseFlow) && !!planned?.ok && /\.(pof|jed)$/.test(planned.plan.bitstream);
  // A Zynq's flash belongs to its processor side: only SRAM is offered there
  const flashOk = canWriteFlash(board) && !vendorFlow;
  const target: ProgramTarget = cpldFlow ? 'flash' : flashOk ? chosenTarget : 'sram';
  /** The programmer's name in the step list and the log */
  const programmerName = vivadoFlow ? 'Vivado' : quartusFlow ? 'Quartus' : iseFlow ? 'iMPACT' : 'openFPGALoader';
  /** The program that writes the board, as the messages name it (a busy or missing programmer) */
  const programmerTool: StepTool = vivadoFlow
    ? { name: 'Vivado', vendor: true }
    : quartusFlow
      ? { name: 'quartus_pgm', vendor: true }
      : iseFlow
        ? { name: 'iMPACT', vendor: true }
        : { name: 'openFPGALoader', vendor: false };
  const abortRef = useRef<AbortController | null>(null);
  // True while openFPGALoader writes the flash: that run is not cancelled (see the header)
  const [flashWriting, setFlashWriting] = useState(false);
  const flashWritingRef = useRef(false);
  useEffect(
    () => () => {
      if (!flashWritingRef.current) abortRef.current?.abort();
    },
    [],
  );

  // The log is buffered and flushed a few times a second, so a chatty tool does not re-render per line
  const [log, setLog] = useState<string[]>([]);
  const pendingLines = useRef<string[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    flushTimer.current = null;
    const add = pendingLines.current;
    if (add.length === 0) return;
    pendingLines.current = [];
    setLog((old) => {
      const next = old.concat(add);
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);
  const addLines = useCallback(
    (...lines: string[]) => {
      pendingLines.current.push(...lines);
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, 120);
    },
    [flush],
  );
  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );

  const logRef = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  const setStep = (id: StepId, state: StepState) => setSteps((all) => all.map((s) => (s.id === id ? { ...s, state } : s)));
  const failFrom = (id: StepId) =>
    setSteps((all) => {
      const at = all.findIndex((s) => s.id === id);
      return all.map((s, i) => (i === at ? { ...s, state: 'failed' } : i > at && s.state === 'pending' ? { ...s, state: 'skipped' } : s));
    });
  /** A step's name; flow stages name their tool (nextpnr-ecp5 / nextpnr-xilinx, ecppack / xc7frames2bit) */
  const stageName = (id: StepId) => {
    if (id === 'program' || id === 'detect') return t(`build.stage.${id}`, { tool: id === 'program' ? programmerName : 'openFPGALoader' });
    return t(`build.stage.${id}`, { tool: stepTool(id).name });
  };
  /** The program a step runs */
  const stepTool = (id: StepId): StepTool => {
    if (id === 'program') return programmerTool;
    if (id === 'detect') return { name: 'openFPGALoader', vendor: false };
    const tool = planned?.ok ? planned.plan.stages.find((s) => s.id === id)?.tool : undefined;
    const vendorName = tool === 'vivado' ? 'Vivado' : tool === 'quartus' ? 'Quartus' : tool === 'ise' ? 'ISE' : null;
    return vendorName ? { name: vendorName, vendor: true } : { name: tool ?? '', vendor: false };
  };

  /** The message for a run the tool runner refused or broke off */
  const runErrorMessage = (error: unknown, step: StepId, aborted: boolean): Message =>
    runErrorText((key, vars) => t(key, vars ?? {}), error, stageName(step), step === 'program' || step === 'detect', aborted, stepTool(step));

  /**
   * openFPGALoader found no cable on a Xilinx board: Vivado's hw_server may hold it (it stays running after Vivado
   * closes). Asks the desktop app whether hw_server runs; never stops it.
   */
  const addHwServerHint = async (m: Message, r: ProgramResult, tool: ToolId): Promise<Message> => {
    if (tool !== 'openfpgaloader' || r.ok || r.kind !== 'toolFailed' || r.problem !== 'noCable' || board.fpga.vendor !== 'vivado') return m;
    const running = await hwServerRunning();
    // Without a desktop answer (web, not Windows) the hint is only worth showing where Vivado can run at all
    if (running === null && !vendorToolsSupported()) return m;
    return withHwServerHint((key, vars) => t(key, vars ?? {}), m, running);
  };

  const programMessage = (r: Exclude<ProgramResult, { ok: true }>, step: 'program' | 'detect', aborted: boolean, tool: ToolId = 'openfpgaloader'): Message => {
    const tr = (key: string, vars?: Record<string, unknown>) => t(key, vars ?? {});
    if (r.kind === 'runError') return withVendorHint(tr, runErrorMessage(r.error, step, aborted), tool, { error: r.error });
    // Vivado, Quartus and ISE have their own cable drivers and messages (build.error.programVivado.* / programQuartus.* /
    // programIse.*);
    // neither reports a board or cable name
    const vendorProblem = r.problem === 'unknownBoard' || r.problem === 'unknownCable' ? 'other' : r.problem;
    const key =
      tool === 'vivado'
        ? `build.error.programVivado.${vendorProblem}`
        : tool === 'quartus'
          ? `build.error.programQuartus.${vendorProblem}`
          : tool === 'ise'
            ? `build.error.programIse.${vendorProblem}`
            : `build.error.program.${r.problem}`;
    return withVendorHint(tr, { kind: 'error', text: t(key, { code: r.exitCode }) }, tool, { exitCode: r.exitCode, log: `${r.stdout}\n${r.stderr}` });
  };

  /** Writes a bitstream to the board; shared by "build and program" (afterBuild) and "program board" */
  const program = async (bitstream: Uint8Array, ctl: AbortController, afterBuild: boolean): Promise<void> => {
    const p = vivadoFlow
      ? planVivadoProgram({ board, bitstream })
      : quartusFlow
        ? planQuartusProgram({ board, bitstream })
        : iseFlow
          ? planIseProgram({ board, bitstream })
          : planProgram({ board, bitstream, target });
    if (!p.ok) {
      failFrom('program');
      setMessage({ kind: 'error', text: t('build.error.planFailed') });
      return;
    }
    setStep('program', 'running');
    addLines(...(afterBuild ? [''] : []), `== ${stageName('program')} ==`, `${({ vivado: 'vivado', quartus: 'quartus_pgm', ise: 'impact' } as Partial<Record<ToolId, string>>)[p.request.tool] ?? 'openFPGALoader'} ${p.request.args.join(' ')}`);
    const flash = target === 'flash';
    flashWritingRef.current = flash;
    setFlashWriting(flash);
    let r: ProgramResult;
    try {
      r = await runProgram(p.request, (req) => runTool(req), { signal: ctl.signal, onLine: (line) => addLines(line) });
    } finally {
      flashWritingRef.current = false;
      setFlashWriting(false);
    }
    if (r.ok) {
      setStep('program', 'done');
      setMessage({ kind: 'ok', text: t(cpldFlow ? 'build.result.programmedCpld' : target === 'flash' ? 'build.result.programmedFlash' : 'build.result.programmedSram') });
    } else {
      failFrom('program');
      if (r.kind === 'toolFailed' && !r.stdout && !r.stderr) addLines(`(exit code ${r.exitCode})`);
      setMessage(await addHwServerHint(programMessage(r, 'program', ctl.signal.aborted, p.request.tool), r, p.request.tool));
    }
  };

  const start = (kind: 'build' | 'program' | 'detect', stepIds: StepId[]): AbortController => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(kind);
    setMessage(null);
    setSteps(stepIds.map((id) => ({ id, state: 'pending' })));
    pendingLines.current = [];
    setLog([]);
    stickToBottom.current = true;
    return ctl;
  };
  const finish = (ctl: AbortController) => {
    flush();
    if (abortRef.current === ctl) {
      abortRef.current = null;
      setBusy(null);
    }
  };

  const build = async (thenProgram: boolean) => {
    if (!planned?.ok || !planKey) return;
    const { plan } = planned;
    const ctl = start('build', ['prepare', ...plan.stages.map((s) => s.id), ...(thenProgram ? (['program'] as const) : [])]);
    const started = Date.now();
    try {
      // 1. Every tool of the flow must be runnable (asks once for a pending WASM download)
      setStep('prepare', 'running');
      for (const tool of [...new Set(plan.stages.map((s) => s.tool))]) {
        const status = await prepareTool(tool, confirmDownload);
        if (ctl.signal.aborted) {
          failFrom('prepare');
          setMessage({ kind: 'info', text: t('build.result.cancelled') });
          return;
        }
        if (!status.available) {
          failFrom('prepare');
          const vendorName = VENDOR_TOOL_NAMES[tool];
          if (vendorName) {
            setMessage(vendorMissingMessage((key, vars) => t(key, vars ?? {}), vendorName));
            return;
          }
          setMessage({
            kind: 'error',
            text:
              status.reason === 'download-required'
                ? t('build.error.downloadDeclined', { tool })
                : t('build.error.toolUnavailable', { message: describeToolStatus(status) }),
          });
          return;
        }
        addLines(describeToolStatus(status));
      }
      setStep('prepare', 'done');

      // 2. The flow, stage by stage
      const streamed = new Set<FlowStageId>();
      let current: FlowStageId | null = null;
      const result: FlowResult = await runFlow(plan, (req) => runTool(req), {
        signal: ctl.signal,
        onStage: (stage) => {
          if (current) setStep(current, 'done');
          current = stage.id;
          setStep(stage.id, 'running');
          addLines('', `== ${stageName(stage.id)} ==`, `${stage.tool} ${stage.args.join(' ')}`);
        },
        onLine: (stage, line) => {
          streamed.add(stage.id);
          addLines(line);
        },
      });
      // A backend that does not stream lines still hands back the whole output (a quiet tool has none)
      for (const s of result.stages) {
        const output = [s.stdout, s.stderr].filter((x) => x.trim() !== '').join('\n');
        if (!streamed.has(s.id) && output) addLines('', `== ${stageName(s.id)} ==`, ...output.split(/\r?\n/));
      }
      if (!result.ok) {
        const f = result.failure;
        failFrom(f.stage);
        const tool = plan.stages.find((s) => s.id === f.stage)?.tool;
        const tr = (key: string, vars?: Record<string, unknown>) => t(key, vars ?? {});
        if (f.kind === 'runError') {
          const m = runErrorMessage(f.error, f.stage, ctl.signal.aborted);
          setMessage(tool ? withVendorHint(tr, m, tool, { error: f.error }) : m);
        } else {
          const stageResult = result.stages.find((s) => s.id === f.stage);
          const m: Message = f.missing
            ? { kind: 'error', text: t('build.error.stageMissing', { stage: stageName(f.stage), file: f.missing }) }
            : { kind: 'error', text: t('build.error.stageFailed', { stage: stageName(f.stage), code: f.exitCode }), details: stageResult ? flowErrorLines(stageResult) : [] };
          setMessage(tool ? withVendorHint(tr, m, tool, { exitCode: f.exitCode, log: stageResult ? `${stageResult.stdout}\n${stageResult.stderr}` : '' }) : m);
        }
        return;
      }
      if (current) setStep(current, 'done');
      // A vendor flow's file keeps its own type (<top>.bit from Vivado / ISE, <top>.sof / .pof from Quartus, <top>.jed for an ISE CPLD)
      const fileName = vendorFlow ? planned.plan.bitstream : `${planned.project.plan.name}.bit`;
      setBuilt({ key: planKey, bitstream: result.bitstream, fileName });
      const vars = { size: Math.max(1, Math.round(result.bitstream.length / 1024)), seconds: ((Date.now() - started) / 1000).toFixed(1) };
      setMessage({ kind: 'ok', text: t(probe?.programmer === 'web' ? 'build.result.builtWeb' : 'build.result.built', vars) });

      // 3. Optionally straight onto the board
      if (thenProgram) await program(result.bitstream, ctl, true);
    } finally {
      finish(ctl);
    }
  };

  const programBuilt = async () => {
    if (!built) return;
    const ctl = start('program', ['program']);
    try {
      await program(built.bitstream, ctl, false);
    } finally {
      finish(ctl);
    }
  };

  const detect = async () => {
    const p = planDetect(board);
    if (!p.ok) return;
    const ctl = start('detect', ['detect']);
    try {
      setStep('detect', 'running');
      addLines(`== ${stageName('detect')} ==`, `openFPGALoader ${p.request.args.join(' ')}`);
      const r = await runProgram(p.request, (req) => runTool(req), { signal: ctl.signal, onLine: (line) => addLines(line) });
      if (r.ok) {
        setStep('detect', 'done');
        setMessage({ kind: 'ok', text: t('build.result.detected') });
      } else {
        failFrom('detect');
        setMessage(await addHwServerHint(programMessage(r, 'detect', ctl.signal.aborted), r, 'openfpgaloader'));
      }
    } finally {
      finish(ctl);
    }
  };

  const download = () => {
    if (!built) return;
    const ok = saveBitstreamSafe(built.bitstream, built.fileName);
    setMessage(ok ? { kind: 'info', text: t('build.downloaded', { file: built.fileName }) } : { kind: 'error', text: t('build.downloadFailed') });
  };

  const copyLog = () => {
    navigator.clipboard?.writeText(log.join('\n')).catch(() => undefined);
  };

  // --- Rendering ---
  const c = dark
    ? {
        text: 'text-slate-100',
        sub: 'text-slate-400',
        card: 'bg-slate-900 border-slate-700',
        btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600',
        seg: 'bg-slate-800 border-slate-700',
        segOff: 'text-slate-300 hover:bg-slate-700',
      }
    : {
        text: 'text-slate-800',
        sub: 'text-slate-500',
        card: 'bg-white border-slate-200',
        btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300',
        seg: 'bg-slate-100 border-slate-200',
        segOff: 'text-slate-600 hover:bg-slate-200',
      };
  const segBtn = (active: boolean) => `px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${active ? 'bg-indigo-600 text-white' : c.segOff}`;
  const btn = `px-3.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${c.btn}`;
  const primary =
    'px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed';

  const blocked = (text: string) => (
    <div className={`flex-1 flex items-center justify-center p-6 text-center text-sm ${c.sub}`} data-fpga-build-blocked>
      <p className="max-w-xl">{text}</p>
    </div>
  );

  let body: ReactNode = null;
  if (!probe || !planned) {
    body = blocked(probe ? t('build.error.planFailed') : t('ui.loadingBoard'));
  } else if (!planned.ok) {
    if (planned.reason === 'notSupported') {
      // Vendor-tool boards (Quartus, ISE): the vendor flows need the desktop app (Aşama 6k)
      const vendorBoard = board.fpga.vendor === 'altera' || board.fpga.vendor === 'xilinx' || board.fpga.vendor === 'vivado';
      const note = vendorBoard && !vendorToolsSupported() ? ` ${t('build.vendorHint.desktopOnly')}` : '';
      body = blocked(`${t('build.notSupported', { board: board.name })}${note}`);
    } else if (planned.reason === 'unknownPart') body = blocked(t('build.unknownPart', { part: board.fpga.part }));
    else if (planned.reason === 'badPackage') body = blocked(t('build.badPackage', { pkg: board.fpga.package }));
    else if (planned.reason === 'drc') body = blocked(t('build.drcBlocked', { count: planned.issues.filter((i) => i.severity === 'error').length }));
  } else if (planned.plan.family === 'xc7' && probe.xc7 === 'web') {
    // nextpnr-xilinx has no WASM build: the web offers the project files for the user's own toolchain
    body = blocked(t('build.xc7Web', { board: board.name }));
  }

  const stale = !!built && built.key !== planKey;
  const usable = built && !stale ? built : null;
  // A vendor flow programs with its own tool (found when the flow is prepared); the open flows need openFPGALoader
  const canProgram = vendorFlow || probe?.programmer === 'native';

  const stepIcon = (s: StepState) => {
    switch (s) {
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />;
      case 'done':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
      case 'failed':
        return <XCircle className="w-3.5 h-3.5 text-rose-500" />;
      case 'skipped':
        return <MinusCircle className={`w-3.5 h-3.5 ${c.sub}`} />;
      default:
        return <Circle className={`w-3.5 h-3.5 ${c.sub}`} />;
    }
  };

  return (
    <div className={`flex-1 flex flex-col gap-3 min-h-0 ${c.text}`} data-fpga-build>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="mr-auto min-w-0">
          <h4 className="font-extrabold text-sm">{t('build.title')}</h4>
          <p className={`text-[11px] ${c.sub}`}>{t('build.intro')}</p>
        </div>
        {onLangChange && (
          <div className={`flex items-center gap-1 p-0.5 rounded-xl border ${c.seg}`} title={t('build.lang')}>
            <button className={segBtn(lang === 'verilog')} onClick={() => onLangChange('verilog')} disabled={!!busy} data-fpga-build-lang="verilog">
              Verilog
            </button>
            <button className={segBtn(lang === 'vhdl')} onClick={() => onLangChange('vhdl')} disabled={!!busy} data-fpga-build-lang="vhdl">
              VHDL
            </button>
          </div>
        )}
        {plannedSel?.choosable && vendorFamily && (
          <div className="flex items-center gap-1.5 font-semibold" title={t('build.flow.title')}>
            {t('build.flow.label')}
            <div className={`flex items-center gap-1 p-0.5 rounded-xl border ${c.seg}`}>
              <button
                className={segBtn(plannedSel.flow === 'open')}
                onClick={() => chooseFlow('open')}
                disabled={!!busy}
                title={t('build.flow.openTitle')}
                data-fpga-build-flow="open"
              >
                {t('build.flow.open', { tools: 'openXC7' })}
              </button>
              <button
                className={segBtn(plannedSel.flow === 'vendor')}
                onClick={() => chooseFlow('vendor')}
                disabled={!!busy}
                title={t('build.flow.vendorTitle', { tool: VENDOR_TOOL_NAMES[vendorFamily] })}
                data-fpga-build-flow="vendor"
              >
                {VENDOR_TOOL_NAMES[vendorFamily]}
              </button>
            </div>
          </div>
        )}
        {onFullSpeedChange && (
          <label className="flex items-center gap-1.5 font-semibold cursor-pointer" title={t('hdl.fullSpeedTitle')}>
            <input type="checkbox" checked={fullSpeed} disabled={!!busy} onChange={(e) => onFullSpeedChange(e.target.checked)} data-fpga-build-fullspeed />
            {t('hdl.fullSpeed')}
          </label>
        )}
      </div>

      {body ?? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {canProgram ? (
              <>
                <button className={primary} disabled={!!busy} onClick={() => void build(true)} data-fpga-build-run="program">
                  <Upload className="w-3.5 h-3.5" />
                  {t('build.buildAndProgram')}
                </button>
                <button className={btn} disabled={!!busy} onClick={() => void build(false)} data-fpga-build-run="build">
                  <Hammer className="w-3.5 h-3.5" />
                  {t('build.buildOnly')}
                </button>
              </>
            ) : (
              <button className={primary} disabled={!!busy} onClick={() => void build(false)} data-fpga-build-run="build">
                <Hammer className="w-3.5 h-3.5" />
                {usable ? t('build.rebuild') : t('build.build')}
              </button>
            )}
            {busy && (
              <button
                className={btn}
                onClick={() => abortRef.current?.abort()}
                disabled={flashWriting}
                title={flashWriting ? t('build.cancelFlashBlocked') : undefined}
                data-fpga-build-cancel
              >
                <Square className="w-3.5 h-3.5 text-rose-500" />
                {t('build.cancel')}
              </button>
            )}
            <span className="mx-1 h-5 border-l border-slate-300/60" />
            {canProgram && (
              <>
                {!cpldFlow && (
                  <label className="flex items-center gap-1.5 font-semibold">
                    {t('build.target.label')}
                    <div className={`flex items-center gap-1 p-0.5 rounded-xl border ${c.seg}`}>
                      <button className={segBtn(target === 'sram')} onClick={() => setTarget('sram')} disabled={!!busy} title={t('build.target.sramTitle')} data-fpga-build-target="sram">
                        {t('build.target.sram')}
                      </button>
                      <button
                        className={segBtn(target === 'flash')}
                        onClick={() => setTarget('flash')}
                        disabled={!!busy || !flashOk}
                        title={t(flashOk ? 'build.target.flashTitle' : 'build.target.flashUnsupported')}
                        data-fpga-build-target="flash"
                      >
                        {t('build.target.flash')}
                      </button>
                    </div>
                  </label>
                )}
                <button className={btn} disabled={!!busy || !usable} onClick={() => void programBuilt()} data-fpga-build-program>
                  <Upload className="w-3.5 h-3.5" />
                  {t('build.program')}
                </button>
                {!vendorFlow && (
                  <button className={btn} disabled={!!busy} onClick={() => void detect()} data-fpga-build-detect>
                    <Search className="w-3.5 h-3.5" />
                    {t('build.detect')}
                  </button>
                )}
              </>
            )}
            <button className={btn} disabled={!!busy || !usable} onClick={download} data-fpga-build-download>
              <Download className="w-3.5 h-3.5" />
              {t('build.download')}
            </button>
          </div>

          {planned?.ok && lang === 'vhdl' && planned.synthLang === 'verilog' && (
            <p className={`text-[11px] ${c.sub}`} data-fpga-build-vhdl-note>
              {t('build.vhdlAsVerilog')}
            </p>
          )}
          {planned?.ok && planned.plan.family === 'xc7' && probe?.xc7 === 'missing' && (
            <p className="text-[11px] text-amber-600 font-semibold flex items-center gap-1" data-fpga-build-no-openxc7>
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('build.error.noOpenXc7')}
            </p>
          )}
          {vendorFlow && vendorFamily && vendorInstalled(vendorFamily, vendorSt) === false && (
            <p className="text-[11px] text-amber-600 font-semibold flex items-center gap-1" data-fpga-build-no-vendor>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {t('build.vendorNotFoundNote', { tool: VENDOR_TOOL_NAMES[vendorFamily] })}
            </p>
          )}
          {vivadoFlow && (
            <p className={`text-[11px] ${c.sub}`} data-fpga-build-vendor-note>
              {t(plannedSel?.choosable ? 'build.vivadoChosenNote' : 'build.vivadoFlowNote')}
            </p>
          )}
          {quartusFlow && (
            <p className={`text-[11px] ${c.sub}`} data-fpga-build-vendor-note>
              {t(cpldFlow ? 'build.quartusCpldNote' : 'build.quartusFlowNote')}
            </p>
          )}
          {iseFlow && (
            <p className={`text-[11px] ${c.sub}`} data-fpga-build-vendor-note>
              {t(cpldFlow ? 'build.iseCpldNote' : 'build.iseFlowNote')}
            </p>
          )}
          {probe?.programmer === 'missing' && !vendorFlow && (
            <p className="text-[11px] text-amber-600 font-semibold flex items-center gap-1" data-fpga-build-no-programmer>
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('build.error.noProgrammer')}
            </p>
          )}
          {stale && !busy && (
            <p className="text-[11px] text-amber-600 font-semibold flex items-center gap-1" data-fpga-build-stale>
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('build.stale')}
            </p>
          )}

          {steps.length > 0 && (
            <ol className={`flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 rounded-xl border text-xs ${c.card}`} data-fpga-build-steps>
              {steps.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5" data-fpga-build-step={s.id} data-state={s.state}>
                  {stepIcon(s.state)}
                  <span className={s.state === 'pending' || s.state === 'skipped' ? c.sub : 'font-semibold'}>{stageName(s.id)}</span>
                </li>
              ))}
            </ol>
          )}

          {message && (
            <div
              className={`px-3 py-2 rounded-xl border text-xs ${
                message.kind === 'ok'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : message.kind === 'error'
                    ? 'border-rose-300 bg-rose-50 text-rose-800'
                    : 'border-slate-300 bg-slate-50 text-slate-700'
              }`}
              data-fpga-build-message={message.kind}
            >
              <p className="font-semibold flex items-center gap-1.5">
                {message.kind === 'ok' ? <Check className="w-3.5 h-3.5" /> : message.kind === 'error' ? <XCircle className="w-3.5 h-3.5" /> : null}
                {message.text}
              </p>
              {message.details && message.details.length > 0 && (
                <pre className="mt-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">{message.details.join('\n')}</pre>
              )}
              {message.hint && (
                <p className="mt-1.5 flex items-start gap-1.5" data-fpga-build-hint>
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{message.hint}</span>
                </p>
              )}
            </div>
          )}

          <div className="flex-1 min-h-[10rem] flex flex-col rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
            <div className="px-3 py-1 flex items-center gap-2 border-b border-slate-800 text-[11px] text-slate-400">
              <span className="mr-auto font-mono">log</span>
              <button className="p-1 rounded-sm hover:bg-slate-800 cursor-pointer disabled:opacity-40" onClick={copyLog} disabled={log.length === 0} title={t('build.copyLog')} data-fpga-build-copy-log>
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1 rounded-sm hover:bg-slate-800 cursor-pointer disabled:opacity-40"
                onClick={() => setLog([])}
                disabled={log.length === 0 || !!busy}
                title={t('build.clearLog')}
                data-fpga-build-clear-log
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <pre
              ref={logRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
              className="flex-1 min-h-0 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre"
              data-fpga-build-log
            >
              {log.length > 0 ? log.join('\n') : <span className="text-slate-500">{t('build.logEmpty')}</span>}
            </pre>
          </div>
        </>
      )}
      {vendorHere && vendorFamily && (
        <VendorToolsSection
          dark={dark}
          disabled={!!busy}
          open={vendorOpen}
          onOpenChange={setVendorOpen}
          relevant={vendorKindsFor(vendorFamily)}
          onStatus={setVendorSt}
        />
      )}
      {downloadDialog}
    </div>
  );
}

/** saveBitstream from the flow, guarded (it touches the DOM) */
function saveBitstreamSafe(bitstream: Uint8Array, fileName: string): boolean {
  try {
    return saveBitstream(bitstream, fileName);
  } catch {
    return false;
  }
}
