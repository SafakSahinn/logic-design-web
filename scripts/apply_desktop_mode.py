import os
import sys
import shutil

src_base = r"C:\Users\safak\Desktop\Logic Deisgn Web Site\src\components\LogisimSimulator.tsx"
target = r"C:\Users\safak\Desktop\Logic Design Studio\src\components\LogisimSimulator.tsx"

# First, copy fresh file with all recent wiring fixes from Web Site
shutil.copy2(src_base, target)
print("Copied fresh base from Web Site")

with open(target, "r", encoding="utf-8") as f:
    text = f.read().replace("\r\n", "\n")

# 1. Add extra imports at top
import_block = """import { StandaloneKMapSolver } from './StandaloneKMapSolver';
import { StandaloneNumberConverter } from './StandaloneNumberConverter';
import {
  PanelLeftClose,
  PanelLeft,
  Type,
  LayoutGrid,
} from 'lucide-react';
"""
text = import_block + text

# 2. Add interface LogicCircuitSimulatorProps
old_decl = """export interface LogicCircuitSimulatorProps {
  desktopMode?: boolean;
}

export const LogicCircuitSimulator: React.FC<LogicCircuitSimulatorProps> = ({ desktopMode: _desktopMode = false }) => {"""

new_decl = """export interface LogicCircuitSimulatorProps {
  desktopMode?: boolean;
}

export const LogicCircuitSimulator: React.FC<LogicCircuitSimulatorProps> = ({ desktopMode = true }) => {"""

text = text.replace(old_decl, new_decl)

