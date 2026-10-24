import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type {
  ComponentType,
  CircuitComponentInstance,
  CircuitWire,
  CircuitPin,
  ComponentCategory,
  CircuitAnnotation,
} from '../types/circuit';
import {
  COMPONENT_CATALOG,
  createComponentInstance,
  updatePinPositions,
  simulateCircuit,
  simulateCircuitStep,
  CIRCUIT_PRESETS,
  HEX_7SEG_MAP,
  CHIPTUNE_NOTE_FREQS,
  CHIPTUNE_NOTE_NAMES,
  generateTruthTable,
  synthesizeCircuitFromBooleanExpression,
} from '../utils/circuitEngine';
import {
  Play,
  Pause,
  StepForward,
  RotateCcw,
  Trash2,
  Cpu,
  Activity,
  Plus,
  Undo2,
  Redo2,
  RotateCw,
  Copy,
  Edit3,
  Table,
  X,
  Sliders,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  Upload,
  Image as ImageIcon,
  Sparkles,
  Keyboard,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Search,
  BookOpen,
  Volume2,
  VolumeX,
  FileText,
  Package,
  Check,
  Grid,
  FileCode,
  FlaskConical,
  Workflow,
  Binary,
  Layers,
  StickyNote,
  Square,
  Moon,
  Sun,
  BarChart3,
  Hand,
  MousePointer,
} from 'lucide-react';
import { importCircXmlProject } from '../utils/circXmlImporter';
import { analyzeCircuit, type CircuitAnalysisReport } from '../utils/circuitAnalyzer';
import { IC_DATASHEETS } from '../utils/icDatasheets';
import { generateVerilog, generateVHDL } from '../utils/hdlGenerator';
import {
  getAllSubcircuits,
  deleteCustomSubcircuit,
  createSubcircuitInstance,
  packageSelectionIntoSubcircuit,
  saveCustomSubcircuit,
  getSubcircuitDefinition,
} from '../utils/subcircuitManager';
import type { CustomSubcircuit } from '../types/circuit';
import type { LogicValue } from '../types/logic';
import { solveKMap } from '../utils/kmapSolver';
import { generateVCD } from '../utils/vcdGenerator';
import { FPGA_BOARDS, generateFpgaConstraints } from '../utils/fpgaConstraints';
import {
  runCircuitTestbench,
  generateExhaustiveTestVector,
  type TestbenchResult,
} from '../utils/testVectorRunner';
import {
  FSM_PRESETS,
  synthesizeFSM,
  type FSMState,
  type FSMTransition,
} from '../utils/fsmSynthesizer';

export interface CircuitSheet {
  id: string;
  name: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  annotations?: CircuitAnnotation[];
}

// Compact labels & badges for single-line stable palette toolbar
const COMPACT_COMPONENT_NAMES: Record<string, { label: string; badge?: string }> = {
  not: { label: 'NOT', badge: 'Değil' },
  and: { label: 'AND', badge: 'VE' },
  or: { label: 'OR', badge: 'VEYA' },
  nand: { label: 'NAND', badge: 'VE DEĞİL' },
  nor: { label: 'NOR', badge: 'VEYA DEĞİL' },
  xor: { label: 'XOR', badge: 'Özel VEYA' },
  xnor: { label: 'XNOR', badge: 'Özel VEYA DEĞİL' },
  triState: { label: 'Buffer', badge: 'Tri-State' },
  switch: { label: 'Anahtar', badge: 'Toggle' },
  pushbutton: { label: 'Basma Butonu', badge: 'Pulse' },
  dipSwitch4: { label: '4-Bit DIP SW', badge: 'DIP' },
  clock: { label: 'Saat Sinyali', badge: 'CLK' },
  vcc: { label: 'Sabit 1', badge: 'VCC' },
  gnd: { label: 'Sabit 0', badge: 'GND' },
  led: { label: 'LED Lamba' },
  sevenSeg: { label: '7-Segment' },
  hexDisplay: { label: 'Hex Gösterge', badge: '4-Bit' },
  probe: { label: 'Mantık Probu' },
  buzzer: { label: 'Buzzer', badge: 'Ses' },
  dotMatrix8x8: { label: '8x8 Matris', badge: 'GPU' },
  rgbMatrix16x16: { label: '16x16 RGB Matris', badge: 'GPU' },
  asciiKeyboard: { label: 'ASCII Klavye', badge: 'KBD' },
  textLabel: { label: 'Metin Etiketi' },
  halfAdder: { label: 'Yarım Toplayıcı', badge: 'HA' },
  fullAdder: { label: 'Tam Toplayıcı', badge: 'FA' },
  halfSubtractor: { label: 'Yarım Çıkarıcı', badge: 'HS' },
  fullSubtractor: { label: 'Tam Çıkarıcı', badge: 'FS' },
  mux2to1: { label: '2:1 MUX' },
  mux4to1: { label: '4:1 MUX' },
  mux8to1: { label: '8:1 MUX', badge: '74HC151' },
  demux1to2: { label: '1:2 DEMUX' },
  demux1to4: { label: '1:4 DEMUX' },
  decoder2to4: { label: '2:4 Decoder' },
  decoder3to8: { label: '3:8 Decoder', badge: '74HC138' },
  bcdTo7Seg: { label: 'BCD to 7-Seg', badge: '74LS47' },
  priorityEncoder4to2: { label: '4:2 Kodlayıcı', badge: '74HC148' },
  comparator4bit: { label: 'Karşılaştırıcı', badge: '4-Bit' },
  alu4bit: { label: '4-Bit ALU', badge: '74HC181' },
  busSplitter: { label: 'Bus Ayırıcı', badge: 'Splitter' },
  srLatch: { label: 'SR Mandal', badge: 'Latch' },
  dFlipFlop: { label: 'D Flip-Flop', badge: 'D-FF' },
  jkFlipFlop: { label: 'JK Flip-Flop', badge: 'JK-FF' },
  tFlipFlop: { label: 'T Flip-Flop', badge: 'T-FF' },
  register4bit: { label: '4-Bit Yazmaç', badge: '74HC173' },
  counter4bit: { label: '4-Bit Sayaç', badge: '74HC161' },
  shiftRegister4bit: { label: 'Kaydırmalı Yazmaç', badge: '74HC194' },
  ram16x4: { label: '16x4 RAM', badge: 'Bellek' },
  rom16x4: { label: '16x4 ROM', badge: 'Bellek' },
};

export interface LogicCircuitSimulatorProps {
  desktopMode?: boolean;
}

export const LogicCircuitSimulator: React.FC<LogicCircuitSimulatorProps> = ({ desktopMode: _desktopMode = false }) => {
  // Step 5: CAD Engineering Theme ('light' vs 'dark' / Neon CAD mode)
  const [cadTheme, setCadTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('logic_cad_theme') as 'light' | 'dark') || 'light';
    } catch {
      return 'light';
    }
  });

  const toggleCadTheme = () => {
    setCadTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('logic_cad_theme', next);
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Canvas starts clean / empty by default (no preset preloaded)
  const [components, setComponents] = useState<CircuitComponentInstance[]>([]);
  const [wires, setWires] = useState<CircuitWire[]>([]);

  // Annotations (Çerçeveler & Yapışkan Notlar)
  const [annotations, setAnnotations] = useState<CircuitAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  // Command Palette / Spotlight Quick Search (Ctrl+K)
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [paletteQuery, setPaletteQuery] = useState<string>('');

  // Palette horizontal scroll track ref & helper (Fixed non-jumping toolbar)
  const paletteScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollPalette = (direction: 'left' | 'right') => {
    if (paletteScrollRef.current) {
      paletteScrollRef.current.scrollBy({
        left: direction === 'left' ? -240 : 240,
        behavior: 'smooth',
      });
    }
  };

  // Default wire type (1-Bit standard vs 4-Bit Multi-bit bus)
  const [defaultWireIsBus, setDefaultWireIsBus] = useState<boolean>(false);

  // Ref to prevent clearing box selection on background click
  const didDragSelectionBoxRef = useRef<boolean>(false);

  // Multi-Sheet Project Workspace Tabs (Sekmeli Çoklu Çalışma Sayfaları)
  const [sheets, setSheets] = useState<CircuitSheet[]>([
    { id: 'sheet_1', name: 'Ana Devre', components: [], wires: [], annotations: [] },
  ]);
  const [activeSheetId, setActiveSheetId] = useState<string>('sheet_1');
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [editingSheetName, setEditingSheetName] = useState<string>('');


  // Simulation mode: running continuously vs paused/step-by-step
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [clockHz, setClockHz] = useState<number>(1);
  const [stepCount, setStepCount] = useState<number>(0);

  // Selected preset (null by default for clean start)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // Active wiring state (supports mid-wire branching tap point)
  const [wiringFrom, setWiringFrom] = useState<{
    compId: string;
    pinId: string;
    pinType: 'input' | 'output';
    x: number;
    y: number;
    branchPoint?: { x: number; y: number };
    sourceWireId?: string;
    waypoints?: { x: number; y: number }[];
  } | null>(null);

  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Selected components & wires for multi-selection, deletion, rotation, or group dragging
  const [selectedCompIds, setSelectedCompIds] = useState<string[]>([]);
  const [selectedWireIds, setSelectedWireIds] = useState<string[]>([]);
  const selectedCompId = selectedCompIds.length === 1 ? selectedCompIds[0] : null;

  // Box Selection Marquee
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Group drag initial offsets
  const dragGroupOffsetsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const dragRafRef = useRef<number | null>(null);
  const pendingDragCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const [showClearConfirmModal, setShowClearConfirmModal] = useState<boolean>(false);

  // Backward compatibility setter wrappers
  const setSelectedCompId = (id: string | null) => {
    setSelectedCompIds(id ? [id] : []);
  };
  const setSelectedWireId = (id: string | null) => {
    setSelectedWireIds(id ? [id] : []);
  };

  // Wire Routing Style: Orthogonal (Manhattan / 90 degrees) vs Bezier (Curved)
  const [wireStyle, setWireStyle] = useState<'orthogonal' | 'bezier'>('orthogonal');

  // Zoom & Pan Viewport State (Canvas Navigation)
  const [zoom, setZoom] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [canvasMode, setCanvasMode] = useState<'select' | 'pan'>('select');
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isSpacePressedRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Truth table & Karnaugh Map modal state
  const [showTruthTable, setShowTruthTable] = useState<boolean>(false);
  const [truthModalTab, setTruthModalTab] = useState<'table' | 'kmap'>('table');
  const [kmapSelectedOutputIdx, setKmapSelectedOutputIdx] = useState<number>(0);

  // Audio Buzzer & Web Audio refs (Shared singleton AudioContext to prevent exceeding hardware limits)
  const sharedAudioCtxRef = useRef<AudioContext | null>(null);
  const buzzerOscRef = useRef<OscillatorNode | null>(null);
  const buzzerGainRef = useRef<GainNode | null>(null);
  const buzzerLastStepRef = useRef<{ note: number; count: number; clockVal: boolean }>({
    note: -1,
    count: -1,
    clockVal: false,
  });

  const getAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    try {
      if (!sharedAudioCtxRef.current) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        sharedAudioCtxRef.current = new AudioCtx();
      }
      if (sharedAudioCtxRef.current.state === 'suspended') {
        sharedAudioCtxRef.current.resume().catch(() => {});
      }
      return sharedAudioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  // Waveform / Timing Scope State (Zamanlama Diyagramı)
  const [showWaveform, setShowWaveform] = useState<boolean>(false);
  const [waveformSamples, setWaveformSamples] = useState<{ time: number; values: Record<string, number> }[]>([]);
  const [isWaveformPaused, setIsWaveformPaused] = useState<boolean>(false);
  const sampleTimeRef = useRef<number>(0);

  // Rename modal state
  const [renameModalCompId, setRenameModalCompId] = useState<string | null>(null);
  const [renameInputVal, setRenameInputVal] = useState<string>('');
  const [renameLabelPos, setRenameLabelPos] = useState<'top' | 'bottom' | 'center' | 'hidden'>('bottom');

  // Circuit Statistics & CMOS Transistor Report Modal state
  const [showStatsModal, setShowStatsModal] = useState<boolean>(false);
  const [statsReport, setStatsReport] = useState<CircuitAnalysisReport | null>(null);

  const handleOpenStatsModal = () => {
    const report = analyzeCircuit(components, wires);
    setStatsReport(report);
    setShowStatsModal(true);
  };

  const handleCopyStatsReport = () => {
    if (!statsReport) return;
    const lines = [
      `=== DEVRE İSTATİSTİK RAPORU (LogicDesign CAD) ===`,
      `Toplam Bileşen: ${statsReport.totalComponents}`,
      `Toplam CMOS Transistör (T_cmos): ${statsReport.totalCMOSTransistors}`,
      `Kritik Yol Derinliği (t_pd logic levels): ${statsReport.criticalPathDepth}`,
      `Giriş / Çıkış: ${statsReport.inputCount} Giriş / ${statsReport.outputCount} Çıkış`,
      `Kombinasyonel / Sıralı: ${statsReport.combinationalCount} / ${statsReport.sequentialCount}`,
      `Toplam Bağlantı (Wire): ${statsReport.totalWires}`,
      ``,
      `--- BİLEŞEN DAĞILIMI ---`,
      ...statsReport.breakdown.map((b) => `${b.gateType}: ${b.count} adet (${b.transistorsPerUnit} T/adet) = ${b.totalTransistors} Transistör`),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    showToast('Devre istatistik raporu panoya kopyalandı');
  };

  // Boolean Logic Synthesizer Modal state (Boole İfadesinden ve Doğruluk Tablosundan Devre Sentezi)
  const [showSynthesizer, setShowSynthesizer] = useState<boolean>(false);
  const [synthMode, setSynthMode] = useState<'expression' | 'truthTable'>('expression');
  const [synthExprInput, setSynthExprInput] = useState<string>("A * B + C'");
  const [synthVarsCount, setSynthVarsCount] = useState<2 | 3 | 4>(3);
  const [synthTruthValues, setSynthTruthValues] = useState<Record<number, LogicValue>>({
    0: 0, 1: 0, 2: 1, 3: 0, 4: 1, 5: 1, 6: 0, 7: 1
  });
  const [synthGateType, setSynthGateType] = useState<'standard' | 'nand' | 'nor'>('standard');
  const [synthPlacement, setSynthPlacement] = useState<'replace' | 'append'>('replace');
  const [synthError, setSynthError] = useState<string | null>(null);

  // Floating Toast Notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Keyboard Shortcuts Modal state
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);

  // Audio mute state
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(false);

  // IC Datasheet Viewer Modal state
  const [showDatasheetModal, setShowDatasheetModal] = useState<boolean>(false);
  const [selectedDatasheetId, setSelectedDatasheetId] = useState<string>('74hc283');
  const [datasheetSearch, setDatasheetSearch] = useState<string>('');

  // Subcircuit / Custom IC Packaging Modal state
  const [showSubcircuitModal, setShowSubcircuitModal] = useState<boolean>(false);
  const [subcircuitName, setSubcircuitName] = useState<string>('ÖZEL_IC_1');
  const [subcircuitDesc, setSubcircuitDesc] = useState<string>('Kullanıcı Tanımlı Sayısal Mantık Bloğu');
  const [subcircuitCopied, setSubcircuitCopied] = useState<boolean>(false);
  const [customSubcircuits, setCustomSubcircuits] = useState<CustomSubcircuit[]>(() => getAllSubcircuits());

  // HDL Code Generator Modal state (Verilog / VHDL / FPGA Constraints)
  const [showHdlModal, setShowHdlModal] = useState<boolean>(false);
  const [hdlLang, setHdlLang] = useState<'verilog' | 'vhdl'>('verilog');
  const [hdlActiveTab, setHdlActiveTab] = useState<'verilog' | 'vhdl' | 'fpga'>('verilog');
  const [selectedFpgaBoard, setSelectedFpgaBoard] = useState<string>('basys3');
  const [hdlCopied, setHdlCopied] = useState<boolean>(false);
  const [fpgaCopied, setFpgaCopied] = useState<boolean>(false);

  // Hex Memory Editor Modal state (RAM & ROM Matrix)
  const [showHexModal, setShowHexModal] = useState<boolean>(false);
  const [hexTargetCompId, setHexTargetCompId] = useState<string | null>(null);
  const [hexDataBuffer, setHexDataBuffer] = useState<number[]>([]);

  // Automated Test Vector / Testbench Runner state
  const [showTestbenchModal, setShowTestbenchModal] = useState<boolean>(false);
  const [testbenchText, setTestbenchText] = useState<string>('');
  const [testbenchResult, setTestbenchResult] = useState<TestbenchResult | null>(null);

  // FSM State Machine Synthesizer Modal state
  const [showFsmModal, setShowFsmModal] = useState<boolean>(false);
  const [fsmStates, setFsmStates] = useState<FSMState[]>(FSM_PRESETS[0].states);
  const [fsmTransitions, setFsmTransitions] = useState<FSMTransition[]>(FSM_PRESETS[0].transitions);
  const [fsmSelectedPreset, setFsmSelectedPreset] = useState<string>('seq_101');

  // Preset Shelf Filter & Collapsible State
  const [isPresetsExpanded, setIsPresetsExpanded] = useState<boolean>(false);
  const [presetSearchQuery, setPresetSearchQuery] = useState<string>('');
  const [presetFilter, setPresetFilter] = useState<'all' | 'arithmetic' | 'basic' | 'sequential' | 'bus' | 'music_graphics'>('all');

  // Grid Snap State (10px grid snapping toggle)
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);

  // Palette search query
  const [paletteSearch, setPaletteSearch] = useState<string>('');

  // Canvas Grid background pattern style: 'dots' | 'lines' | 'clean'
  const [gridMode, setGridMode] = useState<'dots' | 'lines' | 'clean'>('lines');

  // Wire hover state for floating live signal tooltip
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);

  // Dragging state for moving components on canvas
  const [draggingCompId, setDraggingCompId] = useState<string | null>(null);

  // Manhattan wire corner / segment dragging state (supports waypoints)
  const [draggingWireJoint, setDraggingWireJoint] = useState<{
    wireId: string;
    type: 'corner1' | 'corner2' | 'segment' | 'waypoint';
    index?: number;
  } | null>(null);
  // Wire drag-to-branch state (pull branch from anywhere on wire like Logisim)
  const wireDragStartRef = useRef<{
    wireId: string;
    fromCompId: string;
    fromPinId: string;
    tap: { x: number; y: number };
    startClientX: number;
    startClientY: number;
    didDrag: boolean;
  } | null>(null);

  const wiringStartTimeRef = useRef<number>(0);
  const lastWireConnectedTimeRef = useRef<number>(0);

  const draggingWireJointRef = useRef<{
    wireId: string;
    type: 'corner1' | 'corner2' | 'segment' | 'waypoint';
    index?: number;
  } | null>(null);

  // Active component category tab in palette
  const [activeCategory, setActiveCategory] = useState<ComponentCategory>('gates');

  // Undo / Redo History Stacks
  interface HistorySnapshot {
    components: CircuitComponentInstance[];
    wires: CircuitWire[];
  }
  const [historyStack, setHistoryStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);
  const dragStartSnapshotRef = useRef<{
    components: CircuitComponentInstance[];
    wires: CircuitWire[];
    didMove: boolean;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  // Record history snapshot helper
  const recordHistory = useCallback(
    (customComps?: CircuitComponentInstance[], customWires?: CircuitWire[]) => {
      const compsToSave = customComps || components;
      const wiresToSave = customWires || wires;
      setHistoryStack((prev) => [
        ...prev.slice(-30),
        {
          components: JSON.parse(JSON.stringify(compsToSave)),
          wires: JSON.parse(JSON.stringify(wiresToSave)),
        },
      ]);
      setRedoStack([]);
    },
    [components, wires]
  );

  // Keep active sheet in sync with canvas components, wires, and annotations
  useEffect(() => {
    setSheets((prev) =>
      prev.map((s) => (s.id === activeSheetId ? { ...s, components, wires, annotations } : s))
    );
  }, [components, wires, annotations, activeSheetId]);

  // Undo Handler
  const handleUndo = useCallback(() => {
    setHistoryStack((prevHistory) => {
      if (prevHistory.length === 0) return prevHistory;
      const previous = prevHistory[prevHistory.length - 1];
      const newHistory = prevHistory.slice(0, -1);

      setRedoStack((prevRedo) => [
        ...prevRedo,
        {
          components: JSON.parse(JSON.stringify(components)),
          wires: JSON.parse(JSON.stringify(wires)),
        },
      ]);

      const refreshedComps = previous.components.map(updatePinPositions);
      const sim = simulateCircuit(refreshedComps, previous.wires);
      setComponents(sim.components);
      setWires(sim.wires);
      setSelectedCompId(null);
      setSelectedWireId(null);
      setWiringFrom(null);

      return newHistory;
    });
  }, [components, wires]);

  // Redo Handler
  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const next = prevRedo[prevRedo.length - 1];
      const newRedo = prevRedo.slice(0, -1);

      setHistoryStack((prevHistory) => [
        ...prevHistory,
        {
          components: JSON.parse(JSON.stringify(components)),
          wires: JSON.parse(JSON.stringify(wires)),
        },
      ]);

      const refreshedComps = next.components.map(updatePinPositions);
      const sim = simulateCircuit(refreshedComps, next.wires);
      setComponents(sim.components);
      setWires(sim.wires);
      setSelectedCompId(null);
      setSelectedWireId(null);
      setWiringFrom(null);

      return newRedo;
    });
  }, [components, wires]);

  // Execute simulation when components or wires change
  const runSimulation = useCallback(() => {
    setComponents((prevComps) => {
      setWires((prevWires) => {
        const sim = simulateCircuit(prevComps, prevWires);
        return sim.wires;
      });
      const sim = simulateCircuit(prevComps, wires);
      return sim.components;
    });
  }, [wires]);

  // Continuous Clock Generator Loop (Toggle interval = half period T/2 = 500 / clockHz ms)
  useEffect(() => {
    if (!isRunning) return;

    const intervalMs = Math.max(30, Math.round(500 / clockHz));
    const timer = setInterval(() => {
      setComponents((prev) => {
        let clockChanged = false;
        const updated = prev.map((comp) => {
          if (comp.type === 'clock') {
            clockChanged = true;
            return {
              ...comp,
              state: { ...comp.state, on: !comp.state.on },
            };
          }
          return comp;
        });

        if (clockChanged) {
          const sim = simulateCircuit(updated, wires);
          setWires(sim.wires);
          return sim.components;
        }
        return prev;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isRunning, clockHz, wires]);

  // Initial simulation run & auto-load saved workspace from localStorage or URL preset on mount
  useEffect(() => {
    try {
      const urlPreset = new URLSearchParams(window.location.search).get('preset');
      if (urlPreset) {
        handleLoadPreset(urlPreset);
        return;
      }

      const saved = localStorage.getItem('logic_workspace_autosave');
      if (saved) {
        const data = JSON.parse(saved);
        if (data && Array.isArray(data.components) && data.components.length > 0) {
          const sim = simulateCircuit(data.components, data.wires || []);
          setComponents(sim.components);
          setWires(sim.wires);
          if (Array.isArray(data.sheets) && data.sheets.length > 0) {
            setSheets(data.sheets);
          }
          if (data.activeSheetId) {
            setActiveSheetId(data.activeSheetId);
          }
          if (Array.isArray(data.annotations)) {
            setAnnotations(data.annotations);
          }
          showToast('Önceki çalışma oturumunuz otomatik olarak geri yüklendi.');
          return;
        }
      }
    } catch {
      // ignore
    }

    const sim = simulateCircuit(components, wires);
    setComponents(sim.components);
    setWires(sim.wires);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced Auto-Save to localStorage
  useEffect(() => {
    if (components.length === 0 && wires.length === 0) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          'logic_workspace_autosave',
          JSON.stringify({
            components,
            wires,
            annotations,
            sheets,
            activeSheetId,
            timestamp: Date.now(),
          })
        );
      } catch {
        // quota exceeded or private mode
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [components, wires, annotations, sheets, activeSheetId]);

  // Single step tick execution (User requested: "adım adım çalışan")
  const handleSingleStep = () => {
    setStepCount((c) => c + 1);
    setComponents((prevComps) => {
      // Toggle clock if present on manual step
      const withClockTick = prevComps.map((c) => {
        if (c.type === 'clock') {
          return { ...c, state: { ...c.state, on: !c.state.on } };
        }
        return c;
      });

      const step = simulateCircuitStep(withClockTick, wires);
      setWires(step.wires);
      return step.components;
    });
  };

  // Subtle mechanical toggle audio click synthesis (re-uses shared singleton AudioContext)
  const playSwitchSound = (turnOn: boolean) => {
    if (isSoundMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(turnOn ? 920 : 640, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.035);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.035);
      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // ignore
        }
      }, 50);
    } catch {
      // Ignore if audio blocked by browser policy
    }
  };

  // Toggle interactive switch directly on canvas (First click selects and opens HUD menu, second click toggles)
  const handleToggleSwitch = (e: React.MouseEvent, compId: string) => {
    e.stopPropagation();
    if (!selectedCompIds.includes(compId)) {
      setSelectedCompIds([compId]);
      setSelectedWireIds([]);
      return;
    }
    setComponents((prev) => {
      let toggledTo = false;
      const updated = prev.map((c) => {
        if (c.id === compId) {
          const nextState = !c.state.on;
          toggledTo = nextState;
          return {
            ...c,
            state: { ...c.state, on: nextState },
          };
        }
        return c;
      });
      playSwitchSound(toggledTo);
      const sim = simulateCircuit(updated, wires);
      setWires(sim.wires);
      return sim.components;
    });
  };

  // DIP Switch individual toggle handler (First click selects, subsequent click toggles)
  const handleToggleDipSwitch = (e: React.MouseEvent, compId: string, switchIdx: number) => {
    e.stopPropagation();
    if (!selectedCompIds.includes(compId)) {
      setSelectedCompIds([compId]);
      setSelectedWireIds([]);
      return;
    }
    setComponents((prev) => {
      let toggledTo = false;
      const updated = prev.map((c) => {
        if (c.id === compId) {
          const switches = [...(c.state.dipSwitches || [false, false, false, false])];
          switches[switchIdx] = !switches[switchIdx];
          toggledTo = switches[switchIdx];
          return {
            ...c,
            state: { ...c.state, dipSwitches: switches },
          };
        }
        return c;
      });
      playSwitchSound(toggledTo);
      const sim = simulateCircuit(updated, wires);
      setWires(sim.wires);
      return sim.components;
    });
  };

  // Pushbutton Down/Up handler (anlık bas-bırak buton)
  const handlePushbuttonState = (e: React.MouseEvent, compId: string, isDown: boolean) => {
    e.stopPropagation();
    setSelectedCompId(compId);
    playSwitchSound(isDown);
    setComponents((prev) => {
      let changed = false;
      const updated = prev.map((c) => {
        if (c.id === compId) {
          if (c.state.on === isDown) return c;
          changed = true;
          return {
            ...c,
            state: { ...c.state, on: isDown },
          };
        }
        return c;
      });
      if (!changed) return prev;
      const sim = simulateCircuit(updated, wires);
      setWires(sim.wires);
      return sim.components;
    });
  };

  // ASCII Keyboard character selection / keypress handler
  const handleToggleKeyboardChar = (e: React.MouseEvent, compId: string, char: string) => {
    e.stopPropagation();
    if (!selectedCompIds.includes(compId)) {
      setSelectedCompIds([compId]);
      setSelectedWireIds([]);
      return;
    }
    const code = char.charCodeAt(0);
    recordHistory();
    setComponents((prev) => {
      const updated = prev.map((c) => {
        if (c.id === compId) {
          return {
            ...c,
            state: {
              ...c.state,
              asciiChar: char === '\n' ? '↵' : char === ' ' ? '␣' : char,
              asciiCode: code,
              strobe: true,
            },
          };
        }
        return c;
      });
      const sim = simulateCircuit(updated, wires);
      setWires(sim.wires);
      return sim.components;
    });
  };

  // 16x16 RGB Matrix interactive pixel painting
  const handleToggleRgbPixel = (e: React.MouseEvent, compId: string, x: number, y: number) => {
    e.stopPropagation();
    if (!selectedCompIds.includes(compId)) {
      setSelectedCompIds([compId]);
      setSelectedWireIds([]);
      return;
    }
    setComponents((prev) => {
      const updated = prev.map((c) => {
        if (c.id === compId) {
          const pixels = (c.state.rgbPixels || Array.from({ length: 16 }, () => Array(16).fill('#050505'))).map((row) => [...row]);
          const current = pixels[y][x];
          const colorCycle = ['#050505', '#ef4444', '#22c55e', '#3b82f6', '#eab308', '#ec4899', '#06b6d4', '#ffffff'];
          const nextIdx = (colorCycle.indexOf(current) + 1) % colorCycle.length;
          pixels[y][x] = colorCycle[nextIdx === -1 ? 1 : nextIdx];
          return {
            ...c,
            state: {
              ...c.state,
              rgbPixels: pixels,
            },
          };
        }
        return c;
      });
      return updated;
    });
  };

  // Web Audio Chiptune Buzzer Tone Generator (Supports 16 Musical Notes, Authentic ADSR Envelope & Sequenced Articulation)
  useEffect(() => {
    const activeBuzzer = components.find(
      (c) => c.type === 'buzzer' && (c.inputs[0]?.value === 1 || c.state.on)
    );
    if (typeof window === 'undefined') return;

    if (isRunning && activeBuzzer && !isSoundMuted) {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const noteIdx = activeBuzzer.state.buzzerNote ?? 9;
        const freq = CHIPTUNE_NOTE_FREQS[noteIdx] ?? 659.25;

        // Detect if there is an active clock / counter running in the circuit
        const clockComp = components.find((c) => c.type === 'clock');
        const counterComp = components.find((c) => c.type === 'counter4');
        const isClockOn = clockComp ? !!clockComp.state.on : true;
        const currentCount = counterComp ? (counterComp.state.count ?? 0) : 0;

        // Ensure square wave oscillator and gain node exist
        if (!buzzerOscRef.current || !buzzerGainRef.current) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square'; // Authentic 8-bit retro pulse/square chiptune waveform
          osc.frequency.setValueAtTime(freq > 0 ? freq : 440, ctx.currentTime);
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          buzzerOscRef.current = osc;
          buzzerGainRef.current = gain;
        }

        const gainNode = buzzerGainRef.current;
        const oscNode = buzzerOscRef.current;
        const now = ctx.currentTime;

        const isNewStep =
          noteIdx !== buzzerLastStepRef.current.note ||
          currentCount !== buzzerLastStepRef.current.count ||
          (clockComp && isClockOn && !buzzerLastStepRef.current.clockVal);

        buzzerLastStepRef.current = {
          note: noteIdx,
          count: currentCount,
          clockVal: isClockOn,
        };

        if (freq === 0) {
          // Mute / rest (silent beat)
          gainNode.gain.cancelScheduledValues(now);
          gainNode.gain.setValueAtTime(0, now);
        } else {
          oscNode.frequency.setValueAtTime(freq, now);

          if (isNewStep) {
            // Authentic 8-bit chiptune envelope:
            // Fast attack, sustained body, and gate release before the next step for crisp note separation
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(0.001, now);
            gainNode.gain.linearRampToValueAtTime(0.045, now + 0.006); // 6ms attack
            gainNode.gain.exponentialRampToValueAtTime(0.035, now + 0.025); // decay to sustain

            if (clockComp) {
              // Sequencer mode: release at 82% of note beat for crisp retro articulation
              const noteDuration = Math.max(0.06, (1 / clockHz) * 0.82);
              gainNode.gain.setValueAtTime(0.035, now + noteDuration);
              gainNode.gain.linearRampToValueAtTime(0.0001, now + noteDuration + 0.012);
            }
          } else if (!clockComp) {
            // Manual DC circuit sustain (switch/button held)
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(0.04, now);
          }
        }
      } catch {
        // autoplay policy
      }
    } else {
      if (buzzerOscRef.current) {
        try {
          buzzerOscRef.current.stop();
          buzzerOscRef.current.disconnect();
        } catch {
          // ignore
        }
        buzzerOscRef.current = null;
        buzzerGainRef.current = null;
        buzzerLastStepRef.current = { note: -1, count: -1, clockVal: false };
      }
    }
  }, [components, isRunning, isSoundMuted, clockHz, getAudioContext]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (buzzerOscRef.current) {
        try {
          buzzerOscRef.current.stop();
          buzzerOscRef.current.disconnect();
        } catch {
          // ignore
        }
      }
      if (sharedAudioCtxRef.current) {
        try {
          sharedAudioCtxRef.current.close();
        } catch {
          // ignore
        }
        sharedAudioCtxRef.current = null;
      }
    };
  }, []);

  // Apply a specific input combination from K-Map cell directly to canvas switches
  const handleApplyInputsFromKMap = useCallback(
    (inputValues: number[]) => {
      const switchComps = components.filter((c) => c.type === 'switch' || c.type === 'pushbutton').slice(0, 6);
      if (switchComps.length === 0) return;

      setComponents((prev) => {
        const updated = prev.map((c) => {
          const sIdx = switchComps.findIndex((s) => s.id === c.id);
          if (sIdx !== -1 && sIdx < inputValues.length) {
            return {
              ...c,
              state: { ...c.state, on: inputValues[sIdx] === 1 },
            };
          }
          return c;
        });
        const sim = simulateCircuit(updated, wires);
        setWires(sim.wires);
        return sim.components;
      });
      playSwitchSound(true);
    },
    [components, wires]
  );



  // Canvas Mouse Coordinates Helper (respecting Zoom and Pan)
  const getCanvasCoords = (e: React.MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    return {
      x: Math.round((rawX - panOffset.x) / zoom),
      y: Math.round((rawY - panOffset.y) / zoom),
    };
  };

  // Drag component start (supports single or group dragging)
  const handleComponentMouseDown = (e: React.MouseEvent, comp: CircuitComponentInstance) => {
    e.stopPropagation();
    const coords = getCanvasCoords(e);
    dragStartSnapshotRef.current = {
      components: JSON.parse(JSON.stringify(components)),
      wires: JSON.parse(JSON.stringify(wires)),
      didMove: false,
    };

    let currentSelected = selectedCompIds;
    if (e.shiftKey) {
      if (currentSelected.includes(comp.id)) {
        currentSelected = currentSelected.filter((id) => id !== comp.id);
      } else {
        currentSelected = [...currentSelected, comp.id];
      }
      setSelectedCompIds(currentSelected);
    } else {
      if (!currentSelected.includes(comp.id)) {
        currentSelected = [comp.id];
        setSelectedCompIds([comp.id]);
        setSelectedWireIds([]);
      }
    }

    setDraggingCompId(comp.id);

    // Save relative offsets for all selected components relative to drag origin coords
    const offsets = new Map<string, { x: number; y: number }>();
    components.forEach((c) => {
      if (currentSelected.includes(c.id)) {
        offsets.set(c.id, { x: coords.x - c.x, y: coords.y - c.y });
      }
    });
    dragGroupOffsetsRef.current = offsets;
  };

  // Canvas Mouse Down: Start Pan or Start Box Selection
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Pan trigger: Right Click (e.button === 2), Middle Click (e.button === 1), Hand Tool (canvasMode === 'pan'), Spacebar, or Alt
    if (e.button === 2 || e.button === 1 || isSpacePressedRef.current || e.altKey || (canvasMode === 'pan' && e.button === 0)) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX - panOffset.x,
        y: e.clientY - panOffset.y,
      };
      return;
    }

    // Logisim-style interactive wiring: Clicking canvas while wiring places 90° orthogonal corner or freeform waypoint!
    if (e.button === 0 && wiringFrom) {
      const coords = getCanvasCoords(e);
      const snapped = {
        x: snapToGrid ? Math.round(coords.x / 10) * 10 : Math.round(coords.x),
        y: snapToGrid ? Math.round(coords.y / 10) * 10 : Math.round(coords.y),
      };

      setWiringFrom((prev) => {
        if (!prev) return null;
        const lastPt = prev.waypoints && prev.waypoints.length > 0 ? prev.waypoints[prev.waypoints.length - 1] : { x: prev.x, y: prev.y };
        
        // If Shift is pressed: Freeform direct point
        // If normal (default): Strictly 90-degree orthogonal Logisim corner (Horizontal then Vertical)
        if (e.shiftKey) {
          return {
            ...prev,
            waypoints: [...(prev.waypoints || []), snapped],
          };
        } else {
          // Logisim 90° corner
          const cornerPt = { x: snapped.x, y: lastPt.y };
          const newWps = (lastPt.x !== snapped.x && lastPt.y !== snapped.y)
            ? [...(prev.waypoints || []), cornerPt, snapped]
            : [...(prev.waypoints || []), snapped];
          return {
            ...prev,
            waypoints: newWps,
          };
        }
      });
      return;
    }

    // Normal left-click on canvas background starts box selection
    if (e.button === 0 && !wiringFrom) {
      didDragSelectionBoxRef.current = false;
      const coords = getCanvasCoords(e);
      if (!e.shiftKey) {
        setSelectedCompIds([]);
        setSelectedWireIds([]);
        setSelectedAnnotationId(null);
      }
      setSelectionBox({
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y,
      });
    }
  };

  // Canvas mouse move: dragging components, panning, box-selecting, or drawing active wire
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPanOffset({
        x: Math.round(e.clientX - panStartRef.current.x),
        y: Math.round(e.clientY - panStartRef.current.y),
      });
      return;
    }

    const coords = getCanvasCoords(e);
    if (!draggingCompId) setMousePos(coords);

    // Instant Logisim-style pull branch wire from anywhere on wire
    if (wireDragStartRef.current && !wiringFrom && !draggingCompId && !draggingWireJointRef.current) {
      const dx = Math.abs(e.clientX - wireDragStartRef.current.startClientX);
      const dy = Math.abs(e.clientY - wireDragStartRef.current.startClientY);
      if (dx > 16 || dy > 16) {
        wireDragStartRef.current.didDrag = true;
        const wInfo = wireDragStartRef.current;
        setWiringFrom({
          compId: wInfo.fromCompId,
          pinId: wInfo.fromPinId,
          pinType: 'output',
          x: wInfo.tap.x,
          y: wInfo.tap.y,
          branchPoint: wInfo.tap,
          sourceWireId: wInfo.wireId,
        });
        wireDragStartRef.current = null;
        return;
      }
    }

    const activeDragJoint = draggingWireJointRef.current || draggingWireJoint;
    if (activeDragJoint) {
      const snappedX = snapToGrid ? Math.round(coords.x / 10) * 10 : Math.round(coords.x);
      const snappedY = snapToGrid ? Math.round(coords.y / 10) * 10 : Math.round(coords.y);
      setWires((prev) => {
        const targetWire = prev.find((w) => w.id === activeDragJoint.wireId);
        if (!targetWire) return prev;

        return prev.map((w) => {
          if (w.id === activeDragJoint.wireId) {
            // Dragging an interactive waypoint corner:
            if (activeDragJoint.type === 'waypoint' && activeDragJoint.index !== undefined && w.waypoints) {
              const updatedWps = [...w.waypoints];
              updatedWps[activeDragJoint.index] = { x: snappedX, y: snappedY };
              return { ...w, waypoints: updatedWps };
            }
            return { ...w, elbowX: snappedX };
          }
          // ANY branch wire in the same electrical net follows elbowX
          if (w.branchPoint && (w.fromPinId === targetWire.fromPinId || w.sourceWireId === targetWire.id)) {
            return {
              ...w,
              branchPoint: {
                ...w.branchPoint,
                x: snappedX,
              },
            };
          }
          return w;
        });
      });
      return;
    }

    if (draggingCompId && dragGroupOffsetsRef.current.size > 0) {
      if (dragStartSnapshotRef.current) {
        dragStartSnapshotRef.current.didMove = true;
      }
      pendingDragCoordsRef.current = coords;

      if (!dragRafRef.current) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          const currentCoords = pendingDragCoordsRef.current;
          if (!currentCoords || !dragGroupOffsetsRef.current || dragGroupOffsetsRef.current.size === 0) return;

          const offsets = dragGroupOffsetsRef.current;
          const initialComps = dragStartSnapshotRef.current ? dragStartSnapshotRef.current.components : [];
          const initialWires = dragStartSnapshotRef.current ? dragStartSnapshotRef.current.wires : [];
          const initialCompMap = new Map(initialComps.map((c) => [c.id, c]));

          const movedCompDeltas = new Map<string, { dx: number; dy: number }>();
          for (const [cId, off] of offsets.entries()) {
            const rawX = currentCoords.x - off.x;
            const rawY = currentCoords.y - off.y;
            const snappedX = snapToGrid ? Math.max(10, Math.round(rawX / 10) * 10) : Math.max(10, Math.round(rawX));
            const snappedY = snapToGrid ? Math.max(10, Math.round(rawY / 10) * 10) : Math.max(10, Math.round(rawY));
            const c0 = initialCompMap.get(cId);
            if (c0) {
              movedCompDeltas.set(cId, { dx: snappedX - c0.x, dy: snappedY - c0.y });
            }
          }

          setComponents((prev) =>
            prev.map((c) => {
              const delta = movedCompDeltas.get(c.id);
              const c0 = initialCompMap.get(c.id);
              if (delta && c0) {
                return updatePinPositions({ ...c, x: c0.x + delta.dx, y: c0.y + delta.dy });
              }
              return c;
            })
          );

          if (initialWires.length > 0 && movedCompDeltas.size > 0) {
            setWires((prev) =>
              prev.map((w) => {
                const initialWire = initialWires.find((iw) => iw.id === w.id);
                if (!initialWire) return w;

                let updatedWire = { ...w };

                const fromDelta = movedCompDeltas.get(w.fromCompId);
                const toDelta = movedCompDeltas.get(w.toCompId);

                // If this wire is a self-feedback loop (fromCompId === toCompId) OR both endpoints moved together:
                if (fromDelta && (toDelta || w.fromCompId === w.toCompId) && (!toDelta || (fromDelta.dx === toDelta.dx && fromDelta.dy === toDelta.dy))) {
                  const delta = fromDelta;
                  if (initialWire.branchPoint) {
                    updatedWire.branchPoint = {
                      x: initialWire.branchPoint.x + delta.dx,
                      y: initialWire.branchPoint.y + delta.dy,
                    };
                  }
                  if (initialWire.elbowX !== undefined) {
                    updatedWire.elbowX = initialWire.elbowX + delta.dx;
                  }
                  if (initialWire.elbowY !== undefined) {
                    updatedWire.elbowY = initialWire.elbowY + delta.dy;
                  }
                  if (initialWire.waypoints && initialWire.waypoints.length > 0) {
                    updatedWire.waypoints = initialWire.waypoints.map((pt) => ({
                      x: pt.x + delta.dx,
                      y: pt.y + delta.dy,
                    }));
                  }
                  if (initialWire.endPoint) {
                    updatedWire.endPoint = {
                      x: initialWire.endPoint.x + delta.dx,
                      y: initialWire.endPoint.y + delta.dy,
                    };
                  }
                  if (initialWire.startPoint) {
                    updatedWire.startPoint = {
                      x: initialWire.startPoint.x + delta.dx,
                      y: initialWire.startPoint.y + delta.dy,
                    };
                  }
                } else if (fromDelta && initialWire.branchPoint) {
                  // Only source component moved for a branch wire
                  updatedWire.branchPoint = {
                    x: initialWire.branchPoint.x + fromDelta.dx,
                    y: initialWire.branchPoint.y + fromDelta.dy,
                  };
                }

                return updatedWire;
              })
            );
          }
        });
      }
      return;
    }

    if (selectionBox) {
      if (Math.abs(coords.x - selectionBox.startX) > 4 || Math.abs(coords.y - selectionBox.startY) > 4) {
        didDragSelectionBoxRef.current = true;
      }
      setSelectionBox((prev) => (prev ? { ...prev, currentX: coords.x, currentY: coords.y } : null));
    }
  };

  // Canvas mouse up: stop dragging, stop panning, or finalize box selection
  const handleCanvasMouseUp = (e: React.MouseEvent) => {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    if (wiringFrom) {
      const coords = getCanvasCoords(e);
      const didDragWire = Math.hypot(coords.x - wiringFrom.x, coords.y - wiringFrom.y) > 20 || (wiringFrom.waypoints && wiringFrom.waypoints.length > 0);
      if (didDragWire) {
        finishWireAtPoint(coords);
        return;
      }
    }
    wireDragStartRef.current = null;
    if (draggingWireJointRef.current || draggingWireJoint) {
      draggingWireJointRef.current = null;
      setDraggingWireJoint(null);
      recordHistory();
      runSimulation();
    }
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingCompId) {
      if (dragStartSnapshotRef.current && dragStartSnapshotRef.current.didMove) {
        recordHistory(dragStartSnapshotRef.current.components, dragStartSnapshotRef.current.wires);
      }
      dragStartSnapshotRef.current = null;
      setDraggingCompId(null);
      dragGroupOffsetsRef.current.clear();
      runSimulation();
    }
    if (selectionBox) {
      const minX = Math.min(selectionBox.startX, selectionBox.currentX);
      const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
      const minY = Math.min(selectionBox.startY, selectionBox.currentY);
      const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

      if (maxX - minX > 5 || maxY - minY > 5) {
        didDragSelectionBoxRef.current = true;
        // Enclosed components (box intersection)
        const enclosedComps = components
          .filter((c) => {
            const meta = COMPONENT_CATALOG[c.type];
            const compW = meta?.width || (c.type === 'subcircuit' ? 130 : 60);
            const compH = meta?.height || (c.type === 'subcircuit' ? 80 : 50);
            return (
              c.x + compW >= minX &&
              c.x <= maxX &&
              c.y + compH >= minY &&
              c.y <= maxY
            );
          })
          .map((c) => c.id);

        // Enclosed wires (supports open stubs, branches, and box crossing)
        const enclosedWires = wires
          .filter((w) => {
            const startPt = getWireStartPt(w);
            const toP = findPinById(w.toPinId);
            const endPt = toP ? { x: toP.x, y: toP.y } : (w.endPoint || startPt);

            // Check if start, end, or any waypoint is inside selection box
            if (startPt.x >= minX && startPt.x <= maxX && startPt.y >= minY && startPt.y <= maxY) return true;
            if (endPt.x >= minX && endPt.x <= maxX && endPt.y >= minY && endPt.y <= maxY) return true;
            if (w.waypoints && w.waypoints.some((pt) => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY)) return true;

            // Check if wire's bounding envelope overlaps selection box
            const allPts = [startPt, ...(w.waypoints || []), endPt];
            const wMinX = Math.min(...allPts.map((p) => p.x));
            const wMaxX = Math.max(...allPts.map((p) => p.x));
            const wMinY = Math.min(...allPts.map((p) => p.y));
            const wMaxY = Math.max(...allPts.map((p) => p.y));

            const overlaps = wMinX <= maxX && wMaxX >= minX && wMinY <= maxY && wMaxY >= minY;
            const compsSelected = (w.fromCompId && enclosedComps.includes(w.fromCompId)) || (w.toCompId && enclosedComps.includes(w.toCompId));
            return overlaps || compsSelected;
          })
          .map((w) => w.id);

        setSelectedCompIds((prev) => (e.shiftKey ? Array.from(new Set([...prev, ...enclosedComps])) : enclosedComps));
        setSelectedWireIds((prev) => (e.shiftKey ? Array.from(new Set([...prev, ...enclosedWires])) : enclosedWires));
        setTimeout(() => {
          didDragSelectionBoxRef.current = false;
        }, 150);
      } else {
        didDragSelectionBoxRef.current = false;
      }
      setSelectionBox(null);
    }
  };

  // Wheel Zoom: only zoom when Ctrl key is held (standard CAD/Figma convention);
  // normal mouse wheel scrolls the web page up and down naturally without zooming the canvas.
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;

    const onWheelNative = (e: WheelEvent) => {
      // If Ctrl is not pressed, do nothing -> let the browser scroll the page smoothly!
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoom((prevZoom) => {
        const newZoom = Math.min(2.5, Math.max(0.4, Number((prevZoom * zoomFactor).toFixed(2))));
        setPanOffset((prevPan) => ({
          x: Math.round(mouseX - (mouseX - prevPan.x) * (newZoom / prevZoom)),
          y: Math.round(mouseY - (mouseY - prevPan.y) * (newZoom / prevZoom)),
        }));
        return newZoom;
      });
    };

    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheelNative);
    };
  }, []);

  // Reset Zoom & Pan to 100% and Center
  const handleResetView = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Export Circuit Project to JSON File (Multi-Sheet supported)
  const handleExportJSON = () => {
    const updatedSheets = sheets.map((s) =>
      s.id === activeSheetId ? { ...s, components, wires } : s
    );
    const data = {
      version: '2.0',
      appName: 'LogicDesign Studio',
      exportedAt: new Date().toISOString(),
      activeSheetId,
      sheets: updatedSheets,
      components,
      wires,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devre_projesi_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Subcircuit Packaging Analysis
  const subcircuitAnalysis = useMemo(() => {
    const inputComps = components.filter((c) =>
      ['switch', 'pushbutton', 'clock', 'tunnel', 'dipSwitch4'].includes(c.type)
    );
    const outputComps = components.filter((c) =>
      ['led', 'sevenSegment', 'hexDisplay', 'buzzer', 'probe', 'tunnel', 'ledBar4'].includes(c.type)
    );
    const internalGates = components.filter(
      (c) => !inputComps.includes(c) && !outputComps.includes(c)
    );
    return {
      inputs: inputComps,
      outputs: outputComps,
      internalCount: internalGates.length,
      wireCount: wires.length,
      totalComps: components.length,
    };
  }, [components, wires]);

  const handleExportSubcircuitJSON = () => {
    const pkg = {
      format: 'LogicDesign-Subcircuit-Package',
      version: '1.0',
      name: subcircuitName.trim() || 'CUSTOM_IC',
      description: subcircuitDesc.trim(),
      exportedAt: new Date().toISOString(),
      interface: {
        inputs: subcircuitAnalysis.inputs.map((c, idx) => ({
          id: c.id,
          name: c.label || `IN_${idx + 1}`,
          type: c.type,
          state: c.state?.on ? 1 : 0,
        })),
        outputs: subcircuitAnalysis.outputs.map((c, idx) => ({
          id: c.id,
          name: c.label || `OUT_${idx + 1}`,
          type: c.type,
        })),
      },
      circuit: {
        components,
        wires,
      },
    };
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(subcircuitName.trim() || 'custom_ic').toLowerCase().replace(/\s+/g, '_')}_package.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopySubcircuitJSON = () => {
    const pkg = {
      format: 'LogicDesign-Subcircuit-Package',
      version: '1.0',
      name: subcircuitName.trim() || 'CUSTOM_IC',
      description: subcircuitDesc.trim(),
      interface: {
        inputs: subcircuitAnalysis.inputs.map((c, idx) => c.label || `IN_${idx + 1}`),
        outputs: subcircuitAnalysis.outputs.map((c, idx) => c.label || `OUT_${idx + 1}`),
      },
      stats: {
        totalComponents: components.length,
        wireCount: wires.length,
      },
      circuit: { components, wires },
    };
    navigator.clipboard.writeText(JSON.stringify(pkg, null, 2));
    setSubcircuitCopied(true);
    setTimeout(() => setSubcircuitCopied(false), 2000);
  };

  const currentCircuitName = useMemo(() => {
    if (selectedPresetId) {
      const p = CIRCUIT_PRESETS.find((preset) => preset.id === selectedPresetId);
      if (p) return p.name;
    }
    return 'my_digital_circuit';
  }, [selectedPresetId]);

  const generatedVerilogCode = useMemo(() => {
    return generateVerilog(currentCircuitName, components, wires);
  }, [currentCircuitName, components, wires]);

  const generatedVhdlCode = useMemo(() => {
    return generateVHDL(currentCircuitName, components, wires);
  }, [currentCircuitName, components, wires]);

  const handleCopyHdlCode = () => {
    const code = hdlLang === 'verilog' ? generatedVerilogCode : generatedVhdlCode;
    navigator.clipboard.writeText(code);
    setHdlCopied(true);
    setTimeout(() => setHdlCopied(false), 2000);
  };

  const handleDownloadHdlFile = () => {
    const isV = hdlLang === 'verilog';
    const code = isV ? generatedVerilogCode : generatedVhdlCode;
    const ext = isV ? 'v' : 'vhd';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentCircuitName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generatedFpgaData = useMemo(() => {
    return generateFpgaConstraints(selectedFpgaBoard, components);
  }, [selectedFpgaBoard, components]);

  const handleCopyFpgaConstraints = () => {
    navigator.clipboard.writeText(generatedFpgaData.content);
    setFpgaCopied(true);
    setTimeout(() => setFpgaCopied(false), 2000);
  };

  const handleDownloadFpgaFile = () => {
    const blob = new Blob([generatedFpgaData.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generatedFpgaData.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // VCD Export Handler
  const handleExportVCD = () => {
    if (waveformSamples.length === 0) {
      showToast('Zamanlama kaydı henüz oluşmadı. Simülasyonu çalıştırın.');
      return;
    }
    const vcdContent = generateVCD(waveformSamples, components);
    const blob = new Blob([vcdContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentCircuitName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_waveform.vcd`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('GTKWave / ModelSim uyumlu VCD dosyası indirildi!');
  };

  // Open Hex Memory Editor for selected RAM / ROM
  const handleOpenHexEditor = (compId?: string) => {
    const target = compId
      ? components.find((c) => c.id === compId)
      : components.find((c) => selectedCompIds.includes(c.id) && (c.type === 'ram16x4' || c.type === 'rom16x4')) ||
        components.find((c) => c.type === 'ram16x4' || c.type === 'rom16x4');

    if (!target) {
      showToast('Tuvalde RAM veya ROM bileşeni bulunamadı.');
      return;
    }

    setHexTargetCompId(target.id);
    const rawData = target.type === 'ram16x4' ? target.state.ramData : target.state.romData;
    const initial = Array.isArray(rawData) && rawData.length === 16 ? [...rawData] : Array(16).fill(0);
    setHexDataBuffer(initial);
    setShowHexModal(true);
  };

  // Save Hex Memory Editor Data
  const handleSaveHexEditor = () => {
    if (!hexTargetCompId) return;
    recordHistory();
    setComponents((prev) =>
      prev.map((c) => {
        if (c.id === hexTargetCompId) {
          if (c.type === 'ram16x4') {
            return { ...c, state: { ...c.state, ramData: [...hexDataBuffer] } };
          }
          if (c.type === 'rom16x4') {
            return { ...c, state: { ...c.state, romData: [...hexDataBuffer] } };
          }
        }
        return c;
      })
    );
    setShowHexModal(false);
    showToast('Bellek verileri başarıyla güncellendi!');
  };

  // Run Testbench Handler
  const handleRunTestbench = () => {
    try {
      const res = runCircuitTestbench(components, wires, testbenchText);
      setTestbenchResult(res);
      showToast(`Test tamamlandı: ${res.passedTests}/${res.totalTests} test geçti (%${res.successRate})`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Testbench çalıştırılamadı.');
    }
  };

  // Auto-generate testbench text
  const handleAutoGenerateTestbench = () => {
    const generated = generateExhaustiveTestVector(components);
    setTestbenchText(generated);
    setTestbenchResult(null);
    showToast('Tüm girişler için test vektörleri üretildi!');
  };

  // Synthesize FSM onto canvas
  const handleSynthesizeFSM = () => {
    try {
      const maxX = components.length > 0 ? Math.max(...components.map((c) => c.x)) : 60;
      const startX = maxX > 60 ? maxX + 180 : 80;
      const res = synthesizeFSM(fsmStates, fsmTransitions, startX, 80);

      recordHistory();
      setComponents((prev) => [...prev, ...res.components]);
      setWires((prev) => [...prev, ...res.wires]);
      setShowFsmModal(false);
      showToast('FSM Durum Makinesi başarıyla tuvale sentezlendi!');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'FSM sentezlenemedi.');
    }
  };

  // Export Truth Table to CSV for lab reports
  const handleExportTruthTableCSV = () => {
    if (!truthTableData || truthTableData.rows.length === 0) return;
    const inHeaders = truthTableData.inputs.map((i) => i.name);
    const outHeaders = truthTableData.outputs.map((o) => o.name);
    const headerLine = [...inHeaders, ...outHeaders].join(',');
    const dataLines = truthTableData.rows.map((r) => [...r.inputValues, ...r.outputValues].join(','));
    const csv = [headerLine, ...dataLines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dogruluk_tablosu_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Doğruluk tablosu CSV formatında indirildi.');
  };

  // Import Circuit from JSON or Standard CAD (.circ) XML File
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';

      // Check if file is standard CAD (.circ) XML format
      if (file.name.endsWith('.circ') || text.trim().startsWith('<?xml') || text.includes('<project') || text.includes('<circuit')) {
        try {
          const importedCircuits = importCircXmlProject(text);
          if (importedCircuits.length > 0) {
            recordHistory();
            const newSheets: CircuitSheet[] = importedCircuits.map((c, idx) => ({
              id: `sheet_circ_${Date.now()}_${idx}`,
              name: c.name || `Devre ${idx + 1}`,
              components: c.components.map(updatePinPositions),
              wires: c.wires,
            }));
            setSheets(newSheets);
            setActiveSheetId(newSheets[0].id);
            const sim = simulateCircuit(newSheets[0].components, newSheets[0].wires);
            setComponents(sim.components);
            setWires(sim.wires);
            setSelectedCompId(null);
            setSelectedWireId(null);
            handleResetView();
            showToast(`CAD Devre Şeması (${file.name}) başarıyla içe aktarıldı!`);
            return;
          }
        } catch (err: unknown) {
          alert('CAD .circ dosyasını okurken hata: ' + (err instanceof Error ? err.message : String(err)));
          return;
        }
      }

      // Standard JSON circuit parsing
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json.sheets) && json.sheets.length > 0) {
          recordHistory();
          const loadedSheets: CircuitSheet[] = json.sheets.map((s: CircuitSheet) => ({
            ...s,
            components: (s.components || []).map(updatePinPositions),
            wires: s.wires || [],
          }));
          setSheets(loadedSheets);
          const firstSheet = loadedSheets.find((s) => s.id === json.activeSheetId) || loadedSheets[0];
          setActiveSheetId(firstSheet.id);
          const sim = simulateCircuit(firstSheet.components, firstSheet.wires);
          setComponents(sim.components);
          setWires(sim.wires);
          setSelectedCompId(null);
          setSelectedWireId(null);
          handleResetView();
          showToast('Proje başarıyla yüklendi.');
        } else if (Array.isArray(json.components) && Array.isArray(json.wires)) {
          recordHistory();
          const refreshedComps = json.components.map(updatePinPositions);
          const sim = simulateCircuit(refreshedComps, json.wires);
          const defaultSheet: CircuitSheet = {
            id: 'sheet_1',
            name: 'Ana Devre',
            components: sim.components,
            wires: sim.wires,
          };
          setSheets([defaultSheet]);
          setActiveSheetId('sheet_1');
          setComponents(sim.components);
          setWires(sim.wires);
          setSelectedCompId(null);
          setSelectedWireId(null);
          handleResetView();
          showToast('Devre başarıyla yüklendi.');
        } else {
          alert('Hata: Dosyada geçerli devre bileşenleri bulunamadı.');
        }
      } catch {
        alert('Hata: Geçersiz dosya formatı (JSON veya .circ XML bekleniyor)!');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Export Circuit to High-Res PNG Image
  const handleExportPNG = () => {
    if (!svgRef.current) return;
    const svgElement = svgRef.current;
    const svgString = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const blobURL = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2; // High-DPI 2x
      canvas.width = (svgElement.clientWidth || 1000) * scale;
      canvas.height = (svgElement.clientHeight || 600) * scale;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pngURL = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngURL;
        a.download = `devre_semasi_${Date.now()}.png`;
        a.click();
      }
      URL.revokeObjectURL(blobURL);
    };
    image.src = blobURL;
  };

  // Export Circuit to High-Res Vector SVG
  const handleExportSVG = () => {
    if (!svgRef.current) return;
    const svgElement = svgRef.current;
    const svgString = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devre_semasi_${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Circuit to Standard CAD (.circ) XML Format
  const handleExportCirc = () => {
    const compXmls: string[] = [];
    components.forEach((c) => {
      let standardCompName = '';
      let lib = '1';
      switch (c.type) {
        case 'and': standardCompName = 'AND Gate'; break;
        case 'or': standardCompName = 'OR Gate'; break;
        case 'not': standardCompName = 'NOT Gate'; break;
        case 'nand': standardCompName = 'NAND Gate'; break;
        case 'nor': standardCompName = 'NOR Gate'; break;
        case 'xor': standardCompName = 'XOR Gate'; break;
        case 'xnor': standardCompName = 'XNOR Gate'; break;
        case 'switch': standardCompName = 'Pin'; lib = '0'; break;
        case 'pushbutton': standardCompName = 'Pin'; lib = '0'; break;
        case 'clock': standardCompName = 'Clock'; lib = '0'; break;
        case 'vcc': standardCompName = 'Constant'; lib = '0'; break;
        case 'gnd': standardCompName = 'Constant'; lib = '0'; break;
        case 'led': standardCompName = 'LED'; lib = '5'; break;
        case 'probe': standardCompName = 'Probe'; lib = '0'; break;
        case 'sevenSegment': standardCompName = '7-Segment Display'; lib = '5'; break;
        case 'hexDisplay': standardCompName = 'Hex Digit Display'; lib = '5'; break;
        case 'fullAdder': standardCompName = 'Adder'; lib = '3'; break;
        case 'fullSubtractor': standardCompName = 'Subtractor'; lib = '3'; break;
        case 'mux2': standardCompName = 'Multiplexer'; lib = '2'; break;
        case 'demux2': standardCompName = 'Demultiplexer'; lib = '2'; break;
        case 'dFlipFlop': standardCompName = 'D Flip-Flop'; lib = '4'; break;
        case 'jkFlipFlop': standardCompName = 'J-K Flip-Flop'; lib = '4'; break;
        case 'tFlipFlop': standardCompName = 'T Flip-Flop'; lib = '4'; break;
        case 'register4': standardCompName = 'Register'; lib = '4'; break;
        case 'counter4': standardCompName = 'Counter'; lib = '4'; break;
        case 'ram16x4': standardCompName = 'RAM'; lib = '4'; break;
        case 'rom16x4': standardCompName = 'ROM'; lib = '4'; break;
        default: break;
      }
      if (standardCompName) {
        compXmls.push(`    <comp lib="${lib}" loc="(${Math.round(c.x)},${Math.round(c.y)})" name="${standardCompName}"/>`);
      }
    });

    const wireXmls: string[] = [];
    wires.forEach((w) => {
      const fromPin = findPinById(w.fromPinId);
      const toPin = findPinById(w.toPinId);
      if (fromPin && toPin) {
        wireXmls.push(`    <wire from="(${Math.round(fromPin.x)},${Math.round(fromPin.y)})" to="(${Math.round(toPin.x)},${Math.round(toPin.y)})"/>`);
      }
    });

    const circXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<project source="3.8.0" version="1.0">
  This file was exported by LogicDesign Studio.
  <lib desc="#Wiring" name="0"/>
  <lib desc="#Gates" name="1"/>
  <lib desc="#Plexers" name="2"/>
  <lib desc="#Arithmetic" name="3"/>
  <lib desc="#Memory" name="4"/>
  <lib desc="#I/O" name="5"/>
  <main name="main"/>
  <circuit name="main">
${compXmls.join('\n')}
${wireXmls.join('\n')}
  </circuit>
</project>`;

    const blob = new Blob([circXml], { type: 'application/xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devre_${Date.now()}.circ`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Standart CAD (.circ) devre dosyası başarıyla dışa aktarıldı!');
  };

  // Switch Active Circuit Sheet
  const handleSwitchSheet = (targetSheetId: string) => {
    if (targetSheetId === activeSheetId) return;
    const target = sheets.find((s) => s.id === targetSheetId);
    if (!target) return;

    // Persist current active sheet before switching
    setSheets((prev) =>
      prev.map((s) => (s.id === activeSheetId ? { ...s, components, wires } : s))
    );

    setActiveSheetId(targetSheetId);
    const refreshedComps = target.components.map(updatePinPositions);
    const sim = simulateCircuit(refreshedComps, target.wires);
    setComponents(sim.components);
    setWires(sim.wires);
    setSelectedCompIds([]);
    setSelectedWireIds([]);
    setWiringFrom(null);
  };

  // Add New Circuit Sheet
  const handleAddSheet = () => {
    const newId = `sheet_${Date.now()}`;
    const newName = `Sayfa ${sheets.length + 1}`;
    setSheets((prev) => [
      ...prev.map((s) => (s.id === activeSheetId ? { ...s, components, wires } : s)),
      { id: newId, name: newName, components: [], wires: [] },
    ]);
    setActiveSheetId(newId);
    setComponents([]);
    setWires([]);
    setSelectedCompIds([]);
    setSelectedWireIds([]);
    setWiringFrom(null);
  };

  // Duplicate Sheet with newly generated component & wire IDs
  const handleDuplicateSheet = (sheetId: string) => {
    const source =
      sheetId === activeSheetId
        ? { id: activeSheetId, name: sheets.find((s) => s.id === activeSheetId)?.name || 'Sayfa', components, wires }
        : sheets.find((s) => s.id === sheetId);
    if (!source) return;

    const newId = `sheet_${Date.now()}`;
    const newName = `${source.name} (Kopya)`;
    const compIdMap = new Map<string, string>();
    const clonedComps = source.components.map((c) => {
      const newCompId = `${c.type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      compIdMap.set(c.id, newCompId);
      return {
        ...c,
        id: newCompId,
        x: c.x + 20,
        y: c.y + 20,
        inputs: c.inputs.map((pin) => ({ ...pin, id: `${newCompId}_in_${pin.name}` })),
        outputs: c.outputs.map((pin) => ({ ...pin, id: `${newCompId}_out_${pin.name}` })),
      };
    });
    const clonedWires = source.wires.map((w) => {
      const fromC = clonedComps.find((c) => compIdMap.get(w.fromCompId) === c.id);
      const toC = clonedComps.find((c) => compIdMap.get(w.toCompId) === c.id);
      const fromPin = fromC ? fromC.outputs[0]?.id || w.fromPinId : w.fromPinId;
      const toPin = toC ? toC.inputs[0]?.id || w.toPinId : w.toPinId;
      return {
        ...w,
        id: `wire_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        fromCompId: compIdMap.get(w.fromCompId) || w.fromCompId,
        fromPinId: fromPin,
        toCompId: compIdMap.get(w.toCompId) || w.toCompId,
        toPinId: toPin,
      };
    });

    setSheets((prev) => [
      ...prev.map((s) => (s.id === activeSheetId ? { ...s, components, wires } : s)),
      { id: newId, name: newName, components: clonedComps, wires: clonedWires },
    ]);
    setActiveSheetId(newId);
    setComponents(clonedComps);
    setWires(clonedWires);
  };

  // Delete Circuit Sheet (Minimum 1 sheet must remain)
  const handleDeleteSheet = (sheetId: string) => {
    if (sheets.length <= 1) return;
    const remaining = sheets.filter((s) => s.id !== sheetId);
    setSheets(remaining);
    if (activeSheetId === sheetId) {
      const nextSheet = remaining[0];
      setActiveSheetId(nextSheet.id);
      const refreshedComps = nextSheet.components.map(updatePinPositions);
      const sim = simulateCircuit(refreshedComps, nextSheet.wires);
      setComponents(sim.components);
      setWires(sim.wires);
      setSelectedCompIds([]);
      setSelectedWireIds([]);
      setWiringFrom(null);
    }
  };

  // Rename Circuit Sheet
  const handleRenameSheet = (sheetId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setEditingSheetId(null);
      return;
    }
    setSheets((prev) =>
      prev.map((s) => (s.id === sheetId ? { ...s, name: trimmed } : s))
    );
    setEditingSheetId(null);
  };

  // Add Annotation (Frame or Sticky Note)
  const handleAddAnnotation = (type: 'frame' | 'note') => {
    const newId = `ann_${Date.now()}`;
    const posX = Math.round((-panOffset.x + 320) / 20) * 20;
    const posY = Math.round((-panOffset.y + 180) / 20) * 20;

    const newAnn: CircuitAnnotation = {
      id: newId,
      type,
      title: type === 'frame' ? 'Açıklama Bloğu' : 'Yapışkan Not',
      text: type === 'note' ? 'Buraya notunuzu ekleyin...' : undefined,
      x: Math.max(40, posX),
      y: Math.max(40, posY),
      width: type === 'frame' ? 280 : 180,
      height: type === 'frame' ? 180 : 120,
      color: type === 'frame' ? 'blue' : 'amber',
    };
    recordHistory();
    setAnnotations((prev) => [...prev, newAnn]);
    setSelectedAnnotationId(newId);
    showToast(type === 'frame' ? 'Açıklama çerçevesi eklendi!' : 'Yapışkan not eklendi!');
  };

  // Delete Annotation
  const handleDeleteAnnotation = (id: string) => {
    recordHistory();
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    if (selectedAnnotationId === id) setSelectedAnnotationId(null);
  };

  // Turn another project sheet into a modular IC block and place on active canvas
  const handleAddSheetAsSubcircuit = (sheet: CircuitSheet) => {
    const inputComps = sheet.components.filter((c) =>
      ['switch', 'pushbutton', 'clock', 'tunnel', 'dipSwitch4'].includes(c.type)
    );
    const outputComps = sheet.components.filter((c) =>
      ['led', 'sevenSegment', 'hexDisplay', 'buzzer', 'probe', 'tunnel', 'ledBar4'].includes(c.type)
    );

    if (inputComps.length === 0 && outputComps.length === 0) {
      alert(`"${sheet.name}" sayfasında henüz giriş (Anahtar/Saat) veya çıkış (LED/Ekran) bulunamadı. Lütfen önce o sayfaya giriş ve çıkışlar ekleyin.`);
      return;
    }

    const inPorts = inputComps.map((c, idx) => ({
      id: `p_in_${idx}`,
      name: c.label || `IN${idx}`,
      type: 'input' as const,
      targetCompId: c.id,
      targetPinId: c.outputs[0]?.id || `${c.id}_out`,
    }));

    const outPorts = outputComps.map((c, idx) => ({
      id: `p_out_${idx}`,
      name: c.label || `OUT${idx}`,
      type: 'output' as const,
      targetCompId: c.id,
      targetPinId: c.inputs[0]?.id || `${c.id}_in`,
    }));

    const subId = `sub_sheet_${sheet.id}`;
    const code = `SHT-${sheet.name.substring(0, 3).toUpperCase()}`;

    const subDef: CustomSubcircuit = {
      id: subId,
      name: sheet.name,
      chipCode: code,
      description: `${sheet.name} sayfasının paketlenmiş modüler entegre devresi.`,
      category: 'custom',
      color: '#4f46e5',
      width: 136,
      height: Math.max(76, (Math.max(inPorts.length, outPorts.length) + 1) * 22),
      ports: [...inPorts, ...outPorts],
      components: sheet.components,
      wires: sheet.wires,
      createdAt: Date.now(),
    };

    saveCustomSubcircuit(subDef);

    const posX = Math.max(80, Math.round((-panOffset.x + 360) / 20) * 20);
    const posY = Math.max(80, Math.round((-panOffset.y + 200) / 20) * 20);
    const instance = createSubcircuitInstance(subDef, posX, posY, sheet.name);

    recordHistory();
    setComponents((prev) => [...prev, instance]);
    setSelectedCompIds([instance.id]);
    showToast(`"${sheet.name}" sayfası entegre çip olarak tuvale eklendi!`);
  };

  // Toggle wire between 1-Bit single line and 4-Bit Multi-bit Bus
  const handleToggleWireBus = (wireId: string) => {
    recordHistory();
    setWires((prev) =>
      prev.map((w) => (w.id === wireId ? { ...w, isBus: !w.isBus, bitWidth: w.isBus ? 1 : 4 } : w))
    );
  };


  // Helper: Get strictly welded start point for any wire (unbreakable clamped branch resolver)
  const getWireStartPt = (wire: CircuitWire): { x: number; y: number } => {
    if (wire.branchPoint) {
      // Find parent wire in the same electrical net (same fromPinId)
      const parentWire = wires.find(
        (w) => w.id !== wire.id && w.fromPinId === wire.fromPinId && (!w.branchPoint || w.id === wire.sourceWireId)
      );
      if (parentWire) {
        const fromPin = findPinById(parentWire.fromPinId);
        const toPin = findPinById(parentWire.toPinId);
        if (fromPin && toPin) {
          const p1 = parentWire.branchPoint || { x: fromPin.x, y: fromPin.y };
          const p2 = { x: toPin.x, y: toPin.y };
          const bp = wire.branchPoint;

          // Case 1: Pure horizontal wire (within 5px tolerance)
          if (Math.abs(p1.y - p2.y) <= 5) {
            const minX = Math.min(p1.x, p2.x);
            const maxX = Math.max(p1.x, p2.x);
            return {
              x: Math.max(minX, Math.min(maxX, bp.x)),
              y: p1.y,
            };
          }

          // Case 2: Pure vertical wire (within 5px tolerance)
          if (Math.abs(p1.x - p2.x) <= 5) {
            const minY = Math.min(p1.y, p2.y);
            const maxY = Math.max(p1.y, p2.y);
            return {
              x: p1.x,
              y: Math.max(minY, Math.min(maxY, bp.y)),
            };
          }

          // Case 3: 90° Manhattan wire with vertical elbow
          const defaultMidX = Math.round((p1.x + p2.x) / 2);
          const parentElbowX = parentWire.elbowX !== undefined ? parentWire.elbowX : defaultMidX;
          const minY = Math.min(p1.y, p2.y);
          const maxY = Math.max(p1.y, p2.y);

          // If the branch point is on horizontal segment 1 (from p1 to elbow):
          const seg1MinX = Math.min(p1.x, parentElbowX);
          const seg1MaxX = Math.max(p1.x, parentElbowX);
          if (Math.abs(bp.y - p1.y) <= 5 && bp.x >= seg1MinX - 5 && bp.x <= seg1MaxX + 5) {
            return {
              x: Math.max(seg1MinX, Math.min(seg1MaxX, bp.x)),
              y: p1.y,
            };
          }

          // If the branch point is on horizontal segment 2 (from elbow to p2):
          const seg2MinX = Math.min(parentElbowX, p2.x);
          const seg2MaxX = Math.max(parentElbowX, p2.x);
          if (Math.abs(bp.y - p2.y) <= 5 && bp.x >= seg2MinX - 5 && bp.x <= seg2MaxX + 5) {
            return {
              x: Math.max(seg2MinX, Math.min(seg2MaxX, bp.x)),
              y: p2.y,
            };
          }

          // Clamped along the vertical elbow segment:
          const clampedY = Math.max(minY, Math.min(maxY, bp.y));
          return {
            x: parentElbowX,
            y: clampedY,
          };
        }
      }
      return wire.branchPoint;
    }
    const fromPin = findPinById(wire.fromPinId);
    return fromPin ? { x: fromPin.x, y: fromPin.y } : { x: 0, y: 0 };
  };

  // Helper: Find closest orthogonal projection point on a Manhattan wire path
  const getClosestPointOnOrthogonalWire = (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    click: { x: number; y: number },
    elbowX?: number,
    waypoints?: { x: number; y: number }[]
  ) => {
    interface Seg {
      type: 'H' | 'V';
      x1?: number;
      x2?: number;
      y1?: number;
      y2?: number;
      x?: number;
      y?: number;
    }
    const segs: Seg[] = [];
    if (waypoints && waypoints.length > 0) {
      let prev = p1;
      for (const wp of waypoints) {
        if (Math.abs(prev.x - wp.x) > 1 && Math.abs(prev.y - wp.y) > 1) {
          segs.push({ type: 'H', x1: prev.x, x2: wp.x, y: prev.y });
          segs.push({ type: 'V', x: wp.x, y1: prev.y, y2: wp.y });
        } else if (Math.abs(prev.y - wp.y) <= 1) {
          segs.push({ type: 'H', x1: prev.x, x2: wp.x, y: prev.y });
        } else {
          segs.push({ type: 'V', x: prev.x, y1: prev.y, y2: wp.y });
        }
        prev = wp;
      }
      if (Math.abs(prev.x - p2.x) > 1 && Math.abs(prev.y - p2.y) > 1) {
        const midX = Math.round((prev.x + p2.x) / 2);
        segs.push({ type: 'H', x1: prev.x, x2: midX, y: prev.y });
        segs.push({ type: 'V', x: midX, y1: prev.y, y2: p2.y });
        segs.push({ type: 'H', x1: midX, x2: p2.x, y: p2.y });
      } else if (Math.abs(prev.y - p2.y) <= 1) {
        segs.push({ type: 'H', x1: prev.x, x2: p2.x, y: prev.y });
      } else {
        segs.push({ type: 'V', x: prev.x, y1: prev.y, y2: p2.y });
      }
    } else if (Math.abs(p1.y - p2.y) <= 4) {
      segs.push({ type: 'H', x1: p1.x, x2: p2.x, y: p1.y });
    } else if (Math.abs(p1.x - p2.x) <= 4) {
      segs.push({ type: 'V', x: p1.x, y1: p1.y, y2: p2.y });
    } else {
      const midX = elbowX !== undefined ? elbowX : Math.round((p1.x + p2.x) / 2);
      segs.push({ type: 'H', x1: p1.x, x2: midX, y: p1.y });
      segs.push({ type: 'V', x: midX, y1: p1.y, y2: p2.y });
      segs.push({ type: 'H', x1: midX, x2: p2.x, y: p2.y });
    }

    let bestPt = { x: p1.x, y: p1.y };
    let bestDistSq = Infinity;
    let bestSegType: 'H' | 'V' = 'H';
    for (const s of segs) {
      let px: number;
      let py: number;
      if (s.type === 'H') {
        const minX = Math.min(s.x1!, s.x2!);
        const maxX = Math.max(s.x1!, s.x2!);
        px = Math.max(minX, Math.min(maxX, click.x));
        py = s.y!;
      } else {
        const minY = Math.min(s.y1!, s.y2!);
        const maxY = Math.max(s.y1!, s.y2!);
        px = s.x!;
        py = Math.max(minY, Math.min(maxY, click.y));
      }
      const dSq = (px - click.x) ** 2 + (py - click.y) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestPt = { x: px, y: py };
        bestSegType = s.type;
      }
    }
    // Snap only along the free axis; keep the wire axis strictly fixed so tap never jogs off the wire!
    return {
      x: bestSegType === 'H' ? (snapToGrid ? Math.round(bestPt.x / 10) * 10 : Math.round(bestPt.x)) : bestPt.x,
      y: bestSegType === 'V' ? (snapToGrid ? Math.round(bestPt.y / 10) * 10 : Math.round(bestPt.y)) : bestPt.y,
    };
  };

  // Finish a wire ending at a free canvas point (Logisim-style open wire stubs)
  const finishWireAtPoint = (point: { x: number; y: number }) => {
    if (!wiringFrom) return;
    recordHistory();
    const snappedPt = {
      x: snapToGrid ? Math.round(point.x / 10) * 10 : Math.round(point.x),
      y: snapToGrid ? Math.round(point.y / 10) * 10 : Math.round(point.y),
    };

    const dist = Math.hypot(snappedPt.x - wiringFrom.x, snappedPt.y - wiringFrom.y);
    if (dist < 8 && (!wiringFrom.waypoints || wiringFrom.waypoints.length === 0)) {
      setWiringFrom(null);
      return;
    }

    let finalWaypoints = wiringFrom.waypoints ? [...wiringFrom.waypoints] : undefined;
    if (finalWaypoints && finalWaypoints.length > 0) {
      const lastPt = finalWaypoints[finalWaypoints.length - 1];
      if (lastPt.x !== snappedPt.x || lastPt.y !== snappedPt.y) {
        const midX = Math.round((lastPt.x + snappedPt.x) / 2);
        finalWaypoints.push({ x: midX, y: lastPt.y });
        finalWaypoints.push({ x: midX, y: snappedPt.y });
      }
    }

    const freeWire: CircuitWire = {
      id: `wire_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      fromCompId: wiringFrom.compId,
      fromPinId: wiringFrom.pinId,
      toCompId: '',
      toPinId: `node_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      value: 0,
      startPoint: { x: wiringFrom.x, y: wiringFrom.y },
      branchPoint: wiringFrom.branchPoint,
      sourceWireId: wiringFrom.sourceWireId,
      waypoints: finalWaypoints,
      endPoint: snappedPt,
      isBus: defaultWireIsBus,
      bitWidth: defaultWireIsBus ? 4 : 1,
    };

    setWires((prev) => {
      const updated = [...prev, freeWire];
      const sim = simulateCircuit(components, updated);
      setComponents(sim.components);
      return sim.wires;
    });

    lastWireConnectedTimeRef.current = Date.now();
    setWiringFrom(null);
  };

  // Connect active wiring to a component pin (Unrestricted Logisim wiring)
  const connectToPin = (comp: CircuitComponentInstance, pin: CircuitPin) => {
    if (!wiringFrom) return;
    if (wiringFrom.pinId === pin.id) {
      return;
    }

    // Determine from/to: if one is output and one is input, make output 'from' and input 'to'
    let fromCompId = wiringFrom.compId;
    let fromPinId = wiringFrom.pinId;
    let toCompId = comp.id;
    let toPinId = pin.id;

    if (wiringFrom.pinType === 'input' && pin.type === 'output') {
      fromCompId = comp.id;
      fromPinId = pin.id;
      toCompId = wiringFrom.compId;
      toPinId = wiringFrom.pinId;
    }

    recordHistory();

    let finalWaypoints = wiringFrom.waypoints ? [...wiringFrom.waypoints] : undefined;
    if (finalWaypoints && finalWaypoints.length > 0) {
      const lastPt = finalWaypoints[finalWaypoints.length - 1];
      if (lastPt.x !== pin.x || lastPt.y !== pin.y) {
        const midX = Math.round((lastPt.x + pin.x) / 2);
        finalWaypoints.push({ x: midX, y: lastPt.y });
        finalWaypoints.push({ x: midX, y: pin.y });
      }
    }

    const newWire: CircuitWire = {
      id: `wire_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      fromCompId,
      fromPinId,
      toCompId,
      toPinId,
      value: 0,
      branchPoint: wiringFrom.branchPoint,
      sourceWireId: wiringFrom.sourceWireId,
      waypoints: finalWaypoints,
      isBus: defaultWireIsBus,
      bitWidth: defaultWireIsBus ? 4 : 1,
    };

    setWires((prev) => {
      const isDuplicate = prev.some(
        (w) =>
          (w.fromPinId === fromPinId && w.toPinId === toPinId) ||
          (w.fromPinId === toPinId && w.toPinId === fromPinId)
      );
      if (isDuplicate) return prev;
      const updatedWires = [...prev, newWire];
      const sim = simulateCircuit(components, updatedWires);
      setComponents(sim.components);
      return sim.wires;
    });

    lastWireConnectedTimeRef.current = Date.now();
    setWiringFrom(null);
  };

  // Helper to branch active wire onto an existing wire
  const connectBranchToWire = (targetWire: CircuitWire, tap: { x: number; y: number }) => {
    if (!wiringFrom) return;
    recordHistory();

    let finalWaypoints = wiringFrom.waypoints ? [...wiringFrom.waypoints] : undefined;
    if (finalWaypoints && finalWaypoints.length > 0) {
      const lastPt = finalWaypoints[finalWaypoints.length - 1];
      if (lastPt.x !== tap.x || lastPt.y !== tap.y) {
        const midX = Math.round((lastPt.x + tap.x) / 2);
        finalWaypoints.push({ x: midX, y: lastPt.y });
        finalWaypoints.push({ x: midX, y: tap.y });
      }
    }

    const newBranchWire: CircuitWire = {
      id: `wire_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      fromCompId: targetWire.fromCompId,
      fromPinId: targetWire.fromPinId,
      toCompId: wiringFrom.compId,
      toPinId: wiringFrom.pinId,
      value: targetWire.value,
      branchPoint: tap,
      sourceWireId: targetWire.id,
      waypoints: finalWaypoints,
      isBus: targetWire.isBus || defaultWireIsBus,
      bitWidth: targetWire.isBus ? 4 : 1,
    };

    setWires((prev) => {
      const isDuplicate = prev.some(
        (w) =>
          w.sourceWireId === targetWire.id &&
          w.toPinId === wiringFrom.pinId &&
          w.branchPoint?.x === tap.x &&
          w.branchPoint?.y === tap.y
      );
      if (isDuplicate) return prev;
      const updated = [...prev, newBranchWire];
      const sim = simulateCircuit(components, updated);
      setComponents(sim.components);
      return sim.wires;
    });

    lastWireConnectedTimeRef.current = Date.now();
    setWiringFrom(null);
  };

  // Click on pin: start or finish connection
  const handlePinClick = (
    e: React.MouseEvent,
    comp: CircuitComponentInstance,
    pin: CircuitPin
  ) => {
    e.stopPropagation();

    // Prevent immediate re-trigger right after a wire connection finishes
    if (Date.now() - lastWireConnectedTimeRef.current < 400) {
      return;
    }

    // If not currently wiring, start from this pin
    if (!wiringFrom) {
      wiringStartTimeRef.current = Date.now();
      setWiringFrom({
        compId: comp.id,
        pinId: pin.id,
        pinType: pin.type,
        x: pin.x,
        y: pin.y,
      });
      setSelectedCompIds([]);
      setSelectedWireIds([]);
      return;
    }

    // If clicking on the exact same pin where wiring started, do nothing
    if (wiringFrom.pinId === pin.id) {
      return;
    }

    connectToPin(comp, pin);
  };

  // Mouse up on pin: allows drag-and-drop wiring directly onto a pin
  const handlePinMouseUp = (
    e: React.MouseEvent,
    comp: CircuitComponentInstance,
    pin: CircuitPin
  ) => {
    e.stopPropagation();
    if (Date.now() - lastWireConnectedTimeRef.current < 400) {
      return;
    }
    if (wiringFrom && wiringFrom.pinId !== pin.id) {
      connectToPin(comp, pin);
    }
  };

  // Add component from catalog to canvas
  const handleAddComponent = (type: ComponentType) => {
    // Determine free spot near center or right
    const posX = 160 + (components.length % 5) * 40;
    const posY = 120 + (components.length % 4) * 50;

    recordHistory();

    const newComp = updatePinPositions(createComponentInstance(type, posX, posY));
    setComponents((prev) => {
      const updated = [...prev, newComp];
      const sim = simulateCircuit(updated, wires);
      setWires(sim.wires);
      return sim.components;
    });
    setSelectedCompId(newComp.id);
    setSelectedWireId(null);
  };

  // Delete selected components or wires
  const handleDeleteSelected = useCallback(() => {
    if (selectedCompIds.length > 0 || selectedWireIds.length > 0) {
      recordHistory();
      const compIdsToDelete = new Set(selectedCompIds);
      const wireIdsToDelete = new Set(selectedWireIds);

      // Remaining components
      const remainingComps = components.filter((c) => !compIdsToDelete.has(c.id));

      // Remaining wires (remove wires connected to deleted components OR explicitly selected wires)
      const remainingWires = wires.filter(
        (w) => !wireIdsToDelete.has(w.id) && !compIdsToDelete.has(w.fromCompId) && !compIdsToDelete.has(w.toCompId)
      );

      const sim = simulateCircuit(remainingComps, remainingWires);
      setComponents(sim.components);
      setWires(sim.wires);
      setSelectedCompIds([]);
      setSelectedWireIds([]);
    }
  }, [selectedCompIds, selectedWireIds, recordHistory, components, wires]);

  // Rotate selected components 90 degrees clockwise
  const handleRotateSelected = useCallback(() => {
    if (selectedCompIds.length === 0) return;
    recordHistory();
    setComponents((prev) =>
      prev.map((c) => {
        if (selectedCompIds.includes(c.id)) {
          const nextRot = (((c.rotation || 0) + 90) % 360) as 0 | 90 | 180 | 270;
          return updatePinPositions({ ...c, rotation: nextRot });
        }
        return c;
      })
    );
  }, [selectedCompIds, recordHistory]);

  // Duplicate selected components and any interconnecting wires
  const handleDuplicateSelected = useCallback(() => {
    if (selectedCompIds.length === 0) return;
    recordHistory();

    const idMap = new Map<string, string>();
    const newComps: CircuitComponentInstance[] = [];

    // Duplicate components with offset
    components.forEach((c) => {
      if (selectedCompIds.includes(c.id)) {
        const cloned = createComponentInstance(
          c.type,
          c.x + 40,
          c.y + 40,
          c.label ? `${c.label} (Kopya)` : undefined
        );
        cloned.rotation = c.rotation;
        cloned.state = { ...c.state };
        idMap.set(c.id, cloned.id);
        newComps.push(updatePinPositions(cloned));
      }
    });

    // Duplicate wires interconnecting the duplicated components
    const newWires: CircuitWire[] = [];
    wires.forEach((w) => {
      const newFromCompId = idMap.get(w.fromCompId);
      const newToCompId = idMap.get(w.toCompId);
      if (newFromCompId && newToCompId) {
        const origFromComp = components.find((c) => c.id === w.fromCompId);
        const origToComp = components.find((c) => c.id === w.toCompId);
        const fromPinIdx = origFromComp?.outputs.findIndex((p) => p.id === w.fromPinId) ?? -1;
        const toPinIdx = origToComp?.inputs.findIndex((p) => p.id === w.toPinId) ?? -1;

        const duplicatedFromComp = newComps.find((c) => c.id === newFromCompId);
        const duplicatedToComp = newComps.find((c) => c.id === newToCompId);

        if (
          duplicatedFromComp &&
          duplicatedToComp &&
          fromPinIdx >= 0 &&
          toPinIdx >= 0 &&
          duplicatedFromComp.outputs[fromPinIdx] &&
          duplicatedToComp.inputs[toPinIdx]
        ) {
          newWires.push({
            id: `wire_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            fromCompId: newFromCompId,
            fromPinId: duplicatedFromComp.outputs[fromPinIdx].id,
            toCompId: newToCompId,
            toPinId: duplicatedToComp.inputs[toPinIdx].id,
            value: 0,
          });
        }
      }
    });

    const updatedComps = [...components, ...newComps];
    const updatedWires = [...wires, ...newWires];
    const sim = simulateCircuit(updatedComps, updatedWires);
    setComponents(sim.components);
    setWires(sim.wires);
    setSelectedCompIds(newComps.map((c) => c.id));
    setSelectedWireIds(newWires.map((w) => w.id));
  }, [selectedCompIds, components, wires, recordHistory]);

  // Open Rename Modal
  const handleOpenRename = useCallback(() => {
    if (!selectedCompId) return;
    const comp = components.find((c) => c.id === selectedCompId);
    if (!comp) return;
    setRenameModalCompId(selectedCompId);
    setRenameInputVal(comp.label || '');
    setRenameLabelPos(comp.state.labelPos || 'bottom');
  }, [selectedCompId, components]);

  // Double-click component handler: drill down to subcircuit sheet or open rename modal
  const handleComponentDoubleClick = useCallback(
    (e: React.MouseEvent, comp: CircuitComponentInstance) => {
      e.stopPropagation();
      if (comp.type === 'subcircuit') {
        const targetSheet = sheets.find(
          (s) =>
            s.id === comp.state.subcircuitId ||
            s.name.toLowerCase() === (comp.label || '').toLowerCase() ||
            s.name.toLowerCase() === (comp.state.subcircuitName || '').toLowerCase()
        );
        if (targetSheet) {
          handleSwitchSheet(targetSheet.id);
          showToast(`"${targetSheet.name}" alt devre şemasına geçildi.`);
          return;
        }

        // If sheet doesn't exist yet in project tabs, load internal circuit from library!
        const subDef = comp.state.subcircuitId ? getSubcircuitDefinition(comp.state.subcircuitId) : null;
        if (subDef) {
          const newSheet: CircuitSheet = {
            id: subDef.id,
            name: subDef.name,
            components: subDef.components.map(updatePinPositions),
            wires: subDef.wires,
          };
          setSheets((prev) => [...prev, newSheet]);
          handleSwitchSheet(newSheet.id);
          showToast(`"${subDef.name}" (${subDef.chipCode || 'IC'}) içine girildi.`);
          return;
        }
      }
      // Interactive canvas controls should NOT open the rename modal on rapid double-click
      if (['pushbutton', 'switch', 'dipSwitch4', 'clock', 'asciiKeyboard'].includes(comp.type)) {
        return;
      }
      setRenameModalCompId(comp.id);
      setRenameInputVal(comp.label || '');
      setRenameLabelPos(comp.state.labelPos || 'bottom');
    },
    [sheets, handleSwitchSheet, showToast]
  );

  // Save Renamed Label & Position
  const handleSaveRename = () => {
    if (!renameModalCompId) return;
    recordHistory();
    setComponents((prev) =>
      prev.map((c) =>
        c.id === renameModalCompId
          ? {
              ...c,
              label: renameInputVal.trim(),
              state: { ...c.state, labelPos: renameLabelPos },
            }
          : c
      )
    );
    setRenameModalCompId(null);
  };

  // Live K-Map minimal SOP calculation for the Truth Table synthesis tab
  const liveSolvedKMap = useMemo(() => {
    try {
      return solveKMap(synthTruthValues, synthVarsCount);
    } catch {
      return null;
    }
  }, [synthTruthValues, synthVarsCount]);

  // Run Boolean Logic Synthesizer: parses user expression / truth table and generates layout on canvas
  const handleRunSynthesizer = () => {
    try {
      setSynthError(null);
      let exprToBuild = synthExprInput;
      if (synthMode === 'truthTable') {
        const solved = liveSolvedKMap?.simplifiedSOP;
        if (!solved || solved === '0' || solved === '1') {
          if (solved === '0') throw new Error('Fonksiyon tüm giriş kombinasyonları için 0 (Daima Lojik 0).');
          if (solved === '1') throw new Error('Fonksiyon tüm giriş kombinasyonları için 1 (Daima Lojik 1).');
          throw new Error('Doğruluk tablosunda en az bir 1 bulunmalıdır.');
        }
        exprToBuild = solved;
      }

      const maxX = components.length > 0 ? Math.max(...components.map((c) => c.x)) : 60;
      const startX = synthPlacement === 'append' ? maxX + 180 : 80;
      const startY = 80;

      const result = synthesizeCircuitFromBooleanExpression(exprToBuild, {
        gateType: synthGateType,
        offsetX: startX,
        offsetY: startY,
        outputLabel: 'Çıkış F',
      });

      recordHistory();
      if (synthPlacement === 'append') {
        setComponents((prev) => [...prev, ...result.components]);
        setWires((prev) => [...prev, ...result.wires]);
      } else {
        setComponents(result.components);
        setWires(result.wires);
        setPanOffset({ x: 0, y: 0 });
        setZoom(1);
      }
      setSelectedCompIds([]);
      setSelectedWireIds([]);
      setWiringFrom(null);
      setShowSynthesizer(false);
      showToast('Devre başarıyla sentezlendi ve tuvale eklendi!');
    } catch (err: unknown) {
      setSynthError(err instanceof Error ? err.message : 'İfade ayrıştırılamadı');
    }
  };

  // Add custom subcircuit from library to canvas
  const handleAddSubcircuit = (subDef: CustomSubcircuit) => {
    const posX = 160 + (components.length % 5) * 40;
    const posY = 120 + (components.length % 4) * 50;
    recordHistory();
    const newComp = updatePinPositions(createSubcircuitInstance(subDef, posX, posY));
    setComponents((prev) => {
      const updated = [...prev, newComp];
      const sim = simulateCircuit(updated, wires);
      setWires(sim.wires);
      return sim.components;
    });
    setSelectedCompId(newComp.id);
    setSelectedWireId(null);
    showToast(`"${subDef.name}" (${subDef.chipCode || 'IC'}) tuvale eklendi.`);
  };

  // Delete custom subcircuit from library
  const handleDeleteSubcircuit = (subId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteCustomSubcircuit(subId);
    setCustomSubcircuits(getAllSubcircuits());
    showToast('Özel entegre kütüphaneden silindi.');
  };

  // Save selection / canvas as Custom Subcircuit into component library
  const handleSaveSubcircuitToLibrary = () => {
    const targetComps = selectedCompIds.length > 0
      ? components.filter((c) => selectedCompIds.includes(c.id))
      : components;

    if (targetComps.length === 0) return;

    const newSub = packageSelectionIntoSubcircuit(
      subcircuitName,
      subcircuitName,
      subcircuitDesc,
      targetComps,
      wires
    );

    setCustomSubcircuits(getAllSubcircuits());
    setActiveCategory('custom');
    setShowSubcircuitModal(false);
    showToast(`"${newSub.name}" (${newSub.chipCode}) kütüphaneye eklendi!`);
  };

  // Change input count for multi-input gates (2 to 5 inputs)
  const handleChangeGateInputs = useCallback(
    (compId: string, targetCountOrDelta: number, isAbsolute = false) => {
      const comp = components.find((c) => c.id === compId);
      if (!comp) return;
      const currentCount = comp.inputs.length;
      const newCount = isAbsolute
        ? Math.max(2, Math.min(5, targetCountOrDelta))
        : Math.max(2, Math.min(5, currentCount + targetCountOrDelta));
      if (newCount === currentCount) return;

      recordHistory();
      const meta = COMPONENT_CATALOG[comp.type];

      // Build new inputs array
      const newInputs: CircuitPin[] = Array.from({ length: newCount }).map((_, idx) => {
        const pinId = `${comp.id}_in_${idx}`;
        const existing = comp.inputs.find((p) => p.id === pinId);
        const spacing = meta.height / (newCount + 1);
        const relY = Math.round(spacing * (idx + 1));
        return {
          id: pinId,
          name: String.fromCharCode(65 + idx),
          type: 'input' as const,
          value: existing ? existing.value : 0,
          x: comp.x,
          y: comp.y + relY,
        };
      });

      // Remove wires connected to pins that are now gone
      const validPinIds = new Set(newInputs.map((p) => p.id));
      const validWires = wires.filter((w) => {
        if (w.toCompId === compId && !validPinIds.has(w.toPinId)) {
          return false;
        }
        return true;
      });

      const updatedComp = updatePinPositions({
        ...comp,
        inputs: newInputs,
        state: {
          ...comp.state,
          gateInputsCount: newCount,
        },
      });

      setComponents((prev) => {
        const nextComps = prev.map((c) => (c.id === compId ? updatedComp : c));
        const sim = simulateCircuit(nextComps, validWires);
        setWires(sim.wires);
        return sim.components;
      });
    },
    [components, wires, recordHistory]
  );

  // Observable channels for Digital Timing Diagram (Scope)
  const observableChannels = useMemo(() => {
    const list: { key: string; name: string; color: string; type: string }[] = [];
    const colors = [
      '#06b6d4', // cyan
      '#10b981', // emerald
      '#3b82f6', // blue
      '#8b5cf6', // purple
      '#f59e0b', // amber
      '#ec4899', // pink
      '#14b8a6', // teal
      '#f43f5e', // rose
    ];
    let cIdx = 0;

    components.forEach((c) => {
      const name = c.label || c.type;
      if (c.type === 'clock') {
        list.push({ key: c.id, name: `${name} (CLK)`, color: colors[cIdx++ % colors.length], type: 'clock' });
      } else if (c.type === 'switch' || c.type === 'pushbutton') {
        list.push({ key: c.id, name: `${name} (${c.type === 'switch' ? 'SW' : 'BTN'})`, color: colors[cIdx++ % colors.length], type: c.type });
      } else if (c.type === 'led' || c.type === 'probe' || c.type === 'buzzer') {
        list.push({ key: c.id, name: `${name} (OUT)`, color: colors[cIdx++ % colors.length], type: 'output' });
      } else if (c.type === 'dFlipFlop' || c.type === 'jkFlipFlop' || c.type === 'srLatch' || c.type === 'tFlipFlop') {
        list.push({ key: `${c.id}_q`, name: `${name} Q`, color: colors[cIdx++ % colors.length], type: 'state' });
      } else if (c.type === 'counter4' || c.type === 'register4') {
        list.push({ key: `${c.id}_q0`, name: `${name} Q0`, color: colors[cIdx++ % colors.length], type: 'state' });
        list.push({ key: `${c.id}_q1`, name: `${name} Q1`, color: colors[cIdx++ % colors.length], type: 'state' });
        list.push({ key: `${c.id}_q2`, name: `${name} Q2`, color: colors[cIdx++ % colors.length], type: 'state' });
        list.push({ key: `${c.id}_q3`, name: `${name} Q3`, color: colors[cIdx++ % colors.length], type: 'state' });
      } else if (c.type === 'alu4') {
        list.push({ key: `${c.id}_f0`, name: `${name} F0`, color: colors[cIdx++ % colors.length], type: 'state' });
        list.push({ key: `${c.id}_f1`, name: `${name} F1`, color: colors[cIdx++ % colors.length], type: 'state' });
        list.push({ key: `${c.id}_f2`, name: `${name} F2`, color: colors[cIdx++ % colors.length], type: 'state' });
        list.push({ key: `${c.id}_f3`, name: `${name} F3`, color: colors[cIdx++ % colors.length], type: 'state' });
        list.push({ key: `${c.id}_z`, name: `${name} Z`, color: colors[cIdx++ % colors.length], type: 'state' });
      } else if (c.type === 'dipSwitch4') {
        list.push({ key: `${c.id}_q0`, name: `${name} Q0`, color: colors[cIdx++ % colors.length], type: 'input' });
        list.push({ key: `${c.id}_q1`, name: `${name} Q1`, color: colors[cIdx++ % colors.length], type: 'input' });
        list.push({ key: `${c.id}_q2`, name: `${name} Q2`, color: colors[cIdx++ % colors.length], type: 'input' });
        list.push({ key: `${c.id}_q3`, name: `${name} Q3`, color: colors[cIdx++ % colors.length], type: 'input' });
      } else if (c.type === 'ledBar4') {
        list.push({ key: `${c.id}_d0`, name: `${name} D0`, color: colors[cIdx++ % colors.length], type: 'output' });
        list.push({ key: `${c.id}_d1`, name: `${name} D1`, color: colors[cIdx++ % colors.length], type: 'output' });
        list.push({ key: `${c.id}_d2`, name: `${name} D2`, color: colors[cIdx++ % colors.length], type: 'output' });
        list.push({ key: `${c.id}_d3`, name: `${name} D3`, color: colors[cIdx++ % colors.length], type: 'output' });
      } else if (['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'].includes(c.type)) {
        list.push({ key: c.id, name: `${name} (KAPI)`, color: colors[cIdx++ % colors.length], type: 'gate' });
      } else if (c.type === 'asciiKeyboard') {
        list.push({ key: `${c.id}_st`, name: `${name} (ST Strobe)`, color: '#22c55e', type: 'input' });
        list.push({ key: `${c.id}_d0`, name: `${name} (D0 LSB)`, color: colors[cIdx++ % colors.length], type: 'input' });
      } else if (c.type === 'rgbMatrix16x16') {
        list.push({ key: `${c.id}_we`, name: `${name} (WE)`, color: '#eab308', type: 'output' });
      }
    });

    return list;
  }, [components]);

  // Record timing waveform samples continuously as circuit simulation runs
  useEffect(() => {
    if (!showWaveform || isWaveformPaused || !isRunning || observableChannels.length === 0) return;

    const sampleRateMs = Math.max(100, Math.min(400, Math.floor(1000 / (clockHz * 2))));

    const takeSample = () => {
      const values: Record<string, number> = {};
      components.forEach((c) => {
        if (c.type === 'clock' || c.type === 'switch' || c.type === 'pushbutton') {
          values[c.id] = c.state.on ? 1 : 0;
        } else if (c.type === 'led' || c.type === 'probe' || c.type === 'buzzer') {
          values[c.id] = c.inputs[0]?.value === 1 ? 1 : 0;
        } else if (['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'].includes(c.type)) {
          values[c.id] = c.outputs[0]?.value === 1 ? 1 : 0;
        } else if (c.type === 'dFlipFlop' || c.type === 'jkFlipFlop' || c.type === 'srLatch' || c.type === 'tFlipFlop') {
          values[`${c.id}_q`] = c.outputs[0]?.value === 1 ? 1 : 0;
        } else if (c.type === 'counter4' || c.type === 'register4') {
          values[`${c.id}_q0`] = c.outputs[0]?.value === 1 ? 1 : 0;
          values[`${c.id}_q1`] = c.outputs[1]?.value === 1 ? 1 : 0;
          values[`${c.id}_q2`] = c.outputs[2]?.value === 1 ? 1 : 0;
          values[`${c.id}_q3`] = c.outputs[3]?.value === 1 ? 1 : 0;
        } else if (c.type === 'alu4') {
          values[`${c.id}_f0`] = c.outputs[0]?.value === 1 ? 1 : 0;
          values[`${c.id}_f1`] = c.outputs[1]?.value === 1 ? 1 : 0;
          values[`${c.id}_f2`] = c.outputs[2]?.value === 1 ? 1 : 0;
          values[`${c.id}_f3`] = c.outputs[3]?.value === 1 ? 1 : 0;
          values[`${c.id}_z`] = c.outputs[5]?.value === 1 ? 1 : 0;
        } else if (c.type === 'dipSwitch4') {
          const switches = c.state.dipSwitches || [false, false, false, false];
          values[`${c.id}_q0`] = switches[0] ? 1 : 0;
          values[`${c.id}_q1`] = switches[1] ? 1 : 0;
          values[`${c.id}_q2`] = switches[2] ? 1 : 0;
          values[`${c.id}_q3`] = switches[3] ? 1 : 0;
        } else if (c.type === 'ledBar4') {
          values[`${c.id}_d0`] = c.inputs[0]?.value === 1 ? 1 : 0;
          values[`${c.id}_d1`] = c.inputs[1]?.value === 1 ? 1 : 0;
          values[`${c.id}_d2`] = c.inputs[2]?.value === 1 ? 1 : 0;
          values[`${c.id}_d3`] = c.inputs[3]?.value === 1 ? 1 : 0;
        } else if (c.type === 'asciiKeyboard') {
          values[`${c.id}_st`] = c.outputs[7]?.value === 1 ? 1 : 0;
          values[`${c.id}_d0`] = c.outputs[0]?.value === 1 ? 1 : 0;
        } else if (c.type === 'rgbMatrix16x16') {
          values[`${c.id}_we`] = c.inputs[11]?.value === 1 ? 1 : 0;
        }
      });

      sampleTimeRef.current += 1;
      const curT = sampleTimeRef.current;

      setWaveformSamples((prev) => {
        const next = [...prev, { time: curT, values }];
        return next.length > 48 ? next.slice(next.length - 48) : next;
      });
    };

    // Immediate sample
    takeSample();

    const timer = setInterval(takeSample, sampleRateMs);
    return () => clearInterval(timer);
  }, [showWaveform, isWaveformPaused, isRunning, clockHz, components, observableChannels]);

  // Global Keyboard shortcuts: Delete, Backspace, Ctrl+Z, Ctrl+Y, Escape, Ctrl+D, R
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      // ASCII Keyboard direct typing when selected
      if (!e.ctrlKey && !e.metaKey && selectedCompIds.length === 1) {
        const selComp = components.find((c) => c.id === selectedCompIds[0]);
        if (selComp && selComp.type === 'asciiKeyboard') {
          if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === ' ') {
            e.preventDefault();
            const char = e.key === 'Enter' ? '\n' : e.key === 'Backspace' ? '\b' : e.key;
            const code = char.charCodeAt(0);
            recordHistory();
            setComponents((prev) => {
              const updated = prev.map((c) => {
                if (c.id === selComp.id) {
                  return {
                    ...c,
                    state: {
                      ...c.state,
                      asciiChar: char === '\n' ? '↵' : char === '\b' ? '⌫' : char === ' ' ? '␣' : char,
                      asciiCode: code,
                      strobe: true,
                    },
                  };
                }
                return c;
              });
              const sim = simulateCircuit(updated, wires);
              setWires(sim.wires);
              return sim.components;
            });
            return;
          }
        }
      }

      // Ctrl + Z (Undo)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl + Y or Ctrl + Shift + Z (Redo)
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl + D (Duplicate)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        if (selectedCompIds.length > 0) {
          e.preventDefault();
          handleDuplicateSelected();
          return;
        }
      }

      // R key (Rotate 90 degrees)
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (selectedCompIds.length > 0) {
          e.preventDefault();
          handleRotateSelected();
          return;
        }
      }

      // Ctrl + K or '/' (Spotlight / Command Palette Quick Drop)
      if (((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) || e.key === '/') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        setPaletteQuery('');
        return;
      }

      // Space key (Pan mode)
      if (e.code === 'Space' && !isSpacePressedRef.current) {
        isSpacePressedRef.current = true;
      }

      // Delete or Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnotationId) {
          e.preventDefault();
          handleDeleteAnnotation(selectedAnnotationId);
          return;
        }
        if (selectedCompIds.length > 0 || selectedWireIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }

      // Escape
      if (e.key === 'Escape') {
        if (wiringFrom) {
          setWiringFrom(null);
        }
        setSelectedCompIds([]);
        setSelectedWireIds([]);
        setSelectedAnnotationId(null);
        setShowCommandPalette(false);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsPanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    selectedCompIds,
    selectedWireIds,
    selectedAnnotationId,
    wiringFrom,
    handleUndo,
    handleRedo,
    handleDeleteSelected,
    handleDuplicateSelected,
    handleRotateSelected,
  ]);

  // Global release for tactile pushbuttons (guarantees buttons never get stuck when mouse leaves window, drags, or opens modal)
  useEffect(() => {
    const handleGlobalRelease = () => {
      draggingWireJointRef.current = null;
      setDraggingWireJoint(null);
      setComponents((prev) => {
        let hasActivePushbutton = false;
        const updated = prev.map((c) => {
          if (c.type === 'pushbutton' && c.state.on) {
            hasActivePushbutton = true;
            return { ...c, state: { ...c.state, on: false } };
          }
          return c;
        });
        if (!hasActivePushbutton) return prev;
        const sim = simulateCircuit(updated, wires);
        setWires(sim.wires);
        return sim.components;
      });
    };

    window.addEventListener('mouseup', handleGlobalRelease);
    window.addEventListener('blur', handleGlobalRelease);
    return () => {
      window.removeEventListener('mouseup', handleGlobalRelease);
      window.removeEventListener('blur', handleGlobalRelease);
    };
  }, [wires]);

  // Load Preset
  const handleLoadPreset = (presetId: string) => {
    const preset = CIRCUIT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    recordHistory();
    setSelectedPresetId(presetId);
    setWiringFrom(null);
    setSelectedCompId(null);
    setSelectedWireId(null);
    setSelectedCompIds([]);
    setSelectedWireIds([]);

    const refreshedComps = preset.components.map(updatePinPositions);
    const sim = simulateCircuit(refreshedComps, preset.wires);
    setComponents(sim.components);
    setWires(sim.wires);

    // If preset is music or graphics, set appropriate clock tempo & auto-run
    const clkComp = preset.components.find((c) => c.type === 'clock');
    if (preset.category === 'music_graphics' || presetId.includes('chiptune')) {
      const targetHz = clkComp?.state?.frequencyHz || 4;
      setClockHz(targetHz);
      setIsRunning(true);
      showToast(`Müzik Kiti Yüklendi! Tempo: ${targetHz} Hz (Çalıyor 🎵)`);
    }
  };

  // Clear Canvas
  const handleClearCanvas = () => {
    recordHistory();
    setComponents([]);
    setWires([]);
    setAnnotations([]);
    setSelectedAnnotationId(null);
    setWiringFrom(null);
    setSelectedCompIds([]);
    setSelectedWireIds([]);
    try {
      localStorage.removeItem('logic_circuit_autosave');
    } catch {}
  };

  // Render Realistic Electronic & ANSI Gate SVG Symbols
  const renderGateBody = (comp: CircuitComponentInstance) => {
    const isSelected = selectedCompIds.includes(comp.id);
    const strokeColor = isSelected
      ? (cadTheme === 'dark' ? '#38bdf8' : '#2563eb')
      : (cadTheme === 'dark' ? '#64748b' : '#334155');
    const strokeWidth = isSelected ? 2.5 : 1.8;
    const fillColor = isSelected
      ? (cadTheme === 'dark' ? '#1e3a8a' : '#eff6ff')
      : 'url(#gateGrad)';
    const gateTextClass = cadTheme === 'dark' ? 'fill-slate-100' : 'fill-slate-800';

    switch (comp.type) {
      case 'switch': {
        const isOn = !!comp.state.on;
        return (
          <g onClick={(e) => handleToggleSwitch(e, comp.id)} className="cursor-pointer group" filter="url(#gateShadow)">
            {/* Brushed Aluminum Faceplate */}
            <rect
              x={0}
              y={0}
              width={66}
              height={56}
              rx={8}
              fill="url(#metalPlate)"
              stroke="#94a3b8"
              strokeWidth={1.5}
            />
            {/* 4 Corner Screws */}
            <circle cx={5.5} cy={5.5} r={1.5} fill="#64748b" />
            <circle cx={60.5} cy={5.5} r={1.5} fill="#64748b" />
            <circle cx={5.5} cy={50.5} r={1.5} fill="#64748b" />
            <circle cx={60.5} cy={50.5} r={1.5} fill="#64748b" />

            {/* Recessed Bezel Plate */}
            <rect
              x={14}
              y={6}
              width={38}
              height={28}
              rx={5}
              fill="#1e293b"
              stroke="#0f172a"
              strokeWidth={1.2}
            />
            <rect
              x={17}
              y={9}
              width={32}
              height={22}
              rx={3}
              fill="#090d16"
            />

            {/* Status Indicator Jewelled LED */}
            <circle
              cx={isOn ? 23 : 43}
              cy={20}
              r={3}
              fill={isOn ? '#22c55e' : '#ef4444'}
              filter={isOn ? 'drop-shadow(0 0 5px #22c55e)' : undefined}
            />

            {/* Realistic Chrome Bat Lever */}
            {isOn ? (
              <g>
                <line x1={33} y1={20} x2={47} y2={12} stroke="url(#metalLever)" strokeWidth={6} strokeLinecap="round" />
                <circle cx={47} cy={12} r={5.5} fill="url(#metalPlate)" stroke="#475569" strokeWidth={1} filter="drop-shadow(0 2px 3px rgba(0,0,0,0.35))" />
                <circle cx={45.5} cy={10.5} r={1.5} fill="#ffffff" opacity={0.8} />
              </g>
            ) : (
              <g>
                <line x1={33} y1={20} x2={19} y2={12} stroke="url(#metalLever)" strokeWidth={6} strokeLinecap="round" />
                <circle cx={19} cy={12} r={5.5} fill="url(#metalPlate)" stroke="#475569" strokeWidth={1} filter="drop-shadow(0 2px 3px rgba(0,0,0,0.35))" />
                <circle cx={17.5} cy={10.5} r={1.5} fill="#ffffff" opacity={0.8} />
              </g>
            )}

            {/* Spacious Dedicated Recessed Status Plaque */}
            <rect
              x={11}
              y={37}
              width={44}
              height={14}
              rx={3}
              fill="#090d16"
              stroke="#1e293b"
              strokeWidth={1}
            />
            <text
              x={33}
              y={48}
              textAnchor="middle"
              className={`text-[9.5px] font-mono font-black tracking-wider select-none ${
                isOn ? 'fill-emerald-400' : 'fill-slate-400'
              }`}
            >
              {isOn ? 'ON · 1' : 'OFF · 0'}
            </text>
          </g>
        );
      }

      case 'pushbutton': {
        const isDown = !!comp.state.on;
        return (
          <g
            onMouseDown={(e) => handlePushbuttonState(e, comp.id, true)}
            onMouseUp={(e) => handlePushbuttonState(e, comp.id, false)}
            onMouseLeave={(e) => handlePushbuttonState(e, comp.id, false)}
            className="cursor-pointer group"
            filter="url(#gateShadow)"
          >
            {/* Metallic Mounting Faceplate */}
            <rect
              x={0}
              y={0}
              width={60}
              height={52}
              rx={10}
              fill="url(#metalPlate)"
              stroke="#94a3b8"
              strokeWidth={1.5}
            />
            {/* Corner Screws */}
            <circle cx={6} cy={6} r={1.3} fill="#64748b" />
            <circle cx={54} cy={6} r={1.3} fill="#64748b" />
            <circle cx={6} cy={46} r={1.3} fill="#64748b" />
            <circle cx={54} cy={46} r={1.3} fill="#64748b" />

            {/* Recessed Bezel Well */}
            <circle cx={30} cy={26} r={18} fill="#0f172a" stroke="#1e293b" strokeWidth={1.5} />

            {/* Tactile Red Cap */}
            <circle
              cx={30}
              cy={isDown ? 27 : 25}
              r={isDown ? 13 : 14}
              fill={isDown ? '#dc2626' : '#ef4444'}
              stroke="#b91c1c"
              strokeWidth={1.5}
              filter={isDown ? 'drop-shadow(0 0 6px #ef4444)' : 'drop-shadow(0 3px 2px rgba(0,0,0,0.4))'}
            />
            {/* Gloss arc */}
            <path
              d="M 23,20 A 10,10 0 0,1 37,20"
              stroke="#fca5a5"
              strokeWidth={2}
              strokeLinecap="round"
              fill="none"
              opacity={isDown ? 0.3 : 0.8}
            />
            <text
              x={30}
              y={isDown ? 30 : 28}
              textAnchor="middle"
              className="text-[7.5px] font-sans font-black fill-white select-none pointer-events-none"
            >
              {isDown ? '1' : 'PUSH'}
            </text>
          </g>
        );
      }

      case 'clock': {
        const isOn = !!comp.state.on;
        return (
          <g onClick={(e) => handleToggleSwitch(e, comp.id)} className="cursor-pointer group" filter="url(#gateShadow)">
            {/* Quartz Crystal Metallic Can Case */}
            <rect
              x={0}
              y={0}
              width={64}
              height={44}
              rx={12}
              fill="url(#crystalBody)"
              stroke="#94a3b8"
              strokeWidth={1.5}
            />
            <rect x={3} y={3} width={58} height={38} rx={10} fill="none" stroke="#cbd5e1" strokeWidth={1} />

            <text x={28} y={17} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-slate-800 select-none">
              1.000 MHz
            </text>

            {/* Clock Square Wave Icon */}
            <path
              d="M 12,30 L 18,30 L 18,22 L 24,22 L 24,30 L 30,30 L 30,22 L 36,22"
              fill="none"
              stroke="#475569"
              strokeWidth={1.8}
            />

            {/* Active Pulse LED */}
            <circle
              cx={50}
              cy={22}
              r={4}
              fill={isOn ? '#3b82f6' : '#cbd5e1'}
              stroke="#64748b"
              strokeWidth={1}
              filter={isOn ? 'drop-shadow(0 0 6px #3b82f6)' : undefined}
            />
          </g>
        );
      }

      case 'vcc': {
        return (
          <g filter="url(#gateShadow)">
            <rect x={0} y={0} width={52} height={38} rx={8} fill="#fef2f2" stroke="#dc2626" strokeWidth={1.8} />
            <circle cx={16} cy={19} r={10} fill="#dc2626" stroke="#991b1b" strokeWidth={1.5} />
            <circle cx={16} cy={19} r={4} fill="#7f1d1d" />
            <circle cx={16} cy={19} r={2} fill="#450a0a" />
            <text x={35} y={23} textAnchor="middle" className="text-xs font-mono font-extrabold fill-red-700 select-none">
              +5V
            </text>
          </g>
        );
      }

      case 'gnd': {
        return (
          <g filter="url(#gateShadow)">
            <rect x={0} y={0} width={52} height={38} rx={8} fill="#f8fafc" stroke="#475569" strokeWidth={1.8} />
            <circle cx={14} cy={19} r={9} fill="#334155" stroke="#1e293b" strokeWidth={1.5} />
            <circle cx={14} cy={19} r={3.5} fill="#0f172a" />
            <line x1={29} y1={14} x2={43} y2={14} stroke="#334155" strokeWidth={2} />
            <line x1={32} y1={19} x2={40} y2={19} stroke="#334155" strokeWidth={2} />
            <line x1={35} y1={24} x2={37} y2={24} stroke="#334155" strokeWidth={2} />
          </g>
        );
      }

      case 'tunnel': {
        const lbl = comp.label || 'Tünel';
        const isHigh = comp.inputs[0]?.value === 1 || comp.outputs[0]?.value === 1;
        return (
          <g filter="url(#gateShadow)">
            <polygon
              points="0,4 48,4 64,16 48,28 0,28"
              fill={isHigh ? '#dcfce7' : '#f8fafc'}
              stroke={isSelected ? '#2563eb' : isHigh ? '#16a34a' : '#64748b'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
            <text
              x={24}
              y={20}
              textAnchor="middle"
              className={`text-[10px] font-mono font-black select-none ${
                isHigh ? 'fill-emerald-800' : 'fill-slate-700'
              }`}
            >
              {lbl}
            </text>
          </g>
        );
      }

      case 'not': {
        return (
          <g filter="url(#gateShadow)">
            <line x1={0} y1={30} x2={12} y2={30} stroke="#64748b" strokeWidth={2} />
            <polygon
              points="12,14 54,30 12,46"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <circle
              cx={60}
              cy={30}
              r={5.5}
              fill="#ffffff"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line x1={65.5} y1={30} x2={70} y2={30} stroke="#64748b" strokeWidth={2} />
            <text x={28} y={33} textAnchor="middle" className={`text-[11px] font-bold ${gateTextClass} select-none`}>
              NOT
            </text>
          </g>
        );
      }

      case 'and': {
        return (
          <g filter="url(#gateShadow)">
            {comp.inputs.map((pin) => {
              const relY = pin.y - comp.y;
              return <line key={pin.id} x1={0} y1={relY} x2={12} y2={relY} stroke="#64748b" strokeWidth={2} />;
            })}
            <path
              d="M 12,10 L 45,10 A 20,20 0 0,1 45,50 L 12,50 Z"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line x1={65} y1={30} x2={80} y2={30} stroke="#64748b" strokeWidth={2} />
            <text x={35} y={34} textAnchor="middle" className="text-xs font-bold fill-slate-800 select-none">
              AND{comp.inputs.length > 2 ? ` (${comp.inputs.length})` : ''}
            </text>
          </g>
        );
      }

      case 'or': {
        return (
          <g filter="url(#gateShadow)">
            {comp.inputs.map((pin) => {
              const relY = pin.y - comp.y;
              return <line key={pin.id} x1={0} y1={relY} x2={14} y2={relY} stroke="#64748b" strokeWidth={2} />;
            })}
            <path
              d="M 12,10 Q 24,30 12,50 Q 48,50 68,30 Q 48,10 12,10 Z"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line x1={68} y1={30} x2={80} y2={30} stroke="#64748b" strokeWidth={2} />
            <text x={36} y={34} textAnchor="middle" className="text-xs font-bold fill-slate-800 select-none">
              OR{comp.inputs.length > 2 ? ` (${comp.inputs.length})` : ''}
            </text>
          </g>
        );
      }

      case 'nand': {
        return (
          <g filter="url(#gateShadow)">
            {comp.inputs.map((pin) => {
              const relY = pin.y - comp.y;
              return <line key={pin.id} x1={0} y1={relY} x2={12} y2={relY} stroke="#64748b" strokeWidth={2} />;
            })}
            <path
              d="M 12,10 L 45,10 A 20,20 0 0,1 45,50 L 12,50 Z"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <circle cx={70} cy={30} r={5} fill="#ffffff" stroke={strokeColor} strokeWidth={strokeWidth} />
            <line x1={75} y1={30} x2={86} y2={30} stroke="#64748b" strokeWidth={2} />
            <text x={35} y={34} textAnchor="middle" className="text-[11px] font-bold fill-slate-800 select-none">
              NAND{comp.inputs.length > 2 ? ` (${comp.inputs.length})` : ''}
            </text>
          </g>
        );
      }

      case 'nor': {
        return (
          <g filter="url(#gateShadow)">
            {comp.inputs.map((pin) => {
              const relY = pin.y - comp.y;
              return <line key={pin.id} x1={0} y1={relY} x2={14} y2={relY} stroke="#64748b" strokeWidth={2} />;
            })}
            <path
              d="M 12,10 Q 24,30 12,50 Q 48,50 68,30 Q 48,10 12,10 Z"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <circle cx={73} cy={30} r={5} fill="#ffffff" stroke={strokeColor} strokeWidth={strokeWidth} />
            <line x1={78} y1={30} x2={86} y2={30} stroke="#64748b" strokeWidth={2} />
            <text x={36} y={34} textAnchor="middle" className="text-[11px] font-bold fill-slate-800 select-none">
              NOR{comp.inputs.length > 2 ? ` (${comp.inputs.length})` : ''}
            </text>
          </g>
        );
      }

      case 'xor': {
        return (
          <g filter="url(#gateShadow)">
            {comp.inputs.map((pin) => {
              const relY = pin.y - comp.y;
              return <line key={pin.id} x1={0} y1={relY} x2={10} y2={relY} stroke="#64748b" strokeWidth={2} />;
            })}
            <path
              d="M 6,10 Q 20,30 6,50"
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <path
              d="M 14,10 Q 28,30 14,50 Q 50,50 72,30 Q 50,10 14,10 Z"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line x1={72} y1={30} x2={84} y2={30} stroke="#64748b" strokeWidth={2} />
            <text x={38} y={34} textAnchor="middle" className="text-xs font-bold fill-slate-800 select-none">
              XOR{comp.inputs.length > 2 ? ` (${comp.inputs.length})` : ''}
            </text>
          </g>
        );
      }

      case 'xnor': {
        return (
          <g filter="url(#gateShadow)">
            {comp.inputs.map((pin) => {
              const relY = pin.y - comp.y;
              return <line key={pin.id} x1={0} y1={relY} x2={10} y2={relY} stroke="#64748b" strokeWidth={2} />;
            })}
            <path d="M 6,10 Q 20,30 6,50" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path
              d="M 14,10 Q 28,30 14,50 Q 50,50 72,30 Q 50,10 14,10 Z"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <circle cx={77} cy={30} r={5} fill="#ffffff" stroke={strokeColor} strokeWidth={strokeWidth} />
            <line x1={82} y1={30} x2={88} y2={30} stroke="#64748b" strokeWidth={2} />
            <text x={38} y={34} textAnchor="middle" className="text-[10px] font-bold fill-slate-800 select-none">
              XNOR{comp.inputs.length > 2 ? ` (${comp.inputs.length})` : ''}
            </text>
          </g>
        );
      }

      case 'triState': {
        const enVal = comp.inputs[1]?.value === 1;
        return (
          <g filter="url(#gateShadow)">
            <line x1={0} y1={30} x2={16} y2={30} stroke="#64748b" strokeWidth={2} />
            <line x1={35} y1={50} x2={35} y2={36} stroke="#64748b" strokeWidth={2} />
            <circle cx={35} cy={50} r={3} fill={enVal ? '#3b82f6' : '#64748b'} />
            <polygon
              points="16,14 54,30 16,46"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line x1={54} y1={30} x2={70} y2={30} stroke="#64748b" strokeWidth={2} />
            <text x={30} y={33} textAnchor="middle" className="text-[9px] font-mono font-bold fill-slate-700 select-none">
              TRI
            </text>
            <text x={44} y={48} className="text-[7.5px] font-mono font-bold fill-blue-600 select-none">
              EN
            </text>
          </g>
        );
      }

      case 'led': {
        const inVal = comp.inputs[0]?.value === 1;
        const color = comp.state.ledColor || 'green';

        const colorMap = {
          green: { grad: 'url(#ledGradOnGreen)', glow: '#22c55e', border: '#15803d', filter: 'url(#ledGlowGreen)' },
          red: { grad: 'url(#ledGradOnRed)', glow: '#ef4444', border: '#991b1b', filter: 'url(#ledGlowRed)' },
          blue: { grad: 'url(#ledGradOnBlue)', glow: '#3b82f6', border: '#1d4ed8', filter: 'url(#ledGlowBlue)' },
          yellow: { grad: 'url(#ledGradOnYellow)', glow: '#eab308', border: '#a16207', filter: 'url(#ledGlowYellow)' },
        };
        const activeColor = colorMap[color];

        return (
          <g className="cursor-pointer group">
            {/* Input Lead entering LED base from left */}
            <path
              d="M 0,30 L 14,30 L 14,38"
              fill="none"
              stroke={inVal ? activeColor.glow : '#94a3b8'}
              strokeWidth={2.5}
              strokeLinecap="round"
            />

            {/* Right Cathode Stub extending to ground */}
            <line
              x1={30}
              y1={38}
              x2={30}
              y2={46}
              stroke="#94a3b8"
              strokeWidth={2}
              strokeLinecap="round"
            />

            {/* Atmospheric Diffuse Glow Halo when ON */}
            {inVal && (
              <circle
                cx={24}
                cy={20}
                r={26}
                fill={activeColor.glow}
                opacity={0.45}
                filter="blur(8px)"
              />
            )}

            {/* Upright 5mm Bullet Epoxy Dome & Collar Envelope */}
            <path
              d="M 10,20 A 14,14 0 0,1 38,20 L 38,34 L 41,34 L 41,38 L 7,38 L 7,34 L 10,34 Z"
              fill={inVal ? activeColor.grad : 'url(#ledGradOff)'}
              stroke={inVal ? activeColor.border : '#94a3b8'}
              strokeWidth={1.5}
              filter={inVal ? activeColor.filter : 'url(#gateShadow)'}
            />

            {/* Metallic Leadframe: Anode Post (left) & Cathode Anvil with die (right) */}
            <line
              x1={18}
              y1={38}
              x2={18}
              y2={24}
              stroke={inVal ? '#fef08a' : '#94a3b8'}
              strokeWidth={1.5}
              opacity={inVal ? 0.9 : 0.6}
            />
            <polygon
              points="23,28 30,22 23,20"
              fill={inVal ? '#fef08a' : '#94a3b8'}
              opacity={inVal ? 0.9 : 0.6}
            />
            <line
              x1={24}
              y1={38}
              x2={24}
              y2={28}
              stroke={inVal ? '#fef08a' : '#94a3b8'}
              strokeWidth={1.5}
              opacity={inVal ? 0.9 : 0.6}
            />

            {/* Semiconductor Micro-Die on Anvil */}
            <rect
              x={22.5}
              y={22}
              width={3}
              height={3}
              rx={0.5}
              fill={inVal ? '#ffffff' : '#64748b'}
            />

            {/* Micro Gold Bond Wire */}
            <path
              d="M 23,23.5 Q 20.5,21.5 18,24"
              fill="none"
              stroke={inVal ? '#ffffff' : '#cbd5e1'}
              strokeWidth={0.8}
            />

            {/* Glossy Specular Reflection Curve on Dome */}
            <path
              d="M 14,20 Q 15,11 24,9"
              fill="none"
              stroke="#ffffff"
              strokeWidth={2}
              strokeLinecap="round"
              opacity={inVal ? 0.95 : 0.6}
            />

            {/* Bottom PCB Socket Base */}
            <rect
              x={10}
              y={40}
              width={28}
              height={7}
              rx={2}
              fill="#1e293b"
              stroke="#0f172a"
              strokeWidth={1}
            />

            {/* Status text */}
            <text
              x={24}
              y={57}
              textAnchor="middle"
              className={`text-[8.5px] font-mono font-bold select-none ${
                inVal ? 'fill-emerald-700' : 'fill-slate-500'
              }`}
            >
              {inVal ? 'LED (1)' : 'LED (0)'}
            </text>
          </g>
        );
      }

      case 'probe': {
        const inVal = comp.inputs[0]?.value === 1 ? '1' : '0';
        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={0}
              width={54}
              height={42}
              rx={8}
              fill="#1e293b"
              stroke="#0f172a"
              strokeWidth={2}
            />
            <rect
              x={6}
              y={6}
              width={42}
              height={30}
              rx={4}
              fill={inVal === '1' ? '#ecfdf5' : '#f8fafc'}
              stroke="#334155"
              strokeWidth={1}
            />
            <text
              x={27}
              y={27}
              textAnchor="middle"
              className={`text-xl font-mono font-extrabold select-none ${
                inVal === '1' ? 'fill-emerald-600' : 'fill-slate-600'
              }`}
            >
              {inVal}
            </text>
            <text
              x={27}
              y={34}
              textAnchor="middle"
              className="text-[7px] font-mono font-bold fill-slate-400 select-none"
            >
              {inVal === '1' ? 'HIGH' : 'LOW'}
            </text>
          </g>
        );
      }

      case 'buzzer': {
        const isOn = comp.inputs[0]?.value === 1 || comp.state.on;
        const noteIdx = comp.state.buzzerNote ?? 9;
        const noteName = CHIPTUNE_NOTE_NAMES[noteIdx] || 'E5';
        return (
          <g filter="url(#gateShadow)">
            {/* Cylindrical Piezo Enclosure */}
            <circle cx={34} cy={36} r={32} fill="#0f172a" stroke={strokeColor} strokeWidth={strokeWidth} />
            <circle cx={34} cy={36} r={26} fill="#1e293b" stroke="#334155" strokeWidth={1} />
            {/* Center Sound Aperture */}
            <circle cx={34} cy={36} r={9} fill="#020617" stroke="#475569" strokeWidth={1.2} />

            {/* Sound waves when active */}
            {isOn && (
              <g className="animate-pulse">
                <path d="M 48,26 A 16,16 0 0,1 48,46" stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" fill="none" />
                <path d="M 55,20 A 24,24 0 0,1 55,52" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" fill="none" />
              </g>
            )}
            <text x={34} y={59} textAnchor="middle" className={`text-[8px] font-mono font-bold select-none ${isOn ? 'fill-amber-400 font-extrabold' : 'fill-slate-500'}`}>
              {isOn ? noteName : 'BUZZER'}
            </text>
          </g>
        );
      }

      case 'dotMatrix8x8': {
        const grid = comp.state.matrixGrid || Array(8).fill(null).map(() => Array(8).fill(false));
        return (
          <g filter="url(#gateShadow)">
            {/* Dark Bezel / GPU Display Chassis */}
            <rect x={0} y={0} width={120} height={124} rx={10} fill="#090d16" stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Matrix Screen Glass */}
            <rect x={12} y={8} width={96} height={96} rx={6} fill="#020617" stroke="#1e293b" strokeWidth={1.5} />

            {/* Title / Header */}
            <text x={60} y={6} textAnchor="middle" className="text-[7px] font-mono font-bold fill-slate-500 select-none">
              8x8 DOT MATRIX
            </text>

            {/* 64 LED Pixels (8x8) */}
            {grid.map((row, rIdx) =>
              row.map((isLit, cIdx) => {
                const cx = 18 + cIdx * 12;
                const cy = 14 + rIdx * 12;
                return (
                  <circle
                    key={`${rIdx}_${cIdx}`}
                    cx={cx}
                    cy={cy}
                    r={3.8}
                    fill={isLit ? '#22c55e' : '#0f172a'}
                    stroke={isLit ? '#4ade80' : '#1e293b'}
                    strokeWidth={0.8}
                    filter={isLit ? 'drop-shadow(0 0 2px #22c55e)' : undefined}
                  />
                );
              })
            )}

            {/* Pin Row / Col indicators */}
            <text x={6} y={118} className="text-[6.5px] font-mono font-extrabold fill-slate-500 select-none">R0-7</text>
            <text x={108} y={118} textAnchor="end" className="text-[6.5px] font-mono font-extrabold fill-slate-500 select-none">C0-7</text>
          </g>
        );
      }

      case 'rgbMatrix16x16': {
        const pixels = comp.state.rgbPixels || Array.from({ length: 16 }, () => Array(16).fill('#050505'));
        const curX = (comp.inputs[0]?.value === 1 ? 1 : 0) | ((comp.inputs[1]?.value === 1 ? 2 : 0)) | ((comp.inputs[2]?.value === 1 ? 4 : 0)) | ((comp.inputs[3]?.value === 1 ? 8 : 0));
        const curY = (comp.inputs[4]?.value === 1 ? 1 : 0) | ((comp.inputs[5]?.value === 1 ? 2 : 0)) | ((comp.inputs[6]?.value === 1 ? 4 : 0)) | ((comp.inputs[7]?.value === 1 ? 8 : 0));
        const isWe = comp.inputs[11]?.value === 1;

        return (
          <g filter="url(#gateShadow)">
            {/* Dark Bezel Chassis */}
            <rect x={0} y={0} width={170} height={180} rx={10} fill="#090d16" stroke={strokeColor} strokeWidth={strokeWidth} />
            {/* Screen Glass */}
            <rect x={24} y={14} width={136} height={136} rx={6} fill="#02040a" stroke="#1e293b" strokeWidth={1.5} />

            {/* Header info */}
            <text x={85} y={10} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-sky-400 select-none">
              16x16 RGB VRAM
            </text>
            <text x={158} y={10} textAnchor="end" className="text-[6.5px] font-mono font-bold fill-amber-300 select-none">
              [{curX},{curY}]{isWe ? '•WE' : ''}
            </text>

            {/* 256 RGB Pixels (16x16) */}
            {pixels.map((row, rIdx) =>
              row.map((colHex, cIdx) => {
                const px = 28 + cIdx * 8.1;
                const py = 18 + rIdx * 8.1;
                const isSelectedPixel = cIdx === curX && rIdx === curY;
                const isLit = colHex && colHex !== '#050505';
                return (
                  <rect
                    key={`${rIdx}_${cIdx}`}
                    x={px}
                    y={py}
                    width={7}
                    height={7}
                    rx={1.5}
                    fill={colHex || '#050505'}
                    stroke={isSelectedPixel ? '#38bdf8' : isLit ? colHex : '#0f172a'}
                    strokeWidth={isSelectedPixel ? 1.2 : 0.6}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={(e) => handleToggleRgbPixel(e, comp.id, cIdx, rIdx)}
                  />
                );
              })
            )}

            {/* Pin Group Labels */}
            <text x={4} y={36} className="text-[6.5px] font-mono font-bold fill-slate-400 select-none">X:0-3</text>
            <text x={4} y={88} className="text-[6.5px] font-mono font-bold fill-slate-400 select-none">Y:0-3</text>
            <text x={4} y={136} className="text-[6.5px] font-mono font-bold fill-slate-400 select-none">RGB</text>
            <text x={4} y={166} className="text-[6.5px] font-mono font-bold fill-amber-400 select-none">WE</text>
            <text x={60} y={176} textAnchor="middle" className="text-[6.5px] font-mono font-bold fill-cyan-400 select-none">CLK</text>
            <text x={110} y={176} textAnchor="middle" className="text-[6.5px] font-mono font-bold fill-rose-400 select-none">RST</text>
          </g>
        );
      }

      case 'textLabel': {
        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={0}
              width={140}
              height={44}
              rx={8}
              fill="#f8fafc"
              stroke={isSelected ? '#2563eb' : '#cbd5e1'}
              strokeWidth={isSelected ? 2 : 1.5}
              strokeDasharray={isSelected ? undefined : '4,3'}
            />
            <text
              x={12}
              y={24}
              className="text-xs font-sans font-bold fill-slate-800 select-none"
            >
              {comp.label || 'Açıklama Notu'}
            </text>
            <text
              x={12}
              y={36}
              className="text-[9px] font-sans font-medium fill-slate-400 select-none"
            >
              (Çift tıkla veya Etiket ile düzenle)
            </text>
          </g>
        );
      }

      case 'halfAdder':
      case 'fullAdder':
      case 'halfSubtractor':
      case 'fullSubtractor':
      case 'mux2':
      case 'mux4':
      case 'mux8':
      case 'demux2':
      case 'demux4':
      case 'priorityEncoder4to2':
      case 'shiftRegister4':
      case 'ram16x4':
      case 'rom16x4': {
        const meta = COMPONENT_CATALOG[comp.type];
        const isFA = comp.type === 'fullAdder';
        const isHA = comp.type === 'halfAdder';
        const isFS = comp.type === 'fullSubtractor';
        const isHS = comp.type === 'halfSubtractor';
        const isMUX2 = comp.type === 'mux2';
        const isMUX4 = comp.type === 'mux4';
        const isMUX8 = comp.type === 'mux8';
        const isDEMUX2 = comp.type === 'demux2';
        const isDEMUX4 = comp.type === 'demux4';
        const isPRI = comp.type === 'priorityEncoder4to2';
        const isSHIFT = comp.type === 'shiftRegister4';
        const isRAM = comp.type === 'ram16x4';
        const isROM = comp.type === 'rom16x4';

        const icPartCode = isFA
          ? 'SN74HC283N'
          : isFS
          ? 'SN74HC385N'
          : isHS
          ? 'SN74HC86HS'
          : isHA
          ? 'SN74HC280N'
          : isMUX8
          ? 'SN74HC151N'
          : isMUX4
          ? 'SN74HC153N'
          : isMUX2
          ? 'SN74HC157N'
          : isDEMUX4
          ? 'SN74HC139N'
          : isDEMUX2
          ? 'SN74HC138N'
          : isPRI
          ? 'SN74HC148N'
          : isSHIFT
          ? 'SN74HC194N'
          : isRAM
          ? 'SN74HC189N'
          : isROM
          ? 'ROM-2716'
          : 'SN74HC00N';

        const icTitle = isFA
          ? 'FULL ADDER'
          : isFS
          ? 'FULL SUB'
          : isHS
          ? 'HALF SUB'
          : isHA
          ? 'HALF ADDER'
          : isMUX8
          ? '8:1 MUX'
          : isMUX4
          ? '4:1 MUX'
          : isMUX2
          ? '2:1 MUX'
          : isDEMUX4
          ? '1:4 DEMUX'
          : isDEMUX2
          ? '1:2 DEMUX'
          : isPRI
          ? 'PRIORITY ENC'
          : isSHIFT
          ? 'SHIFT REG'
          : isRAM
          ? '16x4 RAM'
          : isROM
          ? '16x4 ROM'
          : 'LOGIC BLOCK';
        const pinLegsCount = Math.floor(meta.width / 14);

        return (
          <g filter="url(#gateShadow)">
            {/* Metallic Silver IC Pins extending top & bottom */}
            {Array.from({ length: pinLegsCount }).map((_, i) => (
              <g key={i}>
                <rect x={12 + i * 14} y={-4} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                <rect x={12 + i * 14} y={meta.height - 2} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
              </g>
            ))}

            {/* Molded Charcoal Epoxy Body */}
            <rect
              x={0}
              y={2}
              width={meta.width}
              height={meta.height - 4}
              rx={6}
              fill="url(#icBody)"
              stroke={isSelected ? '#3b82f6' : '#334155'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />

            {/* Left Orientation Notch */}
            <path
              d={`M 0,${meta.height / 2 - 6} A 6,6 0 0,0 0,${meta.height / 2 + 6} Z`}
              fill="#020617"
              stroke="#334155"
              strokeWidth={1}
            />

            {/* Pin 1 Indent Dot */}
            <circle cx={10} cy={10} r={2} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            {/* Laser-Etched Serigraphy Text */}
            <text
              x={meta.width / 2}
              y={meta.height / 2 - 2}
              textAnchor="middle"
              className="text-[11px] font-mono font-extrabold fill-slate-200 tracking-wider select-none"
            >
              {icPartCode}
            </text>
            <text
              x={meta.width / 2}
              y={meta.height / 2 + 12}
              textAnchor="middle"
              className="text-[9px] font-mono font-bold fill-slate-400 tracking-widest select-none"
            >
              {icTitle}
            </text>
          </g>
        );
      }

      case 'subcircuit': {
        const chipWidth = 130;
        const inCount = comp.inputs.length;
        const outCount = comp.outputs.length;
        const chipHeight = Math.max(76, (Math.max(inCount, outCount) + 1) * 22);
        const code = comp.state.subcircuitCode || 'IC-CUSTOM';
        const name = (comp.state.subcircuitName || comp.label || 'Özel Alt Devre').toUpperCase();

        return (
          <g filter="url(#gateShadow)">
            {/* Left and Right IC Pin Legs with signal labels */}
            {comp.inputs.map((pin) => {
              const relY = pin.y - comp.y;
              return (
                <g key={pin.id}>
                  <rect x={-8} y={relY - 3} width={8} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                  <text x={8} y={relY + 3} className="text-[9px] font-mono font-bold fill-slate-300 select-none">
                    {pin.name}
                  </text>
                </g>
              );
            })}
            {comp.outputs.map((pin) => {
              const relY = pin.y - comp.y;
              return (
                <g key={pin.id}>
                  <rect x={chipWidth} y={relY - 3} width={8} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                  <text x={chipWidth - 8} y={relY + 3} textAnchor="end" className="text-[9px] font-mono font-bold fill-amber-300 select-none">
                    {pin.name}
                  </text>
                </g>
              );
            })}

            {/* IC Epoxy Body */}
            <rect
              x={0}
              y={0}
              width={chipWidth}
              height={chipHeight}
              rx={6}
              fill="url(#icBody)"
              stroke={isSelected ? '#3b82f6' : '#475569'}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />

            {/* Top Orientation Notch */}
            <path
              d={`M ${chipWidth / 2 - 8},0 A 8,8 0 0,0 ${chipWidth / 2 + 8},0 Z`}
              fill="#020617"
              stroke="#334155"
              strokeWidth={1}
            />

            {/* Pin 1 Dot */}
            <circle cx={10} cy={10} r={2.5} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            {/* Laser-Etched Serigraphy */}
            <text
              x={chipWidth / 2}
              y={chipHeight / 2 - 6}
              textAnchor="middle"
              className="text-[11px] font-mono font-black fill-sky-300 tracking-wider select-none"
            >
              {code}
            </text>
            <text
              x={chipWidth / 2}
              y={chipHeight / 2 + 8}
              textAnchor="middle"
              className="text-[8.5px] font-mono font-bold fill-slate-400 tracking-wide select-none"
            >
              {name.length > 14 ? name.substring(0, 13) + '…' : name}
            </text>
          </g>
        );
      }

      case 'sevenSegment': {
        const segA = comp.inputs[0]?.value === 1;
        const segB = comp.inputs[1]?.value === 1;
        const segC = comp.inputs[2]?.value === 1;
        const segD = comp.inputs[3]?.value === 1;
        const segE = comp.inputs[4]?.value === 1;
        const segF = comp.inputs[5]?.value === 1;
        const segG = comp.inputs[6]?.value === 1;
        const segDP = comp.inputs[7]?.value === 1;

        const onColor = '#ef4444';
        const offColor = '#241215';
        const onGlow = 'drop-shadow(0 0 5px #ef4444)';

        return (
          <g filter="url(#gateShadow)">
            {/* Display Enclosure */}
            <rect
              x={14}
              y={2}
              width={56}
              height={92}
              rx={6}
              fill="#090d16"
              stroke={isSelected ? '#3b82f6' : '#1e293b'}
              strokeWidth={isSelected ? 2 : 1.5}
            />

            {/* Recessed Screen Area */}
            <rect
              x={18}
              y={6}
              width={48}
              height={84}
              rx={4}
              fill="#020617"
              stroke="#0f172a"
              strokeWidth={1}
            />

            {/* Pin Labels along the left edge */}
            {['A', 'B', 'C', 'D', 'E', 'F', 'G', '.'].map((lbl, idx) => (
              <text
                key={lbl}
                x={8}
                y={16 + idx * 10}
                textAnchor="middle"
                className="text-[7.5px] font-mono font-bold fill-slate-400 select-none"
              >
                {lbl}
              </text>
            ))}

            {/* 7 Segments (A, B, C, D, E, F, G) + DP */}
            <rect
              x={28}
              y={14}
              width={26}
              height={5}
              rx={2}
              fill={segA ? onColor : offColor}
              filter={segA ? onGlow : undefined}
            />
            <rect
              x={50}
              y={19}
              width={5}
              height={22}
              rx={2}
              fill={segB ? onColor : offColor}
              filter={segB ? onGlow : undefined}
            />
            <rect
              x={50}
              y={47}
              width={5}
              height={22}
              rx={2}
              fill={segC ? onColor : offColor}
              filter={segC ? onGlow : undefined}
            />
            <rect
              x={28}
              y={69}
              width={26}
              height={5}
              rx={2}
              fill={segD ? onColor : offColor}
              filter={segD ? onGlow : undefined}
            />
            <rect
              x={27}
              y={47}
              width={5}
              height={22}
              rx={2}
              fill={segE ? onColor : offColor}
              filter={segE ? onGlow : undefined}
            />
            <rect
              x={27}
              y={19}
              width={5}
              height={22}
              rx={2}
              fill={segF ? onColor : offColor}
              filter={segF ? onGlow : undefined}
            />
            <rect
              x={28}
              y={42}
              width={26}
              height={5}
              rx={2}
              fill={segG ? onColor : offColor}
              filter={segG ? onGlow : undefined}
            />
            <circle
              cx={59}
              cy={71}
              r={3}
              fill={segDP ? onColor : offColor}
              filter={segDP ? onGlow : undefined}
            />

            <text
              x={42}
              y={86}
              textAnchor="middle"
              className="text-[7.5px] font-mono font-bold fill-slate-500 select-none"
            >
              7-SEG
            </text>
          </g>
        );
      }

      case 'hexDisplay': {
        const val = comp.state.hexVal ?? 0;
        const segs = HEX_7SEG_MAP[val] || HEX_7SEG_MAP[0];
        const onColor = '#ef4444';
        const offColor = '#241215';
        const onGlow = 'drop-shadow(0 0 6px #ef4444)';

        return (
          <g filter="url(#gateShadow)">
            <rect
              x={14}
              y={2}
              width={52}
              height={80}
              rx={6}
              fill="#090d16"
              stroke={isSelected ? '#3b82f6' : '#1e293b'}
              strokeWidth={isSelected ? 2 : 1.5}
            />

            <rect
              x={18}
              y={6}
              width={44}
              height={60}
              rx={4}
              fill="#020617"
              stroke="#0f172a"
              strokeWidth={1}
            />

            {['1', '2', '4', '8'].map((lbl, idx) => (
              <text
                key={lbl}
                x={8}
                y={20 + idx * 18}
                textAnchor="middle"
                className="text-[8px] font-mono font-bold fill-slate-400 select-none"
              >
                {lbl}
              </text>
            ))}

            <rect
              x={27}
              y={12}
              width={24}
              height={4.5}
              rx={2}
              fill={segs.a ? onColor : offColor}
              filter={segs.a ? onGlow : undefined}
            />
            <rect
              x={47}
              y={16.5}
              width={4.5}
              height={17}
              rx={2}
              fill={segs.b ? onColor : offColor}
              filter={segs.b ? onGlow : undefined}
            />
            <rect
              x={47}
              y={38.5}
              width={4.5}
              height={17}
              rx={2}
              fill={segs.c ? onColor : offColor}
              filter={segs.c ? onGlow : undefined}
            />
            <rect
              x={27}
              y={55.5}
              width={24}
              height={4.5}
              rx={2}
              fill={segs.d ? onColor : offColor}
              filter={segs.d ? onGlow : undefined}
            />
            <rect
              x={26.5}
              y={38.5}
              width={4.5}
              height={17}
              rx={2}
              fill={segs.e ? onColor : offColor}
              filter={segs.e ? onGlow : undefined}
            />
            <rect
              x={26.5}
              y={16.5}
              width={4.5}
              height={17}
              rx={2}
              fill={segs.f ? onColor : offColor}
              filter={segs.f ? onGlow : undefined}
            />
            <rect
              x={27}
              y={34}
              width={24}
              height={4.5}
              rx={2}
              fill={segs.g ? onColor : offColor}
              filter={segs.g ? onGlow : undefined}
            />

            <text
              x={40}
              y={75}
              textAnchor="middle"
              className="text-[9px] font-mono font-extrabold fill-red-400 select-none"
            >
              HEX: {val.toString(16).toUpperCase()} ({val})
            </text>
          </g>
        );
      }

      case 'dFlipFlop': {
        const qVal = comp.outputs[0]?.value === 1;
        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={0}
              width={84}
              height={74}
              rx={6}
              fill="url(#gateGrad)"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <path d="M 0,46 L 8,52 L 0,58" fill="none" stroke="#475569" strokeWidth={1.8} />
            <circle cx={81} cy={52} r={3.5} fill="#ffffff" stroke={strokeColor} strokeWidth={1.5} />

            <text x={12} y={26} className="text-xs font-mono font-bold fill-slate-700 select-none">
              D
            </text>
            <text x={12} y={56} className="text-[10px] font-mono font-bold fill-slate-700 select-none">
              CLK
            </text>
            <text x={68} y={26} className="text-xs font-mono font-bold fill-slate-700 select-none">
              Q
            </text>
            <text x={64} y={56} className="text-[11px] font-mono font-bold fill-slate-700 select-none">
              Q'
            </text>

            <circle
              cx={52}
              cy={22}
              r={4}
              fill={qVal ? '#22c55e' : '#cbd5e1'}
              stroke="#64748b"
              strokeWidth={1}
              filter={qVal ? 'drop-shadow(0 0 5px #22c55e)' : undefined}
            />

            <text x={42} y={42} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-blue-700 select-none">
              D-FF
            </text>
            <text x={42} y={52} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">
              74HC74
            </text>
          </g>
        );
      }

      case 'tFlipFlop': {
        const qVal = comp.outputs[0]?.value === 1;
        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={0}
              width={86}
              height={82}
              rx={6}
              fill="url(#gateGrad)"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            {/* Clock Dynamic Edge Arrow */}
            <path d="M 0,52 L 8,58 L 0,64" fill="none" stroke="#475569" strokeWidth={1.8} />
            {/* Inverting Bubble on Q' */}
            <circle cx={83} cy={58} r={3.5} fill="#ffffff" stroke={strokeColor} strokeWidth={1.5} />

            <text x={12} y={26} className="text-xs font-mono font-bold fill-slate-700 select-none">
              T
            </text>
            <text x={12} y={62} className="text-[10px] font-mono font-bold fill-cyan-700 select-none">
              CLK
            </text>
            <text x={43} y={76} textAnchor="middle" className="text-[8px] font-mono font-bold fill-rose-600 select-none">
              RST
            </text>
            <text x={70} y={26} className="text-xs font-mono font-bold fill-slate-700 select-none">
              Q
            </text>
            <text x={66} y={62} className="text-[11px] font-mono font-bold fill-slate-700 select-none">
              Q'
            </text>

            <circle
              cx={52}
              cy={22}
              r={4}
              fill={qVal ? '#22c55e' : '#cbd5e1'}
              stroke="#64748b"
              strokeWidth={1}
              filter={qVal ? 'drop-shadow(0 0 5px #22c55e)' : undefined}
            />

            <text x={43} y={40} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-blue-700 select-none">
              T-FF
            </text>
            <text x={43} y={50} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">
              TOGGLE
            </text>
          </g>
        );
      }

      case 'jkFlipFlop': {
        const qVal = comp.outputs[0]?.value === 1;
        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={0}
              width={88}
              height={84}
              rx={6}
              fill="url(#gateGrad)"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <path d="M 0,36 L 8,42 L 0,48" fill="none" stroke="#475569" strokeWidth={1.8} />
            <circle cx={85} cy={60} r={3.5} fill="#ffffff" stroke={strokeColor} strokeWidth={1.5} />

            <text x={12} y={24} className="text-xs font-mono font-bold fill-slate-700 select-none">
              J
            </text>
            <text x={12} y={46} className="text-[9px] font-mono font-bold fill-slate-700 select-none">
              CLK
            </text>
            <text x={12} y={68} className="text-xs font-mono font-bold fill-slate-700 select-none">
              K
            </text>
            <text x={72} y={28} className="text-xs font-mono font-bold fill-slate-700 select-none">
              Q
            </text>
            <text x={68} y={64} className="text-[11px] font-mono font-bold fill-slate-700 select-none">
              Q'
            </text>

            <circle
              cx={54}
              cy={24}
              r={4}
              fill={qVal ? '#22c55e' : '#cbd5e1'}
              stroke="#64748b"
              strokeWidth={1}
              filter={qVal ? 'drop-shadow(0 0 5px #22c55e)' : undefined}
            />

            <text x={44} y={54} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-blue-700 select-none">
              JK-FF
            </text>
            <text x={44} y={64} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">
              74HC73
            </text>
          </g>
        );
      }

      case 'srLatch': {
        const qVal = comp.outputs[0]?.value === 1;
        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={0}
              width={84}
              height={74}
              rx={6}
              fill="url(#gateGrad)"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <circle cx={81} cy={52} r={3.5} fill="#ffffff" stroke={strokeColor} strokeWidth={1.5} />

            <text x={12} y={26} className="text-xs font-mono font-bold fill-slate-700 select-none">
              S
            </text>
            <text x={12} y={56} className="text-xs font-mono font-bold fill-slate-700 select-none">
              R
            </text>
            <text x={68} y={26} className="text-xs font-mono font-bold fill-slate-700 select-none">
              Q
            </text>
            <text x={64} y={56} className="text-[11px] font-mono font-bold fill-slate-700 select-none">
              Q'
            </text>

            <circle
              cx={52}
              cy={22}
              r={4}
              fill={qVal ? '#22c55e' : '#cbd5e1'}
              stroke="#64748b"
              strokeWidth={1}
              filter={qVal ? 'drop-shadow(0 0 5px #22c55e)' : undefined}
            />

            <text x={42} y={45} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-amber-700 select-none">
              SR LATCH
            </text>
          </g>
        );
      }

      case 'decoder2to4': {
        const enVal = comp.inputs[0]?.value === 1;
        const a0 = comp.inputs[1]?.value === 1;
        const a1 = comp.inputs[2]?.value === 1;
        const selIdx = enVal ? (a0 ? 1 : 0) + (a1 ? 2 : 0) : -1;

        return (
          <g filter="url(#gateShadow)">
            {[0, 1, 2, 3, 4].map((i) => (
              <g key={i}>
                <rect x={14 + i * 14} y={-4} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                <rect x={14 + i * 14} y={82} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
              </g>
            ))}
            <rect x={0} y={2} width={88} height={80} rx={6} fill="url(#icBody)" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M 0,36 A 6,6 0 0,0 0,48 Z" fill="#020617" stroke="#334155" strokeWidth={1} />
            <circle cx={10} cy={10} r={2} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            <text x={12} y={19} className="text-[9px] font-mono font-bold fill-slate-300 select-none">EN</text>
            <text x={12} y={45} className="text-[9px] font-mono font-bold fill-slate-300 select-none">A0</text>
            <text x={12} y={69} className="text-[9px] font-mono font-bold fill-slate-300 select-none">A1</text>

            {['Y0', 'Y1', 'Y2', 'Y3'].map((lbl, idx) => (
              <text
                key={lbl}
                x={74}
                y={19 + idx * 18}
                textAnchor="end"
                className={`text-[9px] font-mono font-extrabold select-none ${
                  selIdx === idx ? 'fill-emerald-400' : 'fill-slate-400'
                }`}
              >
                {lbl}
              </text>
            ))}

            <text x={44} y={40} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-indigo-300 select-none">
              74HC139
            </text>
            <text x={44} y={50} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">
              2:4 DECODER
            </text>
          </g>
        );
      }

      case 'decoder3to8': {
        const enVal = comp.inputs[0]?.value === 1;
        const a0 = comp.inputs[1]?.value === 1;
        const a1 = comp.inputs[2]?.value === 1;
        const a2 = comp.inputs[3]?.value === 1;
        const selIdx = enVal ? (a0 ? 1 : 0) + (a1 ? 2 : 0) + (a2 ? 4 : 0) : -1;
        return (
          <g filter="url(#gateShadow)">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <g key={i}>
                <rect x={14 + i * 14} y={-4} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                <rect x={14 + i * 14} y={114} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
              </g>
            ))}
            <rect x={0} y={2} width={96} height={112} rx={6} fill="url(#icBody)" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M 0,50 A 6,6 0 0,0 0,62 Z" fill="#020617" stroke="#334155" strokeWidth={1} />
            <circle cx={10} cy={10} r={2} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            <text x={12} y={18} className="text-[8.5px] font-mono font-bold fill-slate-300 select-none">EN</text>
            <text x={12} y={43} className="text-[8.5px] font-mono font-bold fill-slate-300 select-none">A0</text>
            <text x={12} y={68} className="text-[8.5px] font-mono font-bold fill-slate-300 select-none">A1</text>
            <text x={12} y={93} className="text-[8.5px] font-mono font-bold fill-slate-300 select-none">A2</text>

            {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
              <text
                key={idx}
                x={84}
                y={18 + idx * 13}
                textAnchor="end"
                className={`text-[8.5px] font-mono font-extrabold select-none ${
                  selIdx === idx ? 'fill-emerald-400' : 'fill-slate-400'
                }`}
              >
                Y{idx}
              </text>
            ))}

            <text x={48} y={54} textAnchor="middle" className="text-[9.5px] font-mono font-extrabold fill-indigo-300 select-none">
              74HC138
            </text>
            <text x={48} y={66} textAnchor="middle" className="text-[7px] font-mono font-bold fill-slate-400 select-none">
              3:8 DEC
            </text>
          </g>
        );
      }

      case 'bcdTo7Seg': {
        const inA = comp.inputs[0]?.value === 1;
        const inB = comp.inputs[1]?.value === 1;
        const inC = comp.inputs[2]?.value === 1;
        const inD = comp.inputs[3]?.value === 1;
        const num = (inA ? 1 : 0) | (inB ? 2 : 0) | (inC ? 4 : 0) | (inD ? 8 : 0);
        return (
          <g filter="url(#gateShadow)">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <g key={i}>
                <rect x={14 + i * 14} y={-4} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                <rect x={14 + i * 14} y={102} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
              </g>
            ))}
            <rect x={0} y={2} width={96} height={100} rx={6} fill="url(#icBody)" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M 0,44 A 6,6 0 0,0 0,56 Z" fill="#020617" stroke="#334155" strokeWidth={1} />
            <circle cx={10} cy={10} r={2} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            <text x={12} y={21} className="text-[8.5px] font-mono font-bold fill-slate-300 select-none">A</text>
            <text x={12} y={41} className="text-[8.5px] font-mono font-bold fill-slate-300 select-none">B</text>
            <text x={12} y={61} className="text-[8.5px] font-mono font-bold fill-slate-300 select-none">C</text>
            <text x={12} y={81} className="text-[8.5px] font-mono font-bold fill-slate-300 select-none">D</text>

            {['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((seg, idx) => {
              const segVal = comp.outputs[idx]?.value === 1;
              return (
                <text
                  key={seg}
                  x={84}
                  y={19 + idx * 12}
                  textAnchor="end"
                  className={`text-[8.5px] font-mono font-extrabold select-none ${
                    segVal ? 'fill-emerald-400' : 'fill-slate-500'
                  }`}
                >
                  {seg}
                </text>
              );
            })}

            <text x={48} y={48} textAnchor="middle" className="text-[9.5px] font-mono font-extrabold fill-indigo-300 select-none">
              74LS47
            </text>
            <text x={48} y={60} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-amber-300 select-none">
              BCD={num % 16}
            </text>
          </g>
        );
      }

      case 'dipSwitch4': {
        const switches = comp.state.dipSwitches || [false, false, false, false];
        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={0}
              width={84}
              height={86}
              rx={6}
              fill="#b91c1c"
              stroke={isSelected ? '#3b82f6' : '#7f1d1d'}
              strokeWidth={strokeWidth}
            />
            <text x={42} y={11} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-amber-300 select-none tracking-widest">
              DIP-4 SW
            </text>
            <text x={18} y={11} className="text-[6.5px] font-mono font-bold fill-red-200 select-none">
              ON
            </text>

            {[0, 1, 2, 3].map((idx) => {
              const isOn = switches[idx];
              const yPos = 16 + idx * 18;
              return (
                <g key={idx} onClick={(e) => handleToggleDipSwitch(e, comp.id, idx)} className="cursor-pointer group">
                  <rect x={16} y={yPos - 2} width={40} height={14} rx={3} fill="#0f172a" stroke="#450a0a" strokeWidth={1} />
                  <rect
                    x={isOn ? 38 : 18}
                    y={yPos}
                    width={16}
                    height={10}
                    rx={2}
                    fill={isOn ? '#f8fafc' : '#cbd5e1'}
                    stroke="#475569"
                    strokeWidth={0.8}
                    filter="drop-shadow(0 1px 2px rgba(0,0,0,0.4))"
                  />
                  <line x1={isOn ? 44 : 24} y1={yPos + 2} x2={isOn ? 44 : 24} y2={yPos + 8} stroke="#94a3b8" strokeWidth={0.8} />
                  <line x1={isOn ? 48 : 28} y1={yPos + 2} x2={isOn ? 48 : 28} y2={yPos + 8} stroke="#94a3b8" strokeWidth={0.8} />

                  <text x={10} y={yPos + 8} textAnchor="middle" className="text-[8px] font-mono font-bold fill-white select-none">
                    {idx + 1}
                  </text>
                  <text x={64} y={yPos + 8} className="text-[8.5px] font-mono font-bold fill-white select-none">
                    Q{idx}
                  </text>
                  <circle
                    cx={76}
                    cy={yPos + 5}
                    r={2.5}
                    fill={isOn ? '#22c55e' : '#7f1d1d'}
                    filter={isOn ? 'drop-shadow(0 0 4px #22c55e)' : undefined}
                  />
                </g>
              );
            })}
          </g>
        );
      }

      case 'asciiKeyboard': {
        const char = comp.state.asciiChar ?? 'A';
        const code = comp.state.asciiCode ?? 65;
        const strobe = !!comp.state.strobe;
        const quickKeys = ['A', 'B', 'C', '0', '1', '␣', '↵'];

        return (
          <g filter="url(#gateShadow)">
            {/* Terminal Enclosure */}
            <rect x={0} y={0} width={140} height={96} rx={8} fill="#1e1b4b" stroke={strokeColor} strokeWidth={strokeWidth} />

            {/* Title */}
            <text x={70} y={11} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-indigo-200 select-none tracking-wider">
              ASCII KLAVYE
            </text>

            {/* Main Key Display Box */}
            <rect x={14} y={16} width={38} height={42} rx={6} fill="#0f172a" stroke="#3730a3" strokeWidth={1.5} />
            <text x={33} y={44} textAnchor="middle" className="text-xl font-mono font-black fill-emerald-400 select-none">
              {char}
            </text>

            {/* ASCII Specs Panel */}
            <text x={58} y={26} className="text-[8px] font-mono font-bold fill-amber-300 select-none">
              HEX: 0x{code.toString(16).toUpperCase().padStart(2, '0')}
            </text>
            <text x={58} y={38} className="text-[7.5px] font-mono font-bold fill-indigo-200 select-none">
              DEC: {code}
            </text>
            <text x={58} y={50} className="text-[7px] font-mono font-extrabold fill-cyan-300 select-none">
              BIN: {code.toString(2).padStart(7, '0')}
            </text>

            {/* Strobe Status LED Indicator */}
            <circle cx={14} cy={48} r={3.5} fill={strobe ? '#22c55e' : '#334155'} stroke={strobe ? '#86efac' : '#1e293b'} strokeWidth={1} filter={strobe ? 'drop-shadow(0 0 3px #22c55e)' : undefined} />

            {/* Quick-type Keycaps Row */}
            <g transform="translate(10, 64)">
              {quickKeys.map((k, kIdx) => {
                const kx = kIdx * 17;
                return (
                  <g
                    key={k}
                    transform={`translate(${kx}, 0)`}
                    className="cursor-pointer group hover:scale-105 transition-transform"
                    onClick={(e) => handleToggleKeyboardChar(e, comp.id, k === '␣' ? ' ' : k === '↵' ? '\n' : k)}
                  >
                    <rect x={0} y={0} width={15} height={15} rx={3} fill="#312e81" stroke="#4338ca" strokeWidth={1} className="group-hover:fill-indigo-600" />
                    <text x={7.5} y={10.5} textAnchor="middle" className="text-[8px] font-mono font-bold fill-slate-100 select-none pointer-events-none">
                      {k}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* Pin Labels */}
            <text x={4} y={51} className="text-[6.5px] font-mono font-bold fill-rose-300 select-none">CLR</text>
            <text x={70} y={93} textAnchor="middle" className="text-[6.5px] font-mono font-bold fill-emerald-300 select-none">ST: {strobe ? '1' : '0'}</text>
            <text x={136} y={16} textAnchor="end" className="text-[6px] font-mono font-bold fill-slate-400 select-none">D0-D6</text>
          </g>
        );
      }

      case 'ledBar4': {
        const in0 = comp.inputs[0]?.value === 1;
        const in1 = comp.inputs[1]?.value === 1;
        const in2 = comp.inputs[2]?.value === 1;
        const in3 = comp.inputs[3]?.value === 1;
        const bits = [in0, in1, in2, in3];
        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={0}
              width={76}
              height={86}
              rx={6}
              fill="#0f172a"
              stroke={isSelected ? '#3b82f6' : '#334155'}
              strokeWidth={strokeWidth}
            />
            <text x={38} y={11} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none tracking-wider">
              LED BAR-4
            </text>

            {bits.map((active, idx) => {
              const yPos = 16 + idx * 18;
              return (
                <g key={idx}>
                  <text x={12} y={yPos + 9} className="text-[8.5px] font-mono font-bold fill-slate-400 select-none">
                    D{idx}
                  </text>
                  <rect
                    x={28}
                    y={yPos}
                    width={40}
                    height={12}
                    rx={2.5}
                    fill={active ? '#22c55e' : '#1e293b'}
                    stroke={active ? '#16a34a' : '#334155'}
                    strokeWidth={1}
                    filter={active ? 'drop-shadow(0 0 6px #22c55e)' : undefined}
                  />
                  {active && (
                    <rect x={30} y={yPos + 2} width={36} height={3} rx={1} fill="#86efac" opacity={0.6} />
                  )}
                </g>
              );
            })}
          </g>
        );
      }

      case 'comparator4': {
        const aVal =
          (comp.inputs[0]?.value === 1 ? 1 : 0) +
          (comp.inputs[1]?.value === 1 ? 2 : 0) +
          (comp.inputs[2]?.value === 1 ? 4 : 0) +
          (comp.inputs[3]?.value === 1 ? 8 : 0);
        const bVal =
          (comp.inputs[4]?.value === 1 ? 1 : 0) +
          (comp.inputs[5]?.value === 1 ? 2 : 0) +
          (comp.inputs[6]?.value === 1 ? 4 : 0) +
          (comp.inputs[7]?.value === 1 ? 8 : 0);

        return (
          <g filter="url(#gateShadow)">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <g key={i}>
                <rect x={14 + i * 12} y={-4} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
              </g>
            ))}
            <rect x={0} y={2} width={96} height={86} rx={6} fill="url(#icBody)" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M 0,39 A 6,6 0 0,0 0,51 Z" fill="#020617" stroke="#334155" strokeWidth={1} />
            <circle cx={10} cy={10} r={2} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            <text x={12} y={20} className="text-[8px] font-mono font-bold fill-slate-400 select-none">A[3:0]</text>
            <text x={48} y={82} textAnchor="middle" className="text-[8px] font-mono font-bold fill-slate-400 select-none">B[3:0]</text>

            <text x={84} y={25} textAnchor="end" className={`text-[8.5px] font-mono font-extrabold select-none ${aVal > bVal ? 'fill-emerald-400' : 'fill-slate-500'}`}>A &gt; B</text>
            <text x={84} y={48} textAnchor="end" className={`text-[8.5px] font-mono font-extrabold select-none ${aVal === bVal ? 'fill-emerald-400' : 'fill-slate-500'}`}>A = B</text>
            <text x={84} y={71} textAnchor="end" className={`text-[8.5px] font-mono font-extrabold select-none ${aVal < bVal ? 'fill-emerald-400' : 'fill-slate-500'}`}>A &lt; B</text>

            <text x={44} y={38} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-blue-300 select-none">
              74HC85
            </text>
            <text x={44} y={48} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">
              4-BIT CMP
            </text>
            <text x={44} y={60} textAnchor="middle" className="text-[8px] font-mono font-bold fill-amber-300 select-none">
              {aVal} vs {bVal}
            </text>
          </g>
        );
      }

      case 'counter4': {
        const count = comp.state.count ?? 0;
        return (
          <g filter="url(#gateShadow)">
            {[0, 1, 2, 3, 4].map((i) => (
              <g key={i}>
                <rect x={14 + i * 13} y={-4} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                <rect x={14 + i * 13} y={86} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
              </g>
            ))}
            <rect x={0} y={2} width={90} height={84} rx={6} fill="url(#icBody)" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M 0,38 A 6,6 0 0,0 0,50 Z" fill="#020617" stroke="#334155" strokeWidth={1} />
            <circle cx={10} cy={10} r={2} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            <text x={12} y={33} className="text-[9px] font-mono font-bold fill-slate-300 select-none">CLK</text>
            <text x={12} y={63} className="text-[9px] font-mono font-bold fill-slate-300 select-none">RST</text>

            {['Q0', 'Q1', 'Q2', 'Q3'].map((lbl, idx) => {
              const bitVal = ((count >> idx) & 1) === 1;
              return (
                <text
                  key={lbl}
                  x={76}
                  y={19 + idx * 20}
                  textAnchor="end"
                  className={`text-[9px] font-mono font-extrabold select-none ${
                    bitVal ? 'fill-emerald-400' : 'fill-slate-500'
                  }`}
                >
                  {lbl}
                </text>
              );
            })}

            <text x={42} y={36} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-blue-300 select-none">
              74HC161
            </text>
            <text x={42} y={48} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">
              4-BIT CTR
            </text>
            <rect x={26} y={54} width={32} height={18} rx={3} fill="#020617" stroke="#334155" strokeWidth={1} />
            <text x={42} y={67} textAnchor="middle" className="text-xs font-mono font-extrabold fill-emerald-400 select-none">
              {count.toString(16).toUpperCase()} ({count})
            </text>
          </g>
        );
      }

      case 'alu4': {
        const aVal =
          (comp.inputs[0]?.value === 1 ? 1 : 0) +
          (comp.inputs[1]?.value === 1 ? 2 : 0) +
          (comp.inputs[2]?.value === 1 ? 4 : 0) +
          (comp.inputs[3]?.value === 1 ? 8 : 0);
        const cinVal = comp.inputs[4]?.value === 1 ? 1 : 0;
        const bVal =
          (comp.inputs[5]?.value === 1 ? 1 : 0) +
          (comp.inputs[6]?.value === 1 ? 2 : 0) +
          (comp.inputs[7]?.value === 1 ? 4 : 0) +
          (comp.inputs[8]?.value === 1 ? 8 : 0);
        const s0 = comp.inputs[9]?.value === 1 ? 1 : 0;
        const s1 = comp.inputs[10]?.value === 1 ? 1 : 0;
        const mode = s0 + s1 * 2;
        const modeLabels = ['ADD (A+B)', 'SUB (A-B)', 'AND (A&B)', 'OR (A|B)'];
        const resVal = comp.state.aluResult ?? 0;

        return (
          <g filter="url(#gateShadow)">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <g key={i}>
                <rect x={12 + i * 12} y={-4} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                <rect x={12 + i * 12} y={96} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
              </g>
            ))}
            <rect x={0} y={2} width={104} height={94} rx={6} fill="url(#icBody)" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M 0,43 A 6,6 0 0,0 0,55 Z" fill="#020617" stroke="#334155" strokeWidth={1} />
            <circle cx={10} cy={10} r={2} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            <text x={12} y={18} className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">A[3:0]</text>
            <text x={12} y={80} className="text-[7.5px] font-mono font-bold fill-amber-300 select-none">Cin</text>
            <text x={52} y={92} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">B[3:0]</text>
            <text x={52} y={12} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-cyan-400 select-none">S1 S0</text>

            <text x={94} y={20} textAnchor="end" className="text-[7.5px] font-mono font-bold fill-emerald-400 select-none">F[3:0]</text>
            <text x={94} y={80} textAnchor="end" className="text-[7.5px] font-mono font-bold fill-amber-300 select-none">Cout</text>
            <text x={94} y={92} textAnchor="end" className="text-[7.5px] font-mono font-bold fill-purple-300 select-none">Z</text>

            <text x={52} y={26} textAnchor="middle" className="text-[7px] font-mono font-bold fill-slate-400 select-none">A={aVal} B={bVal} (Ci={cinVal})</text>
            <text x={52} y={38} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-blue-300 select-none">
              74HC181
            </text>
            <text x={52} y={49} textAnchor="middle" className="text-[7.5px] font-mono font-extrabold fill-yellow-300 select-none">
              {modeLabels[mode]}
            </text>
            <rect x={32} y={56} width={40} height={18} rx={3} fill="#020617" stroke="#334155" strokeWidth={1} />
            <text x={52} y={69} textAnchor="middle" className="text-xs font-mono font-black fill-emerald-400 select-none">
              F={resVal.toString(16).toUpperCase()} ({resVal})
            </text>
          </g>
        );
      }

      case 'register4': {
        const val = comp.state.regVal ?? 0;
        const we = comp.inputs[5]?.value === 1;

        return (
          <g filter="url(#gateShadow)">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <g key={i}>
                <rect x={12 + i * 13} y={-4} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
                <rect x={12 + i * 13} y={86} width={5} height={6} rx={1} fill="url(#icPin)" stroke="#64748b" strokeWidth={0.5} />
              </g>
            ))}
            <rect x={0} y={2} width={92} height={84} rx={6} fill="url(#icBody)" stroke={strokeColor} strokeWidth={strokeWidth} />
            <path d="M 0,38 A 6,6 0 0,0 0,50 Z" fill="#020617" stroke="#334155" strokeWidth={1} />
            <circle cx={10} cy={10} r={2} fill="#020617" stroke="#1e293b" strokeWidth={0.8} />

            <text x={12} y={18} className="text-[8px] font-mono font-bold fill-slate-400 select-none">D[3:0]</text>
            <text x={28} y={80} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-cyan-400 select-none">CLK</text>
            <text x={50} y={80} textAnchor="middle" className={`text-[7.5px] font-mono font-bold select-none ${we ? 'fill-emerald-400' : 'fill-slate-500'}`}>WE</text>
            <text x={72} y={80} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-rose-400 select-none">RST</text>

            <text x={82} y={18} textAnchor="end" className="text-[8px] font-mono font-bold fill-emerald-400 select-none">Q[3:0]</text>

            <text x={46} y={35} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-blue-300 select-none">
              74HC173
            </text>
            <text x={46} y={46} textAnchor="middle" className="text-[7.5px] font-mono font-bold fill-slate-400 select-none">
              4-BIT REGISTER
            </text>
            <rect x={28} y={52} width={36} height={18} rx={3} fill="#020617" stroke="#334155" strokeWidth={1} />
            <text x={46} y={65} textAnchor="middle" className="text-xs font-mono font-black fill-emerald-400 select-none">
              Q={val.toString(16).toUpperCase()} ({val})
            </text>
          </g>
        );
      }

      case 'splitter4': {
        const in0 = comp.inputs[0]?.value === 1;
        const in1 = comp.inputs[1]?.value === 1;
        const in2 = comp.inputs[2]?.value === 1;
        const in3 = comp.inputs[3]?.value === 1;
        const busVal = (in0 ? 1 : 0) + (in1 ? 2 : 0) + (in2 ? 4 : 0) + (in3 ? 8 : 0);

        return (
          <g filter="url(#gateShadow)">
            <rect
              x={0}
              y={2}
              width={84}
              height={68}
              rx={6}
              fill="#0f172a"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            {/* Bus trunk spine */}
            <line
              x1={42}
              y1={12}
              x2={42}
              y2={60}
              stroke="#0284c7"
              strokeWidth={5}
              strokeLinecap="round"
            />
            {[15, 30, 45, 60].map((y, idx) => {
              const bitHigh = (busVal & (1 << idx)) !== 0;
              const branchColor = bitHigh ? '#22c55e' : '#475569';
              return (
                <g key={idx}>
                  <line
                    x1={0}
                    y1={y}
                    x2={39}
                    y2={y}
                    stroke={branchColor}
                    strokeWidth={bitHigh ? 2.5 : 1.5}
                  />
                  <line
                    x1={45}
                    y1={y}
                    x2={84}
                    y2={y}
                    stroke={branchColor}
                    strokeWidth={bitHigh ? 2.5 : 1.5}
                  />
                  <text
                    x={8}
                    y={y - 3}
                    className="text-[7.5px] font-mono font-bold fill-slate-400 select-none"
                  >
                    D{idx}
                  </text>
                  <text
                    x={76}
                    y={y - 3}
                    textAnchor="end"
                    className="text-[7.5px] font-mono font-bold fill-emerald-400 select-none"
                  >
                    Y{idx}
                  </text>
                </g>
              );
            })}
            <rect
              x={22}
              y={25}
              width={40}
              height={22}
              rx={4}
              fill="#020617"
              stroke="#0284c7"
              strokeWidth={1.5}
            />
            <text
              x={42}
              y={35}
              textAnchor="middle"
              className="text-[7px] font-mono font-black fill-cyan-400 select-none tracking-wider"
            >
              BUS [3:0]
            </text>
            <text
              x={42}
              y={44}
              textAnchor="middle"
              className="text-[8px] font-mono font-extrabold fill-emerald-400 select-none"
            >
              0x{busVal.toString(16).toUpperCase()}
            </text>
          </g>
        );
      }
    }
  };

  // Find pin by id
  const findPinById = (pinId: string): CircuitPin | null => {
    for (const c of components) {
      const p = c.inputs.find((i) => i.id === pinId) || c.outputs.find((o) => o.id === pinId);
      if (p) return p;
    }
    return null;
  };

  // Count outgoing wires per output pin to detect branching junctions
  const pinWireCounts = useMemo(() => {
    const counts = new Map<string, number>();
    wires.forEach((w) => {
      counts.set(w.fromPinId, (counts.get(w.fromPinId) || 0) + 1);
      counts.set(w.toPinId, (counts.get(w.toPinId) || 0) + 1);
    });
    return counts;
  }, [wires]);

  // Wire jumper bridges removed - Logisim standard flat crossings with solder junction dots

  // Generated Truth Table for active circuit
  const truthTableData = useMemo(() => {
    return generateTruthTable(components, wires);
  }, [components, wires]);

  // Check if any wire is experiencing a contention conflict (0 and 1 driving same net)
  const hasConflictError = useMemo(() => wires.some((w) => w.hasConflict), [wires]);

  // Active truth table summary of current canvas
  const canvasSummary = useMemo(() => {
    const inputs = components.filter((c) => c.type === 'switch' || c.type === 'clock');
    const outputs = components.filter((c) => c.type === 'led' || c.type === 'probe');
    return { inputs, outputs };
  }, [components]);

  // Filtered Components & Sheets for Command Palette (Ctrl+K)
  const filteredPaletteItems = useMemo(() => {
    const q = paletteQuery.toLowerCase().trim();
    const items: {
      id: string;
      title: string;
      description: string;
      tag: string;
      action: () => void;
    }[] = [];

    // 1. Standard Components
    Object.values(COMPONENT_CATALOG).forEach((meta) => {
      if (meta.type === 'subcircuit') return;
      if (
        !q ||
        meta.name.toLowerCase().includes(q) ||
        meta.type.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q)
      ) {
        items.push({
          id: meta.type,
          title: meta.name,
          description: meta.description,
          tag: meta.category.toUpperCase(),
          action: () => handleAddComponent(meta.type),
        });
      }
    });

    // 2. Custom Subcircuits (ICs)
    customSubcircuits.forEach((sub) => {
      if (
        !q ||
        sub.name.toLowerCase().includes(q) ||
        (sub.chipCode && sub.chipCode.toLowerCase().includes(q)) ||
        sub.description.toLowerCase().includes(q)
      ) {
        items.push({
          id: sub.id,
          title: sub.name,
          description: sub.description,
          tag: sub.chipCode || 'IC',
          action: () => handleAddSubcircuit(sub),
        });
      }
    });

    // 3. Project Sheets as ICs
    sheets.forEach((s) => {
      if (s.id !== activeSheetId && (!q || s.name.toLowerCase().includes(q))) {
        items.push({
          id: `sheet_ic_${s.id}`,
          title: `Sayfa Çipi: ${s.name}`,
          description: `"${s.name}" sayfasını entegre çip olarak tuvale ekler`,
          tag: 'SAYFA',
          action: () => handleAddSheetAsSubcircuit(s),
        });
      }
    });

    // 4. Annotations
    if (!q || 'çerçeve'.includes(q) || 'frame'.includes(q) || 'kutu'.includes(q)) {
      items.push({
        id: 'ann_frame_cmd',
        title: 'Gruplama Çerçevesi Ekle',
        description: 'Tuval üzerine renkli açıklama çerçevesi yerleştirir',
        tag: 'ÇERÇEVE',
        action: () => handleAddAnnotation('frame'),
      });
    }
    if (!q || 'not'.includes(q) || 'note'.includes(q) || 'yapışkan'.includes(q)) {
      items.push({
        id: 'ann_note_cmd',
        title: 'Yapışkan Not Ekle',
        description: 'Tuval üzerine sarı yapışkan bilgi notu yerleştirir',
        tag: 'NOT',
        action: () => handleAddAnnotation('note'),
      });
    }

    return items;
  }, [paletteQuery, customSubcircuits, sheets, activeSheetId]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Educational Header - Clean, Spacious & Responsive */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
        {/* Title and Description */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Cpu className="w-3.5 h-3.5" />
            <span>İnteraktif Web Laboratuvarı · Sayısal Mantık & İşlemci Tasarımı</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Dijital Devre & Mantık Laboratuvarı
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed max-w-4xl">
            Mantık kapılarını tuvale yerleştirin, kablolarla bağlayın ve giriş anahtarlarını açıp kapatarak devrenin tepkisini canlı olarak izleyin.
            İster sürekli simülasyon, ister <strong>adım adım (Step-by-step)</strong> çalıştırarak sinyal yayılımını inceleyin.
          </p>
        </div>

        {/* Dedicated Presets Shelf (Açılır / Kapanır Akordeon & Arama Destekli) */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          {/* Header Row: Title, Badge, Selected Status, and Open/Close Toggle */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button
              onClick={() => setIsPresetsExpanded(!isPresetsExpanded)}
              className="flex items-center gap-2.5 text-left group cursor-pointer focus:outline-none"
            >
              <div className="p-1.5 bg-blue-50 text-blue-700 rounded-lg group-hover:bg-blue-100 transition-colors">
                <BookOpen className="w-4 h-4" />
              </div>
              <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider group-hover:text-blue-600 transition-colors">
                Hazır Kitap Şablonları:
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                {CIRCUIT_PRESETS.length} Şablon
              </span>
              {selectedPresetId && (
                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                  Yüklü: {CIRCUIT_PRESETS.find((p) => p.id === selectedPresetId)?.name.split('(')[0].trim()}
                </span>
              )}
            </button>

            {/* Expand / Collapse Button */}
            <button
              onClick={() => setIsPresetsExpanded(!isPresetsExpanded)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>{isPresetsExpanded ? 'Şablonları Gizle' : 'Şablonları İncele & Yükle'}</span>
              {isPresetsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Collapsible Content */}
          {isPresetsExpanded && (
            <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-150">
              {/* Category Filter Pills & Search Input */}
              <div className="flex items-center justify-between flex-wrap gap-2.5 bg-slate-50 p-2.5 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-1 bg-white p-1 rounded-xl text-xs font-semibold border border-slate-200 flex-wrap">
                  {[
                    { id: 'all' as const, label: 'Tümü' },
                    { id: 'music_graphics' as const, label: '🎵 Müzik, Klavye & GPU' },
                    { id: 'arithmetic' as const, label: 'Toplayıcı & ALU' },
                    { id: 'basic' as const, label: 'Temel & MUX' },
                    { id: 'sequential' as const, label: 'Ardışıl & Bellek (RAM)' },
                    { id: 'bus' as const, label: 'Veri Yolu & Gösterge' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setPresetFilter(f.id)}
                      className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-[11px] ${
                        presetFilter === f.id
                          ? 'bg-blue-600 text-white shadow-2xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Instant Search Bar */}
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={presetSearchQuery}
                    onChange={(e) => setPresetSearchQuery(e.target.value)}
                    placeholder="Şablon ara... (Örn: RAM, toplayıcı, sayaç)"
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all shadow-2xs font-medium"
                  />
                  {presetSearchQuery && (
                    <button
                      onClick={() => setPresetSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Presets Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-[280px] overflow-y-auto p-1">
                {CIRCUIT_PRESETS
                  .filter((p) => {
                    const matchesCategory = presetFilter === 'all' || p.category === presetFilter;
                    const matchesSearch =
                      !presetSearchQuery.trim() ||
                      p.name.toLowerCase().includes(presetSearchQuery.toLowerCase()) ||
                      p.description.toLowerCase().includes(presetSearchQuery.toLowerCase());
                    return matchesCategory && matchesSearch;
                  })
                  .map((preset) => {
                    const isSelected = selectedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => {
                          handleLoadPreset(preset.id);
                        }}
                        className={`p-3 rounded-2xl text-left text-xs transition-all cursor-pointer flex flex-col justify-between border shadow-2xs ${
                          isSelected
                            ? 'bg-blue-50/90 border-blue-400 text-blue-950 ring-2 ring-blue-500/30'
                            : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 hover:border-slate-300'
                        }`}
                        title={preset.description}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${isSelected ? 'bg-blue-600' : 'bg-slate-400'}`} />
                          <div className="space-y-1">
                            <span className="font-bold leading-tight block">{preset.name}</span>
                            <span className="text-[10.5px] text-slate-500 line-clamp-2 leading-relaxed">
                              {preset.description}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Simulation Stage Card */}
      <div className={`rounded-3xl border overflow-hidden flex flex-col transition-colors ${
        cadTheme === 'dark'
          ? 'bg-[#0B0F19] border-slate-800 shadow-2xl text-slate-100'
          : 'bg-white border-slate-200 shadow-xs text-slate-900'
      }`}>
        {/* Top Control Bar: Tier 1 - Simulation & Analysis Suite */}
        <div className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 shadow-2xs transition-colors ${
          cadTheme === 'dark' ? 'bg-[#0F172A] border-slate-800' : 'bg-white border-slate-200'
        }`}>
          {/* Section 1: Core Simulation Engine Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setIsRunning(!isRunning)}
              className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 cursor-pointer shadow-xs transition-all focus:outline-none select-none ${
                isRunning
                  ? 'bg-amber-500 hover:bg-amber-600 text-white active:scale-95'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95'
              }`}
            >
              {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isRunning ? 'Durdur' : 'Çalıştır'}</span>
            </button>

            <button
              onClick={handleSingleStep}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border shadow-2xs flex items-center gap-1.5 cursor-pointer transition-colors select-none ${
                cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-blue-300 border-slate-700'
                  : 'bg-slate-50 hover:bg-blue-50 text-blue-700 border-slate-200'
              }`}
              title="Sinyali tek bir adım / saat darbesi ilerletir"
            >
              <StepForward className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tek Adım</span>
            </button>

            {/* Clock Frequency Segmented Control */}
            <div className={`flex items-center gap-1 p-0.5 rounded-xl border text-xs ${
              cadTheme === 'dark'
                ? 'bg-slate-800/90 border-slate-700 text-slate-300'
                : 'bg-slate-100/80 border-slate-200 text-slate-600'
            }`}>
              <span className="px-1.5 text-[11px] font-semibold flex items-center gap-1">
                <Activity className="w-3 h-3 text-blue-500" />
                <span className="hidden md:inline">Saat:</span>
              </span>
              {[0.5, 1, 2, 4, 6, 8].map((hz) => (
                <button
                  key={hz}
                  onClick={() => setClockHz(hz)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold cursor-pointer transition-colors outline-none focus:outline-none focus:ring-0 focus-visible:outline-none select-none ${
                    clockHz === hz
                      ? cadTheme === 'dark'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white text-blue-700 shadow-xs'
                      : cadTheme === 'dark'
                      ? 'text-slate-400 hover:text-slate-100'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {hz}Hz
                </button>
              ))}
            </div>
          </div>

          {/* Section 2: Analysis & Engineering Suite */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 hidden xl:inline-block mr-1">
              Analiz Suite:
            </span>

            {/* Truth Table */}
            <button
              onClick={() => setShowTruthTable(true)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border-indigo-800/60'
                  : 'bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 border-indigo-200/80'
              }`}
              title="Devrenin Tüm Doğruluk Tablosunu Üret"
            >
              <Table className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Doğruluk Tablosu</span>
              <span className="sm:hidden">Tablo</span>
            </button>

            {/* Boolean Logic Synthesizer */}
            <button
              onClick={() => setShowSynthesizer(true)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border-amber-800/60'
                  : 'bg-amber-50/80 hover:bg-amber-100 text-amber-800 border-amber-200/80'
              }`}
              title="Boole Fonksiyonundan Otomatik Mantık Devresi Sentezle"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Boole Sentez</span>
              <span className="sm:hidden">Sentez</span>
            </button>

            {/* Scope / Waveform */}
            <button
              onClick={() => setShowWaveform((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                showWaveform
                  ? 'bg-slate-900 text-cyan-300 border-slate-700'
                  : cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="Sayısal Zamanlama Diyagramı / Osiloskop Panelini Aç/Kapat"
            >
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Osiloskop</span>
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            </button>

            {/* FSM Designer */}
            <button
              onClick={() => setShowFsmModal(true)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-pink-950/60 hover:bg-pink-900/80 text-pink-300 border-pink-800/60'
                  : 'bg-pink-50/80 hover:bg-pink-100 text-pink-700 border-pink-200/80'
              }`}
              title="Durum Makinesi (FSM) Tasarla ve Devreye Dönüştür"
            >
              <Workflow className="w-3.5 h-3.5 text-pink-400" />
              <span className="hidden md:inline">FSM Tasarla</span>
              <span className="md:hidden">FSM</span>
            </button>

            {/* Testbench */}
            <button
              onClick={() => {
                if (!testbenchText) handleAutoGenerateTestbench();
                setShowTestbenchModal(true);
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-violet-950/60 hover:bg-violet-900/80 text-violet-300 border-violet-800/60'
                  : 'bg-violet-50/80 hover:bg-violet-100 text-violet-700 border-violet-200/80'
              }`}
              title="Otomatik Test Vektörleri ve Testbench Koşturucu"
            >
              <FlaskConical className="w-3.5 h-3.5 text-violet-400" />
              <span className="hidden md:inline">Testbench</span>
            </button>

            {/* Hex Memory Matrix */}
            <button
              onClick={() => handleOpenHexEditor()}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-sky-950/60 hover:bg-sky-900/80 text-sky-300 border-sky-800/60'
                  : 'bg-sky-50/80 hover:bg-sky-100 text-sky-800 border-sky-200/80'
              }`}
              title="RAM ve ROM Bellek Hücrelerini Hex Matrisinde Canlı Düzenle"
            >
              <Binary className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden md:inline">Hex Bellek</span>
            </button>

            {/* HDL & FPGA */}
            <button
              onClick={() => {
                setHdlActiveTab('verilog');
                setShowHdlModal(true);
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800/60'
                  : 'bg-emerald-50/80 hover:bg-emerald-100 text-emerald-800 border-emerald-200/80'
              }`}
              title="Sentezlenebilir Verilog, VHDL ve FPGA Kısıt Kodlarını Üret"
            >
              <FileCode className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden lg:inline">HDL & FPGA</span>
              <span className="lg:hidden">HDL</span>
            </button>

            {/* Circuit Statistics & CMOS Transistor Report */}
            <button
              onClick={handleOpenStatsModal}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border-blue-800/60'
                  : 'bg-blue-50/80 hover:bg-blue-100 text-blue-700 border-blue-200/80'
              }`}
              title="Devre İstatistikleri, CMOS Transistör Sayısı ve Mantık Derinliği Raporu"
            >
              <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden xl:inline">İstatistik & CMOS</span>
              <span className="xl:hidden">İstatistik</span>
            </button>
          </div>

          {/* Section 3: Subcircuits, Datasheets & Persistence */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setShowSubcircuitModal(true)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-blue-950/70 hover:bg-blue-900/90 text-blue-300 border-blue-800/60'
                  : 'bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 text-blue-800 border-blue-200'
              }`}
              title="Tuvaldeki Devreyi Özel Entegre (IC / Alt Devre) Olarak Paketle"
            >
              <Package className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden sm:inline">IC Paketle</span>
            </button>

            <button
              onClick={() => setShowDatasheetModal(true)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="74xx Serisi ve Entegre Bacak Şemaları"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Datasheets</span>
            </button>

            {/* Save / Load / Export cluster */}
            <div className={`flex items-center gap-0.5 p-1 rounded-xl border shadow-2xs ${
              cadTheme === 'dark' ? 'bg-slate-800/90 border-slate-700' : 'bg-slate-100/90 border-slate-200'
            }`}>
              <button
                onClick={handleExportJSON}
                className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  cadTheme === 'dark' ? 'text-slate-300 hover:text-white hover:bg-slate-700' : 'text-slate-700 hover:text-blue-700 hover:bg-white'
                }`}
                title="Devreyi JSON Olarak Kaydet"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Kaydet</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  cadTheme === 'dark' ? 'text-slate-300 hover:text-white hover:bg-slate-700' : 'text-slate-700 hover:text-blue-700 hover:bg-white'
                }`}
                title="Bilgisayardan JSON Yükle"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Yükle</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.circ"
                onChange={handleImportJSON}
                className="hidden"
              />
              <button
                onClick={handleExportPNG}
                className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  cadTheme === 'dark' ? 'text-slate-300 hover:text-emerald-400 hover:bg-slate-700' : 'text-slate-700 hover:text-emerald-700 hover:bg-white'
                }`}
                title="Devre Şemasını PNG Resim Olarak İndir"
              >
                <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline">PNG</span>
              </button>
              <button
                onClick={handleExportSVG}
                className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  cadTheme === 'dark' ? 'text-slate-300 hover:text-indigo-400 hover:bg-slate-700' : 'text-slate-700 hover:text-indigo-700 hover:bg-white'
                }`}
                title="Devre Şemasını Vektörel SVG Olarak İndir"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden md:inline">SVG</span>
              </button>
              <button
                onClick={handleExportCirc}
                className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  cadTheme === 'dark' ? 'text-slate-300 hover:text-sky-400 hover:bg-slate-700' : 'text-slate-700 hover:text-sky-700 hover:bg-white'
                }`}
                title="Devreyi Standart (.circ) CAD XML Dosyası Olarak Dışa Aktar"
              >
                <FileCode className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden md:inline">.circ</span>
              </button>
            </div>
          </div>
        </div>

        {/* Top Control Bar: Tier 2 - Canvas Tools & Editing Operations (Strict non-jumping stable row) */}
        <div className={`px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2.5 text-xs transition-colors ${
          cadTheme === 'dark' ? 'bg-[#090D16] border-slate-800 text-slate-300' : 'bg-slate-50/95 border-slate-200 text-slate-700'
        }`}>
          {/* Left: History & Search */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Undo / Redo */}
            <div className={`flex items-center gap-0.5 p-0.5 rounded-xl border shadow-2xs ${
              cadTheme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
            }`}>
              <button
                onClick={handleUndo}
                disabled={historyStack.length === 0}
                className={`p-1.5 sm:px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors select-none ${
                  historyStack.length > 0
                    ? cadTheme === 'dark'
                      ? 'text-slate-200 hover:text-blue-400 hover:bg-slate-700 cursor-pointer'
                      : 'text-slate-700 hover:text-blue-700 hover:bg-slate-100 cursor-pointer'
                    : 'text-slate-400 opacity-40 cursor-not-allowed'
                }`}
                title="Geri Al (Ctrl + Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Geri</span>
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                className={`p-1.5 sm:px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors select-none ${
                  redoStack.length > 0
                    ? cadTheme === 'dark'
                      ? 'text-slate-200 hover:text-blue-400 hover:bg-slate-700 cursor-pointer'
                      : 'text-slate-700 hover:text-blue-700 hover:bg-slate-100 cursor-pointer'
                    : 'text-slate-400 opacity-40 cursor-not-allowed'
                }`}
                title="Yinele (Ctrl + Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">İleri</span>
              </button>
            </div>

            {/* Spotlight / Command Palette */}
            <button
              onClick={() => {
                setShowCommandPalette(true);
                setPaletteQuery('');
              }}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs border border-slate-700"
              title="Hızlı Bileşen Ara ve Ekle (Ctrl + K veya /)"
            >
              <Search className="w-3.5 h-3.5 text-blue-400" />
              <span>Bileşen Ara</span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.2 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-300">Ctrl+K</kbd>
            </button>

            {/* Contention Alert */}
            {hasConflictError && (
              <div className="px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 animate-pulse shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                <span>⚠ Kısa Devre!</span>
              </div>
            )}
          </div>

          {/* Center/Right: Canvas Display, Routing & Step 5 Theme Toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Wire Style: Orthogonal vs Bezier */}
            <button
              onClick={() => setWireStyle(wireStyle === 'orthogonal' ? 'bezier' : 'orthogonal')}
              className={`px-2.5 py-1 rounded-xl font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="Kablo Türü: Dik Açılı (Manhattan CAD) vs Eğik (Bezier)"
            >
              <Sliders className="w-3.5 h-3.5 text-blue-500" />
              <span>{wireStyle === 'orthogonal' ? 'Dik Açılı Hat' : 'Eğik Hat'}</span>
            </button>

            {/* Wire Bus Mode */}
            <button
              onClick={() => {
                setDefaultWireIsBus(!defaultWireIsBus);
                showToast(defaultWireIsBus ? 'Standart 1-Bit kablo modu aktif.' : '4-Bit Kalın Veri Yolu (Bus) modu aktif!');
              }}
              className={`px-2.5 py-1 rounded-xl font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                defaultWireIsBus
                  ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                  : cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="Kablo Tipi: 1-Bit Hat veya 4-Bit Kalın Veri Yolu"
            >
              <span className="font-mono font-black">{defaultWireIsBus ? '//4' : '1B'}</span>
              <span>{defaultWireIsBus ? '4-Bit Veri Yolu' : '1-Bit Kablo'}</span>
            </button>

            {/* Snap to Grid */}
            <button
              onClick={() => setSnapToGrid(!snapToGrid)}
              className={`px-2.5 py-1 rounded-xl font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                snapToGrid
                  ? cadTheme === 'dark'
                    ? 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
                  : 'bg-white hover:bg-slate-100 text-slate-500 border-slate-200'
              }`}
              title="10px Izgara Hizalama (Snap-to-Grid) Aç/Kapat"
            >
              <Grid className="w-3.5 h-3.5" />
              <span>{snapToGrid ? 'Izgara: 10px' : 'Izgara: Serbest'}</span>
            </button>

            {/* Step 5: CAD Engineering Theme Toggle (Açık vs Koyu CAD / Neon Hatlar) */}
            <button
              onClick={toggleCadTheme}
              className={`px-2.5 py-1 rounded-xl font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs select-none ${
                cadTheme === 'dark'
                  ? 'bg-amber-400/10 text-amber-300 border-amber-400/30 hover:bg-amber-400/20'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="CAD Görünüm Teması (5. Adım): Açık Klasik vs Koyu CAD (Neon Hatlar)"
            >
              {cadTheme === 'dark' ? <Moon className="w-3.5 h-3.5 text-amber-300" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
              <span>{cadTheme === 'dark' ? 'Koyu CAD' : 'Açık CAD'}</span>
            </button>

            {/* Annotation Buttons */}
            <div className={`flex items-center gap-0.5 p-0.5 rounded-xl border shadow-2xs ${
              cadTheme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
            }`}>
              <button
                onClick={() => handleAddAnnotation('frame')}
                className={`px-2 py-1 rounded-lg font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  cadTheme === 'dark' ? 'text-slate-300 hover:text-blue-400 hover:bg-slate-700' : 'text-slate-700 hover:text-blue-700 hover:bg-blue-50'
                }`}
                title="Gruplama Çerçevesi Ekle"
              >
                <Square className="w-3.5 h-3.5 text-blue-500" />
                <span className="hidden sm:inline">Çerçeve</span>
              </button>
              <button
                onClick={() => handleAddAnnotation('note')}
                className={`px-2 py-1 rounded-lg font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  cadTheme === 'dark' ? 'text-slate-300 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-700 hover:text-amber-700 hover:bg-amber-50'
                }`}
                title="Yapışkan Not Ekle"
              >
                <StickyNote className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Not</span>
              </button>
            </div>

            {/* Audio Mute/Unmute */}
            <button
              onClick={() => setIsSoundMuted(!isSoundMuted)}
              className={`p-1.5 sm:px-2.5 sm:py-1 rounded-xl font-semibold border flex items-center gap-1 cursor-pointer transition-colors shadow-2xs ${
                isSoundMuted
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  : cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={isSoundMuted ? 'Sesi Aç' : 'Sesi Kapat'}
            >
              {isSoundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-blue-500" />}
              <span className="hidden sm:inline">{isSoundMuted ? 'Sessiz' : 'Ses'}</span>
            </button>

            {/* Reset Canvas / Load Preset */}
            <button
              onClick={() => {
                if (selectedPresetId) handleLoadPreset(selectedPresetId);
                else handleClearCanvas();
              }}
              className={`px-2 py-1 rounded-xl font-semibold border flex items-center gap-1 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="Devreyi varsayılan haline döndür"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              <span className="hidden sm:inline">Sıfırla</span>
            </button>

            {/* Clear Canvas */}
            <button
              onClick={handleClearCanvas}
              className={`px-2 py-1 rounded-xl font-semibold border flex items-center gap-1 cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border-slate-700 hover:border-rose-800'
                  : 'bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border-slate-200 hover:border-rose-200'
              }`}
              title="Tuvaldeki tüm bileşen ve kabloları temizle"
            >
              <span>Temizle</span>
            </button>

            {/* Shortcuts Guide */}
            <button
              onClick={() => setShowShortcutsModal(true)}
              className={`p-1.5 rounded-xl border flex items-center justify-center cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="Klavye Kısayolları Rehberini Aç"
            >
              <Keyboard className="w-3.5 h-3.5 text-indigo-400" />
            </button>
          </div>
        </div>

        {/* Component Palette Bar (Add Components) - Fixed Height & Non-Jumping */}
        <div className={`px-4 py-2 border-b flex flex-col gap-1.5 select-none transition-colors ${
          cadTheme === 'dark' ? 'bg-[#0F172A] border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
        }`}>
          {/* Top row: Category Selector Tabs & Quick Search */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 shrink-0 mr-1">
                <Plus className="w-3.5 h-3.5 text-blue-500" /> Bileşenler:
              </span>

              {/* Category tabs */}
              {!paletteSearch.trim() && (
                <div className={`flex items-center gap-1 p-0.5 rounded-xl border text-xs shrink-0 ${
                  cadTheme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
                }`}>
                  {[
                    { id: 'gates' as const, label: 'Mantık Kapıları' },
                    { id: 'inputs' as const, label: 'Girişler' },
                    { id: 'outputs' as const, label: 'Göstergeler' },
                    { id: 'combinational' as const, label: 'Kombinasyonel' },
                    { id: 'sequential' as const, label: 'Ardışıl Mantık (FF)' },
                    { id: 'custom' as const, label: `Özel Entegreler (${customSubcircuits.length})` },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer focus:outline-none select-none whitespace-nowrap ${
                        activeCategory === cat.id
                          ? cadTheme === 'dark'
                            ? 'bg-blue-600 text-white font-bold shadow-xs'
                            : 'bg-white text-blue-700 shadow-2xs font-bold'
                          : cadTheme === 'dark'
                          ? 'text-slate-400 hover:text-slate-100'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Search Input */}
            <div className="relative shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Bileşen ara (alu, ram, nor, mux)..."
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
                className={`pl-8 pr-7 py-1 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500 w-44 sm:w-56 font-medium border ${
                  cadTheme === 'dark'
                    ? 'bg-slate-800/90 border-slate-700 text-slate-100 placeholder:text-slate-500'
                    : 'bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400'
                }`}
              />
              {paletteSearch && (
                <button
                  onClick={() => setPaletteSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Bottom row: Component Buttons in a strictly fixed-height, smooth horizontal track */}
          <div className="relative flex items-center w-full">
            {/* Scroll Left Button */}
            <button
              onClick={() => scrollPalette('left')}
              className={`shrink-0 w-6 h-8 mr-1 rounded-lg flex items-center justify-center cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
              title="Sola Kaydır"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {/* Scrollable Track - STRICT CONSTANT HEIGHT TO PREVENT CANVAS JUMPING */}
            <div
              ref={paletteScrollRef}
              onWheel={(e) => {
                if (e.deltaY !== 0 && paletteScrollRef.current) {
                  paletteScrollRef.current.scrollLeft += e.deltaY;
                }
              }}
              className="h-8 min-h-[32px] max-h-[32px] flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap w-full scroll-smooth py-0"
            >
              {activeCategory === 'custom' && !paletteSearch.trim() ? (
                <>
                  {/* Project Sheets that can be instantiated as ICs */}
                  {sheets.filter((s) => s.id !== activeSheetId).map((sheet) => (
                    <button
                      key={`sheet_btn_${sheet.id}`}
                      onClick={() => handleAddSheetAsSubcircuit(sheet)}
                      className="shrink-0 h-8 px-2.5 bg-indigo-900 hover:bg-indigo-800 text-white rounded-lg border border-indigo-700 hover:border-indigo-400 flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs whitespace-nowrap active:scale-95"
                      title={`"${sheet.name}" sayfasını bu sayfaya modüler entegre çip olarak yerleştirir`}
                    >
                      <span className="px-1 py-0.2 bg-indigo-500 text-white rounded text-[10px] font-mono font-bold">
                        SAYFA
                      </span>
                      <span className="text-xs font-bold text-indigo-100">{sheet.name}</span>
                      <Layers className="w-3 h-3 text-indigo-300" />
                    </button>
                  ))}

                  {customSubcircuits.map((sub) => (
                    <div
                      key={sub.id}
                      onClick={() => handleAddSubcircuit(sub)}
                      className="shrink-0 h-8 px-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg border border-slate-700 hover:border-blue-400 flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs group whitespace-nowrap active:scale-95"
                      title={`${sub.description} (${sub.ports.filter((p) => p.type === 'input').length} Giriş, ${sub.ports.filter((p) => p.type === 'output').length} Çıkış)`}
                    >
                      <span className="px-1 py-0.2 bg-blue-600/90 text-blue-100 rounded text-[10px] font-mono font-black">
                        {sub.chipCode || 'IC'}
                      </span>
                      <span className="text-xs font-bold text-slate-200">{sub.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {sub.ports.filter((p) => p.type === 'input').length}in/{sub.ports.filter((p) => p.type === 'output').length}out
                      </span>
                      {!sub.id.startsWith('sub_builtin_') && (
                        <button
                          onClick={(e) => handleDeleteSubcircuit(sub.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-400 text-slate-400 transition-opacity ml-1"
                          title="Entegreyi Sil"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setShowSubcircuitModal(true)}
                    className={`shrink-0 h-8 px-2.5 text-xs font-bold rounded-lg border border-dashed flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs whitespace-nowrap active:scale-95 ${
                      cadTheme === 'dark'
                        ? 'bg-blue-950/40 hover:bg-blue-900/60 text-blue-300 border-blue-700/60'
                        : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-300'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Yeni Devre Paketle</span>
                  </button>
                </>
              ) : (
                <>
                  {Object.values(COMPONENT_CATALOG)
                    .filter((meta) => {
                      if (meta.type === 'subcircuit') return false;
                      if (paletteSearch.trim()) {
                        const q = paletteSearch.toLowerCase();
                        return (
                          meta.name.toLowerCase().includes(q) ||
                          meta.type.toLowerCase().includes(q) ||
                          meta.description.toLowerCase().includes(q)
                        );
                      }
                      return meta.category === activeCategory;
                    })
                    .map((meta) => {
                      const compact = COMPACT_COMPONENT_NAMES[meta.type];
                      return (
                        <button
                          key={meta.type}
                          onClick={() => handleAddComponent(meta.type)}
                          className={`shrink-0 h-8 px-2.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs select-none whitespace-nowrap active:scale-95 ${
                            cadTheme === 'dark'
                              ? 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700 hover:border-blue-400'
                              : 'bg-slate-50 hover:bg-blue-50 text-slate-800 hover:text-blue-700 border-slate-200 hover:border-blue-300'
                          }`}
                          title={`${meta.name}: ${meta.description}`}
                        >
                          <span>{compact?.label || meta.name}</span>
                          {compact?.badge && (
                            <span className={`px-1 py-0.2 text-[10px] font-mono font-bold rounded ${
                              cadTheme === 'dark'
                                ? 'bg-slate-900 text-blue-400'
                                : 'bg-slate-200/80 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-700'
                            }`}>
                              {compact.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}

                  {/* Also include custom subcircuits in search matches if user types search query */}
                  {paletteSearch.trim() &&
                    customSubcircuits
                      .filter((sub) => {
                        const q = paletteSearch.toLowerCase();
                        return (
                          sub.name.toLowerCase().includes(q) ||
                          (sub.chipCode && sub.chipCode.toLowerCase().includes(q)) ||
                          sub.description.toLowerCase().includes(q)
                        );
                      })
                      .map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => handleAddSubcircuit(sub)}
                          className="shrink-0 h-8 px-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg border border-slate-700 flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs whitespace-nowrap active:scale-95"
                          title={sub.description}
                        >
                          <span className="px-1.5 py-0.2 bg-blue-600 text-white rounded text-[10px] font-mono font-bold">
                            {sub.chipCode}
                          </span>
                          <span className="text-xs font-bold">{sub.name}</span>
                        </button>
                      ))}
                </>
              )}
            </div>

            {/* Scroll Right Button */}
            <button
              onClick={() => scrollPalette('right')}
              className={`shrink-0 w-6 h-8 ml-1 rounded-lg flex items-center justify-center cursor-pointer transition-colors shadow-2xs ${
                cadTheme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
              title="Sağa Kaydır"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Multi-Sheet Project Workspace Tabs Header */}
        <div className={`border-b px-4 py-2 flex flex-wrap items-center justify-between gap-3 select-none transition-colors ${
          cadTheme === 'dark' ? 'bg-[#090D16] border-slate-800 text-slate-300' : 'bg-slate-100/90 border-slate-200 text-slate-600'
        }`}>
          {/* Left: Sheet Tabs List */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mr-1">
              <Layers className="w-3.5 h-3.5 text-blue-500" />
              Sayfalar:
            </span>

            {sheets.map((sheet) => {
              const isActive = sheet.id === activeSheetId;
              const isEditing = editingSheetId === sheet.id;

              return (
                <div
                  key={sheet.id}
                  onClick={() => !isEditing && handleSwitchSheet(sheet.id)}
                  className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all border ${
                    isActive
                      ? cadTheme === 'dark'
                        ? 'bg-slate-800 text-blue-400 border-blue-500/50 shadow-xs'
                        : 'bg-white text-blue-700 border-blue-300 shadow-xs'
                      : cadTheme === 'dark'
                      ? 'bg-slate-900/60 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                      : 'bg-slate-200/60 text-slate-600 border-slate-200/80 hover:bg-white hover:text-slate-800'
                  }`}
                >
                  <FileText className={`w-3.5 h-3.5 ${isActive ? 'text-blue-500' : 'text-slate-400'}`} />

                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingSheetName}
                      onChange={(e) => setEditingSheetName(e.target.value)}
                      onBlur={() => handleRenameSheet(sheet.id, editingSheetName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSheet(sheet.id, editingSheetName);
                        if (e.key === 'Escape') setEditingSheetId(null);
                      }}
                      className="px-1.5 py-0.5 bg-blue-50 border border-blue-400 rounded text-xs font-bold text-blue-900 outline-none w-28"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingSheetId(sheet.id);
                        setEditingSheetName(sheet.name);
                      }}
                      title="Çift tıklayarak yeniden adlandırın"
                      className="max-w-[120px] truncate"
                    >
                      {sheet.name}
                    </span>
                  )}

                  {/* Tab Actions */}
                  {isActive && !isEditing && (
                    <div className="flex items-center gap-1 ml-0.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSheetId(sheet.id);
                          setEditingSheetName(sheet.name);
                        }}
                        className="p-0.5 hover:text-blue-400 text-blue-300/80 rounded hover:bg-blue-500/10"
                        title="Sayfayı Yeniden Adlandır"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicateSheet(sheet.id);
                        }}
                        className="p-0.5 hover:text-blue-400 text-blue-300/80 rounded hover:bg-blue-500/10"
                        title="Sayfayı Çoğalt (Duplicate)"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {sheets.length > 1 && !isEditing && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSheet(sheet.id);
                      }}
                      className="p-0.5 hover:text-rose-400 text-slate-400 rounded hover:bg-rose-500/10 ml-0.5"
                      title="Sayfayı Sil"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}

            {/* Add New Sheet Button */}
            <button
              onClick={handleAddSheet}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-dashed transition-all cursor-pointer shadow-2xs ${
                cadTheme === 'dark'
                  ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-blue-400 border-slate-700 hover:border-blue-500'
                  : 'bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-700 border-slate-300 hover:border-blue-400'
              }`}
              title="Yeni Çalışma Sayfası Ekle"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Yeni Sayfa</span>
            </button>
          </div>

          {/* Right: Quick Sheet Controls & Stats */}
          <div className="flex items-center gap-3 text-xs font-medium text-slate-400">
            <div className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border shadow-2xs ${
              cadTheme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
            }`}>
              <span className={`font-mono font-bold ${cadTheme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>{components.length}</span>
              <span className="text-[11px] text-slate-400">kapı</span>
              <span className="text-slate-400 opacity-50">|</span>
              <span className={`font-mono font-bold ${cadTheme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>{wires.length}</span>
              <span className="text-[11px] text-slate-400">kablo</span>
            </div>

            {/* Wire Crossing Jumper Toggle */}
            
          </div>
        </div>

        {/* Interactive SVG Canvas */}
        <div
          ref={canvasContainerRef}
          className={`relative w-full overflow-hidden select-none transition-colors ${
            cadTheme === 'dark' ? 'bg-[#070A12]' : 'bg-slate-50/60'
          }`}
          style={{ minHeight: '560px' }}
        >
          {/* Floating Active Wiring Status Pill */}
          {wiringFrom && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-2.5 px-4 py-2 bg-blue-600/95 text-white rounded-full shadow-lg backdrop-blur-xs border border-blue-400/30 text-xs font-semibold animate-in fade-in slide-in-from-top-2">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />
              <span>Kablolama Aktif: Hedef pine tıklayın</span>
              <span className="text-blue-200 text-[11px] font-normal">(Köşe: Tuvale Tıkla | İptal: Sağ Tık / Esc)</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setWiringFrom(null);
                }}
                className="ml-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded-full text-[11px] font-bold text-white transition-colors cursor-pointer"
              >
                İptal
              </button>
            </div>
          )}

          <svg
            ref={svgRef}
            className={`w-full h-full ${
              draggingWireJoint
                ? 'cursor-ew-resize select-none'
                : isPanning
                ? 'cursor-grabbing'
                : isSpacePressedRef.current || canvasMode === 'pan'
                ? 'cursor-grab'
                : 'cursor-crosshair'
            }`}
            style={{ minHeight: '560px' }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onContextMenu={(e) => {
              e.preventDefault();
            }}
          >
            {/* SVG Filter & Gradient Definitions for Realistic Hardware */}
            <defs>
              {/* Canvas Background Grid */}
              <pattern id="gridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                {gridMode === 'lines' ? (
                  <>
                    {/* 10px minor grid lines for micro-alignment */}
                    <path
                      d="M 10 0 L 10 20 M 0 10 L 20 10"
                      fill="none"
                      stroke={cadTheme === 'dark' ? '#0d1322' : '#f1f5f9'}
                      strokeWidth="0.6"
                    />
                    {/* 20px major squared notebook (kareli defter) lines */}
                    <path
                      d="M 20 0 L 0 0 0 20"
                      fill="none"
                      stroke={cadTheme === 'dark' ? '#1e293b' : '#cbd5e1'}
                      strokeWidth="1"
                    />
                  </>
                ) : gridMode === 'dots' ? (
                  <>
                    {/* Dots placed strictly on square intersection corners */}
                    <circle cx="0" cy="0" r="1.3" fill={cadTheme === 'dark' ? '#334155' : '#94a3b8'} />
                    <circle cx="20" cy="0" r="1.3" fill={cadTheme === 'dark' ? '#334155' : '#94a3b8'} />
                    <circle cx="0" cy="20" r="1.3" fill={cadTheme === 'dark' ? '#334155' : '#94a3b8'} />
                    <circle cx="20" cy="20" r="1.3" fill={cadTheme === 'dark' ? '#334155' : '#94a3b8'} />
                  </>
                ) : null}
              </pattern>

              {/* Component Drop Shadow */}
              <filter id="gateShadow" x="-15%" y="-15%" width="130%" height="130%">
                <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#0f172a" floodOpacity={cadTheme === 'dark' ? 0.35 : 0.12} />
              </filter>

              {/* Logic Gate Gradient (clean acrylic white/slate in light mode, dark metallic slate in dark mode) */}
              <linearGradient id="gateGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={cadTheme === 'dark' ? '#1E293B' : '#ffffff'} />
                <stop offset="100%" stopColor={cadTheme === 'dark' ? '#0F172A' : '#f8fafc'} />
              </linearGradient>

              {/* Brushed Aluminum Faceplate */}
              <linearGradient id="metalPlate" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f1f5f9" />
                <stop offset="50%" stopColor="#e2e8f0" />
                <stop offset="100%" stopColor="#cbd5e1" />
              </linearGradient>

              {/* Chrome Bat Lever */}
              <linearGradient id="metalLever" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f8fafc" />
                <stop offset="35%" stopColor="#94a3b8" />
                <stop offset="70%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#475569" />
              </linearGradient>

              {/* Quartz Crystal Metallic Case */}
              <linearGradient id="crystalBody" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="30%" stopColor="#e2e8f0" />
                <stop offset="70%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>

              {/* DIP IC Molded Epoxy Body */}
              <linearGradient id="icBody" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="25%" stopColor="#0f172a" />
                <stop offset="85%" stopColor="#020617" />
                <stop offset="100%" stopColor="#0f172a" />
              </linearGradient>

              {/* DIP IC Tinned Silver Pins */}
              <linearGradient id="icPin" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#cbd5e1" />
                <stop offset="50%" stopColor="#f8fafc" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>

              {/* Off LED Dome Gradient (top-middle highlight for vertical stance) */}
              <radialGradient id="ledGradOff" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#f1f5f9" />
                <stop offset="60%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </radialGradient>

              {/* Green LED On Gradient & Glow Filter */}
              <radialGradient id="ledGradOnGreen" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#bbf7d0" />
                <stop offset="30%" stopColor="#4ade80" />
                <stop offset="75%" stopColor="#22c55e" />
                <stop offset="100%" stopColor="#15803d" />
              </radialGradient>
              <filter id="ledGlowGreen" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#22c55e" floodOpacity="0.8" />
              </filter>

              {/* Red LED On Gradient & Glow Filter */}
              <radialGradient id="ledGradOnRed" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#fecaca" />
                <stop offset="30%" stopColor="#f87171" />
                <stop offset="75%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#991b1b" />
              </radialGradient>
              <filter id="ledGlowRed" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#ef4444" floodOpacity="0.8" />
              </filter>

              {/* Blue LED On Gradient & Glow Filter */}
              <radialGradient id="ledGradOnBlue" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#bfdbfe" />
                <stop offset="30%" stopColor="#60a5fa" />
                <stop offset="75%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#1d4ed8" />
              </radialGradient>
              <filter id="ledGlowBlue" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#3b82f6" floodOpacity="0.8" />
              </filter>

              {/* Yellow LED On Gradient & Glow Filter */}
              <radialGradient id="ledGradOnYellow" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#fef08a" />
                <stop offset="30%" stopColor="#facc15" />
                <stop offset="75%" stopColor="#eab308" />
                <stop offset="100%" stopColor="#a16207" />
              </radialGradient>
              <filter id="ledGlowYellow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#eab308" floodOpacity="0.8" />
              </filter>
            </defs>

            {/* Transform Layer for Pan & Zoom Navigation */}
            <g transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoom})`}>
              {/* Extended Grid Background for Pan/Zoom */}
              <rect
                x={-10000}
                y={-10000}
                width={20000}
                height={20000}
                fill="url(#gridPattern)"
                onClick={() => {
                  if (didDragSelectionBoxRef.current) return;
                  if (wiringFrom) return;
                  setSelectedCompIds([]);
                  setSelectedWireIds([]);
                  setSelectedAnnotationId(null);
                }}
              />

            {/* Render Annotations: Grouping Frames & Sticky Notes */}
            {annotations.map((ann) => {
              const isSelected = selectedAnnotationId === ann.id;
              const isFrame = ann.type === 'frame';

              const colors = {
                blue: { border: '#3b82f6', bg: '#eff6ff', header: '#2563eb', text: '#1e40af' },
                emerald: { border: '#10b981', bg: '#ecfdf5', header: '#059669', text: '#065f46' },
                amber: { border: '#f59e0b', bg: '#fffbeb', header: '#d97706', text: '#92400e' },
                purple: { border: '#a855f7', bg: '#faf5ff', header: '#7c3aed', text: '#5b21b6' },
                rose: { border: '#f43f5e', bg: '#fff1f2', header: '#e11d48', text: '#9f1239' },
                slate: { border: '#64748b', bg: '#f8fafc', header: '#475569', text: '#1e293b' },
              }[ann.color || 'blue'];

              return (
                <g
                  key={ann.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedAnnotationId(ann.id);
                    setSelectedCompIds([]);
                    setSelectedWireIds([]);
                  }}
                  className="cursor-pointer group"
                >
                  {isFrame ? (
                    <>
                      {/* Bounding Box Frame */}
                      <rect
                        x={ann.x}
                        y={ann.y}
                        width={ann.width}
                        height={ann.height}
                        rx={14}
                        fill={colors.bg}
                        fillOpacity={0.4}
                        stroke={colors.border}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        strokeDasharray={isSelected ? undefined : '6,4'}
                      />
                      {/* Header Badge */}
                      <rect
                        x={ann.x}
                        y={ann.y}
                        width={Math.max(120, ann.title.length * 8 + 36)}
                        height={26}
                        rx={8}
                        fill={colors.header}
                      />
                      <text
                        x={ann.x + 12}
                        y={ann.y + 17}
                        fill="#ffffff"
                        fontSize={11}
                        fontWeight="bold"
                        fontFamily="sans-serif"
                        className="select-none"
                      >
                        {ann.title}
                      </text>
                    </>
                  ) : (
                    <>
                      {/* Sticky Note Card */}
                      <rect
                        x={ann.x}
                        y={ann.y}
                        width={ann.width}
                        height={ann.height}
                        rx={10}
                        fill={colors.bg}
                        stroke={colors.border}
                        strokeWidth={isSelected ? 2 : 1}
                        filter="drop-shadow(0 4px 6px rgba(0,0,0,0.06))"
                      />
                      <rect
                        x={ann.x}
                        y={ann.y}
                        width={ann.width}
                        height={22}
                        rx={10}
                        fill={colors.header}
                      />
                      <text
                        x={ann.x + 10}
                        y={ann.y + 15}
                        fill="#ffffff"
                        fontSize={10.5}
                        fontWeight="bold"
                        fontFamily="sans-serif"
                        className="select-none"
                      >
                        📌 {ann.title}
                      </text>
                      {ann.text && (
                        <text
                          x={ann.x + 10}
                          y={ann.y + 42}
                          fill={colors.text}
                          fontSize={11}
                          fontFamily="sans-serif"
                          className="select-none"
                        >
                          {ann.text.substring(0, 48)}
                        </text>
                      )}
                    </>
                  )}

                  {/* Delete Bubble: Always visible for easy one-click removal */}
                  <g
                    transform={`translate(${ann.x + ann.width - 14}, ${ann.y + 13})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAnnotation(ann.id);
                    }}
                    className="cursor-pointer hover:scale-110 transition-transform"
                    
                  >
                    <circle cx={0} cy={0} r={11} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />
                    <path d="M -3.5,-3.5 L 3.5,3.5 M 3.5,-3.5 L -3.5,3.5" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" />
                  </g>
                </g>
              );
            })}

            {/* Render Wires */}
            {wires.map((wire) => {
              const fromPin = findPinById(wire.fromPinId);
              const toPin = findPinById(wire.toPinId);
              if (!fromPin && !wire.branchPoint && !wire.startPoint) return null;
              if (!toPin && !wire.endPoint) return null;

              const isHigh = wire.value === 1;
              const isSelected = selectedWireIds.includes(wire.id);

              // Support mid-wire branching start point
              const startPt = getWireStartPt(wire);
              const endPt = toPin ? { x: toPin.x, y: toPin.y } : (wire.endPoint || startPt);

              // Wire Path: Strictly Manhattan 90°
              const defaultMidX = Math.round((startPt.x + endPt.x) / 2);
              const effectiveMidX = wire.elbowX !== undefined ? wire.elbowX : (wire.jointOffset !== undefined ? defaultMidX + wire.jointOffset : defaultMidX);

              // Anti-kink tolerance: If pins are horizontally or vertically aligned (within 4px), draw pure straight Manhattan line!
              const isStraightH = Math.abs(startPt.y - endPt.y) <= 4;
              const isStraightV = Math.abs(startPt.x - endPt.x) <= 4;

              let pathD: string;
              if (wire.waypoints && wire.waypoints.length > 0) {
                let d = `M ${startPt.x},${startPt.y}`;
                let prev = startPt;
                for (const pt of wire.waypoints) {
                  if (Math.abs(prev.x - pt.x) <= 3) {
                    d += ` V ${pt.y}`;
                  } else if (Math.abs(prev.y - pt.y) <= 3) {
                    d += ` H ${pt.x}`;
                  } else {
                    d += ` H ${pt.x} V ${pt.y}`;
                  }
                  prev = pt;
                }
                // Connect from last waypoint to endPt with 90° Manhattan step (NEVER diagonal!)
                if (Math.abs(prev.x - endPt.x) <= 3) {
                  d += ` V ${endPt.y}`;
                } else if (Math.abs(prev.y - endPt.y) <= 3) {
                  d += ` H ${endPt.x}`;
                } else {
                  const midX = Math.round((prev.x + endPt.x) / 2);
                  d += ` H ${midX} V ${endPt.y} H ${endPt.x}`;
                }
                pathD = d;
              } else if (isStraightH) {
                pathD = `M ${startPt.x},${startPt.y} L ${endPt.x},${startPt.y}`;
              } else if (isStraightV) {
                pathD = `M ${startPt.x},${startPt.y} L ${startPt.x},${endPt.y}`;
              } else {
                const midX = Math.round((startPt.x + endPt.x) / 2);
                pathD = `M ${startPt.x},${startPt.y} H ${midX} V ${endPt.y} H ${endPt.x}`;
              }
              const midX = isStraightH ? Math.round((startPt.x + endPt.x) / 2) : effectiveMidX;
              const midY = isStraightH ? startPt.y : Math.round((startPt.y + endPt.y) / 2);

              return (
                <g
                  key={wire.id}
                  onMouseEnter={() => setHoveredWireId(wire.id)}
                  onMouseLeave={() => setHoveredWireId(null)}
                  onClick={(e) => {
                    e.stopPropagation();

                    // Mid-Wire T-Junction Branching:
                    // If currently dragging from an input pin, tapping on this wire creates a branch connection!
                    if (wiringFrom) {
                        const tap = getClosestPointOnOrthogonalWire(startPt, endPt, mousePos, effectiveMidX, wire.waypoints);
                        connectBranchToWire(wire, tap);
                        return;
                      }

                    if (e.shiftKey) {
                      setSelectedWireIds((prev) =>
                        prev.includes(wire.id) ? prev.filter((id) => id !== wire.id) : [...prev, wire.id]
                      );
                    } else {
                      setSelectedWireIds([wire.id]);
                      setSelectedCompIds([]);
                    }
                  }}
                  className="cursor-pointer group"
                >
                  {/* Thick transparent hover hitbox (supports clicking or dragging from anywhere to branch) */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={20}
                    onMouseDown={(e) => {
                      if (e.button === 0 && !wiringFrom) {
                        e.stopPropagation();
                        // Select wire immediately on mousedown so drag handles appear reliably
                        if (!e.shiftKey) {
                          setSelectedWireIds([wire.id]);
                          setSelectedCompIds([]);
                        }
                        const tap = getClosestPointOnOrthogonalWire(startPt, endPt, mousePos, effectiveMidX, wire.waypoints);
                        wireDragStartRef.current = {
                          wireId: wire.id,
                          fromCompId: wire.fromCompId,
                          fromPinId: wire.fromPinId,
                          tap,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          didDrag: false,
                        };
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      const tap = getClosestPointOnOrthogonalWire(startPt, endPt, mousePos, effectiveMidX, wire.waypoints);
                      setWires((prev) =>
                        prev.map((w) => {
                          if (w.id === wire.id) {
                            const existing = w.waypoints || [];
                            return { ...w, waypoints: [...existing, tap] };
                          }
                          return w;
                        })
                      );
                      setSelectedWireIds([wire.id]);
                    }}
                    onMouseUp={(e) => {
                      if (wiringFrom) {
                        e.stopPropagation();
                        const tap = getClosestPointOnOrthogonalWire(startPt, endPt, mousePos, effectiveMidX, wire.waypoints);
                        connectBranchToWire(wire, tap);
                      }
                    }}
                  />
                  {/* Outer wire / glow if HIGH or SELECTED or CONFLICT */}
                  {wire.hasConflict ? (
                    <path
                      d={pathD}
                      fill="none"
                      stroke={cadTheme === 'dark' ? '#fb7185' : '#fca5a5'}
                      strokeWidth={wire.isBus ? 10 : 8}
                      opacity={cadTheme === 'dark' ? 0.85 : 0.8}
                      strokeLinecap="round"
                    />
                  ) : isSelected ? (
                    <path
                      d={pathD}
                      fill="none"
                      stroke={cadTheme === 'dark' ? '#38bdf8' : '#93c5fd'}
                      strokeWidth={wire.isBus ? 10 : 8}
                      opacity={cadTheme === 'dark' ? 0.85 : 0.8}
                      strokeLinecap="round"
                    />
                  ) : isHigh ? (
                    <path
                      d={pathD}
                      fill="none"
                      stroke={cadTheme === 'dark' ? '#4ade80' : '#86efac'}
                      strokeWidth={wire.isBus ? 9 : 7}
                      opacity={cadTheme === 'dark' ? 0.75 : 0.6}
                      strokeLinecap="round"
                    />
                  ) : null}
                  {/* Visible wire path */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={
                      wire.hasConflict
                        ? '#ef4444'
                        : isSelected
                        ? (cadTheme === 'dark' ? '#38bdf8' : '#2563eb')
                        : isHigh
                        ? (cadTheme === 'dark' ? '#22c55e' : '#16a34a')
                        : wire.isBus
                        ? (cadTheme === 'dark' ? '#06b6d4' : '#3b82f6')
                        : (cadTheme === 'dark' ? '#334155' : '#64748b')
                    }
                    strokeWidth={
                      wire.isBus
                        ? wire.hasConflict
                          ? 6
                          : isSelected
                          ? 6.5
                          : isHigh
                          ? 5.5
                          : 4.5
                        : wire.hasConflict
                        ? 3.5
                        : isSelected
                        ? 3.5
                        : isHigh
                        ? 3
                        : 2
                    }
                    strokeDasharray={wire.hasConflict ? '6,4' : isSelected ? '6,3' : undefined}
                    strokeLinecap="round"
                  />

                  {/* 4-Bit Bus Slash Badge */}
                  {wire.isBus && (
                    <g transform={`translate(${midX}, ${midY})`} className="pointer-events-none select-none">
                      <rect
                        x={-13}
                        y={-8}
                        width={26}
                        height={16}
                        rx={5}
                        fill="#0f172a"
                        stroke="#3b82f6"
                        strokeWidth={1}
                        filter="drop-shadow(0 2px 4px rgba(0,0,0,0.35))"
                      />
                      <text
                        x={0}
                        y={3.5}
                        textAnchor="middle"
                        fill="#60a5fa"
                        fontSize={8.5}
                        fontWeight="black"
                        fontFamily="monospace"
                      >
                        /4
                      </text>
                    </g>
                  )}

                  {/* Solder Junction Dot for Mid-Wire T-Junction - Strictly welded to startPt */}
                  {wire.branchPoint && (
                    <g className="pointer-events-none">
                      <circle
                        cx={startPt.x}
                        cy={startPt.y}
                        r={wire.isBus ? 6.5 : 5}
                        fill={wire.hasConflict ? '#ef4444' : isHigh ? '#16a34a' : (cadTheme === 'dark' ? '#94a3b8' : '#1e293b')}
                        stroke={cadTheme === 'dark' ? '#0f172a' : '#ffffff'}
                        strokeWidth={1.8}
                      />
                    </g>
                  )}

                  {/* Live Hover Tap Preview Indicator when wiring */}
                  {wiringFrom && hoveredWireId === wire.id && wire.id !== wiringFrom.sourceWireId && (() => {
                    const tap = getClosestPointOnOrthogonalWire(startPt, endPt, mousePos, effectiveMidX, wire.waypoints);
                    const dist = Math.hypot(mousePos.x - tap.x, mousePos.y - tap.y);
                    if (dist > 30) return null;
                    return (
                      <g className="pointer-events-none">
                        <circle cx={tap.x} cy={tap.y} r={6} fill="#3b82f6" opacity={0.3} />
                        <circle cx={tap.x} cy={tap.y} r={4} fill="#2563eb" stroke="#ffffff" strokeWidth={1.5} />
                      </g>
                    );
                  })()}

                                    {/* Free wire end terminal dot (Logisim open wire end) */}
                  {!toPin && wire.endPoint && (
                    <circle
                      cx={endPt.x}
                      cy={endPt.y}
                      r={5}
                      fill={isHigh ? '#16a34a' : '#2563eb'}
                      stroke="#ffffff"
                      strokeWidth={1.8}
                      className="cursor-pointer hover:scale-125 transition-transform"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setWiringFrom({
                          compId: wire.fromCompId,
                          pinId: wire.toPinId,
                          pinType: 'output',
                          x: endPt.x,
                          y: endPt.y,
                          sourceWireId: wire.id,
                        });
                      }}
                    >
                      <title>Kabloyu Buradan Uzat</title>
                    </circle>
                  )}

                  {/* Contention Warning Badge */}
                  {wire.hasConflict && (
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x={-46}
                        y={-12}
                        width={92}
                        height={24}
                        rx={6}
                        fill="#dc2626"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        filter="drop-shadow(0 2px 4px rgba(0,0,0,0.35))"
                      />
                      <text
                        x={0}
                        y={4}
                        fill="#ffffff"
                        fontSize={9.5}
                        fontWeight="bold"
                        textAnchor="middle"
                        className="select-none font-mono"
                      >
                        ⚠ ÇAKIŞMA!
                      </text>
                    </g>
                  )}

                  {/* Logisim-Style Dynamic Anywhere-Branching Indicator: Follows mouse cursor along wire */}
                  {hoveredWireId === wire.id && !wiringFrom && !draggingWireJoint && (() => {
                    const tap = getClosestPointOnOrthogonalWire(startPt, endPt, mousePos, effectiveMidX, wire.waypoints);
                    return (
                      <g
                        transform={`translate(${tap.x}, ${tap.y})`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setWiringFrom({
                            compId: wire.fromCompId,
                            pinId: wire.fromPinId,
                            pinType: 'output',
                            x: tap.x,
                            y: tap.y,
                            branchPoint: tap,
                            sourceWireId: wire.id,
                          });
                          setSelectedWireIds([]);
                        }}
                        className="cursor-pointer group/tapGlide"
                      >
                        <circle
                          cx={0}
                          cy={0}
                          r={10.5}
                          fill="#2563eb"
                          stroke="#ffffff"
                          strokeWidth={1.5}
                          filter="drop-shadow(0 2px 5px rgba(0,0,0,0.3))"
                        />
                        <path
                          d="M -3.5,0 L 3.5,0 M 0,-3.5 L 0,3.5"
                          stroke="#ffffff"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                        <title>Bu Noktadan Kablo Çek (T-Kavşak / Sürükle veya Tıkla)</title>
                      </g>
                    );
                  })()}

                  {/* Interactive Wire Drag Handles (Supports both 90° Manhattan and Waypoint Freeform) */}
                  {isSelected && !wiringFrom && (
                    <g>
                      {/* Case A: Wire with interactive waypoints */}
                      {wire.waypoints && wire.waypoints.length > 0 ? (
                        <g>
                          {wire.waypoints.map((pt, i) => (
                            <g
                              key={i}
                              transform={`translate(${pt.x}, ${pt.y})`}
                              className="cursor-move group/wp"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                draggingWireJointRef.current = { wireId: wire.id, type: 'waypoint', index: i };
                                setDraggingWireJoint({ wireId: wire.id, type: 'waypoint', index: i });
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setWires((prev) =>
                                  prev.map((w) => {
                                    if (w.id === wire.id && w.waypoints) {
                                      const nextWps = w.waypoints.filter((_, idx) => idx !== i);
                                      return { ...w, waypoints: nextWps.length > 0 ? nextWps : undefined };
                                    }
                                    return w;
                                  })
                                );
                              }}
                            >
                              <circle cx={0} cy={0} r={16} fill="#000000" fillOpacity={0} pointerEvents="all" />
                              <circle
                                cx={0}
                                cy={0}
                                r={6.5}
                                fill="#2563eb"
                                stroke="#ffffff"
                                strokeWidth={2}
                                filter="drop-shadow(0 2px 5px rgba(0,0,0,0.35))"
                                pointerEvents="none"
                              />
                              <circle cx={0} cy={0} r={2} fill="#ffffff" pointerEvents="none" />
                              <title>{`Köşe Noktası ${i + 1} (Sürükle, Çift tıkla kaldır)`}</title>
                            </g>
                          ))}
                        </g>
                      ) : (
                        /* Case B: Standard 90° Manhattan Wire Handles */
                        
                        <g>
                          {/* Midpoint Handle on vertical segment */}
                          <g
                            transform={`translate(${effectiveMidX}, ${midY})`}
                            className="cursor-ew-resize group/joint"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              draggingWireJointRef.current = { wireId: wire.id, type: 'segment' };
                              setDraggingWireJoint({ wireId: wire.id, type: 'segment' });
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setWires((prev) =>
                                prev.map((w) => (w.id === wire.id ? { ...w, elbowX: undefined, jointOffset: undefined } : w))
                              );
                            }}
                          >
                            <circle
                              cx={0}
                              cy={0}
                              r={18}
                              fill="#000000"
                              fillOpacity={0}
                              pointerEvents="all"
                            />
                            <circle
                              cx={0}
                              cy={0}
                              r={7}
                              fill="#2563eb"
                              stroke="#ffffff"
                              strokeWidth={2}
                              filter="drop-shadow(0 2px 5px rgba(0,0,0,0.35))"
                              pointerEvents="none"
                            />
                            <circle
                              cx={0}
                              cy={0}
                              r={2.5}
                              fill="#ffffff"
                              pointerEvents="none"
                            />
                            <title>Segmenti Yatay Taşı / Sürükle (Çift tıkla sıfırla)</title>
                          </g>

                          {/* Elbow Corner 1 (Top / Start corner) */}
                          <g
                            transform={`translate(${effectiveMidX}, ${startPt.y})`}
                            className="cursor-ew-resize group/corner1"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              draggingWireJointRef.current = { wireId: wire.id, type: 'corner1' };
                              setDraggingWireJoint({ wireId: wire.id, type: 'corner1' });
                            }}
                          >
                            <circle cx={0} cy={0} r={16} fill="#000000" fillOpacity={0} pointerEvents="all" />
                            <circle
                              cx={0}
                              cy={0}
                              r={5.5}
                              fill="#60a5fa"
                              stroke="#ffffff"
                              strokeWidth={1.5}
                              pointerEvents="none"
                            />
                            <title>Dirsek Köşesi 1 (Sürükle)</title>
                          </g>

                          {/* Elbow Corner 2 (Bottom / End corner) */}
                          <g
                            transform={`translate(${effectiveMidX}, ${endPt.y})`}
                            className="cursor-ew-resize group/corner2"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              draggingWireJointRef.current = { wireId: wire.id, type: 'corner2' };
                              setDraggingWireJoint({ wireId: wire.id, type: 'corner2' });
                            }}
                          >
                            <circle cx={0} cy={0} r={16} fill="#000000" fillOpacity={0} pointerEvents="all" />
                            <circle
                              cx={0}
                              cy={0}
                              r={5.5}
                              fill="#60a5fa"
                              stroke="#ffffff"
                              strokeWidth={1.5}
                              pointerEvents="none"
                            />
                            <title>Dirsek Köşesi 2 (Sürükle)</title>
                          </g>
                        </g>
                      )}
                    </g>
                  )}

                  {/* Selected Wire: Floating Action Toolbar Pill (Positioned cleanly 34px ABOVE midpoint with 18px clear air gap) */}
                  {isSelected && !wiringFrom && !draggingWireJoint && !draggingWireJointRef.current && (
                    <g
                      transform={`translate(${effectiveMidX}, ${midY < 55 ? midY + 34 : midY - 34})`}
                      className="select-none"
                    >
                      {/* Pill container shadow and background */}
                      <rect
                        x={-50}
                        y={-14}
                        width={100}
                        height={28}
                        rx={14}
                        fill={cadTheme === 'dark' ? '#0f172a' : '#ffffff'}
                        stroke={cadTheme === 'dark' ? '#334155' : '#cbd5e1'}
                        strokeWidth={1.5}
                        filter="drop-shadow(0 4px 8px rgba(0,0,0,0.25))"
                      />

                      {/* Action 1: Delete Wire Button */}
                      <g
                        transform="translate(-32, 0)"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSelected();
                        }}
                        className="cursor-pointer group/del"
                      >
                        <circle
                          cx={0}
                          cy={0}
                          r={9.5}
                          fill="#ef4444"
                          className="group-hover/del:opacity-80 transition-opacity"
                        />
                        <path
                          d="M -3,-3 L 3,3 M 3,-3 L -3,3"
                          stroke="#ffffff"
                          strokeWidth={1.8}
                          strokeLinecap="round"
                        />
                        <title>Kabloyu Sil (Del / Backspace)</title>
                      </g>

                      {/* Action 2: T-Junction Branch Wire Button */}
                      <g
                        transform="translate(-10, 0)"
                        onClick={(e) => {
                          e.stopPropagation();
                          const tap = getClosestPointOnOrthogonalWire(startPt, endPt, { x: effectiveMidX, y: midY }, effectiveMidX);
                          wiringStartTimeRef.current = Date.now();
                          setWiringFrom({
                            compId: wire.fromCompId,
                            pinId: wire.fromPinId,
                            pinType: 'output',
                            x: tap.x,
                            y: tap.y,
                            branchPoint: tap,
                            sourceWireId: wire.id,
                          });
                          setSelectedWireIds([]);
                        }}
                        className="cursor-pointer group/add"
                      >
                        <circle
                          cx={0}
                          cy={0}
                          r={9.5}
                          fill="#2563eb"
                          className="group-hover/add:opacity-80 transition-opacity"
                        />
                        <path
                          d="M -3.5,0 L 3.5,0 M 0,-3.5 L 0,3.5"
                          stroke="#ffffff"
                          strokeWidth={1.8}
                          strokeLinecap="round"
                        />
                        <title>Kablo Ortasından T-Kavşak Çıkar (Branch Wire)</title>
                      </g>

                      {/* Action 3: Add Corner Waypoint Button */}
                      <g
                        transform="translate(12, 0)"
                        onClick={(e) => {
                          e.stopPropagation();
                          const tap = getClosestPointOnOrthogonalWire(startPt, endPt, { x: effectiveMidX, y: midY }, effectiveMidX);
                          setWires((prev) =>
                            prev.map((w) => {
                              if (w.id === wire.id) {
                                const existing = w.waypoints || [];
                                return { ...w, waypoints: [...existing, tap] };
                              }
                              return w;
                            })
                          );
                        }}
                        className="cursor-pointer group/addwp"
                      >
                        <circle
                          cx={0}
                          cy={0}
                          r={9.5}
                          fill="#8b5cf6"
                          className="group-hover/addwp:opacity-80 transition-opacity"
                        />
                        <circle cx={0} cy={0} r={2.5} fill="#ffffff" />
                        <title>Köşe / Dirsek Noktası Ekle (Çift Tıklama ile de eklenebilir)</title>
                      </g>

                      {/* Action 4: Toggle Bus Width Mode Button */}
                      <g
                        transform="translate(34, 0)"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleWireBus(wire.id);
                        }}
                        className="cursor-pointer group/bus"
                      >
                        <circle
                          cx={0}
                          cy={0}
                          r={9.5}
                          fill={wire.isBus ? '#6366f1' : '#64748b'}
                          className="group-hover/bus:opacity-80 transition-opacity"
                        />
                        <text
                          x={0}
                          y={3.5}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize={8}
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {wire.isBus ? '1B' : '/4'}
                        </text>
                        <title>{wire.isBus ? '1-Bit Standart Kabloya Çevir' : '4-Bit Kalın Veri Yolu (Bus) Yap'}</title>
                      </g>
                    </g>
                  )}

                  {/* Floating Live Signal Tooltip on Hover */}
                  {hoveredWireId === wire.id && !isSelected && !wire.hasConflict && (
                    <g transform={`translate(${midX}, ${midY - 16})`} className="pointer-events-none select-none">
                      <rect
                        x={-52}
                        y={-10}
                        width={104}
                        height={20}
                        rx={5}
                        fill="#0f172a"
                        stroke="#334155"
                        strokeWidth={1}
                        filter="drop-shadow(0 2px 4px rgba(0,0,0,0.35))"
                      />
                      <circle cx={-40} cy={0} r={3} fill={isHigh ? '#22c55e' : '#94a3b8'} />
                      <text x={4} y={3.5} textAnchor="middle" fill="#ffffff" fontSize={8} fontWeight="bold" fontFamily="monospace">
                        {wire.isBus
                          ? isHigh
                            ? 'BUS · 0b1111 (0xF)'
                            : 'BUS · 0b0000 (0x0)'
                          : isHigh
                          ? '1 · 5V (HIGH)'
                          : '0 · 0V (LOW)'}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Dynamic Active Wire being drawn (supports Logisim interactive waypoints) */}
            {wiringFrom && (
              <g className="pointer-events-none">
                {/* Glow Underlay for Maximum Visibility */}
                <path
                  d={(() => {
                    const start = { x: wiringFrom.x, y: wiringFrom.y };
                    const current = mousePos;
                    if (wiringFrom.waypoints && wiringFrom.waypoints.length > 0) {
                      let d = `M ${start.x},${start.y}`;
                      for (const pt of wiringFrom.waypoints) {
                        d += ` L ${pt.x},${pt.y}`;
                      }
                      const lastPt = wiringFrom.waypoints[wiringFrom.waypoints.length - 1];
                      const midX = Math.round((lastPt.x + current.x) / 2);
                      d += ` H ${midX} V ${current.y} H ${current.x}`;
                      return d;
                    }
                    const midX = Math.round((start.x + current.x) / 2);
                    return `M ${start.x},${start.y} H ${midX} V ${current.y} H ${current.x}`;
                  })()}
                  fill="none"
                  stroke={cadTheme === 'dark' ? '#0284c7' : '#93c5fd'}
                  strokeWidth={6}
                  strokeOpacity={0.4}
                />
                {/* Main Active Wire Cable */}
                <path
                  d={(() => {
                    const start = { x: wiringFrom.x, y: wiringFrom.y };
                    const current = mousePos;
                    if (wiringFrom.waypoints && wiringFrom.waypoints.length > 0) {
                      let d = `M ${start.x},${start.y}`;
                      for (const pt of wiringFrom.waypoints) {
                        d += ` L ${pt.x},${pt.y}`;
                      }
                      const lastPt = wiringFrom.waypoints[wiringFrom.waypoints.length - 1];
                      const midX = Math.round((lastPt.x + current.x) / 2);
                      d += ` H ${midX} V ${current.y} H ${current.x}`;
                      return d;
                    }
                    const midX = Math.round((start.x + current.x) / 2);
                    return `M ${start.x},${start.y} H ${midX} V ${current.y} H ${current.x}`;
                  })()}
                  fill="none"
                  stroke={cadTheme === 'dark' ? '#38bdf8' : '#2563eb'}
                  strokeWidth={3}
                  strokeDasharray="6,4"
                />
                {/* Prominent Start Solder Dot */}
                <circle
                  cx={wiringFrom.x}
                  cy={wiringFrom.y}
                  r={6}
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                {/* Targeting Crosshair Cursor at Mouse Position */}
                <circle
                  cx={mousePos.x}
                  cy={mousePos.y}
                  r={8}
                  fill="none"
                  stroke={cadTheme === 'dark' ? '#38bdf8' : '#2563eb'}
                  strokeWidth={2}
                />
                <circle
                  cx={mousePos.x}
                  cy={mousePos.y}
                  r={2.5}
                  fill={cadTheme === 'dark' ? '#38bdf8' : '#2563eb'}
                />
                {/* Placed Interactive Waypoints */}
                {wiringFrom.waypoints?.map((pt, idx) => (
                  <circle
                    key={idx}
                    cx={pt.x}
                    cy={pt.y}
                    r={4.5}
                    fill="#2563eb"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                ))}
              </g>
            )}

            {/* Solder Junction Dots for Branching Output Pins */}
            {Array.from(pinWireCounts.entries()).map(([pinId, count]) => {
              if (count < 2) return null;
              const pin = findPinById(pinId);
              if (!pin) return null;
              return (
                <circle
                  key={`junc_${pinId}`}
                  cx={pin.x}
                  cy={pin.y}
                  r={5}
                  fill={pin.value === 1 ? '#16a34a' : '#475569'}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  className="pointer-events-none"
                />
              );
            })}

            {/* Render Components */}
            {components.map((comp) => {
              const meta = COMPONENT_CATALOG[comp.type];
              const isSelected = selectedCompIds.includes(comp.id);

              return (
                <g
                  key={comp.id}
                  transform={`translate(${comp.x}, ${comp.y})`}
                  onMouseDown={(e) => handleComponentMouseDown(e, comp)}
                  onDoubleClick={(e) => handleComponentDoubleClick(e, comp)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) {
                      setSelectedCompIds((prev) =>
                        prev.includes(comp.id) ? prev.filter((id) => id !== comp.id) : [...prev, comp.id]
                      );
                    } else {
                      if (!selectedCompIds.includes(comp.id)) {
                        setSelectedCompIds([comp.id]);
                        setSelectedWireIds([]);
                      }
                    }
                  }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  {/* Selection Indicator Box */}
                  {isSelected && (
                    <rect
                      x={-6}
                      y={-6}
                      width={meta.width + 12}
                      height={meta.height + 12}
                      rx={14}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      strokeDasharray="4,4"
                      className="pointer-events-none"
                    />
                  )}

                  {/* Component Shape Body with Rotation */}
                  <g transform={comp.rotation ? `rotate(${comp.rotation}, ${meta.width / 2}, ${meta.height / 2})` : undefined}>
                    {renderGateBody(comp)}
                  </g>

                  {/* Component Label Text with Alignment (Top, Bottom, Center, Hidden) */}
                  {comp.label && comp.state.labelPos !== 'hidden' && (
                    <text
                      x={meta.width / 2}
                      y={
                        comp.state.labelPos === 'top'
                          ? -10
                          : comp.state.labelPos === 'center'
                          ? meta.height / 2 + 4
                          : meta.height + 16
                      }
                      textAnchor="middle"
                      className="text-[10px] font-sans font-semibold fill-slate-500 select-none pointer-events-none"
                    >
                      {comp.label}
                    </text>
                  )}

                  {/* Input Pins */}
                  {comp.inputs.map((pin) => {
                    const isPinHigh = pin.value === 1;
                    const isValidTarget = wiringFrom && wiringFrom.pinId !== pin.id;

                    return (
                      <g
                        key={pin.id}
                        transform={`translate(${pin.x - comp.x}, ${pin.y - comp.y})`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          if (Date.now() - lastWireConnectedTimeRef.current < 400) {
                            return;
                          }
                          if (!wiringFrom && e.button === 0) {
                            wiringStartTimeRef.current = Date.now();
                            setWiringFrom({
                              compId: comp.id,
                              pinId: pin.id,
                              pinType: pin.type,
                              x: pin.x,
                              y: pin.y,
                            });
                            setSelectedCompIds([]);
                            setSelectedWireIds([]);
                          }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePinClick(e, comp, pin);
                        }}
                        onMouseUp={(e) => {
                          e.stopPropagation();
                          handlePinMouseUp(e, comp, pin);
                        }}
                        className="cursor-pointer group"
                      >
                        {/* Generous hover/hit target (prevents accidental misclicks on component body) */}
                        <circle cx={0} cy={0} r={14} fill="transparent" />
                        {/* Valid target indicator ring while wiring */}
                        {isValidTarget && (
                          <circle
                            cx={0}
                            cy={0}
                            r={9}
                            fill="rgba(34, 197, 94, 0.2)"
                            stroke="#22c55e"
                            strokeWidth={2}
                            className="animate-pulse"
                          />
                        )}
                        {/* Pin dot */}
                        <circle
                          cx={0}
                          cy={0}
                          r={4.5}
                          fill={isPinHigh ? '#16a34a' : '#64748b'}
                          stroke="#ffffff"
                          strokeWidth={1.5}
                          className="group-hover:scale-125 transition-transform"
                        />
                        {/* Pin label tooltip on hover */}
                        <title>{`${pin.name} (Giriş: ${pin.value})`}</title>
                      </g>
                    );
                  })}

                  {/* Output Pins */}
                  {comp.outputs.map((pin) => {
                    const isPinHigh = pin.value === 1;
                    const isValidTarget = wiringFrom && wiringFrom.pinId !== pin.id;

                    return (
                      <g
                        key={pin.id}
                        transform={`translate(${pin.x - comp.x}, ${pin.y - comp.y})`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          if (Date.now() - lastWireConnectedTimeRef.current < 400) {
                            return;
                          }
                          if (!wiringFrom && e.button === 0) {
                            wiringStartTimeRef.current = Date.now();
                            setWiringFrom({
                              compId: comp.id,
                              pinId: pin.id,
                              pinType: pin.type,
                              x: pin.x,
                              y: pin.y,
                            });
                            setSelectedCompIds([]);
                            setSelectedWireIds([]);
                          }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePinClick(e, comp, pin);
                        }}
                        onMouseUp={(e) => {
                          e.stopPropagation();
                          handlePinMouseUp(e, comp, pin);
                        }}
                        className="cursor-pointer group"
                      >
                        <circle cx={0} cy={0} r={14} fill="transparent" />
                        {isValidTarget && (
                          <circle
                            cx={0}
                            cy={0}
                            r={9}
                            fill="rgba(34, 197, 94, 0.2)"
                            stroke="#22c55e"
                            strokeWidth={2}
                            className="animate-pulse"
                          />
                        )}
                        <circle
                          cx={0}
                          cy={0}
                          r={4.5}
                          fill={isPinHigh ? '#16a34a' : '#64748b'}
                          stroke="#ffffff"
                          strokeWidth={1.5}
                          className="group-hover:scale-125 transition-transform"
                        />
                        <title>{`${pin.name} (Çıkış: ${pin.value})`}</title>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Box Selection Marquee */}
            {selectionBox && (
              <rect
                x={Math.min(selectionBox.startX, selectionBox.currentX)}
                y={Math.min(selectionBox.startY, selectionBox.currentY)}
                width={Math.abs(selectionBox.currentX - selectionBox.startX)}
                height={Math.abs(selectionBox.currentY - selectionBox.startY)}
                fill="rgba(59, 130, 246, 0.14)"
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="4,4"
                rx={3}
                className="pointer-events-none"
              />
            )}
            </g>
          </svg>

          {/* Centered Empty Canvas Watermark Overlay */}
          {components.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-center p-6 z-10 animate-in fade-in duration-200">
              <div className={`w-16 h-16 rounded-3xl border shadow-md flex items-center justify-center mb-4 backdrop-blur-xs ${
                cadTheme === 'dark'
                  ? 'bg-slate-900/90 border-slate-800 text-slate-500'
                  : 'bg-white/95 border-slate-200/90 text-slate-400'
              }`}>
                <Plus className="w-8 h-8 stroke-[2.5]" />
              </div>
              <h3 className={`font-extrabold text-base sm:text-lg tracking-tight font-sans mb-1.5 ${
                cadTheme === 'dark' ? 'text-slate-300' : 'text-slate-600'
              }`}>
                Tuval Boş · Tasarıma Başlayın
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md font-sans leading-relaxed">
                Yukarıdaki paletten mantık kapıları ekleyin veya hazır kitap şablonlarından birini seçin
              </p>
            </div>
          )}

          {/* Floating Component Properties Inspector Bar (Özellikler Paneli) */}
          {selectedCompIds.length === 1 && (() => {
            const selectedComp = components.find((c) => c.id === selectedCompIds[0]);
            if (!selectedComp) return null;
            const meta = COMPONENT_CATALOG[selectedComp.type];
            const isConfigurableGate =
              meta.category === 'gates' &&
              selectedComp.type !== 'not' &&
              selectedComp.type !== 'triState';
            const curInputCount = selectedComp.inputs.length;

            return (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-slate-900/90 hover:bg-slate-900 text-white px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-md border border-slate-700/80 flex items-center gap-3 text-xs animate-in fade-in slide-in-from-top-3 duration-150">
                {/* Component Name & Type Pill */}
                <div className="flex items-center gap-2 pr-2 border-r border-slate-700">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="font-extrabold text-slate-100 max-w-[140px] truncate">
                    {selectedComp.label || meta.name}
                  </span>
                </div>

                {/* Gate Input Count Selector (2, 3, 4, 5 Giriş) */}
                {isConfigurableGate && (
                  <div className="flex items-center gap-1.5 pr-2 border-r border-slate-700">
                    <span className="text-slate-400 font-semibold text-[11px]">Giriş:</span>
                    {[2, 3, 4, 5].map((cnt) => (
                      <button
                        key={cnt}
                        onClick={() => handleChangeGateInputs(selectedComp.id, cnt, true)}
                        className={`px-2 py-0.5 rounded-lg font-mono font-bold text-[11px] cursor-pointer transition-colors ${
                          curInputCount === cnt
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                        }`}
                        title={`${cnt} Girişli Yap`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                )}

                {/* LED Color Picker */}
                {selectedComp.type === 'led' && (
                  <div className="flex items-center gap-1.5 pr-2 border-r border-slate-700">
                    <span className="text-slate-400 font-semibold text-[11px]">Renk:</span>
                    {(['green', 'red', 'blue', 'yellow'] as const).map((col) => (
                      <button
                        key={col}
                        onClick={() => {
                          recordHistory();
                          setComponents((prev) =>
                            prev.map((c) => (c.id === selectedComp.id ? { ...c, state: { ...c.state, ledColor: col } } : c))
                          );
                        }}
                        className={`w-4 h-4 rounded-full border transition-transform ${
                          (selectedComp.state.ledColor || 'green') === col ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                        } ${
                          col === 'green' ? 'bg-emerald-500 border-emerald-400' :
                          col === 'red' ? 'bg-rose-500 border-rose-400' :
                          col === 'blue' ? 'bg-blue-500 border-blue-400' : 'bg-amber-400 border-amber-300'
                        }`}
                        title={`${col.toUpperCase()} Renk`}
                      />
                    ))}
                  </div>
                )}

                {/* Clock Frequency Switcher */}
                {selectedComp.type === 'clock' && (
                  <div className="flex items-center gap-1.5 pr-2 border-r border-slate-700">
                    <span className="text-slate-400 font-semibold text-[11px]">Hız:</span>
                    {[0.5, 1, 2, 4, 6, 8].map((hz) => (
                      <button
                        key={hz}
                        onClick={() => {
                          recordHistory();
                          setComponents((prev) =>
                            prev.map((c) => (c.id === selectedComp.id ? { ...c, state: { ...c.state, frequencyHz: hz } } : c))
                          );
                        }}
                        className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] cursor-pointer transition-colors outline-none focus:outline-none focus:ring-0 focus-visible:outline-none select-none ${
                          (selectedComp.state.frequencyHz || 1) === hz ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {hz}Hz
                      </button>
                    ))}
                  </div>
                )}

                {/* Actions: Rename, Rotate, Duplicate, Delete */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleOpenRename}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer transition-colors"
                    title="Yeniden Adlandır / Etiket Değiştir"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleRotateSelected}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer transition-colors"
                    title="90° Döndür (R)"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleDuplicateSelected}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer transition-colors"
                    title="Çoğalt (Ctrl+D / Ctrl+C)"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleDeleteSelected}
                    className="p-1.5 rounded-lg hover:bg-rose-950/60 text-rose-400 hover:text-rose-200 cursor-pointer transition-colors"
                    title="Sil (Delete)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Multi-Selection Group Action Bar */}
          {selectedCompIds.length > 1 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-slate-900/95 text-white px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-md border border-slate-700/80 flex items-center gap-3 text-xs animate-in fade-in slide-in-from-top-3 duration-150">
              <div className="flex items-center gap-2 pr-3 border-r border-slate-700">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-extrabold text-slate-100">{selectedCompIds.length} Bileşen Seçildi</span>
                {selectedWireIds.length > 0 && (
                  <span className="text-slate-400 text-[11px]">({selectedWireIds.length} kablo)</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleRotateSelected}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer transition-colors text-xs font-semibold"
                  title="Seçilenleri 90° Döndür (R)"
                >
                  <RotateCw className="w-3.5 h-3.5 text-blue-400" />
                  <span>Döndür (R)</span>
                </button>
                <button
                  onClick={handleDuplicateSelected}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer transition-colors text-xs font-semibold"
                  title="Seçilen Grubu Çoğalt (Ctrl+D)"
                >
                  <Copy className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Çoğalt</span>
                </button>
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white cursor-pointer transition-colors text-xs font-semibold shadow-xs"
                  title="Seçilenleri Sil (Delete / Backspace)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Toplu Sil</span>
                </button>
              </div>
            </div>
          )}

          {/* Keyboard Shortcuts Trigger Button */}
          <button
            onClick={() => setShowShortcutsModal(true)}
            className={`absolute bottom-4 left-4 z-20 backdrop-blur-md px-3.5 py-2 rounded-2xl border text-xs shadow-md flex items-center gap-2 cursor-pointer transition-all hover:scale-105 active:scale-95 group ${
              cadTheme === 'dark'
                ? 'bg-slate-900/90 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                : 'bg-white/95 hover:bg-slate-50 border-slate-200 text-slate-700 hover:text-slate-900'
            }`}
            title="Tüm Klavye Kısayolları ve Kontroller Rehberini Aç"
          >
            <Keyboard className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xs">Kısayollar</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md border font-semibold ${
              cadTheme === 'dark'
                ? 'bg-slate-800 text-slate-400 border-slate-700'
                : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}>
              Rehber ↵
            </span>
          </button>

          {/* Floating Live Boolean Algebraic Expression HUD (Non-Jumping) */}
          {truthTableData?.booleanExpressions && Object.keys(truthTableData.booleanExpressions).length > 0 && (
            <div className={`absolute bottom-16 right-4 z-20 px-3.5 py-2 rounded-2xl shadow-xl backdrop-blur-md border flex items-center gap-2.5 text-xs animate-in fade-in select-none ${
              cadTheme === 'dark'
                ? 'bg-slate-900/95 border-slate-700 text-slate-200'
                : 'bg-white/95 border-indigo-200 text-indigo-950'
            }`}>
              <div className="flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wider text-indigo-500">
                <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                <span className="hidden sm:inline">Formül:</span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto max-w-[360px]">
                {Object.entries(truthTableData.booleanExpressions).map(([name, expr]) => (
                  <div
                    key={name}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border font-mono text-[11px] ${
                      cadTheme === 'dark'
                        ? 'bg-slate-800 border-slate-700 text-cyan-300'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-900'
                    }`}
                  >
                    <span className="font-extrabold">{name}</span>
                    <span className="opacity-50">=</span>
                    <span className="font-black">{expr}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowTruthTable(true)}
                className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-400 hover:underline cursor-pointer ml-1"
                title="Doğruluk Tablosunu İncele"
              >
                Tablo →
              </button>
            </div>
          )}

                    

                    {/* Floating Clear Canvas Button (Canvas Top-Right) */}
          <button
            onClick={() => setShowClearConfirmModal(true)}
            className={`absolute top-4 right-4 z-20 backdrop-blur-md px-3.5 py-1.5 rounded-2xl border text-xs shadow-md flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105 active:scale-95 font-bold ${
              cadTheme === 'dark'
                ? 'bg-rose-950/80 hover:bg-rose-900 border-rose-800 text-rose-300 hover:text-white'
                : 'bg-white/95 hover:bg-rose-50 border-rose-200 text-rose-600 hover:text-rose-700 shadow-sm'
            }`}
            title="Tüm devreyi temizle"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span>Temizle</span>
          </button>

          {/* Floating Zoom & Pan Navigation Controls */}
          <div className={`absolute bottom-4 right-4 backdrop-blur-md px-2 py-1.5 rounded-2xl border text-xs shadow-md flex items-center gap-1.5 select-none transition-colors ${
            cadTheme === 'dark' ? 'bg-slate-900/95 border-slate-800 text-slate-300' : 'bg-white/95 border-slate-200 text-slate-700'
          }`}>
            {/* Tool Mode: Selection (Arrow) vs Hand / Pan Tool (Hand) */}
            <div className={`flex items-center gap-0.5 p-0.5 rounded-xl border ${
              cadTheme === 'dark' ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-100 border-slate-200'
            }`}>
              <button
                onClick={() => setCanvasMode('select')}
                className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                  canvasMode === 'select'
                    ? 'bg-blue-600 text-white shadow-2xs font-bold'
                    : cadTheme === 'dark'
                    ? 'text-slate-400 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Seçim Modu (Bileşenleri seçin veya taşıyın)"
              >
                <MousePointer className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCanvasMode('pan')}
                className={`p-1.5 rounded-lg cursor-pointer transition-colors flex items-center gap-1 ${
                  canvasMode === 'pan'
                    ? 'bg-blue-600 text-white shadow-2xs font-bold'
                    : cadTheme === 'dark'
                    ? 'text-slate-400 hover:text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Tuvali Kaydır / El Aracı (Sol tıkla veya Sağ tıkla sürükleyin)"
              >
                <Hand className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold hidden sm:inline">Kaydır</span>
              </button>
            </div>
            <div className={`w-[1px] h-4 mx-0.5 ${cadTheme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />

            <button
              onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(2))))}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                cadTheme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
              title="Uzaklaştır (Büyüteç - veya Ctrl + Tekerlek)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className={`font-mono font-bold text-[11px] px-1 min-w-[42px] text-center ${
              cadTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'
            }`}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.1).toFixed(2))))}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                cadTheme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
              title="Yakınlaştır (Büyüteç + veya Ctrl + Tekerlek)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <div className={`w-[1px] h-4 mx-0.5 ${cadTheme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />
            <button
              onClick={handleResetView}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                cadTheme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
              title="Görünümü Sıfırla (100% ve Merkez)"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <div className={`w-[1px] h-4 mx-0.5 ${cadTheme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />
            <button
              onClick={() => setGridMode((m) => (m === 'dots' ? 'lines' : m === 'lines' ? 'clean' : 'dots'))}
              className={`px-2 py-1 rounded-lg font-mono font-bold text-[10px] cursor-pointer transition-colors flex items-center gap-1 ${
                cadTheme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-blue-400' : 'hover:bg-slate-100 text-slate-600 hover:text-indigo-600'
              }`}
              title={`Tuval Deseni: ${gridMode === 'dots' ? 'Noktalı' : gridMode === 'lines' ? 'Kareli' : 'Düz'}`}
            >
              <span>{gridMode === 'dots' ? '• Nokta' : gridMode === 'lines' ? '▦ Kare' : '◻ Düz'}</span>
            </button>
          </div>
        </div>

        {/* Live Logic Analyzer / Truth Bar */}
        <div className={`p-5 border-t flex flex-wrap items-center justify-between gap-4 text-xs transition-colors ${
          cadTheme === 'dark' ? 'bg-[#090D16] border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <div className="flex items-center gap-6">
            {/* Inputs live status */}
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-500 uppercase tracking-wider">Canlı Girişler:</span>
              <div className="flex items-center gap-1.5 font-mono">
                {canvasSummary.inputs.length === 0 ? (
                  <span className="text-slate-400">Giriş yok</span>
                ) : (
                  canvasSummary.inputs.map((inp) => (
                    <span
                      key={inp.id}
                      className={`px-2 py-0.5 rounded-md font-bold text-xs ${
                        inp.state.on ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {inp.label || inp.id}: {inp.state.on ? '1' : '0'}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Outputs live status */}
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-500 uppercase tracking-wider">Canlı Çıkışlar:</span>
              <div className="flex items-center gap-1.5 font-mono">
                {canvasSummary.outputs.length === 0 ? (
                  <span className="text-slate-400">Çıkış yok</span>
                ) : (
                  canvasSummary.outputs.map((out) => {
                    const isHigh = out.inputs[0]?.value === 1;
                    return (
                      <span
                        key={out.id}
                        className={`px-2 py-0.5 rounded-md font-bold text-xs ${
                          isHigh ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {out.label || out.id}: {isHigh ? '1' : '0'}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="text-slate-500 font-mono text-[11px]">
            Bileşen Sayısı: <strong>{components.length}</strong> • Kablo Sayısı: <strong>{wires.length}</strong> • Adım: <strong>{stepCount}</strong>
          </div>
        </div>
      </div>

      {/* Digital Timing Diagram / Oscilloscope Panel (Timing Scope) */}
      {showWaveform && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-slate-100 shadow-xl space-y-4 animate-in fade-in slide-in-from-top-4 duration-200">
          {/* Header & Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan-950/80 text-cyan-400 rounded-xl border border-cyan-800/60 shadow-2xs">
                <Activity className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-sm sm:text-base text-white tracking-wide">
                    Sayısal Mantık Analizörü & Zamanlama Diyagramı
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                    {isWaveformPaused ? 'DURAKLATILDI' : 'CANLI ÇALIŞIYOR'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Devredeki saat (CLK), anahtar (SW), flip-flop ve çıkış sinyallerinin zaman içindeki mantık dalga şekilleri
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsWaveformPaused(!isWaveformPaused)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors ${
                  isWaveformPaused
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                {isWaveformPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{isWaveformPaused ? 'Örneklemeyi Sürdür' : 'Duraklat'}</span>
              </button>

              <button
                onClick={() => setWaveformSamples([])}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Tüm dalga şekli örneklerini temizle"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Temizle</span>
              </button>

              <button
                onClick={handleExportVCD}
                className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 hover:text-white rounded-xl text-xs font-semibold border border-cyan-800 flex items-center gap-1.5 cursor-pointer transition-colors"
                title="GTKWave ve ModelSim ile tam uyumlu VCD zamanlama döküm dosyasını indir"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>VCD İndir (GTKWave)</span>
              </button>

              <button
                onClick={() => setShowWaveform(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                title="Paneli Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scope Traces Screen */}
          {observableChannels.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-mono">
              Tuval üzerinde izlenecek aktif giriş veya çıkış elemanı (Anahtar, Saat, LED, Prob vb.) bulunamadı.
            </div>
          ) : (
            <div className="overflow-x-auto space-y-3 pb-2">
              {observableChannels.map((channel) => {
                const sampleCount = waveformSamples.length;
                const slotWidth = 24;
                const svgWidth = Math.max(720, sampleCount * slotWidth + 40);
                const svgHeight = 36;
                const yHigh = 6;
                const yLow = 28;

                // Build step path
                let pathD = '';
                let areaD = '';
                if (sampleCount > 0) {
                  const firstVal = waveformSamples[0].values[channel.key] ?? 0;
                  const firstY = firstVal === 1 ? yHigh : yLow;
                  pathD = `M 10,${firstY} H ${10 + slotWidth}`;
                  areaD = `M 10,${yLow} L 10,${firstY} H ${10 + slotWidth}`;

                  for (let i = 1; i < sampleCount; i++) {
                    const prevVal = waveformSamples[i - 1].values[channel.key] ?? 0;
                    const curVal = waveformSamples[i].values[channel.key] ?? 0;
                    const curY = curVal === 1 ? yHigh : yLow;
                    const x2 = 10 + (i + 1) * slotWidth;

                    if (curVal !== prevVal) {
                      pathD += ` V ${curY}`;
                      areaD += ` V ${curY}`;
                    }
                    pathD += ` H ${x2}`;
                    areaD += ` H ${x2}`;
                  }
                  const lastX = 10 + sampleCount * slotWidth;
                  areaD += ` L ${lastX},${yLow} Z`;
                }

                const lastSampleVal =
                  sampleCount > 0 ? waveformSamples[sampleCount - 1].values[channel.key] ?? 0 : 0;

                return (
                  <div
                    key={channel.key}
                    className="flex items-center gap-3 bg-slate-950/70 p-2.5 rounded-2xl border border-slate-800/80"
                  >
                    {/* Channel Label & Live Value Badge */}
                    <div className="w-36 shrink-0 flex items-center justify-between gap-2 border-r border-slate-800 pr-3">
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: channel.color }} />
                        <span className="font-mono text-xs font-bold text-slate-200 truncate" title={channel.name}>
                          {channel.name}
                        </span>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-extrabold shrink-0 ${
                          lastSampleVal === 1
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-slate-900 text-slate-500 border border-slate-800'
                        }`}
                      >
                        {lastSampleVal === 1 ? '1' : '0'}
                      </span>
                    </div>

                    {/* SVG Trace */}
                    <div className="flex-1 overflow-x-auto">
                      <svg width={svgWidth} height={svgHeight} className="block">
                        {/* Background timing grid lines */}
                        {Array.from({ length: Math.ceil(svgWidth / slotWidth) }).map((_, gIdx) => (
                          <line
                            key={gIdx}
                            x1={10 + gIdx * slotWidth}
                            y1={0}
                            x2={10 + gIdx * slotWidth}
                            y2={svgHeight}
                            stroke="#1e293b"
                            strokeWidth={1}
                            strokeDasharray="2,3"
                          />
                        ))}

                        {/* Baseline */}
                        <line x1={10} y1={yLow} x2={svgWidth - 10} y2={yLow} stroke="#334155" strokeWidth={1} />

                        {/* Waveform Fill Area */}
                        {areaD && <path d={areaD} fill={channel.color} opacity={0.15} />}

                        {/* Waveform Stroke Line */}
                        {pathD && (
                          <path
                            d={pathD}
                            fill="none"
                            stroke={channel.color}
                            strokeWidth={2.2}
                            strokeLinecap="square"
                            strokeLinejoin="miter"
                            filter="drop-shadow(0 0 3px rgba(6, 182, 212, 0.4))"
                          />
                        )}
                      </svg>
                    </div>
                  </div>
                );
              })}

              {/* Time axis scale at bottom */}
              <div className="flex items-center gap-3 pt-1 text-[10px] font-mono text-slate-500 pl-40">
                <span>← Zaman / Örnek Döngüsü (t₋ₙ → t₀)</span>
                <span>• Slot Genişliği: 24px/döngü</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Truth Table Modal */}
      {showTruthTable && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-700 rounded-2xl border border-blue-200">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-lg">Devre Analizörü (Circuit Analyzer)</h3>
                  <p className="text-xs text-slate-500">Doğruluk Tablosu, Boole Fonksiyonu ve Karnaugh Haritası (K-Map)</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Export CSV Button */}
                <button
                  onClick={handleExportTruthTableCSV}
                  className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                  title="Doğruluk Tablosunu CSV Dosyası Olarak İndir (Excel / Rapor)"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                  <span className="hidden sm:inline">CSV İndir</span>
                </button>

                {/* Tabs */}
                <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-xl text-xs font-semibold">
                  <button
                    onClick={() => setTruthModalTab('table')}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      truthModalTab === 'table' ? 'bg-white text-blue-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    📋 Doğruluk Tablosu
                  </button>
                  <button
                    onClick={() => setTruthModalTab('kmap')}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      truthModalTab === 'kmap' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🗺️ Karnaugh Haritası (K-Map)
                  </button>
                </div>
                <button
                  onClick={() => setShowTruthTable(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {!truthTableData || truthTableData.inputs.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm space-y-2">
                  <p className="font-semibold text-slate-700">Analiz üretilemedi</p>
                  <p>Doğruluk tablosu ve Karnaugh haritası oluşturmak için tuvalde en az 1 adet <strong>Giriş Anahtarı (Switch/Buton)</strong> ve 1 adet çıkış elemanı (LED, Prob vb.) bulunmalıdır.</p>
                </div>
              ) : truthModalTab === 'table' ? (
                <div className="space-y-4">
                  {/* Derived Boolean Expressions */}
                  {truthTableData.booleanExpressions && Object.keys(truthTableData.booleanExpressions).length > 0 && (
                    <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-2xl space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 uppercase tracking-wider">
                        <Cpu className="w-4 h-4 text-indigo-600" />
                        <span>Çıkarılan Boole Cebri İfadeleri (Boolean Logic Formula)</span>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {Object.entries(truthTableData.booleanExpressions).map(([outName, expr]) => (
                          <div
                            key={outName}
                            className="bg-white px-3 py-1.5 rounded-xl border border-indigo-200 shadow-2xs font-mono text-xs flex items-center gap-2"
                          >
                            <span className="font-bold text-indigo-700">{outName}</span>
                            <span className="text-slate-400">=</span>
                            <span className="font-extrabold text-slate-900 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                              {expr}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                    <table className="w-full text-center border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100/80 border-b border-slate-200">
                          {truthTableData.inputs.map((inp, idx) => (
                            <th key={idx} className="py-2.5 px-3 font-mono font-bold text-blue-700 border-r border-slate-200">
                              {inp.name}
                            </th>
                          ))}
                          {truthTableData.outputs.map((out, idx) => (
                            <th key={idx} className="py-2.5 px-3 font-mono font-bold text-emerald-700 border-r border-slate-200 last:border-r-0">
                              {out.name}
                            </th>
                          ))}
                          <th className="py-2.5 px-3 font-semibold text-slate-500">Durum</th>
                          <th className="py-2.5 px-2 font-semibold text-slate-500">Uygula</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {truthTableData.rows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={`transition-colors ${
                              row.isCurrentState ? 'bg-emerald-50/90 font-bold' : 'hover:bg-slate-50'
                            }`}
                          >
                            {row.inputValues.map((v, cIdx) => (
                              <td key={cIdx} className="py-2 px-3 border-r border-slate-100">
                                <span className={v === 1 ? 'text-blue-700 font-extrabold' : 'text-slate-400'}>
                                  {v}
                                </span>
                              </td>
                            ))}
                            {row.outputValues.map((v, cIdx) => (
                              <td key={cIdx} className="py-2 px-3 border-r border-slate-100 last:border-r-0">
                                <span className={v === 1 ? 'text-emerald-700 font-extrabold' : 'text-slate-400'}>
                                  {v}
                                </span>
                              </td>
                            ))}
                            <td className="py-2 px-3">
                              {row.isCurrentState ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-emerald-100 text-emerald-800">
                                  ● Canlı Aktif
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>
                            <td className="py-2 px-2">
                              <button
                                onClick={() => {
                                  handleApplyInputsFromKMap(row.inputValues.map((v) => (v === 1 ? 1 : 0)));
                                  showToast(`m${rIdx} (${row.inputValues.join('')}) durumu tuval anahtarlarına uygulandı!`);
                                }}
                                className="px-2 py-0.5 text-[10px] font-sans font-bold bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white rounded-md border border-blue-200 transition-colors cursor-pointer"
                                title="Bu giriş kombinasyonunu tuval anahtarlarına canlı uygula"
                              >
                                Dene →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-[11px] text-slate-500">
                    * Yeşil vurgulu satır, şu anda tuval üzerindeki anahtarların canlı durumunu temsil eder.
                  </p>
                </div>
              ) : (
                /* Karnaugh Map (K-Map) Tab */
                (() => {
                  const inputsCount = truthTableData.inputs.length;
                  const activeOut = truthTableData.outputs[kmapSelectedOutputIdx] || truthTableData.outputs[0];
                  if (!activeOut) return null;

                  if (inputsCount > 4) {
                    return (
                      <div className="p-8 text-center text-slate-600 text-sm space-y-2">
                        <p className="font-bold text-slate-800">Karnaugh Haritası Limiti</p>
                        <p>Karnaugh Haritası görsel indirgeme için en fazla 4 giriş (16 hücre) desteklenir. Devrenizde {inputsCount} giriş bulunmaktadır; tüm durumları 'Doğruluk Tablosu' sekmesinden görebilirsiniz.</p>
                      </div>
                    );
                  }

                  const GRAY_2 = [
                    { label: '00', vals: [0, 0] },
                    { label: '01', vals: [0, 1] },
                    { label: '11', vals: [1, 1] },
                    { label: '10', vals: [1, 0] },
                  ];

                  let rowDefs: { label: string; vals: number[] }[] = [];
                  let colDefs: { label: string; vals: number[] }[] = [];
                  let rowVarName = '';
                  let colVarName = '';

                  if (inputsCount === 1) {
                    rowVarName = truthTableData.inputs[0].name;
                    colVarName = '';
                    rowDefs = [{ label: '0', vals: [0] }, { label: '1', vals: [1] }];
                    colDefs = [{ label: '-', vals: [] }];
                  } else if (inputsCount === 2) {
                    rowVarName = truthTableData.inputs[0].name;
                    colVarName = truthTableData.inputs[1].name;
                    rowDefs = [{ label: '0', vals: [0] }, { label: '1', vals: [1] }];
                    colDefs = [{ label: '0', vals: [0] }, { label: '1', vals: [1] }];
                  } else if (inputsCount === 3) {
                    rowVarName = truthTableData.inputs[0].name;
                    colVarName = `${truthTableData.inputs[1].name}${truthTableData.inputs[2].name}`;
                    rowDefs = [{ label: '0', vals: [0] }, { label: '1', vals: [1] }];
                    colDefs = GRAY_2;
                  } else {
                    rowVarName = `${truthTableData.inputs[0].name}${truthTableData.inputs[1].name}`;
                    colVarName = `${truthTableData.inputs[2].name}${truthTableData.inputs[3].name}`;
                    rowDefs = GRAY_2;
                    colDefs = GRAY_2;
                  }

                  const minterms: number[] = [];
                  truthTableData.rows.forEach((row, rIdx) => {
                    if (row.outputValues[kmapSelectedOutputIdx] === 1) {
                      minterms.push(rIdx);
                    }
                  });

                  return (
                    <div className="space-y-5">
                      {/* Output switcher if multiple outputs */}
                      {truthTableData.outputs.length > 1 && (
                        <div className="flex items-center gap-2 flex-wrap bg-slate-50 p-2 rounded-2xl border border-slate-200">
                          <span className="text-xs font-bold text-slate-500 pl-1">İncelenen Çıkış:</span>
                          {truthTableData.outputs.map((out, idx) => (
                            <button
                              key={out.id}
                              onClick={() => setKmapSelectedOutputIdx(idx)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold cursor-pointer transition-colors ${
                                kmapSelectedOutputIdx === idx
                                  ? 'bg-indigo-600 text-white shadow-2xs'
                                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                              }`}
                            >
                              {out.name}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* K-Map Matrix Table */}
                      <div className="flex justify-center p-2">
                        <div className="inline-block border-2 border-slate-300 rounded-2xl overflow-hidden shadow-xs bg-white">
                          <table className="border-collapse text-center font-mono">
                            <thead>
                              <tr>
                                <th className="p-3 bg-slate-100 text-slate-700 text-xs font-extrabold border-b-2 border-r-2 border-slate-300">
                                  <span className="text-indigo-600">{rowVarName}</span> \ <span className="text-cyan-600">{colVarName}</span>
                                </th>
                                {colDefs.map((col, cIdx) => (
                                  <th key={cIdx} className="px-5 py-2.5 bg-slate-100 text-cyan-700 font-black text-xs border-b-2 border-r border-slate-200 last:border-r-0">
                                    {col.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rowDefs.map((row, rIdx) => (
                                <tr key={rIdx}>
                                  <td className="px-4 py-3 bg-slate-100 text-indigo-700 font-black text-xs border-b border-r-2 border-slate-300 last:border-b-0">
                                    {row.label}
                                  </td>
                                  {colDefs.map((col, cIdx) => {
                                    const combinedInputs = [...row.vals, ...col.vals];
                                    const matchingRow = truthTableData.rows.find((r) =>
                                      r.inputValues.slice(0, inputsCount).every((v, i) => v === combinedInputs[i])
                                    );
                                    const val = matchingRow ? matchingRow.outputValues[kmapSelectedOutputIdx] : 0;
                                    const isLiveActive = matchingRow ? matchingRow.isCurrentState : false;
                                    const mIndex = combinedInputs.reduce((acc, bit, idx) => acc + (bit ? Math.pow(2, inputsCount - 1 - idx) : 0), 0);

                                    return (
                                      <td
                                        key={cIdx}
                                        onClick={() => handleApplyInputsFromKMap(combinedInputs)}
                                        title={`Tıkla: Tuvaldeki anahtarları bu lojik kombinasyona ayarla (m${mIndex}: ${rowVarName}=${row.label}, ${colVarName}=${col.label})`}
                                        className={`relative px-7 py-5 border-b border-r border-slate-200 last:border-r-0 transition-all cursor-pointer hover:ring-2 hover:ring-indigo-400 hover:z-10 ${
                                          isLiveActive
                                            ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/70'
                                            : val === 1
                                            ? 'bg-emerald-50/80 hover:bg-emerald-100 font-black'
                                            : 'bg-white hover:bg-slate-50'
                                        }`}
                                      >
                                        <span className={`text-base font-black ${val === 1 ? 'text-emerald-600 font-black' : 'text-slate-300'}`}>
                                          {val}
                                        </span>
                                        <span className="absolute bottom-1 right-1.5 text-[9px] font-sans text-slate-400 select-none">
                                          m{mIndex}
                                        </span>
                                        {isLiveActive && (
                                          <span className="absolute top-1 left-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Educational SOP & Minimized Formula */}
                      <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 space-y-3 text-xs">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="font-bold text-indigo-950">Kanonik Çarpımlar Toplamı (Minterm SOP):</span>
                          <span className="font-mono font-bold text-indigo-700 bg-white px-2.5 py-1 rounded-lg border border-indigo-200 shadow-2xs">
                            {activeOut.name} = Σm({minterms.length > 0 ? minterms.join(', ') : '∅'})
                          </span>
                        </div>

                        {/* Minimal SOP via Quine-McCluskey / K-Map */}
                        {truthTableData.minimalExpressions?.[activeOut.name] && (
                          <div className="pt-2 border-t border-indigo-200/60 space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div>
                                <span className="font-extrabold text-indigo-950 block">Karnaugh / Quine-McCluskey Minimal Fonksiyon:</span>
                                <span className="text-[11px] text-slate-500">Matematiksel olarak indirgenmiş en sade Boole formülü</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-black text-indigo-900 bg-white px-3 py-1.5 rounded-xl border border-indigo-300 shadow-xs text-sm">
                                  {activeOut.name} = {truthTableData.minimalExpressions[activeOut.name].expression}
                                </span>
                                {truthTableData.minimalExpressions[activeOut.name].expression !== '0' &&
                                 truthTableData.minimalExpressions[activeOut.name].expression !== '1' && (
                                  <button
                                    onClick={() => {
                                      try {
                                        const expr = truthTableData.minimalExpressions![activeOut.name].expression;
                                        const synthesized = synthesizeCircuitFromBooleanExpression(expr);
                                        recordHistory();
                                        setComponents(synthesized.components);
                                        setWires(synthesized.wires);
                                        setSelectedCompIds([]);
                                        setSelectedWireIds([]);
                                        setShowTruthTable(false);
                                        playSwitchSound(true);
                                      } catch (err: any) {
                                        console.error('Synthesis error:', err);
                                      }
                                    }}
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-xs flex items-center gap-1.5"
                                    title="Bu sadeleştirilmiş fonksiyonu kapılarla otomatik tuvale çiz"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>Devreyi Sentezle</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Prime Implicants Badges */}
                            {truthTableData.minimalExpressions[activeOut.name].primeImplicants.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
                                <span className="font-bold text-slate-500">Asal Bileşenler (Prime Implicants):</span>
                                {truthTableData.minimalExpressions[activeOut.name].primeImplicants.map((pi, pIdx) => (
                                  <span
                                    key={pIdx}
                                    className="px-2 py-0.5 bg-white border border-indigo-200 text-indigo-800 rounded-lg font-mono font-bold text-[11px]"
                                  >
                                    {pi}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {truthTableData.booleanExpressions?.[activeOut.name] &&
                         truthTableData.booleanExpressions[activeOut.name] !== truthTableData.minimalExpressions?.[activeOut.name]?.expression && (
                          <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-indigo-200/50">
                            <span className="font-bold text-slate-600">Devre Fiziksel Yapı İfadesi:</span>
                            <span className="font-mono text-slate-700 bg-white/70 px-2 py-0.5 rounded-lg border border-slate-200 text-[11px]">
                              {activeOut.name} = {truthTableData.booleanExpressions[activeOut.name]}
                            </span>
                          </div>
                        )}

                        <p className="text-[11px] text-indigo-900/70 pt-1 leading-relaxed">
                          * Gray kodu sıralaması (00, 01, 11, 10) mantıksal olarak yalnızca 1 bit değişimi garanti eder. 1 olan komşu karelerin 2'nin katları (1, 2, 4, 8) boyutunda gruplanması minimum lojik kapı sentezini sağlar.
                        </p>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowTruthTable(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Component Label Modal */}
      {renameModalCompId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full border border-slate-200 shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-blue-600" />
                <span>Bileşeni Yeniden Adlandır</span>
              </h3>
              <button
                onClick={() => setRenameModalCompId(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Yeni Etiket / İsim:</label>
              <input
                type="text"
                value={renameInputVal}
                onChange={(e) => setRenameInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') setRenameModalCompId(null);
                }}
                autoFocus
                placeholder="Örn: Giriş A, CLK, Reset..."
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1.5">Etiket Konumu:</label>
              <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-semibold text-slate-600">
                {(['bottom', 'top', 'center', 'hidden'] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setRenameLabelPos(pos)}
                    className={`py-1 rounded-lg text-center font-medium cursor-pointer transition-colors ${
                      renameLabelPos === pos ? 'bg-white text-blue-600 shadow-xs font-bold' : 'hover:text-slate-900'
                    }`}
                  >
                    {pos === 'bottom' ? 'Alt' : pos === 'top' ? 'Üst' : pos === 'center' ? 'İç/Orta' : 'Gizle'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setRenameModalCompId(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                İptal
              </button>
              <button
                onClick={handleSaveRename}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-2xs"
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Boolean Logic Synthesizer Modal (Boole İfadesinden ve Doğruluk Tablosundan Otomatik Devre Üretici) */}
      {showSynthesizer && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-amber-500 text-white shadow-xs">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    Kombinasyonel Devre Analizi & Sentezleyicisi
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Boole fonksiyonundan veya doğruluk tablosundan otomatik mantık kapıları ve kablolama üretin.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSynthesizer(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3 gap-2">
              <button
                onClick={() => setSynthMode('expression')}
                className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
                  synthMode === 'expression'
                    ? 'border-amber-600 text-amber-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Boole İfadesi ile Sentez</span>
              </button>
              <button
                onClick={() => setSynthMode('truthTable')}
                className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
                  synthMode === 'truthTable'
                    ? 'border-amber-600 text-amber-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>Doğruluk Tablosu & K-Map Sentezi</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {synthMode === 'expression' ? (
                <>
                  {/* Formula Input */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 block">
                      Boole Mantık Fonksiyonu:
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={synthExprInput}
                        onChange={(e) => {
                          setSynthExprInput(e.target.value);
                          if (synthError) setSynthError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRunSynthesizer();
                          if (e.key === 'Escape') setShowSynthesizer(false);
                        }}
                        placeholder="Örn: A * B + C' veya (A + B) * C"
                        autoFocus
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-mono font-bold text-slate-900 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-200/50 focus:outline-none transition-all shadow-inner"
                      />
                    </div>
                  </div>

                  {/* Quick Formula Preset Pills */}
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      Hızlı Örnek Şablonlar:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "F = A · B + C'", expr: "A * B + C'" },
                        { label: "Y = (A + B) · C'", expr: "(A + B) * C'" },
                        { label: "Sum = A ⊕ B ⊕ Cin", expr: "A ^ B ^ Cin" },
                        { label: "Carry = A·B + Cin·(A⊕B)", expr: "A * B + Cin * (A ^ B)" },
                        { label: "Majority = AB + BC + AC", expr: "A * B + B * C + A * C" },
                        { label: "XNOR = (A ⊕ B)'", expr: "(A ^ B)'" },
                      ].map((p, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setSynthExprInput(p.expr);
                            setSynthError(null);
                          }}
                          className="px-3 py-1.5 rounded-xl text-xs font-mono font-semibold bg-slate-100 hover:bg-amber-100 hover:text-amber-900 text-slate-700 border border-slate-200 hover:border-amber-300 transition-colors cursor-pointer"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Syntax Operator Reference */}
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs space-y-2">
                    <span className="font-bold text-slate-700 block">Desteklenen Operatörler:</span>
                    <div className="grid grid-cols-2 gap-2 text-slate-600 font-mono text-[11px]">
                      <div><strong className="text-slate-800">AND (VE):</strong> <code>*</code>, <code>&</code> veya <code>AB</code></div>
                      <div><strong className="text-slate-800">OR (VEYA):</strong> <code>+</code>, <code>|</code></div>
                      <div><strong className="text-slate-800">NOT (DEĞİL):</strong> <code>A'</code>, <code>!A</code>, <code>~A</code></div>
                      <div><strong className="text-slate-800">XOR (Özel VEYA):</strong> <code>^</code>, <code>⊕</code></div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Truth Table Config */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-700">Giriş Değişken Sayısı:</label>
                      <div className="flex gap-1.5">
                        {([2, 3, 4] as const).map((num) => (
                          <button
                            key={num}
                            onClick={() => {
                              setSynthVarsCount(num);
                              const total = Math.pow(2, num);
                              const nextVals: Record<number, LogicValue> = {};
                              for (let i = 0; i < total; i++) {
                                nextVals[i] = (synthTruthValues[i] ?? 0) as LogicValue;
                              }
                              setSynthTruthValues(nextVals);
                            }}
                            className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                              synthVarsCount === num
                                ? 'bg-amber-600 text-white'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            {num} Değişken ({['A, B', 'A, B, C', 'A, B, C, D'][num - 2]})
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Interactive Truth Table Grid */}
                    <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-2xl">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-100 sticky top-0 border-b border-slate-200 text-slate-700 font-mono text-[11px]">
                          <tr>
                            <th className="p-2 text-center w-12">m</th>
                            {['A', 'B', 'C', 'D'].slice(0, synthVarsCount).map((v) => (
                              <th key={v} className="p-2 text-center">{v}</th>
                            ))}
                            <th className="p-2 text-center font-bold text-amber-800 w-24">Çıkış F</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono">
                          {Array.from({ length: Math.pow(2, synthVarsCount) }).map((_, idx) => {
                            const bin = idx.toString(2).padStart(synthVarsCount, '0');
                            const val = synthTruthValues[idx] ?? 0;
                            return (
                              <tr key={idx} className="hover:bg-amber-50/40 transition-colors">
                                <td className="p-2 text-center text-slate-400 text-[10px]">m{idx}</td>
                                {bin.split('').map((bit, bIdx) => (
                                  <td key={bIdx} className="p-2 text-center text-slate-700 font-bold">{bit}</td>
                                ))}
                                <td className="p-1.5 text-center">
                                  <button
                                    onClick={() => {
                                      setSynthTruthValues((prev) => ({
                                        ...prev,
                                        [idx]: prev[idx] === 1 ? 0 : 1,
                                      }));
                                    }}
                                    className={`w-12 py-1 rounded-lg font-bold text-xs cursor-pointer transition-all ${
                                      val === 1
                                        ? 'bg-amber-500 text-white shadow-2xs font-black'
                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                    }`}
                                  >
                                    {val}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Live Solved K-Map Equation Preview */}
                    <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-2xl flex items-center justify-between gap-3">
                      <div>
                        <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
                          K-Map ile Sadeleştirilmiş Fonksiyon:
                        </span>
                        <span className="font-mono text-sm font-extrabold text-amber-950">
                          F = {liveSolvedKMap?.simplifiedSOP || '0'}
                        </span>
                      </div>
                      <span className="text-[10px] bg-white px-2.5 py-1 rounded-lg border border-amber-200 text-amber-700 font-mono font-bold shrink-0">
                        {Object.values(synthTruthValues).filter((v) => v === 1).length} Minterm
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* Common Synthesis Parameters (Gate Family & Placement) */}
              <div className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Gate Family Preference */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Kapı Mimarisi Tercihi:
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'standard' as const, label: 'Standart (AND-OR)' },
                      { id: 'nand' as const, label: 'Evrensel NAND' },
                      { id: 'nor' as const, label: 'Evrensel NOR' },
                    ].map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setSynthGateType(g.id)}
                        className={`p-2 rounded-xl text-center text-[10.5px] font-bold border transition-colors cursor-pointer ${
                          synthGateType === g.id
                            ? 'bg-amber-100 border-amber-400 text-amber-900 font-extrabold'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Placement Mode */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Tuval Yerleşim Şekli:
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'replace' as const, label: 'Tuvali Sıfırla & Çiz' },
                      { id: 'append' as const, label: 'Mevcut Devreye Ekle' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSynthPlacement(p.id)}
                        className={`p-2 rounded-xl text-center text-[10.5px] font-bold border transition-colors cursor-pointer ${
                          synthPlacement === p.id
                            ? 'bg-amber-100 border-amber-400 text-amber-900 font-extrabold'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {synthError && (
                <p className="text-xs font-semibold text-rose-600 flex items-center gap-1.5 bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                  <span>⚠</span>
                  <span>{synthError}</span>
                </p>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                {synthPlacement === 'replace'
                  ? '* Tuvaldeki mevcut devre temizlenip yeni devre yerleştirilir.'
                  : '* Yeni devre mevcut devrenin sağına bağlanarak eklenir.'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSynthesizer(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer transition-colors"
                >
                  İptal
                </button>
                <button
                  onClick={handleRunSynthesizer}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Devreyi Tuvale Sentezle</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Keyboard Shortcuts Guide Modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
                  <Keyboard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-base">Klavye Kısayolları Rehberi</h3>
                  <p className="text-xs text-slate-500">Sayısal Mantık Simülatöründe hızlı kullanım tuşları</p>
                </div>
              </div>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { key: 'Boşluk (Space)', desc: 'Simülasyonu Başlat / Duraklat' },
                  { key: 'F10 / Adım', desc: 'Sinyali 1 Adım İlerlet (Step)' },
                  { key: 'Delete / Backspace', desc: 'Seçili Bileşeni veya Kabloyu Sil' },
                  { key: 'Ctrl + Z', desc: 'Son İşlemi Geri Al (Undo)' },
                  { key: 'Ctrl + Y', desc: 'İleri Al (Redo)' },
                  { key: 'Ctrl + D', desc: 'Seçili Bileşenleri Çoğalt (Duplicate)' },
                  { key: 'R', desc: 'Seçili Bileşeni 90° Döndür' },
                  { key: 'Ctrl + C / V', desc: 'Kopyala / Yapıştır' },
                  { key: 'Shift + Tık', desc: 'Çoklu Bileşen / Kablo Seç' },
                  { key: 'Sol Tık + Sürükle', desc: 'Dikdörtgen Çoklu Seçim (Marquee)' },
                  { key: 'Sağ Tık veya ✋ El Aracı', desc: 'Tuvali Serbest Kaydır (Pan)' },
                  { key: 'Boşluk / Alt + Sürükle', desc: 'Tuvali Kaydırma Kısayolu' },
                  { key: '+ / -', desc: 'Tuval Yakınlaştır / Uzaklaştır' },
                  { key: '0', desc: 'Görünümü Varsayılan Boyuta Sıfırla' },
                  { key: 'Esc', desc: 'Tüm Seçimleri Temizle / Modalları Kapat' },
                  { key: 'Çift Tık', desc: 'Bileşeni / Göstergeyi Yeniden Adlandır' },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-600 font-medium">{item.desc}</span>
                    <kbd className="px-2 py-1 bg-white border border-slate-300 rounded-md font-mono text-[11px] font-bold text-slate-800 shadow-2xs whitespace-nowrap">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-blue-50/70 rounded-2xl border border-blue-200 text-blue-900 leading-relaxed text-[11.5px]">
                💡 <strong>İpucu:</strong> Tuval üzerindeki herhangi bir giriş anahtarına doğrudan tıklayarak 0 ile 1 arasında anında geçiş yapabilir, Karnaugh haritasındaki minterm hücrelerine tıklayarak anahtarları otomatik kurabilirsiniz.
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs"
              >
                Anladım
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IC Datasheets & Pinout Viewer Modal */}
      {showDatasheetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-5xl w-full h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-2xl shadow-xs">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
                    Entegre Bilgi Kartları & Bacak Şemaları (IC Datasheets)
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-mono font-bold rounded-full">
                      DIP Pinout
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Standart 74xx serisi sayısal mantık entegrelerinin pin konfigürasyonları ve çalışma tabloları
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDatasheetModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content: Left IC list, Right details */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left IC Selector List */}
              <div className="w-72 sm:w-80 border-r border-slate-200 bg-slate-50 flex flex-col shrink-0">
                <div className="p-3 border-b border-slate-200">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Entegre ara (örn. 74HC283, ALU, RAM)..."
                      value={datasheetSearch}
                      onChange={(e) => setDatasheetSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {IC_DATASHEETS.filter((ds) => {
                    if (!datasheetSearch.trim()) return true;
                    const q = datasheetSearch.toLowerCase();
                    return (
                      ds.code.toLowerCase().includes(q) ||
                      ds.name.toLowerCase().includes(q) ||
                      ds.category.toLowerCase().includes(q)
                    );
                  }).map((ds) => {
                    const isSelected = ds.id === selectedDatasheetId;
                    return (
                      <button
                        key={ds.id}
                        onClick={() => setSelectedDatasheetId(ds.id)}
                        className={`w-full text-left p-2.5 rounded-xl transition-all cursor-pointer border ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                            : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200/80'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`font-mono font-extrabold text-xs px-2 py-0.5 rounded-md ${
                              isSelected
                                ? 'bg-indigo-700/60 text-white'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {ds.code}
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
                              isSelected ? 'text-indigo-200' : 'text-slate-400'
                            }`}
                          >
                            {ds.category}
                          </span>
                        </div>
                        <p
                          className={`text-[11px] line-clamp-1 font-medium ${
                            isSelected ? 'text-indigo-100' : 'text-slate-600'
                          }`}
                        >
                          {ds.name}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right IC Details View */}
              {(() => {
                const activeDS =
                  IC_DATASHEETS.find((d) => d.id === selectedDatasheetId) || IC_DATASHEETS[0];
                const halfCount = Math.ceil(activeDS.pins.length / 2);
                const leftPins = activeDS.pins.slice(0, halfCount);
                // Right pins: in physical DIP ICs, pin N is top-right, down to N/2+1 at bottom-right
                const rightPins = activeDS.pins.slice(halfCount).reverse();

                return (
                  <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6 bg-white">
                    {/* Top Header Card */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-xl font-extrabold text-slate-900 font-mono tracking-tight">
                            {activeDS.code}
                          </h2>
                          <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-700 font-bold text-xs rounded-full">
                            {activeDS.packageType}
                          </span>
                          <span className="px-2.5 py-0.5 bg-slate-200/80 text-slate-700 font-semibold text-xs rounded-full">
                            {activeDS.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 font-medium">{activeDS.name}</p>
                      </div>

                      {activeDS.simulatorCompType && (
                        <button
                          onClick={() => {
                            if (activeDS.simulatorCompType) {
                              handleAddComponent(activeDS.simulatorCompType);
                              setShowDatasheetModal(false);
                            }
                          }}
                          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-2 transition-colors shrink-0"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Bu Entegreyi Tuvale Ekle</span>
                        </button>
                      )}
                    </div>

                    {/* Description */}
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-1.5">
                        Genel Tanım & Çalışma Prensibi
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                        {activeDS.description}
                      </p>
                    </div>

                    {/* DIP Pinout Diagram */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-indigo-600" />
                          <span>DIP Bacak Bağlantı Şeması (Pinout)</span>
                        </h4>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 font-medium">
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Giriş
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Çıkış
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Kontrol
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Besleme
                          </span>
                        </div>
                      </div>

                      {/* Realistic DIP Chip Package */}
                      <div className="p-4 bg-slate-900/5 rounded-2xl border border-slate-200/80 flex justify-center items-center overflow-x-auto">
                        <div className="flex items-stretch gap-1 sm:gap-2">
                          {/* Left Pin Rows */}
                          <div className="flex flex-col justify-around py-3 items-end">
                            {leftPins.map((p) => {
                              const badgeBg =
                                p.type === 'in'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                  : p.type === 'out'
                                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                                  : p.type === 'ctrl'
                                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                                  : 'bg-red-50 text-red-700 border-red-300';
                              return (
                                <div key={p.pin} className="flex items-center gap-1.5 sm:gap-2 h-7" title={`Pin ${p.pin} (${p.label}): ${p.desc}`}>
                                  <span className="text-[10px] font-mono text-slate-400 w-4 text-right shrink-0">
                                    {p.pin}
                                  </span>
                                  <span
                                    className={`w-16 sm:w-[68px] shrink-0 py-0.5 rounded font-mono font-bold text-[10px] sm:text-[11px] border shadow-2xs truncate text-center ${badgeBg}`}
                                  >
                                    {p.label}
                                  </span>
                                  <div className="w-3.5 sm:w-4 h-1 bg-slate-400 rounded-sm shrink-0" />
                                </div>
                              );
                            })}
                          </div>

                          {/* IC Body */}
                          <div className="w-36 sm:w-44 bg-slate-900 rounded-xl border-2 border-slate-700 shadow-xl py-4 px-3 flex flex-col items-center justify-between relative text-center shrink-0">
                            {/* Top Notch Cutout */}
                            <div className="w-8 h-4 bg-slate-200 rounded-b-full border-b-2 border-slate-700 mb-2 -mt-4 shadow-inner" />

                            <div className="my-auto space-y-1">
                              <p className="font-mono font-extrabold text-slate-100 text-sm tracking-wider">
                                {activeDS.code}
                              </p>
                              <p className="text-[8px] font-mono text-slate-400 tracking-widest uppercase">
                                {activeDS.packageType}
                              </p>
                              <p className="text-[8px] font-mono text-indigo-400 tracking-wider">
                                LOGICDESIGN IC
                              </p>
                            </div>

                            <div className="w-2 h-2 rounded-full bg-slate-600 mt-2" title="Pin 1 Orientation Dot" />
                          </div>

                          {/* Right Pin Rows */}
                          <div className="flex flex-col justify-around py-3 items-start">
                            {rightPins.map((p) => {
                              const badgeBg =
                                p.type === 'in'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                  : p.type === 'out'
                                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                                  : p.type === 'ctrl'
                                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                                  : 'bg-red-50 text-red-700 border-red-300';
                              return (
                                <div key={p.pin} className="flex items-center gap-1.5 sm:gap-2 h-7" title={`Pin ${p.pin} (${p.label}): ${p.desc}`}>
                                  <div className="w-3.5 sm:w-4 h-1 bg-slate-400 rounded-sm shrink-0" />
                                  <span
                                    className={`w-16 sm:w-[68px] shrink-0 py-0.5 rounded font-mono font-bold text-[10px] sm:text-[11px] border shadow-2xs truncate text-center ${badgeBg}`}
                                  >
                                    {p.label}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400 w-4 text-left shrink-0">
                                    {p.pin}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Pin Descriptions Table */}
                      <div className="mt-3 overflow-hidden border border-slate-200 rounded-2xl shadow-2xs">
                        <div className="px-4 py-2 bg-slate-100/70 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                          <span>Bacak Tanımları &amp; İşlevleri</span>
                          <span className="text-[10px] text-slate-400 font-normal">Toplam {activeDS.pins.length} Pin</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 bg-white max-h-48 overflow-y-auto">
                          <div className="divide-y divide-slate-100">
                            {leftPins.map((p) => (
                              <div key={p.pin} className="px-3.5 py-1.5 flex items-center gap-2.5 text-xs hover:bg-slate-50/80 transition-colors">
                                <span className="w-5 text-right font-mono text-[11px] text-slate-400 font-bold">{p.pin}</span>
                                <span className="font-mono font-bold text-[11px] text-slate-800 w-14 shrink-0">{p.label}</span>
                                <span className="text-[11px] text-slate-600 truncate flex-1" title={p.desc}>{p.desc}</span>
                              </div>
                            ))}
                          </div>
                          <div className="divide-y divide-slate-100">
                            {rightPins.map((p) => (
                              <div key={p.pin} className="px-3.5 py-1.5 flex items-center gap-2.5 text-xs hover:bg-slate-50/80 transition-colors">
                                <span className="w-5 text-right font-mono text-[11px] text-slate-400 font-bold">{p.pin}</span>
                                <span className="font-mono font-bold text-[11px] text-slate-800 w-14 shrink-0">{p.label}</span>
                                <span className="text-[11px] text-slate-600 truncate flex-1" title={p.desc}>{p.desc}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Truth Table / Function Table */}
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                        Doğruluk & Fonksiyon Tablosu
                      </h4>
                      <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-2xs">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                            <tr>
                              {activeDS.truthTableHeaders.map((head, i) => (
                                <th key={i} className="px-3.5 py-2 font-mono text-[11px]">
                                  {head}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                            {activeDS.truthTableRows.map((row, rIdx) => (
                              <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx} className="px-3.5 py-2 text-slate-700 whitespace-nowrap">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Key Features */}
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                        Temel Donanımsal Özellikler
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {activeDS.features.map((feat, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-2 text-xs text-slate-700"
                          >
                            <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            <span>{feat}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Application Notes */}
                    <div className="p-4 bg-indigo-50/70 border border-indigo-200/80 rounded-2xl text-xs text-indigo-900 leading-relaxed">
                      💡 <strong>Uygulama Notu:</strong> {activeDS.applicationNotes}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Toplam <strong>{IC_DATASHEETS.length}</strong> Entegre Veri Kartı Kayıtlı
              </span>
              <button
                onClick={() => setShowDatasheetModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subcircuit / Custom IC Packaging Modal */}
      {showSubcircuitModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-100 text-blue-700 rounded-2xl shadow-xs">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
                    Alt Devre (IC / Subcircuit) Paketleyici
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-mono font-bold rounded-full">
                      Custom Chip
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tuvaldeki mevcut mantık devrenizi bağımsız bir modül veya özel entegre olarak paketleyin
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSubcircuitModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {components.length === 0 ? (
                <div className="text-center py-12 px-4 space-y-3">
                  <div className="w-14 h-14 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto text-slate-400">
                    <Package className="w-7 h-7" />
                  </div>
                  <h4 className="font-bold text-slate-700 text-sm">Tuvalde Paketlenecek Devre Bulunamadı</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Özel bir entegre paketlemek için önce tuval üzerine mantık kapıları ve giriş/çıkış elemanları yerleştirin veya hazır şablonlardan birini yükleyin.
                  </p>
                </div>
              ) : (
                <>
                  {/* IC Configuration Fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Özel Entegre Kodu / Adı (IC Name)
                      </label>
                      <input
                        type="text"
                        value={subcircuitName}
                        onChange={(e) => setSubcircuitName(e.target.value.toUpperCase())}
                        placeholder="Örn: MY_ALU_4, CUSTOM_ADDER..."
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Açıklama / Fonksiyon Notu
                      </label>
                      <input
                        type="text"
                        value={subcircuitDesc}
                        onChange={(e) => setSubcircuitDesc(e.target.value)}
                        placeholder="Örn: 4-Bit Özel Mantık ve Toplama Bloğu"
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Circuit Analysis Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl text-center">
                      <div className="text-emerald-700 text-lg font-mono font-extrabold">
                        {subcircuitAnalysis.inputs.length}
                      </div>
                      <div className="text-[10.5px] font-bold text-emerald-800">Giriş Portu</div>
                      <div className="text-[9px] text-emerald-600">Anahtar / Saat / Tünel</div>
                    </div>
                    <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-2xl text-center">
                      <div className="text-blue-700 text-lg font-mono font-extrabold">
                        {subcircuitAnalysis.outputs.length}
                      </div>
                      <div className="text-[10.5px] font-bold text-blue-800">Çıkış Portu</div>
                      <div className="text-[9px] text-blue-600">LED / Ekran / Prob</div>
                    </div>
                    <div className="p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-2xl text-center">
                      <div className="text-indigo-700 text-lg font-mono font-extrabold">
                        {subcircuitAnalysis.internalCount}
                      </div>
                      <div className="text-[10.5px] font-bold text-indigo-800">Dahili Kapı / IC</div>
                      <div className="text-[9px] text-indigo-600">İç Mantık Mantığı</div>
                    </div>
                    <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl text-center">
                      <div className="text-amber-700 text-lg font-mono font-extrabold">
                        {subcircuitAnalysis.wireCount}
                      </div>
                      <div className="text-[10.5px] font-bold text-amber-800">Bağlantı Kablosu</div>
                      <div className="text-[9px] text-amber-600">İletim Hatları</div>
                    </div>
                  </div>

                  {/* Live Chip Packaging Preview */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-blue-600" />
                      <span>Paketlenmiş Entegre Görsel Önizlemesi</span>
                    </h4>

                    <div className="p-6 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-center min-h-[160px] shadow-inner">
                      <div className="flex items-center gap-3">
                        {/* Input Pins on the left */}
                        <div className="flex flex-col gap-2">
                          {subcircuitAnalysis.inputs.length === 0 ? (
                            <span className="text-[10px] text-slate-500 italic">Giriş yok</span>
                          ) : (
                            subcircuitAnalysis.inputs.map((inComp, i) => (
                              <div key={inComp.id} className="flex items-center gap-1.5">
                                <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded text-[10px] font-mono font-bold">
                                  {inComp.label || `IN_${i + 1}`}
                                </span>
                                <div className="w-4 h-0.5 bg-emerald-500" />
                              </div>
                            ))
                          )}
                        </div>

                        {/* Chip Box */}
                        <div className="w-44 py-5 px-4 bg-slate-800 border-2 border-indigo-500/70 rounded-xl text-center shadow-lg relative flex flex-col items-center">
                          <div className="w-6 h-2 bg-slate-900 rounded-b-full border border-slate-700 -mt-5 mb-2" />
                          <div className="font-mono font-black text-indigo-300 text-sm tracking-wider">
                            {subcircuitName.trim() || 'CUSTOM_IC'}
                          </div>
                          <div className="text-[9px] text-slate-400 font-mono mt-0.5">
                            {subcircuitAnalysis.inputs.length} IN / {subcircuitAnalysis.outputs.length} OUT
                          </div>
                          <div className="text-[8px] text-indigo-400 font-mono mt-2 uppercase tracking-widest border border-indigo-900/60 bg-indigo-950/50 px-2 py-0.5 rounded">
                            SUBCIRCUIT BLOCK
                          </div>
                        </div>

                        {/* Output Pins on the right */}
                        <div className="flex flex-col gap-2">
                          {subcircuitAnalysis.outputs.length === 0 ? (
                            <span className="text-[10px] text-slate-500 italic">Çıkış yok</span>
                          ) : (
                            subcircuitAnalysis.outputs.map((outComp, i) => (
                              <div key={outComp.id} className="flex items-center gap-1.5">
                                <div className="w-4 h-0.5 bg-blue-500" />
                                <span className="px-2 py-0.5 bg-blue-950 text-blue-400 border border-blue-800 rounded text-[10px] font-mono font-bold">
                                  {outComp.label || `OUT_${i + 1}`}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Save to Live Component Library Option */}
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 space-y-3">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div>
                        <h5 className="font-extrabold text-xs text-blue-900 flex items-center gap-1.5">
                          <Package className="w-4 h-4 text-blue-600" />
                          <span>Bileşen Kütüphanesine Ekle</span>
                        </h5>
                        <p className="text-[11px] text-blue-700/80 mt-0.5">
                          Bu devreyi sol menüdeki "Özel Entegreler" sekmesine kaydeder. İstediğiniz projede tek parça IC olarak tuvale ekleyebilirsiniz.
                        </p>
                      </div>
                      <button
                        onClick={handleSaveSubcircuitToLibrary}
                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-2 transition-colors shrink-0"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Kütüphaneye Kaydet</span>
                      </button>
                    </div>
                  </div>

                  {/* Export Options */}
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
                    <h5 className="font-bold text-xs text-slate-800">Paket Dışa Aktarım Seçenekleri</h5>
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        onClick={handleExportSubcircuitJSON}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-2 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        <span>Entegre Paketini İndir (.json)</span>
                      </button>

                      <button
                        onClick={handleCopySubcircuitJSON}
                        className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 shadow-2xs cursor-pointer flex items-center gap-2 transition-colors"
                      >
                        {subcircuitCopied ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-600" />
                            <span className="text-emerald-700">Panoya Kopyalandı!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 text-slate-500" />
                            <span>Paket JSON'ını Kopyala</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                * Kaydedilen alt devreler tarayıcınızın yerel hafızasında saklanır.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSubcircuitModal(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer transition-colors"
                >
                  Kapat
                </button>
                {components.length > 0 && (
                  <button
                    onClick={handleSaveSubcircuitToLibrary}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                  >
                    <Package className="w-4 h-4" />
                    <span>Özel Entegre Olarak Kaydet & Kullan</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HDL Code Generator Modal (Verilog & VHDL) */}
      {showHdlModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-2xl shadow-xs">
                  <FileCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
                    Donanım Tanımlama Dili (HDL) Kod Üretici
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full">
                      FPGA & ASIC Ready
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tuvaldeki devreyi endüstri standardı Verilog HDL ve VHDL kodlarına otomatik dönüştürün
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHdlModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Language Switcher & Action Toolbar */}
            <div className="p-4 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 text-xs shadow-2xs">
                <button
                  onClick={() => {
                    setHdlActiveTab('verilog');
                    setHdlLang('verilog');
                  }}
                  className={`px-3.5 py-1.5 rounded-lg font-mono font-bold transition-all cursor-pointer ${
                    hdlActiveTab === 'verilog'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Verilog HDL (.v)
                </button>
                <button
                  onClick={() => {
                    setHdlActiveTab('vhdl');
                    setHdlLang('vhdl');
                  }}
                  className={`px-3.5 py-1.5 rounded-lg font-mono font-bold transition-all cursor-pointer ${
                    hdlActiveTab === 'vhdl'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  VHDL (.vhd)
                </button>
                <button
                  onClick={() => setHdlActiveTab('fpga')}
                  className={`px-3.5 py-1.5 rounded-lg font-mono font-bold transition-all cursor-pointer ${
                    hdlActiveTab === 'fpga'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  FPGA Kısıt (.xdc/.qsf)
                </button>
              </div>

              {hdlActiveTab === 'fpga' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={selectedFpgaBoard}
                    onChange={(e) => setSelectedFpgaBoard(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 shadow-2xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {FPGA_BOARDS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.format.toUpperCase()})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={handleCopyFpgaConstraints}
                    className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                  >
                    {fpgaCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-bold">Kopyalandı!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>Kısıtı Kopyala</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleDownloadFpgaFile}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Kısıtı İndir (.{generatedFpgaData.filename.split('.').pop()})</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyHdlCode}
                    className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                  >
                    {hdlCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-bold">Kopyalandı!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>Kodu Kopyala</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleDownloadHdlFile}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{hdlLang === 'verilog' ? 'Verilog İndir (.v)' : 'VHDL İndir (.vhd)'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Code Display Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-950">
              <pre className="font-mono text-xs text-emerald-300 leading-relaxed whitespace-pre selection:bg-emerald-700 selection:text-white">
                <code>
                  {hdlActiveTab === 'fpga'
                    ? generatedFpgaData.content
                    : hdlLang === 'verilog'
                    ? generatedVerilogCode
                    : generatedVhdlCode}
                </code>
              </pre>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                {hdlActiveTab === 'fpga'
                  ? `${generatedFpgaData.boardName} için Vivado / Quartus pin atama ve zamanlama kısıtları.`
                  : 'Xilinx Vivado, Intel Quartus Prime ve ModelSim ile tam uyumlu sentezlenebilir RTL kodu.'}
              </span>
              <button
                onClick={() => setShowHdlModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Hex Memory Matrix Editor Modal (RAM & ROM) */}
      {showHexModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-cyan-50 to-sky-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-sky-500 text-white rounded-2xl shadow-xs">
                  <Binary className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                    <span>RAM / ROM İnteraktif Hex Bellek Editörü</span>
                    <span className="px-2 py-0.5 bg-sky-100 text-sky-800 text-[10px] font-mono font-bold rounded-full">
                      16x4-Bit
                    </span>
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Hafıza hücrelerini canlı olarak onaltılık (Hex) veya ikilik (Bin) formatında düzenleyin.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHexModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Actions Bar */}
            <div className="p-3 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setHexDataBuffer(Array(16).fill(0))}
                  className="px-2.5 py-1 bg-white hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors cursor-pointer"
                >
                  0x0 Sıfırla
                </button>
                <button
                  onClick={() => setHexDataBuffer(Array.from({ length: 16 }, (_, i) => i % 16))}
                  className="px-2.5 py-1 bg-white hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors cursor-pointer"
                >
                  Sayıcı (0..F)
                </button>
                <button
                  onClick={() =>
                    setHexDataBuffer(Array.from({ length: 16 }, () => Math.floor(Math.random() * 16)))
                  }
                  className="px-2.5 py-1 bg-white hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors cursor-pointer"
                >
                  Rastgele
                </button>
                <div className="h-4 w-px bg-slate-300 mx-1 hidden sm:block" />
                <button
                  onClick={() =>
                    setHexDataBuffer([9, 9, 15, 9, 15, 7, 9, 15, 11, 15, 15, 15, 4, 15, 15, 15])
                  }
                  className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-lg text-xs font-bold border border-amber-300 transition-colors cursor-pointer flex items-center gap-1"
                  title="Super Mario Bros İntro Teması"
                >
                  <span>🍄 Mario</span>
                </button>
                <button
                  onClick={() =>
                    setHexDataBuffer([4, 4, 4, 7, 7, 11, 11, 10, 9, 8, 14, 14, 11, 11, 15, 15])
                  }
                  className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-lg text-xs font-bold border border-blue-300 transition-colors cursor-pointer flex items-center gap-1"
                  title="Star Wars Fanfare Ana Teması"
                >
                  <span>⚔️ Star Wars</span>
                </button>
                <button
                  onClick={() =>
                    setHexDataBuffer([9, 6, 7, 8, 7, 6, 5, 5, 7, 9, 8, 7, 6, 7, 8, 9])
                  }
                  className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-900 rounded-lg text-xs font-bold border border-purple-300 transition-colors cursor-pointer flex items-center gap-1"
                  title="Tetris (Korobeiniki) Teması"
                >
                  <span>🧱 Tetris</span>
                </button>
              </div>

              <button
                onClick={() => {
                  const hexStr = hexDataBuffer.map((b) => b.toString(16).toUpperCase()).join(' ');
                  navigator.clipboard.writeText(hexStr);
                  showToast('Hex dizesi panoya kopyalandı!');
                }}
                className="px-2.5 py-1 bg-white hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Copy className="w-3 h-3 text-slate-500" />
                <span>Hex Kopyala</span>
              </button>
            </div>

            {/* Memory Matrix Table */}
            <div className="p-5 overflow-y-auto max-h-96 space-y-3">
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-inner">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 text-[11px]">
                    <tr>
                      <th className="p-2.5 text-center w-16">Adres</th>
                      <th className="p-2.5 text-center">Hex (0-F)</th>
                      <th className="p-2.5 text-center">İkilik (Bin)</th>
                      <th className="p-2.5 text-center">Onluk (Dec)</th>
                      <th className="p-2.5 text-center text-amber-700 bg-amber-50/50">Nota (Chiptune)</th>
                      <th className="p-2.5 text-center w-24">Hızlı Ayar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {hexDataBuffer.map((val, addr) => {
                      const hexChar = val.toString(16).toUpperCase();
                      const binStr = val.toString(2).padStart(4, '0');
                      return (
                        <tr key={addr} className="hover:bg-sky-50/50 transition-colors">
                          <td className="p-2 text-center text-slate-400 font-bold bg-slate-50/50">
                            0x{addr.toString(16).toUpperCase()}
                          </td>
                          <td className="p-2 text-center">
                            <input
                              type="text"
                              maxLength={1}
                              value={hexChar}
                              onChange={(e) => {
                                const parsed = parseInt(e.target.value, 16);
                                const nextVal = isNaN(parsed) ? 0 : Math.max(0, Math.min(15, parsed));
                                setHexDataBuffer((prev) => {
                                  const n = [...prev];
                                  n[addr] = nextVal;
                                  return n;
                                });
                              }}
                              className="w-10 text-center py-1 bg-white border border-slate-300 rounded-lg font-black text-sky-950 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-200"
                            />
                          </td>
                          <td className="p-2 text-center text-slate-600 font-bold">{binStr}</td>
                          <td className="p-2 text-center text-slate-500">{val}</td>
                          <td className="p-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              val === 15
                                ? 'bg-slate-100 text-slate-400'
                                : 'bg-amber-100/80 text-amber-900 border border-amber-200'
                            }`}>
                              {CHIPTUNE_NOTE_NAMES[val] || 'Bilinmiyor'}
                            </span>
                          </td>
                          <td className="p-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => {
                                  setHexDataBuffer((prev) => {
                                    const n = [...prev];
                                    n[addr] = (n[addr] + 1) % 16;
                                    return n;
                                  });
                                }}
                                className="w-6 h-6 rounded-md bg-slate-100 hover:bg-sky-100 text-slate-700 hover:text-sky-900 font-bold text-xs flex items-center justify-center cursor-pointer"
                              >
                                +
                              </button>
                              <button
                                onClick={() => {
                                  setHexDataBuffer((prev) => {
                                    const n = [...prev];
                                    n[addr] = (n[addr] - 1 + 16) % 16;
                                    return n;
                                  });
                                }}
                                className="w-6 h-6 rounded-md bg-slate-100 hover:bg-sky-100 text-slate-700 hover:text-sky-900 font-bold text-xs flex items-center justify-center cursor-pointer"
                              >
                                -
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                * Değişiklikler kaydedildiğinde bellek verileri devre simülasyonuna anında yansır.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowHexModal(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer transition-colors"
                >
                  İptal
                </button>
                <button
                  onClick={handleSaveHexEditor}
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Belleğe Yaz & Kaydet</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Automated Test Vector / Testbench Runner Modal */}
      {showTestbenchModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-violet-50 to-purple-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-violet-600 text-white rounded-2xl shadow-xs">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    Otomatik Test Vektörü / Testbench Koşturucu
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Devrenizin beklenen çıkışlarını doğrulamak için otomatik test senaryoları çalıştırın.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowTestbenchModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">
                  Test Senaryoları [Girişler | Beklenen Çıkışlar]:
                </label>
                <button
                  onClick={handleAutoGenerateTestbench}
                  className="px-3 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  Tüm Girişlerden Vektör Üret
                </button>
              </div>

              <textarea
                value={testbenchText}
                onChange={(e) => setTestbenchText(e.target.value)}
                placeholder={`# Örnek format:\n0 0 | 0 0\n0 1 | 1 0\n1 0 | 1 0\n1 1 | 0 1`}
                className="w-full h-36 p-3.5 bg-slate-950 text-emerald-300 font-mono text-xs rounded-2xl border border-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 shadow-inner"
              />

              {/* Action Toolbar */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-500">
                  * Her satırda giriş bitleri ve '|' işaretinden sonra beklenen çıkış bitleri yer alır.
                </span>
                <button
                  onClick={handleRunTestbench}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Testleri Koştur</span>
                </button>
              </div>

              {/* Testbench Results Report */}
              {testbenchResult && (
                <div className="space-y-3 pt-3 border-t border-slate-200">
                  <div className="grid grid-cols-4 gap-2.5">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                      <div className="text-lg font-mono font-black text-slate-800">
                        {testbenchResult.totalTests}
                      </div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase">Toplam Test</div>
                    </div>
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
                      <div className="text-lg font-mono font-black text-emerald-700">
                        {testbenchResult.passedTests}
                      </div>
                      <div className="text-[10px] font-bold text-emerald-700 uppercase">Başarılı</div>
                    </div>
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-center">
                      <div className="text-lg font-mono font-black text-rose-700">
                        {testbenchResult.failedTests}
                      </div>
                      <div className="text-[10px] font-bold text-rose-700 uppercase">Hatalı</div>
                    </div>
                    <div className="p-3 bg-violet-50 border border-violet-200 rounded-2xl text-center">
                      <div className="text-lg font-mono font-black text-violet-700">
                        %{testbenchResult.successRate}
                      </div>
                      <div className="text-[10px] font-bold text-violet-700 uppercase">
                        {testbenchResult.durationMs}ms
                      </div>
                    </div>
                  </div>

                  {/* Results Table */}
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-2xl">
                    <table className="w-full text-xs font-mono">
                      <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 text-[10.5px]">
                        <tr>
                          <th className="p-2 text-center w-10">#</th>
                          <th className="p-2 text-center">Girişler</th>
                          <th className="p-2 text-center">Beklenen</th>
                          <th className="p-2 text-center">Alınan</th>
                          <th className="p-2 text-center w-20">Sonuç</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {testbenchResult.rows.map((row) => (
                          <tr
                            key={row.index}
                            className={row.passed ? 'hover:bg-emerald-50/40' : 'bg-rose-50/40'}
                          >
                            <td className="p-1.5 text-center text-slate-400 text-[10px]">{row.index}</td>
                            <td className="p-1.5 text-center text-slate-700">
                              {Object.entries(row.inputValues)
                                .map(([k, v]) => `${k}:${v}`)
                                .join(' ')}
                            </td>
                            <td className="p-1.5 text-center text-slate-600 font-bold">
                              {Object.values(row.expectedOutputs).join(' ')}
                            </td>
                            <td className="p-1.5 text-center font-bold text-slate-900">
                              {row.actualOutputs ? Object.values(row.actualOutputs).join(' ') : '-'}
                            </td>
                            <td className="p-1.5 text-center">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                  row.passed
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                                }`}
                              >
                                {row.passed ? 'GEÇTİ' : 'HATA'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowTestbenchModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FSM State Machine Synthesizer Modal */}
      {showFsmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-pink-50 to-rose-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-pink-600 text-white rounded-2xl shadow-xs">
                  <Workflow className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    Sonlu Durum Makinesi (FSM) Tasarımcısı & Sentezleyicisi
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Durum geçiş tablosunu tanımlayın, D Flip-Flop ve kombinasyonel devresi otomatik kurulsun.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowFsmModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Presets */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Hazır FSM Şablonu:</label>
                <div className="flex gap-2 flex-wrap">
                  {FSM_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setFsmSelectedPreset(p.id);
                        setFsmStates(p.states);
                        setFsmTransitions(p.transitions);
                        showToast(`"${p.name}" şablonu yüklendi.`);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                        fsmSelectedPreset === p.id
                          ? 'bg-pink-600 text-white border-pink-700 shadow-xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* States and Transitions Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* States Table */}
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700 block">FSM Durumları (States):</span>
                  <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-inner max-h-40 overflow-y-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="bg-slate-100 text-slate-600 text-[10.5px]">
                        <tr>
                          <th className="p-2 text-left">Durum</th>
                          <th className="p-2 text-center">Kod (Q1 Q0)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {fsmStates.map((s) => (
                          <tr key={s.id} className="hover:bg-pink-50/30">
                            <td className="p-2 font-bold text-slate-800">{s.name}</td>
                            <td className="p-2 text-center">
                              <span className="px-2 py-0.5 bg-pink-100 text-pink-800 rounded font-black">
                                {s.code}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Transitions Table */}
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700 block">
                    Geçişler (From → To | X → Z):
                  </span>
                  <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-inner max-h-40 overflow-y-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="bg-slate-100 text-slate-600 text-[10.5px]">
                        <tr>
                          <th className="p-2 text-center">Mevcut</th>
                          <th className="p-2 text-center">X</th>
                          <th className="p-2 text-center">Sonraki</th>
                          <th className="p-2 text-center">Z</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {fsmTransitions.map((t) => {
                          const from = fsmStates.find((s) => s.id === t.fromStateId)?.code || t.fromStateId;
                          const to = fsmStates.find((s) => s.id === t.toStateId)?.code || t.toStateId;
                          return (
                            <tr key={t.id} className="hover:bg-pink-50/30">
                              <td className="p-1.5 text-center font-bold text-slate-700">{from}</td>
                              <td className="p-1.5 text-center text-pink-700 font-bold">{t.inputX}</td>
                              <td className="p-1.5 text-center font-bold text-slate-800">{to}</td>
                              <td className="p-1.5 text-center text-emerald-600 font-bold">{t.outputZ}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* FSM Synthesis Formula Preview Card */}
              <div className="p-4 bg-pink-50/70 border border-pink-200 rounded-2xl space-y-1.5">
                <span className="text-[10px] font-bold text-pink-800 uppercase tracking-wider block">
                  Otomatik Çözülen D Flip-Flop & Çıkış Denklemleri:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-xs">
                  <div className="p-2 bg-white rounded-xl border border-pink-200 text-slate-800">
                    <strong className="text-pink-700">D1 =</strong> Q1⁺ uyarım denklemi
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-pink-200 text-slate-800">
                    <strong className="text-pink-700">D0 =</strong> Q0⁺ uyarım denklemi
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-pink-200 text-slate-800">
                    <strong className="text-emerald-700">Z =</strong> Çıkış lojik denklemi
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                * Flip-Floplar, Saat, Giriş Anahtarı ve lojik kapılar tuval üzerine otomatik kurulur.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFsmModal(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer transition-colors"
                >
                  İptal
                </button>
                <button
                  onClick={handleSynthesizeFSM}
                  className="px-5 py-2 bg-pink-600 hover:bg-pink-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                >
                  <Workflow className="w-3.5 h-3.5" />
                  <span>FSM Devresini Tuvale Çiz</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Spotlight Command Palette (Ctrl + K) */}
      {showCommandPalette && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start justify-center pt-20 px-4 animate-in fade-in duration-150"
          onClick={() => setShowCommandPalette(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[75vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input Bar */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
              <Search className="w-5 h-5 text-blue-600 shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="Kapı, entegre, alt devre veya sayfa ara... (örn: XOR, D-FF, ALU, Sayfa)"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setShowCommandPalette(false);
                  if (e.key === 'Enter') {
                    const firstMatch = filteredPaletteItems[0];
                    if (firstMatch) {
                      firstMatch.action();
                      setShowCommandPalette(false);
                    }
                  }
                }}
                className="w-full text-sm font-semibold text-slate-800 placeholder:text-slate-400 outline-none bg-transparent"
              />
              <button
                onClick={() => setShowCommandPalette(false)}
                className="p-1 hover:bg-slate-200/80 text-slate-400 hover:text-slate-600 rounded-lg text-xs"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results List */}
            <div className="overflow-y-auto p-3 divide-y divide-slate-100 flex-1">
              {filteredPaletteItems.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 font-medium">
                  "{paletteQuery}" ile eşleşen bileşen bulunamadı.
                </div>
              ) : (
                filteredPaletteItems.map((item, idx) => (
                  <button
                    key={`${item.id}_${idx}`}
                    onClick={() => {
                      item.action();
                      setShowCommandPalette(false);
                    }}
                    className="w-full px-3 py-2.5 hover:bg-blue-50/70 rounded-xl flex items-center justify-between text-left cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-colors shrink-0">
                        {item.tag}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800 group-hover:text-blue-900 truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {item.description}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 group-hover:text-blue-600 font-medium shrink-0 ml-2">
                      Enter ↵
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* Footer Hints */}
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-2">
                <span>Gezinme: <kbd className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600">Enter</kbd> ile Ekle</span>
              </div>
              <span>Kapat: <kbd className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600">Esc</kbd></span>
            </div>
          </div>
        </div>
      )}

      {/* Circuit Statistics & CMOS Transistor Analysis Modal */}
      {showStatsModal && statsReport && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Devre İstatistikleri & CMOS Transistör Analizi
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Endüstri Standardı Devre Karmaşıklığı, Transistör ve Kritik Yol Raporu
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowStatsModal(false)}
                className="p-1.5 hover:bg-slate-200/80 text-slate-400 hover:text-slate-600 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Summary Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-2xl text-center">
                  <div className="text-2xl font-mono font-black text-indigo-600">
                    {statsReport.totalCMOSTransistors}
                  </div>
                  <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mt-0.5">
                    CMOS Transistör (T)
                  </div>
                </div>

                <div className="p-3.5 bg-amber-50/70 border border-amber-100 rounded-2xl text-center">
                  <div className="text-2xl font-mono font-black text-amber-600">
                    {statsReport.criticalPathDepth}
                  </div>
                  <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mt-0.5">
                    Kritik Yol (t_pd Kapı)
                  </div>
                </div>

                <div className="p-3.5 bg-emerald-50/70 border border-emerald-100 rounded-2xl text-center">
                  <div className="text-2xl font-mono font-black text-emerald-600">
                    {statsReport.gateCount}
                  </div>
                  <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mt-0.5">
                    Toplam Kapı
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                  <div className="text-2xl font-mono font-black text-slate-700">
                    {statsReport.totalWires}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">
                    İletken Net
                  </div>
                </div>
              </div>

              {/* Sub-metrics Pills */}
              <div className="grid grid-cols-3 gap-2.5 text-xs">
                <div className="px-3 py-2 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                  <span className="text-slate-500">Giriş / Çıkış:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {statsReport.inputCount} Giriş / {statsReport.outputCount} Çıkış
                  </span>
                </div>
                <div className="px-3 py-2 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                  <span className="text-slate-500">Kombinasyonel:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {statsReport.combinationalCount} Adet
                  </span>
                </div>
                <div className="px-3 py-2 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                  <span className="text-slate-500">Sıralı (Sequential):</span>
                  <span className="font-mono font-bold text-slate-800">
                    {statsReport.sequentialCount} Adet
                  </span>
                </div>
              </div>

              {/* Gate & Component Breakdown Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-2">
                  <span>Bileşen ve Transistör Dağılım Tablosu</span>
                  <span className="text-[10px] font-normal text-slate-400">
                    (Standart CMOS Silikon Eşdeğerleri)
                  </span>
                </h4>
                {statsReport.breakdown.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                    Devre üzerinde henüz analiz edilecek mantık bileşeni bulunmuyor.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-56 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="px-4 py-2">Bileşen Türü</th>
                          <th className="px-3 py-2 text-center">Adet</th>
                          <th className="px-3 py-2 text-right">Birim Transistör</th>
                          <th className="px-4 py-2 text-right">Toplam Transistör</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {statsReport.breakdown.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-2 font-medium text-slate-800">{row.gateType}</td>
                            <td className="px-3 py-2 text-center text-slate-600">{row.count}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{row.transistorsPerUnit} T</td>
                            <td className="px-4 py-2 text-right font-bold text-indigo-600">{row.totalTransistors} T</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-700 text-xs">
                        <tr>
                          <td className="px-4 py-2.5">Genel Toplam</td>
                          <td className="px-3 py-2.5 text-center font-mono">{statsReport.totalComponents}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-400">-</td>
                          <td className="px-4 py-2.5 text-right font-mono text-indigo-700">{statsReport.totalCMOSTransistors} T</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={handleCopyStatsReport}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
              >
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Raporu Panoya Kopyala</span>
              </button>

              <button
                onClick={() => setShowStatsModal(false)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

            {/* Secondary Confirmation Modal for Clear Canvas */}
      {showClearConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 ${
            cadTheme === 'dark' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold">Tüm Devreyi Temizle</h3>
                <p className="text-xs text-slate-500 mt-0.5">İkincil Onay</p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Tuvaldeki tüm mantık kapıları, bağlantı kabloları ve açıklama blokları tamamen silinecektir. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowClearConfirmModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                onClick={() => {
                  setShowClearConfirmModal(false);
                  handleClearCanvas();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Evet, Hepsini Temizle</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-md border border-slate-700 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

// Backward-compatible alias export
export const LogisimSimulator = LogicCircuitSimulator;
