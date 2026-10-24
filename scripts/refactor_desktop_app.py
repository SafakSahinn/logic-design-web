import os
import sys

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

target = r"C:\Users\safak\Desktop\Logic Design Studio\src\components\LogisimSimulator.tsx"

with open(target, "r", encoding="utf-8") as f:
    text = f.read()

# Marker 1: Start of return statement
idx_return = text.find('return (\n    <div className="space-y-6 max-w-7xl mx-auto">')
if idx_return == -1:
    idx_return = text.find('return (\r\n    <div className="space-y-6 max-w-7xl mx-auto">')

# Marker 2: Multi-sheet tabs header
idx_tabs = text.find('{/* Multi-Sheet Project Workspace Tabs Header */}')

# Marker 3: Interactive SVG canvas
idx_canvas = text.find('{/* Interactive SVG Canvas */}')

# Marker 4: Truth table modal
idx_modals = text.find('{/* Truth Table Modal */}')

# Marker 5: End of component (before the final </div>\n  );\n};)
idx_end = text.rfind('{/* Floating Action Toast Notification */}')

print(f"Indices: return={idx_return}, tabs={idx_tabs}, canvas={idx_canvas}, modals={idx_modals}, end={idx_end}")

if -1 in (idx_return, idx_tabs, idx_canvas, idx_modals, idx_end):
    print("Error: Could not find all indices!")
    exit(1)

# Extract parts:
# before_return: everything up to return (
before_return = text[:idx_return]

# sheet_tabs_code: from idx_tabs to idx_canvas
sheet_tabs_code = text[idx_tabs:idx_canvas].strip()

# canvas_code: from idx_canvas to closing of simulation stage card (just before idx_modals)
# Note: before idx_modals there are closing tags </div>\n        </div>\n      )}\n\n      
# Let's find the closing </div> of canvasContainerRef before idx_modals
canvas_block = text[idx_canvas:idx_modals].strip()
# Let's ensure canvas_block ends properly: it ends with </div> (closing canvasContainerRef) or closing of stage card
# In text[idx_canvas:idx_modals], the last tag is the closing of stage card.
# Let's inspect the end of canvas_block
print("Canvas block ends with:", canvas_block[-120:])

# modals_code: from idx_modals to idx_end + toast
modals_code = text[idx_modals:idx_end].strip()
toast_and_end = text[idx_end:].strip()
# remove trailing </div>\n  );\n};\n\n// Backward-compatible alias export\nexport const LogisimSimulator = LogicCircuitSimulator;
end_export_idx = toast_and_end.rfind("export const LogisimSimulator = LogicCircuitSimulator;")
toast_code = toast_and_end[:end_export_idx].strip()
if toast_code.endswith("</div>\n  );"):
    toast_code = toast_code[:-len("</div>\n  );")].strip()
elif toast_code.endswith("</div>\r\n  );"):
    toast_code = toast_code[:-len("</div>\r\n  );")].strip()
elif toast_code.endswith("</div>"):
    toast_code = toast_code[:-len("</div>")].strip()

print("Toast code ends with:", toast_code[-100:])

