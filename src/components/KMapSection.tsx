import React, { useState, useMemo } from 'react';
import type { LogicValue } from '../types/logic';
import { solveKMap, getGridConfig, GROUP_COLORS, DEFAULT_VAR_NAMES } from '../utils/kmapSolver';
import { Grid, Sparkles, Copy, Check, RotateCcw, Info, CheckCircle2, ChevronRight, Layers, X } from 'lucide-react';

interface KMapSectionProps {
  initialValues?: Record<number, LogicValue>;
  initialNumVars?: number;
  /** Variable names (e.g. a book example's x, y, z); used only while the map has that many variables. */
  variables?: string[];
}

export const KMapSection: React.FC<KMapSectionProps> = ({
  initialValues,
  initialNumVars = 3,
  variables,
}) => {
  const [numVars, setNumVars] = useState<number>(initialNumVars);
  const [values, setValues] = useState<Record<number, LogicValue>>(
    initialValues || {
      0: 0, 1: 1, 2: 1, 3: 1, 4: 0, 5: 1, 6: 0, 7: 1,
    }
  );

  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const varNames = variables && variables.length === numVars ? variables : DEFAULT_VAR_NAMES;
  const config = useMemo(() => getGridConfig(numVars, varNames), [numVars, varNames]);

  const solution = useMemo(() => {
    return solveKMap(values, numVars, varNames);
  }, [values, numVars, varNames]);

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

  const loadPreset = (type: string) => {
    if (type === 'corners') {
      setNumVars(4);
      setValues({
        0: 1, 2: 1, 8: 1, 10: 1,
        1: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0,
        9: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0,
      });
    } else if (type === 'wrapEdge') {
      setNumVars(4);
      setValues({
        0: 1, 1: 1, 2: 1, 3: 1,
        8: 1, 9: 1, 10: 1, 11: 1,
        4: 0, 5: 0, 6: 0, 7: 0,
        12: 0, 13: 0, 14: 0, 15: 0,
      });
    } else if (type === 'dontCare') {
      setNumVars(4);
      setValues({
        0: 0, 1: 0, 2: 0, 3: 0,
        4: 1, 5: 1, 6: 1, 7: 1,
        8: 1, 9: 1,
        10: 'X', 11: 'X', 12: 'X', 13: 'X', 14: 'X', 15: 'X',
      });
    } else if (type === 'parity') {
      setNumVars(3);
      setValues({
        0: 0, 1: 1, 2: 1, 3: 0,
        4: 1, 5: 0, 6: 0, 7: 1,
      });
    } else if (type === 'clear') {
      const total = Math.pow(2, numVars);
      const reset: Record<number, LogicValue> = {};
      for (let i = 0; i < total; i++) reset[i] = 0;
      setValues(reset);
    }
  };

  return (
    <div className="space-y-10">
      {/* K-Map Controls & Settings Bar */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-blue-600 font-bold text-xs uppercase tracking-wider">
            <Grid className="w-4 h-4" />
            <span>Harita Konfigürasyonu</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            {numVars} Değişkenli Karnaugh Haritası ({Math.pow(2, numVars)} Hücre)
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Hücrelere tıklayarak değerleri değiştirebilirsiniz: <strong className="text-slate-800">0 → 1 → X (Farketmez)</strong>
          </p>
        </div>

        {/* Variable Switcher */}
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 self-start md:self-auto">
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
              {v} Değişken ({(variables && variables.length === v ? variables : DEFAULT_VAR_NAMES.slice(0, v)).join(', ')})
            </button>
          ))}
        </div>
      </div>

      {/* Preset Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1.5 mr-1">
            <Sparkles className="w-4 h-4 text-blue-600" />
            Hızlı Şablonlar:
          </span>
          <button
            onClick={() => loadPreset('corners')}
            className="px-3.5 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors cursor-pointer"
          >
            4 Köşe Grubu (B'D')
          </button>
          <button
            onClick={() => loadPreset('wrapEdge')}
            className="px-3.5 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors cursor-pointer"
          >
            Kenar Sarılmalı (Wrap-Around)
          </button>
          <button
            onClick={() => loadPreset('dontCare')}
            className="px-3.5 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors cursor-pointer"
          >
            Don't Care (BCD Örneği)
          </button>
          <button
            onClick={() => loadPreset('parity')}
            className="px-3.5 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors cursor-pointer"
          >
            XOR / Dama Deseni
          </button>
        </div>

        <button
          onClick={() => loadPreset('clear')}
          className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-xl border border-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
          <span>Tümünü Sıfırla</span>
        </button>
      </div>

      {/* Interactive Split Workspace: K-Map Grid on Left, Results & Gruplar on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: K-Map Display Stage (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
            {/* Stage Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  Gray Kodu Yerleşim Izgarası ({numVars} Değişken)
                </h3>
                <p className="text-xs text-slate-500">
                  Hücreye tıklayarak değeri doğrudan değiştirebilirsiniz: <strong>0 → 1 → X</strong>
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                <span>1: <strong className="text-blue-700">{solution.minterms.length}</strong></span>
                {solution.dontCares.length > 0 && (
                  <span>• X: <strong className="text-amber-700">{solution.dontCares.length}</strong></span>
                )}
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
                  <span>Sağdaki grupların üzerine gelerek haritada hücreleri görebilirsiniz.</span>
                </div>
                <span className="text-xs text-slate-400 font-medium hidden sm:inline">Sabitlemek için tıklayın</span>
              </div>
            )}

            {/* K-Map Grid */}
            <div className="overflow-x-auto pb-2 pt-1 flex justify-center">
              <div className="inline-block border-2 border-slate-300 rounded-2xl overflow-hidden shadow-sm bg-white">
                {/* Column Gray Code Headers */}
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

                {/* Grid Rows */}
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

            {/* Torus / Neighborhood Rule Note */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs sm:text-sm text-slate-600 flex items-start sm:items-center gap-3">
              <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 sm:mt-0" />
              <span>
                <strong>Simit (Torus) Bitişikliği:</strong> Haritanın en sol ve en sağ sütunları ile en üst ve en alt satırları birbiriyle komşudur. 4 köşe hücresi (m₀, m₂, m₈, m₁₀) birleştirilerek tek bir 4'lü grup oluşturabilir.
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Sticky Live Results & Groups (5 cols) */}
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
                Minimal POS (Toplamların Çarpımı) Karşılığı:
              </span>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs sm:text-sm font-semibold text-slate-800 break-all">
                F = {solution.simplifiedPOS}
              </div>
            </div>
          </div>

          {/* Selected Groups Breakdown Card */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 uppercase tracking-wider">
                  Oluşturulan K-Map Grupları ({solution.selectedGroups.length})
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

      {/* Step by Step Explanation Box */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-4">
        <h3 className="font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-blue-600" />
          <span>Adım Adım Sadeleştirme Mantığı ve Analizi</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs sm:text-sm text-slate-600">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <strong className="text-slate-900 block font-semibold">1. Minterm Tespiti</strong>
            <span>Haritadaki tüm 1'ler belirlendi: [{solution.minterms.map((m) => `m${m}`).join(', ') || 'Yok'}].</span>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <strong className="text-slate-900 block font-semibold">2. Asal Bileşenler (PI)</strong>
            <span>En büyük 2'nin kuvveti olan dikdörtgen gruplar (16, 8, 4, 2, 1) toroid kurallarına göre birleştirildi.</span>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
            <strong className="text-slate-900 block font-semibold">3. Minimal Kapsama (EPI)</strong>
            <span>Temel asal bileşenler seçilerek tüm 1'ler en az sayıda terim ile örtüldü.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
