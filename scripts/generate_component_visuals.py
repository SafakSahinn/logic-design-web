import os
import subprocess
import tempfile
import shutil
from PIL import Image

COMPONENTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "components")
os.makedirs(COMPONENTS_DIR, exist_ok=True)

CHROME_BIN = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# Grid configuration: 4 columns x 6 rows = 24 cells. Each cell 180x120 px.
CELL_W = 180
CELL_H = 120
COLS = 4
ROWS = 6
TOTAL_W = COLS * CELL_W
TOTAL_H = ROWS * CELL_H

COMPONENTS = [
    ("comp_and", "AND Kapısı", """
      <line x1="16" y1="36" x2="38" y2="36" stroke="#64748b" stroke-width="3" />
      <line x1="16" y1="64" x2="38" y2="64" stroke="#64748b" stroke-width="3" />
      <path d="M 38,20 L 78,20 A 30,30 0 0,1 78,80 L 38,80 Z" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <line x1="108" y1="50" x2="134" y2="50" stroke="#64748b" stroke-width="3" />
      <text x="64" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="14" fill="#0f172a">AND</text>
    """),
    ("comp_or", "OR Kapısı", """
      <line x1="16" y1="36" x2="42" y2="36" stroke="#64748b" stroke-width="3" />
      <line x1="16" y1="64" x2="42" y2="64" stroke="#64748b" stroke-width="3" />
      <path d="M 38,20 Q 56,50 38,80 Q 82,80 110,50 Q 82,20 38,20 Z" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <line x1="110" y1="50" x2="134" y2="50" stroke="#64748b" stroke-width="3" />
      <text x="68" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="14" fill="#0f172a">OR</text>
    """),
    ("comp_not", "NOT Kapısı", """
      <line x1="18" y1="50" x2="40" y2="50" stroke="#64748b" stroke-width="3" />
      <polygon points="40,24 94,50 40,76" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <circle cx="102" cy="50" r="7.5" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <line x1="110" y1="50" x2="134" y2="50" stroke="#64748b" stroke-width="3" />
      <text x="62" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="13" fill="#0f172a">NOT</text>
    """),
    ("comp_nand", "NAND Kapısı", """
      <line x1="16" y1="36" x2="36" y2="36" stroke="#64748b" stroke-width="3" />
      <line x1="16" y1="64" x2="36" y2="64" stroke="#64748b" stroke-width="3" />
      <path d="M 36,20 L 74,20 A 30,30 0 0,1 74,80 L 36,80 Z" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <circle cx="111" cy="50" r="7" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <line x1="118" y1="50" x2="134" y2="50" stroke="#64748b" stroke-width="3" />
      <text x="62" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="13" fill="#0f172a">NAND</text>
    """),
    ("comp_nor", "NOR Kapısı", """
      <line x1="16" y1="36" x2="40" y2="36" stroke="#64748b" stroke-width="3" />
      <line x1="16" y1="64" x2="40" y2="64" stroke="#64748b" stroke-width="3" />
      <path d="M 36,20 Q 52,50 36,80 Q 76,80 102,50 Q 76,20 36,20 Z" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <circle cx="109" cy="50" r="7" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <line x1="116" y1="50" x2="134" y2="50" stroke="#64748b" stroke-width="3" />
      <text x="64" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="13" fill="#0f172a">NOR</text>
    """),
    ("comp_xor", "XOR Kapısı", """
      <line x1="14" y1="36" x2="28" y2="36" stroke="#64748b" stroke-width="3" />
      <line x1="14" y1="64" x2="28" y2="64" stroke="#64748b" stroke-width="3" />
      <path d="M 28,20 Q 44,50 28,80" fill="none" stroke="#1e293b" stroke-width="2.5" />
      <path d="M 38,20 Q 54,50 38,80 Q 80,80 108,50 Q 80,20 38,20 Z" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <line x1="108" y1="50" x2="134" y2="50" stroke="#64748b" stroke-width="3" />
      <text x="68" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="13" fill="#0f172a">XOR</text>
    """),
    ("comp_xnor", "XNOR Kapısı", """
      <line x1="14" y1="36" x2="28" y2="36" stroke="#64748b" stroke-width="3" />
      <line x1="14" y1="64" x2="28" y2="64" stroke="#64748b" stroke-width="3" />
      <path d="M 28,20 Q 44,50 28,80" fill="none" stroke="#1e293b" stroke-width="2.5" />
      <path d="M 37,20 Q 53,50 37,80 Q 75,80 101,50 Q 75,20 37,20 Z" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <circle cx="108" cy="50" r="6.5" fill="#ffffff" stroke="#1e293b" stroke-width="2.5" />
      <line x1="115" y1="50" x2="134" y2="50" stroke="#64748b" stroke-width="3" />
      <text x="64" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="12" fill="#0f172a">XNOR</text>
    """),
    ("comp_tristate", "Tri-State Buffer", """
      <line x1="16" y1="50" x2="42" y2="50" stroke="#64748b" stroke-width="3" />
      <line x1="72" y1="84" x2="72" y2="63" stroke="#2563eb" stroke-width="3" />
      <circle cx="72" cy="84" r="4.5" fill="#2563eb" />
      <polygon points="42,24 98,50 42,76" fill="#eff6ff" stroke="#1e3a8a" stroke-width="2.5" />
      <line x1="98" y1="50" x2="134" y2="50" stroke="#64748b" stroke-width="3" />
      <text x="64" y="54" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="11" fill="#1e3a8a">TRI</text>
      <text x="86" y="80" font-family="monospace" font-weight="bold" font-size="10" fill="#2563eb">EN</text>
    """),
    ("comp_switch", "Mekanik Anahtar", """
      <rect x="32" y="14" width="86" height="72" rx="10" fill="url(#metalPlate)" stroke="#94a3b8" stroke-width="2" />
      <circle cx="40" cy="22" r="2.5" fill="#64748b" /><circle cx="110" cy="22" r="2.5" fill="#64748b" />
      <circle cx="40" cy="78" r="2.5" fill="#64748b" /><circle cx="110" cy="78" r="2.5" fill="#64748b" />
      <rect x="50" y="22" width="50" height="34" rx="6" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />
      <circle cx="62" cy="39" r="4" fill="#22c55e" />
      <line x1="75" y1="39" x2="92" y2="30" stroke="#cbd5e1" stroke-width="7" stroke-linecap="round" />
      <circle cx="92" cy="30" r="7" fill="#f8fafc" stroke="#475569" stroke-width="1.5" />
      <rect x="47" y="60" width="56" height="18" rx="4" fill="#090d16" stroke="#1e293b" stroke-width="1" />
      <text x="75" y="73" text-anchor="middle" font-family="monospace" font-weight="black" font-size="11" fill="#4ade80">ON · 1</text>
    """),
    ("comp_pushbutton", "Basmalı Buton", """
      <rect x="35" y="15" width="80" height="70" rx="12" fill="url(#metalPlate)" stroke="#94a3b8" stroke-width="2" />
      <circle cx="43" cy="23" r="2" fill="#64748b" /><circle cx="107" cy="23" r="2" fill="#64748b" />
      <circle cx="43" cy="77" r="2" fill="#64748b" /><circle cx="107" cy="77" r="2" fill="#64748b" />
      <circle cx="75" cy="50" r="24" fill="#0f172a" stroke="#1e293b" stroke-width="2" />
      <circle cx="75" cy="49" r="18" fill="#ef4444" stroke="#b91c1c" stroke-width="2" />
      <path d="M 66,41 A 13,13 0 0,1 84,41" stroke="#fca5a5" stroke-width="2.5" stroke-linecap="round" fill="none" />
      <text x="75" y="53" text-anchor="middle" font-family="Arial, sans-serif" font-weight="black" font-size="10" fill="#ffffff">PUSH</text>
    """),
    ("comp_clock", "Saat Jeneratörü", """
      <rect x="32" y="20" width="86" height="60" rx="14" fill="url(#metalPlate)" stroke="#94a3b8" stroke-width="2" />
      <rect x="42" y="28" width="66" height="44" rx="6" fill="#0f172a" stroke="#1e293b" stroke-width="1" />
      <path d="M 49,56 L 58,56 L 58,40 L 70,40 L 70,56 L 82,56 L 82,40 L 94,40 L 94,56 L 101,56" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" />
      <circle cx="98" cy="35" r="3.5" fill="#38bdf8" />
    """),
    ("comp_vcc_gnd", "VCC (+5V) & GND", """
      <polygon points="18,34 50,34 68,50 50,66 18,66" fill="#dcfce7" stroke="#16a34a" stroke-width="2" />
      <text x="38" y="54" text-anchor="middle" font-family="monospace" font-weight="black" font-size="12" fill="#15803d">VCC</text>
      <line x1="112" y1="26" x2="112" y2="50" stroke="#475569" stroke-width="3" />
      <line x1="94" y1="50" x2="130" y2="50" stroke="#475569" stroke-width="3.5" />
      <line x1="100" y1="57" x2="124" y2="57" stroke="#475569" stroke-width="2.8" />
      <line x1="106" y1="64" x2="118" y2="64" stroke="#475569" stroke-width="2" />
      <text x="112" y="78" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="10" fill="#475569">GND</text>
    """),
    ("comp_led", "LED (Işıklı Gösterge)", """
      <circle cx="75" cy="46" r="32" fill="#22c55e" opacity="0.3" />
      <path d="M 32,56 L 54,56 L 54,66" fill="none" stroke="#22c55e" stroke-width="3.5" stroke-linecap="round" />
      <line x1="96" y1="66" x2="96" y2="78" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" />
      <path d="M 54,46 A 21,21 0 0,1 96,46 L 96,66 L 100,66 L 100,72 L 50,72 L 50,66 L 54,66 Z" fill="#22c55e" stroke="#15803d" stroke-width="2" />
      <ellipse cx="68" cy="38" rx="6" ry="3.5" fill="#ffffff" opacity="0.8" />
      <text x="75" y="86" text-anchor="middle" font-family="Arial, sans-serif" font-weight="black" font-size="10" fill="#166534">LED (ON)</text>
    """),
    ("comp_probe", "Mantık Probu (Probe)", """
      <rect x="36" y="24" width="78" height="52" rx="8" fill="#0f172a" stroke="#334155" stroke-width="2" />
      <rect x="42" y="30" width="42" height="40" rx="5" fill="#020617" stroke="#1e293b" stroke-width="1.2" />
      <text x="63" y="59" text-anchor="middle" font-family="monospace" font-weight="black" font-size="28" fill="#22c55e">1</text>
      <circle cx="97" cy="42" r="6" fill="#22c55e" />
      <text x="97" y="62" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="9" fill="#94a3b8">HIGH</text>
    """),
    ("comp_7seg", "7-Segment Display", """
      <rect x="46" y="14" width="58" height="72" rx="7" fill="#020617" stroke="#334155" stroke-width="2" />
      <line x1="60" y1="24" x2="90" y2="24" stroke="#ef4444" stroke-width="4" stroke-linecap="round" />
      <line x1="58" y1="27" x2="58" y2="46" stroke="#ef4444" stroke-width="4" stroke-linecap="round" />
      <line x1="92" y1="27" x2="92" y2="46" stroke="#ef4444" stroke-width="4" stroke-linecap="round" />
      <line x1="60" y1="49" x2="90" y2="49" stroke="#ef4444" stroke-width="4" stroke-linecap="round" />
      <line x1="58" y1="52" x2="58" y2="71" stroke="#ef4444" stroke-width="4" stroke-linecap="round" />
      <line x1="92" y1="52" x2="92" y2="71" stroke="#ef4444" stroke-width="4" stroke-linecap="round" />
      <line x1="60" y1="74" x2="90" y2="74" stroke="#ef4444" stroke-width="4" stroke-linecap="round" />
      <circle cx="98" cy="74" r="2.5" fill="#ef4444" />
    """),
    ("comp_hex", "4-Bit Hex Display", """
      <rect x="40" y="16" width="70" height="68" rx="8" fill="#0f172a" stroke="#2563eb" stroke-width="2" />
      <rect x="48" y="22" width="54" height="56" rx="5" fill="#020617" stroke="#1e293b" stroke-width="1.2" />
      <text x="75" y="62" text-anchor="middle" font-family="monospace" font-weight="black" font-size="38" fill="#38bdf8">F</text>
    """),
    ("comp_dff", "D Flip-Flop", """
      <rect x="36" y="18" width="78" height="64" rx="6" fill="#ffffff" stroke="#1e293b" stroke-width="2.2" />
      <line x1="18" y1="36" x2="36" y2="36" stroke="#64748b" stroke-width="2.5" />
      <text x="46" y="40" font-family="monospace" font-weight="bold" font-size="12" fill="#0f172a">D</text>
      <line x1="18" y1="60" x2="36" y2="60" stroke="#64748b" stroke-width="2.5" />
      <polyline points="36,54 46,60 36,66" fill="none" stroke="#0f172a" stroke-width="2" />
      <text x="94" y="40" font-family="monospace" font-weight="bold" font-size="12" fill="#0f172a">Q</text>
      <line x1="114" y1="36" x2="132" y2="36" stroke="#64748b" stroke-width="2.5" />
      <text x="92" y="68" font-family="monospace" font-weight="bold" font-size="12" fill="#64748b">~Q</text>
      <line x1="114" y1="64" x2="132" y2="64" stroke="#64748b" stroke-width="2.5" />
      <text x="74" y="32" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="10" fill="#0284c7">D-FF</text>
    """),
    ("comp_jkff", "JK Flip-Flop", """
      <rect x="36" y="16" width="78" height="68" rx="6" fill="#ffffff" stroke="#1e293b" stroke-width="2.2" />
      <text x="44" y="32" font-family="monospace" font-weight="bold" font-size="11" fill="#0f172a">J</text>
      <polyline points="36,46 45,50 36,54" fill="none" stroke="#0f172a" stroke-width="2" />
      <text x="44" y="74" font-family="monospace" font-weight="bold" font-size="11" fill="#0f172a">K</text>
      <text x="94" y="34" font-family="monospace" font-weight="bold" font-size="11" fill="#0f172a">Q</text>
      <text x="92" y="70" font-family="monospace" font-weight="bold" font-size="11" fill="#64748b">~Q</text>
      <text x="72" y="32" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="9" fill="#0284c7">JK-FF</text>
    """),
    ("comp_adder", "Tam Toplayıcı (Adder)", """
      <rect x="30" y="18" width="90" height="64" rx="7" fill="#f8fafc" stroke="#2563eb" stroke-width="2.2" />
      <text x="39" y="33" font-family="monospace" font-weight="bold" font-size="10" fill="#1e3a8a">A</text>
      <text x="39" y="50" font-family="monospace" font-weight="bold" font-size="10" fill="#1e3a8a">B</text>
      <text x="39" y="69" font-family="monospace" font-weight="bold" font-size="10" fill="#1e3a8a">Cin</text>
      <text x="88" y="38" font-family="monospace" font-weight="bold" font-size="10" fill="#15803d">Sum</text>
      <text x="84" y="64" font-family="monospace" font-weight="bold" font-size="10" fill="#b45309">Cout</text>
      <text x="75" y="29" text-anchor="middle" font-family="Arial, sans-serif" font-weight="black" font-size="9" fill="#2563eb">FULL ADDER</text>
    """),
    ("comp_mux", "Multiplexer (MUX)", """
      <polygon points="40,20 95,30 95,70 40,80" fill="#ffffff" stroke="#1e293b" stroke-width="2.2" />
      <text x="49" y="38" font-family="monospace" font-weight="bold" font-size="10" fill="#0f172a">D0</text>
      <text x="49" y="68" font-family="monospace" font-weight="bold" font-size="10" fill="#0f172a">D1</text>
      <text x="68" y="80" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="9" fill="#2563eb">SEL</text>
      <text x="83" y="54" font-family="monospace" font-weight="bold" font-size="11" fill="#15803d">Y</text>
      <text x="68" y="53" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="9" fill="#64748b">MUX</text>
    """),
    ("comp_counter", "4-Bit Sayaç (Counter)", """
      <rect x="34" y="16" width="82" height="68" rx="6" fill="#0f172a" stroke="#475569" stroke-width="2" />
      <polyline points="34,36 43,40 34,44" fill="none" stroke="#38bdf8" stroke-width="2" />
      <text x="44" y="66" font-family="monospace" font-weight="bold" font-size="9" fill="#ef4444">RST</text>
      <text x="88" y="32" font-family="monospace" font-size="9" fill="#38bdf8">Q0</text>
      <text x="88" y="44" font-family="monospace" font-size="9" fill="#38bdf8">Q1</text>
      <text x="88" y="56" font-family="monospace" font-size="9" fill="#38bdf8">Q2</text>
      <text x="88" y="68" font-family="monospace" font-size="9" fill="#38bdf8">Q3</text>
      <text x="65" y="48" text-anchor="middle" font-family="monospace" font-weight="black" font-size="12" fill="#22c55e">CTR</text>
    """),
    ("comp_buzzer", "8-Bit Chiptune Buzzer", """
      <circle cx="75" cy="50" r="34" fill="#1e293b" stroke="#475569" stroke-width="2" />
      <circle cx="75" cy="50" r="23" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <circle cx="75" cy="50" r="10" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5" />
      <path d="M 112,38 Q 122,50 112,62" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" />
      <path d="M 120,30 Q 134,50 120,70" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" />
      <text x="75" y="90" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="9" fill="#f59e0b">BUZZER</text>
    """),
    ("comp_rgbmatrix", "16x16 RGB Matrix", """
      <rect x="38" y="16" width="74" height="68" rx="6" fill="#020617" stroke="#334155" stroke-width="2" />
      <circle cx="52" cy="30" r="3.2" fill="#22c55e" /><circle cx="67" cy="30" r="3.2" fill="#22c55e" /><circle cx="82" cy="30" r="3.2" fill="#22c55e" /><circle cx="97" cy="30" r="3.2" fill="#22c55e" />
      <circle cx="52" cy="44" r="3.2" fill="#ef4444" /><circle cx="67" cy="44" r="3.2" fill="#ef4444" /><circle cx="82" cy="30" r="3.2" fill="#3b82f6" /><circle cx="97" cy="44" r="3.2" fill="#3b82f6" />
      <circle cx="52" cy="58" r="3.2" fill="#eab308" /><circle cx="67" cy="58" r="3.2" fill="#22c55e" /><circle cx="82" cy="58" r="3.2" fill="#eab308" /><circle cx="97" cy="58" r="3.2" fill="#22c55e" />
      <circle cx="52" cy="72" r="3.2" fill="#22c55e" /><circle cx="67" cy="72" r="3.2" fill="#ec4899" /><circle cx="82" cy="72" r="3.2" fill="#ec4899" /><circle cx="97" cy="72" r="3.2" fill="#22c55e" />
    """),
    ("comp_ram", "16x4 RAM / ROM Bellek", """
      <rect x="32" y="16" width="86" height="68" rx="6" fill="#0f172a" stroke="#6366f1" stroke-width="2" />
      <text x="42" y="34" font-family="monospace" font-size="8" fill="#94a3b8">A[3:0]</text>
      <text x="42" y="52" font-family="monospace" font-size="8" fill="#38bdf8">WE</text>
      <text x="42" y="70" font-family="monospace" font-size="8" fill="#38bdf8">OE</text>
      <text x="86" y="52" font-family="monospace" font-weight="bold" font-size="8" fill="#a855f7">D[3:0]</text>
      <text x="75" y="32" text-anchor="middle" font-family="monospace" font-weight="black" font-size="10" fill="#818cf8">RAM</text>
      <text x="75" y="72" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="8" fill="#94a3b8">16x4</text>
    """)
]