desktop_toolbox_def = """
  const DESKTOP_TOOLBOX_GROUPS = [
    {
      id: 'wiring',
      name: 'Kablolama & Güç',
      color: 'text-sky-500',
      items: [
        { type: 'vcc', name: 'VCC (+5V)', desc: 'Sabit Mantık 1 Kaynağı', badge: '+5V' },
        { type: 'gnd', name: 'Toprak (GND)', desc: 'Sabit Mantık 0 (Toprak)', badge: '0V' },
        { type: 'clock', name: 'Saat Jeneratörü', desc: 'Ayarlanabilir Periyodik Saat', badge: 'CLK' },
        { type: 'triState', name: 'Tri-State Tampon', desc: 'Üç Durumlu Sinyal Geçidi', badge: 'TRI' },
        { type: 'pin', name: 'Bağlantı Pini', desc: 'Genel I/O Pini', badge: 'PIN' },
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
        { type: 'display7Segment', name: '7-Segment Display', desc: 'Sayısal Gösterge', badge: '7SEG' },
        { type: 'displayHex', name: '4-Bit Hex Display', desc: 'Onaltılık Büyük Karakter', badge: 'HEX' },
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
        { type: 'alu4', name: '4-Bit ALU (74HC181)', desc: 'Aritmetik Mantık Birimi', badge: 'ALU' },
        { type: 'mux2', name: 'Multiplexer 2:1', desc: '2 Kanaldan 1 Hat Seçici', badge: 'MUX2' },
        { type: 'mux8', name: 'Multiplexer 8:1', desc: '8 Kanaldan 1 Hat Seçici', badge: 'MUX8' },
        { type: 'demux2', name: 'Demultiplexer 1:2', desc: '1 Hattan 2 Kanala Yönlendirici', badge: 'DEMUX' },
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
        { type: 'counter', name: '4-Bit Senkron Sayaç', desc: '0-15 İkili İleri Sayaç', badge: 'CTR' },
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
        { type: 'rgbMatrix', name: '16x16 RGB LED Matrix', desc: '256 Piksellik Renkli GPU Ekranı', badge: 'GPU' },
      ],
    },
  ];
"""

