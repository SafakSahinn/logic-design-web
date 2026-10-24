import React from 'react';

interface GateDiagramProps {
  gateId: string;
  a: number;
  b: number;
  out: number;
  onToggleA: () => void;
  onToggleB?: () => void;
}

export const GateDiagram: React.FC<GateDiagramProps> = ({
  gateId,
  a,
  b,
  out,
  onToggleA,
  onToggleB,
}) => {
  const isOneA = a === 1;
  const isOneB = b === 1;
  const isOneOut = out === 1;

  // Academic schematic colors
  const wireColorA = isOneA ? '#0284c7' : '#94a3b8';
  const wireColorB = isOneB ? '#0284c7' : '#94a3b8';
  const wireColorOut = isOneOut ? '#059669' : '#94a3b8';

  const isSingleInput = gateId === 'not' || gateId === 'buffer';

  return (
    <div className="relative flex flex-col items-center justify-center p-8 sm:p-10 bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden select-none">
      {/* Subtle Technical Drawing Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1.5px,transparent_1.5px)] [background-size:20px_20px] opacity-75 pointer-events-none" />

      {/* Top Laboratory Controls - Spacious */}
      <div className="relative z-10 w-full flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 px-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onToggleA}
            className={`px-4 py-2 rounded-xl border text-xs sm:text-sm font-mono font-bold transition-all duration-150 flex items-center gap-2.5 cursor-pointer shadow-2xs ${
              isOneA
                ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-xs'
                : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className={`w-3 h-3 rounded-full ${isOneA ? 'bg-blue-600 ring-2 ring-blue-200' : 'bg-slate-300'}`} />
            <span>Giriş A: <strong className="text-sm">{a}</strong></span>
            <span className="text-xs text-slate-400 font-sans font-normal">(tıkla)</span>
          </button>

          {!isSingleInput && onToggleB && (
            <button
              onClick={onToggleB}
              className={`px-4 py-2 rounded-xl border text-xs sm:text-sm font-mono font-bold transition-all duration-150 flex items-center gap-2.5 cursor-pointer shadow-2xs ${
                isOneB
                  ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-xs'
                  : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className={`w-3 h-3 rounded-full ${isOneB ? 'bg-blue-600 ring-2 ring-blue-200' : 'bg-slate-300'}`} />
              <span>Giriş B: <strong className="text-sm">{b}</strong></span>
              <span className="text-xs text-slate-400 font-sans font-normal">(tıkla)</span>
            </button>
          )}
        </div>

        {/* Output LED Status Indicator */}
        <div className="flex items-center self-end sm:self-auto">
          <div
            className={`px-5 py-2.5 rounded-2xl border flex items-center gap-3.5 transition-all duration-200 ${
              isOneOut
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-xs'
                : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full transition-all duration-200 ${
                isOneOut
                  ? 'bg-emerald-500 ring-4 ring-emerald-100 shadow-sm'
                  : 'bg-slate-300'
              }`}
            />
            <div className="flex flex-col text-right font-mono">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-sans font-semibold">Çıkış Y</span>
              <span className="text-base font-bold text-slate-900">{out} ({out === 1 ? 'Lojik 1 / High' : 'Lojik 0 / Low'})</span>
            </div>
          </div>
        </div>
      </div>

      {/* SVG Circuit Canvas */}
      <div className="relative z-10 w-full max-w-[500px] h-[230px] flex items-center justify-center my-2">
        <svg viewBox="0 0 460 210" className="w-full h-full">
          {/* INPUT WIRES */}
          {isSingleInput ? (
            <g onClick={onToggleA} style={{ cursor: 'pointer' }}>
              <line x1="50" y1="105" x2="190" y2="105" stroke={wireColorA} strokeWidth="3.5" strokeLinecap="round" />
              <circle cx="50" cy="105" r="5" fill={wireColorA} />
              <text x="35" y="110" fill="#334155" fontSize="14" fontWeight="bold" textAnchor="end" fontFamily="monospace">A ({a})</text>
            </g>
          ) : (
            <>
              <g onClick={onToggleA} style={{ cursor: 'pointer' }}>
                <line x1="50" y1="70" x2="175" y2="70" stroke={wireColorA} strokeWidth="3.5" strokeLinecap="round" />
                <circle cx="50" cy="70" r="5" fill={wireColorA} />
                <text x="35" y="75" fill="#334155" fontSize="14" fontWeight="bold" textAnchor="end" fontFamily="monospace">A ({a})</text>
              </g>
              <g onClick={onToggleB} style={{ cursor: 'pointer' }}>
                <line x1="50" y1="140" x2="175" y2="140" stroke={wireColorB} strokeWidth="3.5" strokeLinecap="round" />
                <circle cx="50" cy="140" r="5" fill={wireColorB} />
                <text x="35" y="145" fill="#334155" fontSize="14" fontWeight="bold" textAnchor="end" fontFamily="monospace">B ({b})</text>
              </g>
            </>
          )}

          {/* GATE SYMBOL RENDER (Academic Textbook Style) */}
          {gateId === 'and' && (
            <path
              d="M 175 50 L 225 50 A 55 55 0 0 1 225 160 L 175 160 Z"
              fill="#f8fafc"
              stroke="#1e293b"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          )}

          {gateId === 'nand' && (
            <>
              <path
                d="M 175 50 L 220 50 A 55 55 0 0 1 220 160 L 175 160 Z"
                fill="#f8fafc"
                stroke="#1e293b"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <circle cx="281" cy="105" r="6" fill="#f8fafc" stroke="#1e293b" strokeWidth="2.5" />
            </>
          )}

          {gateId === 'or' && (
            <path
              d="M 165 50 Q 210 105 165 160 Q 235 160 285 105 Q 235 50 165 50 Z"
              fill="#f8fafc"
              stroke="#1e293b"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          )}

          {gateId === 'nor' && (
            <>
              <path
                d="M 160 50 Q 205 105 160 160 Q 225 160 275 105 Q 225 50 160 50 Z"
                fill="#f8fafc"
                stroke="#1e293b"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <circle cx="286" cy="105" r="6" fill="#f8fafc" stroke="#1e293b" strokeWidth="2.5" />
            </>
          )}

          {gateId === 'xor' && (
            <>
              <path
                d="M 152 50 Q 197 105 152 160"
                fill="none"
                stroke="#1e293b"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M 168 50 Q 213 105 168 160 Q 235 160 285 105 Q 235 50 168 50 Z"
                fill="#f8fafc"
                stroke="#1e293b"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            </>
          )}

          {gateId === 'xnor' && (
            <>
              <path
                d="M 150 50 Q 195 105 150 160"
                fill="none"
                stroke="#1e293b"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M 165 50 Q 210 105 165 160 Q 225 160 275 105 Q 225 50 165 50 Z"
                fill="#f8fafc"
                stroke="#1e293b"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <circle cx="286" cy="105" r="6" fill="#f8fafc" stroke="#1e293b" strokeWidth="2.5" />
            </>
          )}

          {gateId === 'not' && (
            <>
              <polygon
                points="190,60 270,105 190,150"
                fill="#f8fafc"
                stroke="#1e293b"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <circle cx="281" cy="105" r="6" fill="#f8fafc" stroke="#1e293b" strokeWidth="2.5" />
            </>
          )}

          {gateId === 'buffer' && (
            <polygon
              points="190,60 280,105 190,150"
              fill="#f8fafc"
              stroke="#1e293b"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          )}

          {/* OUTPUT WIRE & LABEL */}
          {(() => {
            let outStartX = 280;
            if (gateId === 'and' || gateId === 'or' || gateId === 'xor' || gateId === 'buffer') outStartX = 282;
            if (gateId === 'nand' || gateId === 'nor' || gateId === 'xnor' || gateId === 'not') outStartX = 292;

            return (
              <g>
                <line x1={outStartX} y1="105" x2="380" y2="105" stroke={wireColorOut} strokeWidth="3.5" strokeLinecap="round" />
                <circle cx="380" cy="105" r="5" fill={wireColorOut} />
                <text x="395" y="110" fill="#334155" fontSize="14" fontWeight="bold" fontFamily="monospace">Y ({out})</text>
              </g>
            );
          })()}
        </svg>
      </div>

      <div className="relative z-10 text-xs sm:text-sm text-slate-500 mt-3 flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
        <span>Giriş anahtarlarına veya devre şemasına tıklayarak lojik seviyeleri (0 / 1) anında test edebilirsiniz.</span>
      </div>
    </div>
  );
};