def generate_sheet_html():
    cells_html = []
    for key, name, svg_body in COMPONENTS:
        cell = f'''
        <div class="cell">
          <svg class="comp-svg" viewBox="0 0 150 100">
            <defs>
              <linearGradient id="metalPlate" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#f8fafc" />
                <stop offset="50%" stop-color="#e2e8f0" />
                <stop offset="100%" stop-color="#cbd5e1" />
              </linearGradient>
            </defs>
            {svg_body}
          </svg>
          <div class="comp-name">{name}</div>
        </div>
        '''
        cells_html.append(cell)
    
    html = f'''<!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
          width: {TOTAL_W}px;
          height: {TOTAL_H}px;
          background: #ffffff;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }}
        .grid {{
          display: grid;
          grid-template-columns: repeat({COLS}, {CELL_W}px);
          grid-template-rows: repeat({ROWS}, {CELL_H}px);
          width: {TOTAL_W}px;
          height: {TOTAL_H}px;
        }}
        .cell {{
          width: {CELL_W}px;
          height: {CELL_H}px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          position: relative;
        }}
        .comp-svg {{
          width: 140px;
          height: 85px;
        }}
        .comp-name {{
          font-size: 11px;
          font-weight: 700;
          color: #334155;
          margin-top: 2px;
          letter-spacing: -0.2px;
        }}
      </style>
    </head>
    <body>
      <div class="grid">
        {''.join(cells_html)}
      </div>
    </body>
    </html>
    '''
    return html