# 3. Add desktop state & toolbox definition before state
desktop_state = """
  // Simulation reset handler for desktop ribbon
  const handleResetSimulation = () => {
    setStepCount(0);
    runSimulation();
  };

  // Desktop Window State & Modals
  const [activeDesktopMenu, setActiveDesktopMenu] = useState<'file' | 'edit' | 'simulate' | 'tools' | 'view' | 'help' | null>(null);
  const [showKMapModal, setShowKMapModal] = useState<boolean>(false);
  const [showNumberConverterModal, setShowNumberConverterModal] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [showLeftToolbox, setShowLeftToolbox] = useState<boolean>(true);
  const [desktopToolboxSearch, setDesktopToolboxSearch] = useState<string>('');
  const [toolboxCategoryOpen, setToolboxCategoryOpen] = useState<Record<string, boolean>>({
    wiring: true,
    gates: true,
    inputs: true,
    outputs: true,
    combinational: false,
    sequential: false,
    peripherals: false,
    custom: false,
  });

  const toggleToolboxCategory = (catId: string) => {
    setToolboxCategoryOpen((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  useEffect(() => {
    if (!activeDesktopMenu) return;
    const handleClose = () => setActiveDesktopMenu(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [activeDesktopMenu]);

  // Handle Drag & Drop to canvas
  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const compType = e.dataTransfer.getData('application/component-type') as ComponentType;
    if (!compType) return;
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const posX = Math.round((clientX - panOffset.x) / zoom / 20) * 20;
    const posY = Math.round((clientY - panOffset.y) / zoom / 20) * 20;

    recordHistory();
    const newComp = updatePinPositions(createComponentInstance(compType, posX, posY));
    setComponents((prev) => {
      const updated = [...prev, newComp];
      const sim = simulateCircuit(updated, wires);
      setWires(sim.wires);
      return sim.components;
    });
    setSelectedCompIds([newComp.id]);
    setSelectedWireIds([]);
    setToastMessage((newComp.label || 'Bileşen') + ' tuvale eklendi');
    setTimeout(() => setToastMessage(null), 1800);
  };

  const DESKTOP_TOOLBOX_GROUPS = [
    {
      id: 'wiring',
      name: 'Kablolama & Güç',
      color: 'text-sky-500',
      items: [
        { type: 'vcc', name: 'VCC (+5V)', desc: 'Sabit Mantık 1', badge: '+5V' },
        { type: 'gnd', name: 'Toprak (GND)', desc: 'Sabit Mantık 0', badge: '0V' },
        { type: 'clock', name: 'Saat (Clock)', desc: 'Kare Dalga Kalp Atışı', badge: 'CLK' },
      ],
    },
    {
      id: 'gates',
      name: 'Mantık Kapıları',
      color: 'text-blue-500',
      items: [
        { type: 'and', name: 'AND (VE) Kapısı', desc: 'Tüm girişler 1 ise 1', badge: 'AND' },
        { type: 'or', name: 'OR (VEYA) Kapısı', desc: 'En az bir giriş 1 ise 1', badge: 'OR' },
        { type: 'not', name: 'NOT (DEĞİL) Kapısı', desc: 'Girişi tersler', badge: 'NOT' },
        { type: 'nand', name: 'NAND (VE-DEĞİL)', desc: 'AND kapısının tersi', badge: 'NAND' },
        { type: 'nor', name: 'NOR (VEYA-DEĞİL)', desc: 'OR kapısının tersi', badge: 'NOR' },
        { type: 'xor', name: 'XOR (ÖZEL VEYA)', desc: 'Farklı girişlerde 1', badge: 'XOR' },
        { type: 'xnor', name: 'XNOR (EŞDEĞERLİK)', desc: 'Aynı girişlerde 1', badge: 'XNOR' },
      ],
    },
    {
      id: 'inputs',
      name: 'Giriş & Kontrol',
      color: 'text-emerald-500',
      items: [
        { type: 'switch', name: 'Mekanik Switch', desc: 'Aç/Kapa Mandallı Anahtar', badge: 'SW' },
        { type: 'pushbutton', name: 'Basmalı Buton', desc: 'Anlık Bas-Bırak Buton', badge: 'BTN' },
        { type: 'dipSwitch4', name: '4-Bit DIP Switch', desc: '4 Kanallı Giriş Bankası', badge: 'DIP' },
        { type: 'asciiKeyboard', name: 'ASCII Klavye Terminal', desc: 'Karakter Giriş Matrisi', badge: 'KEY' },
      ],
    },
    {
      id: 'outputs',
      name: 'Göstergeler & Çıkış',
      color: 'text-amber-500',
      items: [
        { type: 'led', name: 'Işıklı LED', desc: 'Renkli Sinyal Lambası', badge: 'LED' },
        { type: 'probe', name: 'Mantık Probu', desc: 'Canlı 0/1 Seviye Göstergesi', badge: 'PRB' },
        { type: 'sevenSeg', name: '7-Segment Display', desc: 'Sayısal Gösterge', badge: '7SEG' },
        { type: 'hexDisplay', name: '4-Bit Hex Display', desc: 'Onaltılık Büyük Karakter', badge: 'HEX' },
      ],
    },
    {
      id: 'combinational',
      name: 'Aritmetik & Çoklayıcılar',
      color: 'text-indigo-500',
      items: [
        { type: 'halfAdder', name: 'Yarım Toplayıcı', desc: '2-Bit Toplam & Elde', badge: 'HA' },
        { type: 'fullAdder', name: 'Tam Toplayıcı', desc: 'A + B + Cin Eldeli Toplayıcı', badge: 'FA' },
        { type: 'fullSubtractor', name: 'Tam Çıkarıcı', desc: 'A - B - Bin Borçlu Çıkarıcı', badge: 'FS' },
        { type: 'alu4bit', name: '4-Bit ALU (74HC181)', desc: 'Aritmetik Mantık Birimi', badge: 'ALU' },
        { type: 'mux2to1', name: 'Multiplexer 2:1', desc: '2 Kanaldan 1 Hat Seçici', badge: 'MUX2' },
        { type: 'mux4to1', name: 'Multiplexer 4:1', desc: '4 Kanaldan 1 Hat Seçici', badge: 'MUX4' },
        { type: 'mux8to1', name: 'Multiplexer 8:1', desc: '8 Kanaldan 1 Hat Seçici', badge: 'MUX8' },
        { type: 'demux1to2', name: 'Demultiplexer 1:2', desc: '1 Hattan 2 Kanala Yönlendirici', badge: 'DEMUX' },
        { type: 'demux1to4', name: 'Demultiplexer 1:4', desc: '1 Hattan 4 Kanala Yönlendirici', badge: 'DEMUX4' },
        { type: 'decoder2to4', name: '2:4 Kod Çözücü', desc: '2-Bit Adres Çözücü', badge: 'DEC4' },
        { type: 'decoder3to8', name: '3:8 Kod Çözücü', desc: '3-Bit Adres Çözücü', badge: 'DEC8' },
      ],
    },
    {
      id: 'sequential',
      name: 'Ardışıl Mantık & Bellek',
      color: 'text-purple-500',
      items: [
        { type: 'dFlipFlop', name: 'D Flip-Flop', desc: 'Saat Kenarı 1-Bit Hafıza', badge: 'D-FF' },
        { type: 'jkFlipFlop', name: 'JK Flip-Flop', desc: 'Universal Flip-Flop', badge: 'JK-FF' },
        { type: 'tFlipFlop', name: 'T Flip-Flop', desc: 'Tersleyici Tetiklemeli FF', badge: 'T-FF' },
        { type: 'srLatch', name: 'SR Latch', desc: 'Set-Reset Temel Mandal', badge: 'SR' },
        { type: 'counter4bit', name: '4-Bit Senkron Sayaç', desc: '0-15 İkili İleri Sayaç', badge: 'CTR' },
        { type: 'ram16x4', name: '16x4 SRAM Bellek', desc: '16 Adres 4-Bit Yaz/Oku', badge: 'RAM' },
        { type: 'rom16x4', name: '16x4 ROM Bellek', desc: 'Sabit Program Belleği', badge: 'ROM' },
      ],
    },
    {
      id: 'peripherals',
      name: 'Multimedya & GPU',
      color: 'text-rose-500',
      items: [
        { type: 'buzzer', name: 'Chiptune Piezo Buzzer', desc: '8-Bit Analog Melodi Ses Motoru', badge: 'SND' },
        { type: 'rgbMatrix16x16', name: '16x16 RGB LED Matrix', desc: '256 Piksellik Renkli GPU Ekranı', badge: 'GPU' },
      ],
    },
  ];

  const renderDesktopMenuBar = () => (
    <div className={`h-9 px-3 border-b flex items-center justify-between text-xs font-medium z-40 select-none ${
      cadTheme === 'dark' ? 'bg-[#0F172A] border-slate-800 text-slate-300' : 'bg-slate-200/90 border-slate-300 text-slate-700'
    }`}>
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-2 mr-3 font-bold text-sm tracking-tight text-blue-500">
          <Cpu className="w-4 h-4 text-blue-500" />
          <span className={cadTheme === 'dark' ? 'text-white font-extrabold' : 'text-slate-900 font-extrabold'}>LogicDesign Studio</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-600/20 text-blue-400 font-mono font-bold">EDA</span>
        </div>

        {/* Dosya */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveDesktopMenu(activeDesktopMenu === 'file' ? null : 'file');
            }}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeDesktopMenu === 'file'
                ? cadTheme === 'dark' ? 'bg-slate-700 text-white' : 'bg-slate-300 text-slate-900 font-bold'
                : 'hover:bg-slate-700/40'
            }`}
          >
            Dosya
          </button>
          {activeDesktopMenu === 'file' && (
            <div
              className={`absolute top-full left-0 mt-1 w-56 rounded-xl shadow-2xl border py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                cadTheme === 'dark' ? 'bg-[#1E293B] border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => { handleClearCanvas(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Yeni Devre (New)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+N</span>
              </button>
              <button
                onClick={() => { fileInputRef.current?.click(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Devre Aç... (Open)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+O</span>
              </button>
              <button
                onClick={() => { handleExportJSON(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Kaydet (Save JSON)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+S</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => { handleExportCirc(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Logisim (.circ) Dışa Aktar</span>
                <span className="text-[10px] opacity-60 font-mono">.circ</span>
              </button>
              <button
                onClick={() => { handleExportPNG(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>PNG Resmi Dışa Aktar</span>
                <span className="text-[10px] opacity-60 font-mono">PNG</span>
              </button>
              <button
                onClick={() => { handleExportSVG(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>SVG Vektör Dışa Aktar</span>
                <span className="text-[10px] opacity-60 font-mono">SVG</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => { handleAddSheet(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Yeni Sayfa Ekle</span>
                <span className="text-[10px] opacity-60 font-mono">+</span>
              </button>
            </div>
          )}
        </div>

        {/* Düzenle */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveDesktopMenu(activeDesktopMenu === 'edit' ? null : 'edit');
            }}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeDesktopMenu === 'edit'
                ? cadTheme === 'dark' ? 'bg-slate-700 text-white' : 'bg-slate-300 text-slate-900 font-bold'
                : 'hover:bg-slate-700/40'
            }`}
          >
            Düzenle
          </button>
          {activeDesktopMenu === 'edit' && (
            <div
              className={`absolute top-full left-0 mt-1 w-52 rounded-xl shadow-2xl border py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                cadTheme === 'dark' ? 'bg-[#1E293B] border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                disabled={historyStack.length === 0}
                onClick={() => { handleUndo(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer disabled:opacity-40"
              >
                <span>Geri Al (Undo)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+Z</span>
              </button>
              <button
                disabled={redoStack.length === 0}
                onClick={() => { handleRedo(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer disabled:opacity-40"
              >
                <span>İleri Al (Redo)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+Y</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => { handleDuplicateSelected(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Çoğalt (Duplicate)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+D</span>
              </button>
              <button
                onClick={() => { handleRotateSelected(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>90° Döndür</span>
                <span className="text-[10px] opacity-60 font-mono">R</span>
              </button>
              <button
                onClick={() => { handleDeleteSelected(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-rose-600 hover:text-white cursor-pointer"
              >
                <span>Seçilileri Sil</span>
                <span className="text-[10px] opacity-60 font-mono">Del</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => { setShowCommandPalette(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Hızlı Komut Paleti</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+K</span>
              </button>
            </div>
          )}
        </div>

        {/* Simülasyon */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveDesktopMenu(activeDesktopMenu === 'simulate' ? null : 'simulate');
            }}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeDesktopMenu === 'simulate'
                ? cadTheme === 'dark' ? 'bg-slate-700 text-white' : 'bg-slate-300 text-slate-900 font-bold'
                : 'hover:bg-slate-700/40'
            }`}
          >
            Simülasyon
          </button>
          {activeDesktopMenu === 'simulate' && (
            <div
              className={`absolute top-full left-0 mt-1 w-56 rounded-xl shadow-2xl border py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                cadTheme === 'dark' ? 'bg-[#1E293B] border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => { setIsRunning(!isRunning); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>{isRunning ? 'Durdur' : 'Çalıştır'}</span>
                <span className="text-[10px] opacity-60 font-mono">Space</span>
              </button>
              <button
                onClick={() => { handleSingleStep(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Tek Adım İlerle</span>
                <span className="text-[10px] opacity-60 font-mono">T</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase">Saat Frekansı (Hz)</div>
              <div className="grid grid-cols-3 gap-1 px-3 py-1">
                {[0.5, 1, 2, 4, 6, 8].map((hz) => (
                  <button
                    key={hz}
                    onClick={() => { setClockHz(hz); setActiveDesktopMenu(null); }}
                    className={`py-1 text-center rounded font-mono text-[11px] font-bold cursor-pointer ${
                      clockHz === hz ? 'bg-blue-600 text-white' : 'bg-slate-700/50 hover:bg-slate-700'
                    }`}
                  >
                    {hz}Hz
                  </button>
                ))}
              </div>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => { setIsSoundMuted(!isSoundMuted); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Ses Motoru</span>
                <span className="text-[10px] font-bold text-blue-400">{isSoundMuted ? 'Sessiz' : 'Açık'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Araçlar */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveDesktopMenu(activeDesktopMenu === 'tools' ? null : 'tools');
            }}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeDesktopMenu === 'tools'
                ? cadTheme === 'dark' ? 'bg-slate-700 text-white' : 'bg-slate-300 text-slate-900 font-bold'
                : 'hover:bg-slate-700/40'
            }`}
          >
            Araçlar
          </button>
          {activeDesktopMenu === 'tools' && (
            <div
              className={`absolute top-full left-0 mt-1 w-64 rounded-xl shadow-2xl border py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                cadTheme === 'dark' ? 'bg-[#1E293B] border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => { setShowKMapModal(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>K-Map Çözücü (Karnaugh)</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">SOP</span>
              </button>
              <button
                onClick={() => { setShowNumberConverterModal(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Binary className="w-3.5 h-3.5 text-blue-400" />
                  <span>Sayı Sistemleri & Radix</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">Bin/Hex</span>
              </button>
              <button
                onClick={() => { setShowWaveform((p) => !p); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Zamanlama Osiloskobu</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">Scope</span>
              </button>
              <button
                onClick={() => { setShowTruthTable(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Table className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Doğruluk Tablosu</span>
                </div>
              </button>
              <button
                onClick={() => { setShowSynthesizer(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Boole Formülü Sentezleyici</span>
                </div>
              </button>
              <button
                onClick={() => { setShowFsmModal(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Workflow className="w-3.5 h-3.5 text-pink-400" />
                  <span>FSM Durum Makinesi</span>
                </div>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => { handleOpenHexEditor(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <Binary className="w-3.5 h-3.5 text-sky-400" />
                <span>Hex Bellek (RAM/ROM)</span>
              </button>
              <button
                onClick={() => { setShowHdlModal(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                <span>HDL & FPGA (Verilog/VHDL)</span>
              </button>
              <button
                onClick={() => { handleOpenStatsModal(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Devre İstatistikleri & CMOS</span>
              </button>
              <button
                onClick={() => { setShowDatasheetModal(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span>74xx Entegre Datasheets</span>
              </button>
            </div>
          )}
        </div>

        {/* Görünüm */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveDesktopMenu(activeDesktopMenu === 'view' ? null : 'view');
            }}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeDesktopMenu === 'view'
                ? cadTheme === 'dark' ? 'bg-slate-700 text-white' : 'bg-slate-300 text-slate-900 font-bold'
                : 'hover:bg-slate-700/40'
            }`}
          >
            Görünüm
          </button>
          {activeDesktopMenu === 'view' && (
            <div
              className={`absolute top-full left-0 mt-1 w-52 rounded-xl shadow-2xl border py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                cadTheme === 'dark' ? 'bg-[#1E293B] border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => { setShowLeftToolbox(!showLeftToolbox); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Sol Bileşen Paletini Göster</span>
                <span className="text-[10px] font-bold text-blue-400">{showLeftToolbox ? '✓' : ''}</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => { toggleCadTheme(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Tema Değiştir ({cadTheme === 'dark' ? 'Karanlık CAD' : 'Aydınlık'})</span>
              </button>
              <button
                onClick={() => { handleResetView(); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Görünümü Sıfırla (100%)</span>
                <span className="text-[10px] opacity-60 font-mono">100%</span>
              </button>
            </div>
          )}
        </div>

        {/* Yardım */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveDesktopMenu(activeDesktopMenu === 'help' ? null : 'help');
            }}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeDesktopMenu === 'help'
                ? cadTheme === 'dark' ? 'bg-slate-700 text-white' : 'bg-slate-300 text-slate-900 font-bold'
                : 'hover:bg-slate-700/40'
            }`}
          >
            Yardım
          </button>
          {activeDesktopMenu === 'help' && (
            <div
              className={`absolute top-full left-0 mt-1 w-52 rounded-xl shadow-2xl border py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                cadTheme === 'dark' ? 'bg-[#1E293B] border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => { setShowShortcutsModal(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>Klavye Kısayolları</span>
                <span className="text-[10px] opacity-60 font-mono">?</span>
              </button>
              <button
                onClick={() => { setShowAboutModal(true); setActiveDesktopMenu(null); }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <span>LogicDesign Studio Hakkında</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleCadTheme}
          className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-colors cursor-pointer ${
            cadTheme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-blue-400' : 'bg-slate-300 hover:bg-slate-400 text-slate-800'
          }`}
        >
          {cadTheme === 'dark' ? '🌙 Dark CAD' : '☀️ Light'}
        </button>
      </div>
    </div>
  );

  const renderDesktopRibbon = () => (
    <div className={`h-11 px-3 border-b flex items-center justify-between gap-3 text-xs z-30 select-none shadow-2xs ${
      cadTheme === 'dark' ? 'bg-[#0B0F19] border-slate-800' : 'bg-white border-slate-200'
    }`}>
      {/* Sol Hızlı İşlemler */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setShowLeftToolbox(!showLeftToolbox)}
          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
            showLeftToolbox
              ? 'bg-blue-600 text-white border-blue-500'
              : cadTheme === 'dark'
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
          }`}
          title="Sol Bileşen Ağacını Aç/Kapat"
        >
          {showLeftToolbox ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </button>

        <div className={`w-[1px] h-5 mx-1 ${cadTheme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />

        <button
          onClick={() => setIsRunning(!isRunning)}
          className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs transition-all active:scale-95 ${
            isRunning
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          }`}
        >
          {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isRunning ? 'Durdur' : 'Çalıştır'}</span>
        </button>

        <button
          onClick={handleSingleStep}
          disabled={isRunning}
          className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 border transition-colors ${
            isRunning
              ? 'opacity-40 cursor-not-allowed border-transparent'
              : cadTheme === 'dark'
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 cursor-pointer'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 cursor-pointer'
          }`}
          title="Tek Adım Simülasyon (T)"
        >
          <StepForward className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Adım</span>
        </button>

        <button
          onClick={handleResetSimulation}
          className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
            cadTheme === 'dark'
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
          }`}
          title="Simülasyon Değerlerini Sıfırla"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sıfırla</span>
        </button>

        <div className={`w-[1px] h-5 mx-1 ${cadTheme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />

        <div className="flex items-center gap-1">
          <button
            disabled={historyStack.length === 0}
            onClick={handleUndo}
            className={`p-1.5 rounded-lg border transition-colors ${
              historyStack.length === 0
                ? 'opacity-30 cursor-not-allowed border-transparent'
                : cadTheme === 'dark'
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 cursor-pointer'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 cursor-pointer'
            }`}
            title="Geri Al (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            disabled={redoStack.length === 0}
            onClick={handleRedo}
            className={`p-1.5 rounded-lg border transition-colors ${
              redoStack.length === 0
                ? 'opacity-30 cursor-not-allowed border-transparent'
                : cadTheme === 'dark'
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 cursor-pointer'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 cursor-pointer'
            }`}
            title="İleri Al (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className={`w-[1px] h-5 mx-1 ${cadTheme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />

        {/* Hızlı Butonlar: Doğruluk Tablosu, K-Map, Osiloskop */}
        <button
          onClick={() => setShowTruthTable(true)}
          className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
            cadTheme === 'dark' ? 'bg-slate-800/80 hover:bg-slate-800 text-indigo-400 border-slate-700' : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
          }`}
          title="Devre Doğruluk Tablosu & Analizör"
        >
          <Table className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Doğruluk Tablosu</span>
        </button>

        <button
          onClick={() => setShowKMapModal(true)}
          className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
            cadTheme === 'dark' ? 'bg-slate-800/80 hover:bg-slate-800 text-amber-400 border-slate-700' : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
          }`}
          title="Karnaugh Haritası (K-Map Çözücü)"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden md:inline">K-Map</span>
        </button>

        <button
          onClick={() => setShowNumberConverterModal(true)}
          className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
            cadTheme === 'dark' ? 'bg-slate-800/80 hover:bg-slate-800 text-sky-400 border-slate-700' : 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200'
          }`}
          title="Sayı Sistemleri Dönüştürücü (Bin, Oct, Dec, Hex)"
        >
          <Binary className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Sayı Dönüştürücü</span>
        </button>
      </div>

      {/* Sağ Hızlı Kontroller */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => handleAddComponent('textLabel')}
          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
            cadTheme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
          }`}
          title="Metin Etiketi Ekle"
        >
          <Type className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => handleAddAnnotation('note')}
          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
            cadTheme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-amber-400 border-slate-700' : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
          }`}
          title="Yapışkan Not (Sticky Note) Ekle"
        >
          <StickyNote className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => handleAddAnnotation('frame')}
          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
            cadTheme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-blue-400 border-slate-700' : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
          }`}
          title="Modül Gruplama Çerçevesi Ekle"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>

        <div className={`w-[1px] h-5 mx-1 ${cadTheme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />

        <button
          onClick={handleClearCanvas}
          className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1 border transition-colors cursor-pointer ${
            cadTheme === 'dark' ? 'bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border-rose-800' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
          }`}
          title="Tuvali Temizle"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Temizle</span>
        </button>
      </div>
    </div>
  );

  const renderDesktopLeftToolbox = () => {
    const q = desktopToolboxSearch.trim().toLowerCase();

    return (
      <div className={`w-64 shrink-0 h-full border-r flex flex-col select-none z-20 ${
        cadTheme === 'dark' ? 'bg-[#0B0F19] border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
      }`}>
        {/* Search header */}
        <div className="p-2.5 border-b border-inherit">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={desktopToolboxSearch}
              onChange={(e) => setDesktopToolboxSearch(e.target.value)}
              placeholder="Bileşen ara (örn: AND, D-FF, LED)..."
              className={`w-full pl-8 pr-3 py-1.5 rounded-lg text-xs font-medium border outline-none transition-all ${
                cadTheme === 'dark'
                  ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                  : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white'
              }`}
            />
          </div>
        </div>

        {/* Tree Categories */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {DESKTOP_TOOLBOX_GROUPS.map((group) => {
            const filteredItems = group.items.filter(
              (it) => it.name.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q) || it.badge.toLowerCase().includes(q)
            );

            if (q && filteredItems.length === 0) return null;

            const isOpen = q ? true : toolboxCategoryOpen[group.id];

            return (
              <div key={group.id} className="rounded-xl overflow-hidden border border-transparent hover:border-slate-800/40 transition-colors">
                <button
                  onClick={() => toggleToolboxCategory(group.id)}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                    cadTheme === 'dark' ? 'hover:bg-slate-800/60 text-slate-300' : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <span className={`flex items-center gap-2 ${group.color}`}>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`} />
                    <span>{group.name}</span>
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-700/30 text-slate-400">
                    {filteredItems.length}
                  </span>
                </button>

                {isOpen && (
                  <div className="pl-4 pr-1 py-1 space-y-0.5">
                    {filteredItems.map((item) => (
                      <div
                        key={item.type}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/component-type', item.type);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => handleAddComponent(item.type as ComponentType)}
                        className={`group px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-xs cursor-grab active:cursor-grabbing border border-transparent transition-all ${
                          cadTheme === 'dark'
                            ? 'hover:bg-slate-800/80 hover:border-slate-700 text-slate-300 hover:text-white'
                            : 'hover:bg-blue-50/80 hover:border-blue-200 text-slate-700 hover:text-blue-900'
                        }`}
                        title={`${item.desc} (Tıkla veya Tuvale Sürükle)`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 group-hover:bg-blue-500 transition-colors" />
                          <span className="font-medium truncate">{item.name}</span>
                        </div>
                        <span className="font-mono text-[9.5px] px-1 py-0.2 rounded bg-slate-700/20 text-slate-400 font-bold shrink-0">
                          {item.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDesktopStatusBar = () => (
    <div className={`h-7 px-4 border-t flex items-center justify-between text-[11px] font-mono select-none z-30 ${
      cadTheme === 'dark' ? 'bg-[#070A12] border-slate-800 text-slate-400' : 'bg-slate-100 border-slate-300 text-slate-600'
    }`}>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className="font-bold">{isRunning ? 'CANLI SİMÜLASYON' : 'DURAKLATILDI'}</span>
        </span>
        <span className="opacity-40">|</span>
        <span>Saat: <strong>{clockHz} Hz</strong></span>
        <span className="opacity-40">|</span>
        <span>Adım: <strong>{stepCount}</strong></span>
        <span className="opacity-40">|</span>
        <span>Kapılar: <strong>{components.length}</strong></span>
        <span className="opacity-40">|</span>
        <span>Kablolar: <strong>{wires.length}</strong></span>
      </div>

      <div className="flex items-center gap-4">
        <span>Yakınlaştırma: <strong>{Math.round(zoom * 100)}%</strong></span>
        <span className="opacity-40">|</span>
        <span>Izgara: <strong>{gridMode === 'dots' ? 'Nokta' : gridMode === 'lines' ? 'Kareli Defter' : 'Düz'}</strong></span>
        <span className="opacity-40">|</span>
        <span className="text-blue-400 font-semibold">LogicDesign EDA v2.0</span>
      </div>
    </div>
  );

  const renderDesktopExtraModals = () => (
    <>
      {/* K-Map Modal */}
      {showKMapModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>Karnaugh Haritası (K-Map) Çözücü & Minimizasyon</span>
              </div>
              <button
                onClick={() => setShowKMapModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <StandaloneKMapSolver />
            </div>
          </div>
        </div>
      )}

      {/* Number Converter Modal */}
      {showNumberConverterModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                <Binary className="w-4 h-4 text-blue-500" />
                <span>Sayı Sistemleri & Radix Dönüştürücü (2's Complement, Hex, Bin)</span>
              </div>
              <button
                onClick={() => setShowNumberConverterModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <StandaloneNumberConverter />
            </div>
          </div>
        </div>
      )}

      {/* About Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden p-6 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center shadow-inner">
              <Cpu className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-extrabold text-slate-900">LogicDesign Studio</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Masaüstü Sayısal Mantık & İşlemci Tasarım Laboratuvarı.
              Logisim uyumlu devre simülatörü, K-Map minimizasyonu, Boole sentezi ve FPGA HDL ihracatı.
            </p>
            <div className="p-3 bg-slate-50 rounded-2xl border text-xs font-mono text-slate-600 space-y-1">
              <div>Sürüm: <strong>2.0.0-Desktop EDA</strong></div>
              <div>Electron Platform: <strong>Windows x64 Portable</strong></div>
            </div>
            <button
              onClick={() => setShowAboutModal(false)}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs cursor-pointer transition-colors shadow-xs"
            >
              Tamam
            </button>
          </div>
        </div>
      )}
    </>
  );
"""

