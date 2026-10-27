import React, { useState, useMemo } from 'react';
import type { LogicValue } from '../types/logic';
import { solveKMap, getGridConfig, GROUP_COLORS } from '../utils/kmapSolver';
import { extractVariables, evaluateExpression } from '../utils/booleanParser';
import { Copy, Check, RotateCcw, Info, CheckCircle2, Calculator, Send, AlertCircle, Layers, X } from 'lucide-react';

interface StandaloneKMapSolverProps {
  initialValues?: Record<number, LogicValue>;
  initialNumVars?: number;
}

export const StandaloneKMapSolver: React.FC<StandaloneKMapSolverProps> = ({
  initialValues,
  initialNumVars = 4,
}) => {
  const [numVars, setNumVars] = useState<number>(initialNumVars);
  const [inputMode, setInputMode] = useState<'grid' | 'minterms' | 'expression'>('grid');

  // Cell values for K-Map (0, 1, X)
  const [values, setValues] = useState<Record<number, LogicValue>>(() => {
    if (initialValues) return initialValues;
    return {
      0: 1, 2: 1, 8: 1, 10: 1, // default 4 corners example
      1: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0,
      9: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0,
    };
  });

  // Minterm string inputs
  const [mintermsInput, setMintermsInput] = useState<string>('0, 2, 8, 10');
  const [dontCaresInput, setDontCaresInput] = useState<string>('');

  // Boolean Expression input
  const [expressionInput, setExpressionInput] = useState<string>("A'B' + CD + A'C");
  const [exprError, setExprError] = useState<string | null>(null);

  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const config = useMemo(() => getGridConfig(numVars), [numVars]);

  // Solver engine
  const solution = useMemo(() => {
    return solveKMap(values, numVars);
  }, [values, numVars]);

  const activeGroupId = hoveredGroupId ?? selectedGroupId;
  const activeGroup = useMemo(
    () => solution.selectedGroups.find((g) => g.id === activeGroupId),
    [solution, activeGroupId]
  );
  const activeGroupIdx = useMemo(
    () => solution.selectedGroups.findIndex((g) => g.id === activeGroupId),
    [solution, activeGroupId]
  );
  const activeGroupColor =
    activeGroupIdx >= 0 ? GROUP_COLORS[activeGroupIdx % GROUP_COLORS.length] : null;

  const toggleCell = (mIndex: number) => {
    setValues((prev) => {
      const cur = prev[mIndex] ?? 0;
      let next: LogicValue = 1;
      if (cur === 0) next = 1;
      else if (cur === 1) next = 'X';
      else next = 0;
      return { ...prev, [mIndex]: next };
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Apply Minterms input
  const applyMinterms = () => {
    const total = Math.pow(2, numVars);
    const newVals: Record<number, LogicValue> = {};
    for (let i = 0; i < total; i++) newVals[i] = 0;

    const parseNums = (str: string) =>
      str
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !isNaN(Number(s)))
        .map(Number);

    const mList = parseNums(mintermsInput);
    const dList = parseNums(dontCaresInput);

    mList.forEach((m) => {
      if (m >= 0 && m < total) newVals[m] = 1;
    });
    dList.forEach((d) => {
      if (d >= 0 && d < total) newVals[d] = 'X';
    });

    setValues(newVals);
  };

  // Apply Boolean expression
  const applyExpression = () => {
    setExprError(null);
    try {
      const vars = extractVariables(expressionInput);
      if (vars.length === 0) {
        setExprError('Lütfen geçerli değişkenler içeren bir Boole ifadesi yazın (ör: A, B, C, D).');
        return;
      }

      // Determine required numVars
      const neededVars = Math.max(Math.min(vars.length, 4), 2);
      if (neededVars !== numVars) {
        setNumVars(neededVars);
      }

      const total = Math.pow(2, neededVars);
      const activeVarNames = ['A', 'B', 'C', 'D'].slice(0, neededVars);
      const newVals: Record<number, LogicValue> = {};

      for (let i = 0; i < total; i++) {
        const bin = i.toString(2).padStart(neededVars, '0');
        const varValues: Record<string, number> = {};
        for (let v = 0; v < neededVars; v++) {
          varValues[activeVarNames[v]] = parseInt(bin[v], 10);
        }
        const out = evaluateExpression(expressionInput, varValues);
        newVals[i] = out as LogicValue;
      }

      setValues(newVals);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sözdizimi hatası';
      setExprError(msg);
    }
  };

  const clearAll = () => {
    const total = Math.pow(2, numVars);
    const reset: Record<number, LogicValue> = {};
    for (let i = 0; i < total; i++) reset[i] = 0;
    setValues(reset);
    setMintermsInput('');
    setDontCaresInput('');
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title Header */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Calculator className="w-3.5 h-3.5" />
            <span>Bağımsız Araç & Sadeleştirici</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Karnaugh Haritası (K-Map) Çözücü
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            İstediğiniz değişken sayısını seçin, minterm / don't care listesi girin, bir Boole ifadesi yazın ya da haritaya doğrudan tıklayarak serbestçe sadeleştirme yapın.
          </p>
        </div>
      </div>

      {/* Input Mode Selector Bar */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 text-xs sm:text-sm font-semibold">
            <button
              onClick={() => setInputMode('grid')}
              className={`px-4 py-2 rounded-xl transition-all cursor-pointer ${
                inputMode === 'grid'
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Izgaraya Tıklayarak
            </button>
            <button
              onClick={() => setInputMode('minterms')}
              className={`px-4 py-2 rounded-xl transition-all cursor-pointer ${
                inputMode === 'minterms'
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Minterm Listesi Girerek (Σm)
            </button>
            <button
              onClick={() => setInputMode('expression')}
              className={`px-4 py-2 rounded-xl transition-all cursor-pointer ${
                inputMode === 'expression'
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Boole İfadesi Yazarak
            </button>
          </div>

          <button
            onClick={clearAll}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>Haritayı Temizle</span>
          </button>
        </div>

        {/* Input Mode 2: Minterms list input */}
        {inputMode === 'minterms' && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Mintermler (1 olan hücreler, virgülle ayırın):
                </label>
                <input
                  type="text"
                  value={mintermsInput}
                  onChange={(e) => setMintermsInput(e.target.value)}
                  placeholder="Örn: 0, 2, 5, 7, 8, 10, 13, 15"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 font-mono text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">Geçerli aralık: 0 ile {Math.pow(2, numVars) - 1} arası</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Farketmez / Don't Care (X olan hücreler):
                </label>
                <input
                  type="text"
                  value={dontCaresInput}
                  onChange={(e) => setDontCaresInput(e.target.value)}
                  placeholder="Örn: 10, 11, 12, 13, 14, 15"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 font-mono text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">İsteğe bağlı</span>
              </div>
            </div>

            <button
              onClick={applyMinterms}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all"
            >
              <Send className="w-4 h-4" />
              <span>Haritaya Uygula ve Çöz</span>
            </button>
          </div>
        )}

        {/* Input Mode 3: Boolean Expression */}
        {inputMode === 'expression' && (
          <div className="space-y-4 pt-1">
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                Boole Cebri Fonksiyonu (Değişkenler: A, B, C, D):
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={expressionInput}
                  onChange={(e) => setExpressionInput(e.target.value)}
                  placeholder="Örn: A'B + BC' + A(B + C)"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 font-mono text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
                <button
                  onClick={applyExpression}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all shrink-0"
                >
                  <Send className="w-4 h-4" />
                  <span>İfadeyi K-Map'e Aktar</span>
                </button>
              </div>
            </div>

            {/* Quick Virtual Symbols */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500 font-semibold mr-1">Semboller:</span>
              {[
                { sym: "'", label: "' (NOT)" },
                { sym: " + ", label: "+ (OR)" },
                { sym: " · ", label: "· (AND)" },
                { sym: " ⊕ ", label: "⊕ (XOR)" },
                { sym: "(", label: "(" },
                { sym: ")", label: ")" },
              ].map((b, idx) => (
                <button
                  key={idx}
                  onClick={() => setExpressionInput((p) => p + b.sym)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 text-slate-700 rounded-lg border border-slate-200 font-mono cursor-pointer"
                >
                  {b.label}
                </button>
              ))}
            </div>

            {exprError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{exprError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Variable Switcher Panel */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Değişken Sayısı</h3>
            <p className="text-xs text-slate-500">Karnaugh haritasında kullanılacak değişken sayısını seçin</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shrink-0">
          {[2, 3, 4].map((v) => (
            <button
              key={v}
              onClick={() => {
                setNumVars(v);
                const total = Math.pow(2, v);
                const newVals: Record<number, LogicValue> = {};
                for (let i = 0; i < total; i++) {
                  newVals[i] = values[i] ?? 0;
                }
                setValues(newVals);
              }}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                numVars === v
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {v} Değişken ({['A, B', 'A, B, C', 'A, B, C, D'][v - 2]})
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Split Workspace: K-Map Grid on Left, Results & Asal Gruplar on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: K-Map Display Stage (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  {numVars} Değişkenli K-Map Izgarası
                </h3>
                <p className="text-xs text-slate-500">
                  Hücreye tıklayarak değeri değiştirin: <strong>0 → 1 → X</strong>
                </p>
              </div>
              <div className="text-xs font-mono text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 flex items-center gap-2">
                <span>1: <strong className="text-blue-700">{solution.minterms.length}</strong></span>
                {solution.dontCares.length > 0 && <span>• X: <strong className="text-amber-700">{solution.dontCares.length}</strong></span>}
              </div>
            </div>

            {/* Active Group Highlight Banner */}
            {activeGroup ? (
              <div className="flex items-center justify-between min-h-[46px] px-4 py-2 bg-blue-50/90 border border-blue-200 rounded-2xl text-xs sm:text-sm text-blue-900 transition-all">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold flex items-center gap-1.5 text-blue-700">
                    <Layers className="w-4 h-4" /> Vurgulanan Grup:
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-lg font-mono font-bold text-xs ${activeGroupColor?.badge || 'bg-blue-600 text-white'}`}>
                    {activeGroup.term}
                  </span>
                  <span className="text-slate-600 font-mono text-xs">
                    [{activeGroup.cells.map(c => `m${c}`).join(', ')}]
                  </span>
                  <span className="text-xs text-slate-500">({activeGroup.cells.length}'li grup)</span>
                </div>
                {selectedGroupId ? (
                  <button
                    onClick={() => setSelectedGroupId(null)}
                    className="text-xs text-blue-700 hover:text-blue-900 font-semibold flex items-center gap-1 cursor-pointer bg-white px-2.5 py-1 rounded-xl border border-blue-200 shadow-xs"
                    title="Sabitlemeyi kaldır"
                  >
                    <X className="w-3.5 h-3.5" /> Seçimi Kaldır
                  </button>
                ) : (
                  <span className="text-xs text-blue-600 font-medium hidden sm:inline">Sabitlemek için gruba tıklayın</span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between min-h-[46px] px-4 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-400" />
                  <span>Sağdaki asal grupların üzerine gelerek haritada hücreleri görebilirsiniz.</span>
                </div>
                <span className="text-xs text-slate-400 font-medium hidden sm:inline">Sabitlemek için tıklayın</span>
              </div>
            )}

            {/* Responsive Grid */}
            <div className="overflow-x-auto pb-2 pt-1 flex justify-center">
              <div className="inline-block border-2 border-slate-300 rounded-2xl overflow-hidden shadow-sm bg-white">
                {/* Header Row */}
                <div className="flex items-center bg-slate-100 border-b border-slate-300">
                  <div className="w-16 sm:w-20 md:w-24 h-12 flex items-center justify-center font-mono text-xs sm:text-sm font-bold text-slate-700 border-r border-slate-300 bg-slate-200/80 relative select-none">
                    <span className="absolute bottom-1 left-2 sm:left-3 text-slate-700">
                      {config.rowVars.join('')}
                    </span>
                    <span className="text-slate-400 font-light">/</span>
                    <span className="absolute top-1 right-2 sm:right-3 text-blue-700">
                      {config.colVars.join('')}
                    </span>
                  </div>

                  {config.colCodes.map((code, cIdx) => (
                    <div
                      key={cIdx}
                      className="w-16 sm:w-20 md:w-24 h-12 flex flex-col items-center justify-center border-r border-slate-300 last:border-r-0 text-blue-900 font-mono text-xs sm:text-sm font-bold select-none"
                    >
                      <span>{code}</span>
                    </div>
                  ))}
                </div>

                {/* Rows */}
                {config.grid.map((rowCells, rIdx) => (
                  <div key={rIdx} className="flex items-center border-b border-slate-300 last:border-b-0">
                    <div className="w-16 sm:w-20 md:w-24 h-16 sm:h-20 md:h-24 flex items-center justify-center border-r border-slate-300 bg-slate-100 text-slate-800 font-mono text-xs sm:text-sm font-bold select-none">
                      <span>{config.rowCodes[rIdx]}</span>
                    </div>

                    {rowCells.map((minterm, cIdx) => {
                      const val = values[minterm] ?? 0;
                      const isOne = val === 1;
                      const isDC = val === 'X';

                      const coveringGroups = solution.selectedGroups.filter((g) =>
                        g.cells.includes(minterm)
                      );
                      const isHovered =
                        activeGroupId !== null &&
                        coveringGroups.some((g) => g.id === activeGroupId);

                      return (
                        <div
                          key={cIdx}
                          onClick={() => toggleCell(minterm)}
                          className={`w-16 sm:w-20 md:w-24 h-16 sm:h-20 md:h-24 border-r border-slate-300 last:border-r-0 flex flex-col items-center justify-between p-2 sm:p-2.5 cursor-pointer transition-all duration-150 relative select-none ${
                            isHovered
                              ? 'bg-blue-100 ring-4 ring-inset ring-blue-600 z-10 scale-[1.03] shadow-md font-extrabold'
                              : isOne
                              ? 'bg-blue-50/70 hover:bg-blue-100/70'
                              : isDC
                              ? 'bg-amber-50 hover:bg-amber-100/60'
                              : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="w-full flex items-center justify-between text-[11px] sm:text-xs font-mono text-slate-500">
                            <span className="font-semibold">m{minterm}</span>
                            <div className="flex gap-1">
                              {coveringGroups.map((g, gIdx) => {
                                const colInfo = GROUP_COLORS[gIdx % GROUP_COLORS.length];
                                return (
                                  <span
                                    key={g.id}
                                    className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${colInfo.badge.split(' ')[0]}`}
                                    title={`Grup: ${g.term}`}
                                  />
                                );
                              })}
                            </div>
                          </div>

                          <div
                            className={`text-2xl sm:text-3xl md:text-4xl font-extrabold font-mono transition-transform hover:scale-110 ${
                              isOne
                                ? 'text-blue-700'
                                : isDC
                                ? 'text-amber-700'
                                : 'text-slate-300'
                            }`}
                          >
                            {val}
                          </div>

                          <div className="text-[10px] sm:text-[11px] text-slate-400 font-mono">
                            {minterm.toString(2).padStart(numVars, '0')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs sm:text-sm text-slate-600 flex items-start sm:items-center gap-3">
              <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 sm:mt-0" />
              <span>
                <strong>Torus (Simit) Komşuluğu:</strong> Sağ-sol ve üst-alt kenarlar ile 4 köşe hücresi ($m_0, m_2, m_8, m_{10}$) birbirine komşudur ve tek grup oluşturabilir.
              </span>
            </div>
          </div>
        </div>

        {/* Right Column (5 cols, sticky on desktop): Live Minimal SOP & Bulunan Asal K-Map Grupları */}
        <div className="lg:col-span-5 space-y-5 lg:sticky lg:top-24">
          {/* Minimal SOP Result Card */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                Minimal Boole İfadesi (SOP)
              </span>
              <button
                onClick={() => handleCopy(`F = ${solution.simplifiedSOP}`)}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-mono flex items-center gap-1.5 cursor-pointer border border-slate-200 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
              </button>
            </div>

            <div className="p-4 bg-blue-50/70 rounded-2xl border border-blue-200 font-mono text-lg sm:text-xl font-bold text-blue-900 flex items-center flex-wrap gap-1.5">
              <span className="text-slate-500">F = </span>
              {solution.selectedGroups.length > 0 ? (
                solution.selectedGroups.map((grp, idx) => {
                  const isActive = activeGroupId === grp.id;
                  return (
                    <span
                      key={grp.id}
                      onClick={() => setSelectedGroupId(prev => prev === grp.id ? null : grp.id)}
                      onMouseEnter={() => setHoveredGroupId(grp.id)}
                      onMouseLeave={() => setHoveredGroupId(null)}
                      className={`cursor-pointer px-2 py-1 rounded-lg transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'hover:bg-blue-200/80'
                      }`}
                      title="Haritada vurgulamak için tıklayın veya gelin"
                    >
                      {grp.term}
                      {idx < solution.selectedGroups.length - 1 && <span className={isActive ? 'text-blue-200' : 'text-slate-400'}> + </span>}
                    </span>
                  );
                })
              ) : (
                <span>{solution.simplifiedSOP}</span>
              )}
            </div>

            <div className="space-y-1 pt-1">
              <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                Minimal POS (Toplamların Çarpımı):
              </span>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs sm:text-sm font-semibold text-slate-800 break-all">
                F = {solution.simplifiedPOS}
              </div>
            </div>
          </div>

          {/* Bulunan Asal K-Map Grupları Card (Visible side-by-side) */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 uppercase tracking-wider">
                  Bulunan Asal K-Map Grupları ({solution.selectedGroups.length})
                </h3>
                <span className="text-[11px] text-slate-500">Haritada görmek için üzerine gelin veya tıklayın</span>
              </div>
              {selectedGroupId && (
                <button
                  onClick={() => setSelectedGroupId(null)}
                  className="text-xs text-slate-500 hover:text-slate-800 font-medium px-2 py-1 rounded-lg hover:bg-slate-100"
                >
                  Seçimi Sıfırla
                </button>
              )}
            </div>

            {solution.selectedGroups.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">Hiçbir grup oluşturulmadı (Tüm harita 0 veya 1).</p>
            ) : (
              <div className="space-y-3 max-h-[440px] overflow-y-auto p-1">
                {solution.selectedGroups.map((grp, idx) => {
                  const color = GROUP_COLORS[idx % GROUP_COLORS.length];
                  const isActive = activeGroupId === grp.id;
                  const isPinned = selectedGroupId === grp.id;

                  return (
                    <div
                      key={grp.id}
                      onClick={() => setSelectedGroupId(prev => prev === grp.id ? null : grp.id)}
                      onMouseEnter={() => setHoveredGroupId(grp.id)}
                      onMouseLeave={() => setHoveredGroupId(null)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-blue-50/90 border-blue-500 ring-2 ring-inset ring-blue-400/40 shadow-sm'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100/90 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold ${color.badge}`}>
                            {grp.term}
                          </span>
                          <span className="text-xs font-bold text-slate-800">
                            {grp.cells.length}'li Grup
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isPinned ? (
                            <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-md">
                              Sabitlendi
                            </span>
                          ) : isActive ? (
                            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                              Haritada
                            </span>
                          ) : null}
                          <span className="text-[11px] font-mono text-slate-500">
                            [{grp.cells.map((c) => `m${c}`).join(', ')}]
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {grp.explanation}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