def main():
    sheet_html_path = os.path.join(COMPONENTS_DIR, "components_sheet.html")
    with open(sheet_html_path, "w", encoding="utf-8") as f:
        f.write(generate_sheet_html())
    print("Created sheet HTML at:", sheet_html_path)

    sheet_png_path = os.path.join(COMPONENTS_DIR, "components_sheet.png")
    temp_dir = tempfile.gettempdir()
    tmp_out = os.path.join(temp_dir, "components_sheet.png")
    if os.path.exists(tmp_out):
        os.remove(tmp_out)

    cmd = [
        CHROME_BIN,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--force-device-scale-factor=2",
        f"--window-size={TOTAL_W},{TOTAL_H}",
        f"--screenshot={tmp_out}",
        f"file:///{os.path.abspath(sheet_html_path).replace(os.sep, '/')}"
    ]
    subprocess.run(cmd, check=True)
    if os.path.exists(tmp_out):
        shutil.copyfile(tmp_out, sheet_png_path)
        print("Captured high-res sheet PNG:", sheet_png_path)
    else:
        raise RuntimeError("Failed to capture screenshot")

    # Load high-res sheet and crop each component cell
    sheet_img = Image.open(sheet_png_path)
    # Since scale factor is 2, actual pixel dimensions are doubled
    scale = sheet_img.width / TOTAL_W
    print(f"Sheet dimensions: {sheet_img.size}, scale factor: {scale}")

    for idx, (key, name, _) in enumerate(COMPONENTS):
        row = idx // COLS
        col = idx % COLS
        left = int(col * CELL_W * scale)
        top = int(row * CELL_H * scale)
        right = int((col + 1) * CELL_W * scale)
        bottom = int((row + 1) * CELL_H * scale)

        cell_crop = sheet_img.crop((left, top, right, bottom))
        out_png = os.path.join(COMPONENTS_DIR, f"{key}.png")
        cell_crop.save(out_png, "PNG")
        print(f"Saved: {out_png}")

if __name__ == "__main__":
    main()