state_insert_marker = "const [cadTheme, setCadTheme] = useState<'light' | 'dark'>"
text = text.replace(state_insert_marker, desktop_state + "\n  " + state_insert_marker)

# 4. Modify Return Statement:
old_return = """  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Educational Header - Clean, Spacious & Responsive */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">"""

new_return = """  return (
    <div className={desktopMode ? "w-screen h-screen overflow-hidden flex flex-col select-none" : "space-y-6 max-w-7xl mx-auto"}>
      {desktopMode && (
        <>
          {renderDesktopMenuBar()}
          {renderDesktopRibbon()}
        </>
      )}

      {!desktopMode && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">"""

text = text.replace(old_return, new_return)

# 5. Modify Stage Card Header:
old_stage_header = """      {/* Main Simulation Stage Card */}
      <div className={`rounded-3xl border overflow-hidden flex flex-col transition-colors ${
        cadTheme === 'dark'
          ? 'bg-[#0B0F19] border-slate-800 shadow-2xl text-slate-100'
          : 'bg-white border-slate-200 shadow-xs text-slate-900'
      }`}>"""

new_stage_header = """      )}

      {/* Main Simulation Stage Card / Desktop Workspace Row */}
      <div className={desktopMode ? "flex-1 w-full min-h-0 flex flex-row overflow-hidden relative" : `rounded-3xl border overflow-hidden flex flex-col transition-colors ${
        cadTheme === 'dark'
          ? 'bg-[#0B0F19] border-slate-800 shadow-2xl text-slate-100'
          : 'bg-white border-slate-200 shadow-xs text-slate-900'
      }`}>
        {desktopMode && showLeftToolbox && renderDesktopLeftToolbox()}

        <div className={desktopMode ? "flex-1 h-full min-h-0 flex flex-col relative overflow-hidden" : "contents"}>
          {!desktopMode && (
            <>"""