# Now write the helper render functions
render_helpers = """
  // Desktop Menu Bar Dropdowns
  const renderDesktopMenuBar = () => (
    <div className={`h-9 px-3 border-b flex items-center justify-between text-xs font-medium z-40 select-none ${
      cadTheme === 'dark' ? 'bg-[#0F172A] border-slate-800 text-slate-300' : 'bg-slate-200/90 border-slate-300 text-slate-700'
    }`}>
      <div className="flex items-center gap-1">
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-2 mr-3 font-bold text-sm tracking-tight text-blue-500">
          <Cpu className="w-4 h-4 text-blue-500" />
          <span className={cadTheme === 'dark' ? 'text-white font-extrabold' : 'text-slate-900 font-extrabold'}>LogicDesign Studio</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-600/20 text-blue-400 font-mono font-bold">EDA</span>
        </div>

        {/* 1. Dosya (File) Menu */}
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
                onClick={() => {
                  handleClearCanvas();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Yeni Devre (New)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+N</span>
              </button>
              <button
                onClick={() => {
                  fileInputRef.current?.click();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Devre Aç... (Open JSON/circ)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+O</span>
              </button>
              <button
                onClick={() => {
                  handleExportJSON();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Kaydet (Save JSON)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+S</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  handleExportCirc();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Logisim (.circ) Olarak Dışa Aktar</span>
                <span className="text-[10px] opacity-60 font-mono">.circ</span>
              </button>
              <button
                onClick={() => {
                  handleExportPNG();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>PNG Resmi Olarak Dışa Aktar</span>
                <span className="text-[10px] opacity-60 font-mono">PNG</span>
              </button>
              <button
                onClick={() => {
                  handleExportSVG();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>SVG Vektörel Olarak Dışa Aktar</span>
                <span className="text-[10px] opacity-60 font-mono">SVG</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  handleAddSheet();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Yeni Çalışma Sayfası Ekle</span>
                <span className="text-[10px] opacity-60 font-mono">+</span>
              </button>
            </div>
          )}
        </div>

        {/* 2. Düzenle (Edit) Menu */}
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
                onClick={() => {
                  handleUndo();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Geri Al (Undo)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+Z</span>
              </button>
              <button
                disabled={redoStack.length === 0}
                onClick={() => {
                  handleRedo();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>İleri Al (Redo)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+Y</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  handleDuplicateSelected();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Çoğalt (Duplicate)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+D</span>
              </button>
              <button
                onClick={() => {
                  handleRotateSelected();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>90° Döndür (Rotate)</span>
                <span className="text-[10px] opacity-60 font-mono">R</span>
              </button>
              <button
                onClick={() => {
                  handleDeleteSelected();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-rose-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Seçilileri Sil (Delete)</span>
                <span className="text-[10px] opacity-60 font-mono">Del</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  setShowCommandPalette(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Komut Paleti (Spotlight)</span>
                <span className="text-[10px] opacity-60 font-mono">Ctrl+K</span>
              </button>
            </div>
          )}
        </div>

        {/* 3. Simülasyon (Simulation) Menu */}
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
                onClick={() => {
                  setIsRunning(!isRunning);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>{isRunning ? 'Simülasyonu Durdur' : 'Simülasyonu Çalıştır'}</span>
                <span className="text-[10px] opacity-60 font-mono">Space</span>
              </button>
              <button
                onClick={() => {
                  handleSingleStep();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Tek Adım İlerle (Step)</span>
                <span className="text-[10px] opacity-60 font-mono">T</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <div className="px-3 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Saat Frekansı (Hz)
              </div>
              <div className="grid grid-cols-3 gap-1 px-3 py-1">
                {[0.5, 1, 2, 4, 6, 8].map((hz) => (
                  <button
                    key={hz}
                    onClick={() => {
                      setClockHz(hz);
                      setActiveDesktopMenu(null);
                    }}
                    className={`py-1 text-center rounded font-mono text-[11px] font-bold cursor-pointer transition-colors ${
                      clockHz === hz ? 'bg-blue-600 text-white' : 'bg-slate-700/50 hover:bg-slate-700'
                    }`}
                  >
                    {hz}Hz
                  </button>
                ))}
              </div>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  setShowWireJumpBridges(!showWireJumpBridges);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Atlama Köprüleri (Jump Bridges)</span>
                <span className="text-[10px] font-bold text-blue-400">{showWireJumpBridges ? 'Açık' : 'Kapalı'}</span>
              </button>
              <button
                onClick={() => {
                  setIsSoundMuted(!isSoundMuted);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Ses Efektleri Motoru</span>
                <span className="text-[10px] font-bold text-blue-400">{isSoundMuted ? 'Sessiz' : 'Açık'}</span>
              </button>
            </div>
          )}
        </div>

        {/* 4. Mühendislik Araçları (Tools) Menu */}
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
                onClick={() => {
                  setShowKMapModal(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>K-Map Çözücü (Karnaugh)</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">SOP</span>
              </button>
              <button
                onClick={() => {
                  setShowNumberConverterModal(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Binary className="w-3.5 h-3.5 text-blue-400" />
                  <span>Sayı Sistemleri & Radix</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">Bin/Hex</span>
              </button>
              <button
                onClick={() => {
                  setShowWaveform((p) => !p);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Zamanlama Osiloskobu</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">Scope</span>
              </button>
              <button
                onClick={() => {
                  setShowTruthTable(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Table className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Doğruluk Tablosu (Truth Table)</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">Table</span>
              </button>
              <button
                onClick={() => {
                  setShowSynthesizer(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Boole Formülü Sentezleyici</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">Synth</span>
              </button>
              <button
                onClick={() => {
                  setShowFsmModal(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Workflow className="w-3.5 h-3.5 text-pink-400" />
                  <span>FSM Durum Makinesi Tasarla</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">FSM</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  handleOpenHexEditor();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Binary className="w-3.5 h-3.5 text-sky-400" />
                  <span>Hex Bellek Düzenleyici (RAM/ROM)</span>
                </div>
              </button>
              <button
                onClick={() => {
                  setShowHdlModal(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                  <span>HDL & FPGA (Verilog/VHDL)</span>
                </div>
              </button>
              <button
                onClick={() => {
                  handleOpenStatsModal();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Devre İstatistikleri & CMOS Raporu</span>
                </div>
              </button>
              <button
                onClick={() => {
                  setShowDatasheetModal(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <span>74xx Serisi Entegre Datasheets</span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* 5. Görünüm (View) Menu */}
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
                onClick={() => {
                  setShowLeftToolbox(!showLeftToolbox);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Sol Bileşen Paletini Göster</span>
                <span className="text-[10px] font-bold text-blue-400">{showLeftToolbox ? '✓' : ''}</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  setZoom((z) => Math.min(2.5, z + 0.15));
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Yakınlaştır (Zoom In)</span>
                <span className="text-[10px] opacity-60 font-mono">+</span>
              </button>
              <button
                onClick={() => {
                  setZoom((z) => Math.max(0.4, z - 0.15));
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Uzaklaştır (Zoom Out)</span>
                <span className="text-[10px] opacity-60 font-mono">-</span>
              </button>
              <button
                onClick={() => {
                  setZoom(1);
                  setPanOffset({ x: 0, y: 0 });
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>%100 Boyutuna Sıfırla</span>
                <span className="text-[10px] opacity-60 font-mono">100%</span>
              </button>
              <button
                onClick={() => {
                  handleFitView();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Görünüme Sığdır (Fit View)</span>
                <span className="text-[10px] opacity-60 font-mono">Fit</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  toggleCadTheme();
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>CAD Teması ({cadTheme === 'dark' ? 'Koyu' : 'Açık'})</span>
                <span className="text-[10px] opacity-60 font-mono">{cadTheme === 'dark' ? '🌙' : '☀️'}</span>
              </button>
            </div>
          )}
        </div>

        {/* 6. Yardım (Help) Menu */}
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
                onClick={() => {
                  setShowShortcutsModal(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>Klavye Kısayolları Kartı</span>
                <span className="text-[10px] opacity-60 font-mono">F1</span>
              </button>
              <div className="my-1 border-t border-slate-600/30" />
              <button
                onClick={() => {
                  setShowAboutModal(true);
                  setActiveDesktopMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <span>LogicDesign Studio Hakkında</span>
                <span className="text-[10px] opacity-60 font-mono">v1.0</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-2">
        {/* Preset Selector Dropdown */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Şablon:</span>
          <select
            value={selectedPresetId || ''}
            onChange={(e) => {
              const pid = e.target.value;
              if (pid) handleLoadPreset(pid);
            }}
            className={`px-2 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
              cadTheme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'
            }`}
          >
            <option value="">Devre Şablonu Seç...</option>
            {CIRCUIT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name.split('(')[0].trim()}</option>
            ))}
          </select>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleCadTheme}
          className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
            cadTheme === 'dark' ? 'bg-slate-800 border-slate-700 text-amber-400 hover:bg-slate-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
          }`}
          title={cadTheme === 'dark' ? 'Açık CAD Temasına Geç' : 'Koyu CAD Temasına Geç'}
        >
          {cadTheme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>

        {/* Sound Toggle Button */}
        <button
          onClick={() => setIsSoundMuted(!isSoundMuted)}
          className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
            isSoundMuted
              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
              : cadTheme === 'dark'
              ? 'bg-slate-800 border-slate-700 text-blue-400 hover:bg-slate-700'
              : 'bg-white border-slate-300 text-blue-600 hover:bg-slate-100'
          }`}
          title={isSoundMuted ? 'Sesi Aç' : 'Sesi Kapat'}
        >
          {isSoundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );

  // Desktop Quick Ribbon Toolbar
  const renderDesktopRibbon = () => (
    <div className={`h-11 px-3 border-b flex items-center justify-between gap-2 z-30 select-none ${
      cadTheme === 'dark' ? 'bg-[#0B0F19] border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
    }`}>
      {/* Left: Simulation Engine controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setIsRunning(!isRunning)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-all select-none ${
            isRunning
              ? 'bg-amber-500 hover:bg-amber-600 text-white active:scale-95'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95'
          }`}
        >
          {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isRunning ? 'Durdur' : 'Çalıştır'}</span>
        </button>

        <button
          onClick={handleSingleStep}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border shadow-2xs flex items-center gap-1 cursor-pointer transition-colors select-none ${
            cadTheme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-blue-300 border-slate-700' : 'bg-slate-50 hover:bg-blue-50 text-blue-700 border-slate-200'
          }`}
          title="Tek Adım İlerle"
        >
          <StepForward className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tek Adım</span>
        </button>

        {/* Clock speed buttons */}
        <div className={`flex items-center gap-0.5 p-0.5 rounded-xl border text-xs ${
          cadTheme === 'dark' ? 'bg-slate-800/90 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-600'
        }`}>
          {[0.5, 1, 2, 4, 6, 8].map((hz) => (
            <button
              key={hz}
              onClick={() => setClockHz(hz)}
              className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono font-bold cursor-pointer transition-colors ${
                clockHz === hz ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {hz}Hz
            </button>
          ))}
        </div>

        {/* Wire Crossing Jumper Toggle */}
        <button
          onClick={() => setShowWireJumpBridges(!showWireJumpBridges)}
          className={`px-2 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
            showWireJumpBridges
              ? 'bg-blue-600/15 text-blue-400 border-blue-500/40'
              : 'bg-transparent text-slate-400 border-slate-700'
          }`}
          title="Kesişen kablolarda atlama köprülerini aç/kapat"
        >
          Köprü: {showWireJumpBridges ? 'Açık' : 'Kapalı'}
        </button>
      </div>

      {/* Center: Engineering Tools Fast Launch */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowKMapModal(true)}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 cursor-pointer transition-colors ${
            cadTheme === 'dark' ? 'bg-amber-950/40 text-amber-300 border-amber-800/50 hover:bg-amber-900/60' : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
          }`}
          title="Karnaugh Haritası (K-Map) Çözücüyü Aç"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>K-Map</span>
        </button>

        <button
          onClick={() => setShowNumberConverterModal(true)}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 cursor-pointer transition-colors ${
            cadTheme === 'dark' ? 'bg-blue-950/40 text-blue-300 border-blue-800/50 hover:bg-blue-900/60' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
          }`}
          title="Sayı Sistemleri ve Radix Çeviriciyi Aç"
        >
          <Binary className="w-3.5 h-3.5 text-blue-400" />
          <span>Sayı Dönüştürücü</span>
        </button>

        <button
          onClick={() => setShowWaveform((p) => !p)}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 cursor-pointer transition-colors ${
            showWaveform
              ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/50'
              : cadTheme === 'dark' ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
          }`}
          title="Zamanlama Osiloskobunu Aç/Kapat"
        >
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span>Osiloskop</span>
        </button>

        <button
          onClick={() => setShowSynthesizer(true)}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 cursor-pointer transition-colors ${
            cadTheme === 'dark' ? 'bg-amber-950/30 text-amber-300 border-amber-800/40 hover:bg-amber-900/50' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
          }`}
          title="Boole Mantık Formülü Sentezleyici"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Boole Sentez</span>
        </button>

        <button
          onClick={() => setShowTruthTable(true)}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 cursor-pointer transition-colors ${
            cadTheme === 'dark' ? 'bg-indigo-950/40 text-indigo-300 border-indigo-800/50 hover:bg-indigo-900/60' : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
          }`}
          title="Doğruluk Tablosu"
        >
          <Table className="w-3.5 h-3.5 text-indigo-400" />
          <span>Tablo</span>
        </button>

        <button
          onClick={() => setShowFsmModal(true)}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 cursor-pointer transition-colors ${
            cadTheme === 'dark' ? 'bg-pink-950/40 text-pink-300 border-pink-800/50 hover:bg-pink-900/60' : 'bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100'
          }`}
          title="FSM Durum Makinesi"
        >
          <Workflow className="w-3.5 h-3.5 text-pink-400" />
          <span>FSM</span>
        </button>
      </div>

      {/* Right: Zoom & Left Sidebar Toggle */}
      <div className="flex items-center gap-1.5">
        <div className={`flex items-center gap-0.5 p-0.5 rounded-xl border ${
          cadTheme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
        }`}>
          <button
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}
            className="p-1.5 rounded hover:bg-slate-700/50 cursor-pointer text-slate-300"
            title="Uzaklaştır (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPanOffset({ x: 0, y: 0 });
            }}
            className="px-2 py-0.5 font-mono text-[11px] font-bold text-slate-300 hover:bg-slate-700/50 rounded cursor-pointer"
            title="%100 Sıfırla"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
            className="p-1.5 rounded hover:bg-slate-700/50 cursor-pointer text-slate-300"
            title="Yakınlaştır (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleFitView}
            className="p-1.5 rounded hover:bg-slate-700/50 cursor-pointer text-slate-300"
            title="Görünüme Sığdır"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Sidebar Toggle Button */}
        <button
          onClick={() => setShowLeftToolbox(!showLeftToolbox)}
          className={`p-1.5 rounded-xl border cursor-pointer transition-colors ${
            showLeftToolbox
              ? 'bg-blue-600/15 text-blue-400 border-blue-500/40'
              : cadTheme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
          }`}
          title={showLeftToolbox ? 'Sol Paleti Gizle' : 'Sol Paleti Göster'}
        >
          {showLeftToolbox ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  // Desktop Left Logisim Component Palette Tree
  const renderDesktopLeftToolbox = () => {
    const q = desktopToolboxSearch.trim().toLowerCase();

    return (
      <div className={`w-64 h-full border-r flex flex-col shrink-0 select-none z-20 ${
        cadTheme === 'dark' ? 'bg-[#0F172A] border-slate-800' : 'bg-slate-50 border-slate-200'
      }`}>
        {/* Search header */}
        <div className="p-2.5 border-b border-slate-700/50">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Bileşen kütüphanesinde ara..."
              value={desktopToolboxSearch}
              onChange={(e) => setDesktopToolboxSearch(e.target.value)}
              className={`w-full pl-8 pr-7 py-1.5 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium border ${
                cadTheme === 'dark'
                  ? 'bg-slate-800/90 border-slate-700 text-slate-100 placeholder:text-slate-500'
                  : 'bg-white border-slate-200 text-slate-800 placeholder:text-slate-400'
              }`}
            />
            {desktopToolboxSearch && (
              <button
                onClick={() => setDesktopToolboxSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5 cursor-pointer text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Scrollable categorized component items */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {DESKTOP_TOOLBOX_GROUPS.map((group) => {
            const filteredItems = group.items.filter((item) => {
              if (!q) return true;
              return (
                item.name.toLowerCase().includes(q) ||
                item.type.toLowerCase().includes(q) ||
                item.desc.toLowerCase().includes(q) ||
                item.badge.toLowerCase().includes(q)
              );
            });

            if (filteredItems.length === 0 && q) return null;

            const isOpen = q ? true : toolboxCategoryOpen[group.id] !== false;

            return (
              <div key={group.id} className="rounded-xl overflow-hidden border border-slate-700/30">
                <button
                  onClick={() => toggleToolboxCategory(group.id)}
                  className={`w-full px-2.5 py-1.5 flex items-center justify-between text-xs font-bold transition-colors cursor-pointer ${
                    cadTheme === 'dark' ? 'bg-slate-800/60 hover:bg-slate-800 text-slate-200' : 'bg-slate-200/60 hover:bg-slate-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${group.color.replace('text-', 'bg-')}`} />
                    <span>{group.name}</span>
                    <span className="text-[10px] text-slate-400 font-normal">({filteredItems.length})</span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className={`p-1 space-y-0.5 divide-y divide-slate-700/20 ${
                    cadTheme === 'dark' ? 'bg-slate-900/60' : 'bg-white'
                  }`}>
                    {filteredItems.map((item) => (
                      <div
                        key={item.type}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/component-type', item.type);
                        }}
                        onClick={() => handleAddComponent(item.type as ComponentType)}
                        className={`px-2 py-1.5 rounded-lg flex items-center justify-between transition-colors cursor-pointer group select-none ${
                          cadTheme === 'dark' ? 'hover:bg-slate-800 text-slate-300 hover:text-white' : 'hover:bg-blue-50 text-slate-700 hover:text-blue-900'
                        }`}
                        title={`${item.name} (${item.desc}) - Tıklayarak veya sürükleyerek tuvale ekleyin`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-1.5 py-0.5 text-[9.5px] font-mono font-black rounded bg-slate-800 text-blue-400 border border-slate-700 shrink-0">
                            {item.badge}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate leading-tight">{item.name}</div>
                            <div className="text-[10px] text-slate-400 truncate leading-tight">{item.desc}</div>
                          </div>
                        </div>
                        <Plus className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Custom subcircuits section */}
          {customSubcircuits.length > 0 && (
            <div className="rounded-xl overflow-hidden border border-slate-700/30">
              <button
                onClick={() => toggleToolboxCategory('custom')}
                className={`w-full px-2.5 py-1.5 flex items-center justify-between text-xs font-bold transition-colors cursor-pointer ${
                  cadTheme === 'dark' ? 'bg-slate-800/60 hover:bg-slate-800 text-slate-200' : 'bg-slate-200/60 hover:bg-slate-200 text-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Özel Entegreler ({customSubcircuits.length})</span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
              {toolboxCategoryOpen['custom'] && (
                <div className={`p-1 space-y-0.5 ${cadTheme === 'dark' ? 'bg-slate-900/60' : 'bg-white'}`}>
                  {customSubcircuits.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => handleAddSubcircuit(sub)}
                      className="w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left hover:bg-indigo-600/20 text-slate-300 hover:text-white cursor-pointer"
                    >
                      <span className="text-xs font-bold">{sub.name}</span>
                      <span className="text-[10px] text-indigo-400 font-mono">{sub.chipCode || 'IC'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Desktop Status Bar at bottom
  const renderDesktopStatusBar = () => (
    <div className={`h-6 px-3 border-t flex items-center justify-between text-[11px] font-medium select-none z-30 ${
      cadTheme === 'dark' ? 'bg-[#090D16] border-slate-800 text-slate-400' : 'bg-slate-200/80 border-slate-300 text-slate-600'
    }`}>
      {/* Left: Simulation & Status */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 font-bold">
          <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className={isRunning ? 'text-emerald-400' : 'text-amber-400'}>
            {isRunning ? `ÇALIŞIYOR (${clockHz} Hz)` : 'DURAKLATILDI'}
          </span>
        </span>
        <span className="opacity-40">|</span>
        <span>Sayfa: <strong className="text-slate-200">{sheets.find((s) => s.id === activeSheetId)?.name || 'Ana Devre'}</strong></span>
        <span className="opacity-40">|</span>
        <span>Mod: <strong>{canvasMode === 'pan' ? 'Gezinme' : 'Seçim & Manhattan Kablolama'}</strong></span>
      </div>

      {/* Center: Component & Wire Counts */}
      <div className="flex items-center gap-3">
        <span>{components.length} Bileşen</span>
        <span className="opacity-40">•</span>
        <span>{wires.length} Kablo</span>
        <span className="opacity-40">•</span>
        <span>{sheets.length} Sayfa</span>
      </div>

      {/* Right: Coordinates & Zoom & Hints */}
      <div className="flex items-center gap-3 font-mono">
        <span>X: {Math.round(mousePos.x)}, Y: {Math.round(mousePos.y)}</span>
        <span className="opacity-40">|</span>
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span className="opacity-40">|</span>
        <span className="font-sans text-[10px] opacity-75 hidden xl:inline">[Space]=Kaydır [R]=Döndür [Ctrl+K]=Komut</span>
      </div>
    </div>
  );

  // Desktop Extra Modals (K-Map, Number Converter, About)
  const renderDesktopExtraModals = () => (
    <>
      {/* 1. K-Map Solver Modal */}
      {showKMapModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shadow-xs">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Karnaugh Haritası (K-Map) Çözücü & Sadeleştirici</h3>
                  <p className="text-[11px] text-slate-400">Minimal SOP Çözümü, Renkli Çerçeve Grupları ve Doğruluk Matrisi</p>
                </div>
              </div>
              <button
                onClick={() => setShowKMapModal(false)}
                className="p-1.5 hover:bg-slate-200/80 text-slate-400 hover:text-slate-600 rounded-xl transition-colors cursor-pointer"
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

      {/* 2. Number Converter Modal */}
      {showNumberConverterModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-xs">
                  <Binary className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Sayı Sistemleri & Radix Dönüştürücü</h3>
                  <p className="text-[11px] text-slate-400">İkili (Binary), Onluk (Decimal), Onaltılık (Hex), Sekizlik (Octal) ve 2'ye Tümleyen</p>
                </div>
              </div>
              <button
                onClick={() => setShowNumberConverterModal(false)}
                className="p-1.5 hover:bg-slate-200/80 text-slate-400 hover:text-slate-600 rounded-xl transition-colors cursor-pointer"
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

      {/* 3. About Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden flex flex-col p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-blue-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-blue-500/30">
              <Cpu className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900">LogicDesign Studio</h3>
              <p className="text-xs font-semibold text-blue-600">Sürüm 1.0.0 (Masaüstü EDA / CAD Sürümü)</p>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Gelişmiş dijital mantık simülatörü, ANSI kapı kütüphanesi, Manhattan kablolama, K-Map çözücü, timing osiloskobu ve müzik/grafik çevre birimlerine sahip profesyonel devre tasarım yazılımı.
            </p>
            <div className="pt-2 border-t border-slate-100 flex justify-center">
              <button
                onClick={() => setShowAboutModal(false)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
"""

