// Telnet part terminal window (Aşama 5c-2b): shows the bytes the circuit sent through the part and sends what is
// typed into it to the part, like a Telnet client would. Draggable by its title bar; one per part.
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Eraser, Network, X } from 'lucide-react';
import type { CircuitComponentInstance } from '../types/circuit';
import { getIo5cConfig, telnetSent } from '../utils/circuitEngine';
import { keyToTelnetBytes, terminalScreen, textToTelnetBytes, type LdsNetStatus } from '../utils/telnetNet';

export interface TelnetTerminalWindowProps {
  comp: CircuitComponentInstance;
  x: number;
  y: number;
  dark: boolean;
  /** desktop app: the part also has a TCP server */
  desktop: boolean;
  status?: LdsNetStatus;
  lan: boolean;
  /** telnetTxCount when the screen was last cleared */
  clearedAt: number;
  onMove: (x: number, y: number) => void;
  onFocus: () => void;
  onClose: () => void;
  onClear: () => void;
  onType: (bytes: number[]) => void;
  onSetLan: (on: boolean) => void;
}

const WIDTH = 460;

function statusText(desktop: boolean, port: number, status: LdsNetStatus | undefined): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!desktop) return { text: 'Web sürümünde ağ bağlantısı yok: bu pencere parçanın tek istemcisi.', tone: 'muted' };
  if (!status) return { text: `TCP ${port} açılıyor…`, tone: 'muted' };
  if (status.error) {
    const why = status.error === 'EADDRINUSE' ? 'port başka bir program tarafından kullanılıyor' : status.error === 'EACCES' ? 'bu porta izin yok' : status.error;
    return { text: `TCP ${port} açılamadı: ${why}. Portu değiştirin.`, tone: 'warn' };
  }
  if (!status.listening) return { text: `TCP ${port} açılıyor…`, tone: 'muted' };
  const who = status.clients === 0 ? 'istemci yok' : `${status.clients} istemci bağlı`;
  return { text: `${status.host}:${port} dinleniyor · ${who}`, tone: 'ok' };
}

export const TelnetTerminalWindow: React.FC<TelnetTerminalWindowProps> = (props) => {
  const { comp, x, y, dark, desktop, status, lan, clearedAt } = props;
  const cfg = getIo5cConfig(comp);
  const { bytes } = telnetSent(comp, clearedAt);
  const lines = terminalScreen(bytes);
  const screenRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const waiting = comp.state.telnetRx?.length ?? 0;

  // keep the newest line in view
  const text = lines.join('\n');
  useLayoutEffect(() => {
    const el = screenRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    props.onFocus();
    dragRef.current = { dx: e.clientX - x, dy: e.clientY - y };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const nx = Math.min(Math.max(ev.clientX - d.dx, 8 - WIDTH + 80), window.innerWidth - 80);
      const ny = Math.min(Math.max(ev.clientY - d.dy, 0), window.innerHeight - 40);
      props.onMove(nx, ny);
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const st = statusText(desktop, cfg.telnetPort, status);
  const toneCls = st.tone === 'ok' ? 'text-emerald-500' : st.tone === 'warn' ? 'text-rose-500' : dark ? 'text-slate-400' : 'text-slate-500';
  const name = comp.label || 'Telnet';

  return (
    <div
      className={`fixed z-40 rounded-2xl border shadow-2xl flex flex-col text-xs ${dark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
      style={{ left: x, top: y, width: WIDTH, maxWidth: 'calc(100vw - 16px)' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onFocus();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 border-b cursor-move select-none ${dark ? 'border-slate-700' : 'border-slate-200'}`}
        onPointerDown={startDrag}
      >
        <Network className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        <span className="font-extrabold truncate">{name} — terminal</span>
        <span className={`font-mono shrink-0 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>port {cfg.telnetPort}</span>
        <span className="flex-1" />
        <button onClick={props.onClear} className={`p-1 rounded-md cursor-pointer ${dark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`} title="Ekranı temizle">
          <Eraser className="w-3.5 h-3.5" />
        </button>
        <button onClick={props.onClose} className={`p-1 rounded-md cursor-pointer ${dark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`} title="Kapat">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <pre
        ref={screenRef}
        onClick={() => inputRef.current?.focus()}
        className="m-0 h-56 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.35] whitespace-pre-wrap break-all bg-slate-950 text-emerald-300 select-text cursor-text"
        title="Devrenin bu parçadan gönderdiği baytlar"
      >
        {text}
        <span className="inline-block w-[0.6em] bg-emerald-300/70 animate-pulse">&nbsp;</span>
      </pre>
      <div className="px-3 pt-2 pb-2.5 space-y-1.5">
        <input
          ref={inputRef}
          value=""
          onChange={() => {}}
          onKeyDown={(e) => {
            const b = keyToTelnetBytes(e);
            if (!b) return;
            e.preventDefault();
            e.stopPropagation();
            props.onType(b);
          }}
          onPaste={(e) => {
            e.preventDefault();
            const b = textToTelnetBytes(e.clipboardData.getData('text'));
            if (b.length) props.onType(b);
          }}
          placeholder="Buraya yazın: her tuş parçaya bayt olarak gider (Enter = 10, Backspace = 8)"
          className={`w-full text-[11px] font-mono rounded-md px-2 py-1.5 border outline-none ${
            dark ? 'bg-slate-800 text-slate-200 border-slate-600 focus:border-blue-500' : 'bg-white text-slate-800 border-slate-300 focus:border-blue-500'
          }`}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="flex items-center gap-2">
          <span className={`flex-1 min-w-0 ${st.tone === 'warn' ? 'break-words' : 'truncate'} ${toneCls}`} title={st.text}>{st.text}</span>
          <span className={`shrink-0 font-mono ${dark ? 'text-slate-400' : 'text-slate-500'}`} title="İstemciden gelip devrenin henüz okumadığı baytlar">
            tampon {waiting}/{cfg.telnetBufLen}
          </span>
        </div>
        {desktop && (
          <label className={`flex items-start gap-1.5 cursor-pointer ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            <input type="checkbox" checked={lan} onChange={(e) => props.onSetLan(e.target.checked)} className="mt-0.5 cursor-pointer" />
            <span>
              Ağdaki diğer bilgisayarlardan bağlantıya izin ver (0.0.0.0). Uygulamanın tamamı için geçerli, devre dosyasına kaydedilmez; kapalıyken yalnız bu bilgisayar bağlanabilir.
            </span>
          </label>
        )}
        {desktop && status?.listening && !status.error && (
          <p className={`font-mono text-[10.5px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            Bağlanmak için: telnet 127.0.0.1 {cfg.telnetPort}
          </p>
        )}
      </div>
    </div>
  );
};