text = text.replace(old_stage_header, new_stage_header)

# 6. Close Tier 1/2 and Horizontal Catalog before Tabs:
old_tabs = "{/* Multi-Sheet Project Workspace Tabs Header */}"
new_tabs = """            </>
          )}

          {/* Multi-Sheet Project Workspace Tabs Header */}"""
text = text.replace(old_tabs, new_tabs)

# 7. Modify SVG Canvas Container:
old_canvas = """        {/* Interactive SVG Canvas */}
        <div
          ref={canvasContainerRef}
          className={`relative w-full overflow-hidden select-none transition-colors ${
            cadTheme === 'dark' ? 'bg-[#070A12]' : 'bg-slate-50/60'
          }`}
          style={{ minHeight: '560px' }}
        >"""

new_canvas = """        {/* Interactive SVG Canvas */}
        <div
          ref={canvasContainerRef}
          className={desktopMode ? `relative flex-1 w-full h-full overflow-hidden select-none transition-colors ${
            cadTheme === 'dark' ? 'bg-[#070A12]' : 'bg-slate-50/60'
          }` : `relative w-full overflow-hidden select-none transition-colors ${
            cadTheme === 'dark' ? 'bg-[#070A12]' : 'bg-slate-50/60'
          }`}
          style={desktopMode ? { width: '100%', height: '100%' } : { minHeight: '560px' }}
          onDragOver={desktopMode ? (e) => e.preventDefault() : undefined}
          onDrop={desktopMode ? handleCanvasDrop : undefined}
        >"""