# Let's construct the desktop return block
desktop_return_block = """
  if (desktopMode) {
    return (
      <div className={`w-screen h-screen overflow-hidden flex flex-col select-none ${
        cadTheme === 'dark' ? 'bg-[#080C14] text-slate-100' : 'bg-slate-100 text-slate-800'
      }`}>
        {/* 1. Desktop Window Menu Bar */}
        {renderDesktopMenuBar()}

        {/* 2. Desktop Quick Ribbon Toolbar */}
        {renderDesktopRibbon()}

        {/* 3. Main Workspace Row: Left Logisim Toolbox + Full Canvas + Bottom Status Bar */}
        <div className="flex-1 w-full min-h-0 flex flex-row overflow-hidden relative">
          {showLeftToolbox && renderDesktopLeftToolbox()}

          <div className="flex-1 h-full min-h-0 flex flex-col relative overflow-hidden">
            {/* Multi-Sheet Tabs Header */}
            """ + sheet_tabs_code + """

            {/* Interactive SVG Canvas filling 100% of remaining area */}
            <div
              ref={canvasContainerRef}
              className={`relative flex-1 w-full h-full overflow-hidden select-none transition-colors ${
                cadTheme === 'dark' ? 'bg-[#070A12]' : 'bg-slate-50/60'
              }`}
              style={{ width: '100%', height: '100%' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleCanvasDrop}
            >
              """ + canvas_block[canvas_block.find("<svg"):canvas_block.rfind("</div>")] + """
            </div>

            {/* Bottom Status Bar */}
            {renderDesktopStatusBar()}
          </div>
        </div>

        {/* 4. Desktop Extra Modals & Common Modals */}
        {renderDesktopExtraModals()}
        """ + modals_code + """
        """ + toast_code + """
      </div>
    );
  }
"""

# Now write everything into the target file:
new_content = before_return + desktop_toolbox_def + render_helpers + desktop_return_block + "\n\n  " + text[idx_return:]

with open(target, "w", encoding="utf-8") as f:
    f.write(new_content)

print("Successfully refactored LogisimSimulator.tsx with desktopMode support!")