text = text.replace(old_canvas, new_canvas)

# 8. Modify Live Analyzer / End of Stage Card:
old_stage_end = """        {/* Live Logic Analyzer / Truth Bar */}
        <div className={`p-5 border-t flex flex-wrap items-center justify-between gap-4 text-xs transition-colors ${
          cadTheme === 'dark' ? 'bg-[#090D16] border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>"""

new_stage_end = """        {!desktopMode && (
          <div className={`p-5 border-t flex flex-wrap items-center justify-between gap-4 text-xs transition-colors ${
            cadTheme === 'dark' ? 'bg-[#090D16] border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}>"""

text = text.replace(old_stage_end, new_stage_end)

# And close stage card:
old_card_close = """          <div className="text-slate-500 font-mono text-[11px]">
            Bileşen Sayısı: <strong>{components.length}</strong> • Kablo Sayısı: <strong>{wires.length}</strong> • Adım: <strong>{stepCount}</strong>
          </div>
        </div>
      </div>"""

new_card_close = """          <div className="text-slate-500 font-mono text-[11px]">
            Bileşen Sayısı: <strong>{components.length}</strong> • Kablo Sayısı: <strong>{wires.length}</strong> • Adım: <strong>{stepCount}</strong>
          </div>
        </div>
        )}

        {desktopMode && renderDesktopStatusBar()}
        </div>
      </div>

      {desktopMode && renderDesktopExtraModals()}"""

text = text.replace(old_card_close, new_card_close)

with open(target, "w", encoding="utf-8") as f:
    f.write(text)

print("Desktop CAD layout applied successfully to Logic Design Studio!")
