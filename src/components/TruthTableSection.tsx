import React, { useState, useMemo } from 'react';
import { extractVariables, evaluateExpression } from '../utils/booleanParser';
import type { LogicValue } from '../types/logic';
import { Table, Send, AlertCircle, Sparkles, RefreshCw, Layers } from 'lucide-react';

interface TruthTableSectionProps {
  onTransferToKMap?: (values: Record<number, LogicValue>, numVars: number) => void;
}

export const TruthTableSection: React.FC<TruthTableSectionProps> = ({ onTransferToKMap }) => {
  const [mode, setMode] = useState<'expression' | 'manual'>('expression');
  const [expression, setExpression] = useState<string>("A'B + BC' + AC");
  const [numVarsManual, setNumVarsManual] = useState<number>(3);
  const [manualValues, setManualValues] = useState<Record<number, LogicValue>>({
    0: 0, 1: 1, 2: 1, 3: 1, 4: 0, 5: 1, 6: 0, 7: 1,
  });

  const EXAMPLES = [
    { label: "A'B + BC' + AC", expr: "A'B + BC' + AC", desc: "3 Değişkenli SOP Sadeleşebilir Fonksiyon" },
    { label: "(A + B)(A' + C)", expr: "(A + B)(A' + C)", desc: "POS Formunda Çarpım İfadesi" },
    { label: "A ⊕ B ⊕ C", expr: "A ⊕ B ⊕ C", desc: "3 Girişli Parite Üreteci / XOR" },
    { label: "A'B'C' + A'BC + AB'C + ABC'", expr: "A'B'C' + A'BC + AB'C + ABC'", desc: "4 Mintermli Eşitlik Fonksiyonu" },
    { label: "AB + CD + A'B'C'D'", expr: "AB + CD + A'B'C'D'", desc: "4 Değişkenli İfade" },
  ];

  const { variables, rows, error } = useMemo(() => {
    if (mode !== 'expression') return { variables: [], rows: [], error: null };

    try {
      const vars = extractVariables(expression);
      if (vars.length === 0) {
        return { variables: [], rows: [], error: 'Lütfen geçerli değişkenler içeren bir Boole ifadesi yazın (ör: A, B, C).' };
      }
      if (vars.length > 5) {
        return { variables: [], rows: [], error: 'En fazla 5 değişken desteklenmektedir.' };
      }

      const totalRows = Math.pow(2, vars.length);
      const generatedRows = [];

      for (let i = 0; i < totalRows; i++) {
        const bin = i.toString(2).padStart(vars.length, '0');
        const varValues: Record<string, number> = {};
        for (let v = 0; v < vars.length; v++) {
          varValues[vars[v]] = parseInt(bin[v], 10);
        }

        const out = evaluateExpression(expression, varValues);
        generatedRows.push({
          index: i,
          binary: bin,
          varValues,
          out: out as LogicValue,
        });
      }

      return { variables: vars, rows: generatedRows, error: null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sözdizimi hatası';
      return { variables: [], rows: [], error: msg };
    }
  }, [expression, mode]);

  const manualVariables = useMemo(() => {
    return ['A', 'B', 'C', 'D'].slice(0, numVarsManual);
  }, [numVarsManual]);

  const manualRows = useMemo(() => {
    const total = Math.pow(2, numVarsManual);
    const r = [];
    for (let i = 0; i < total; i++) {
      const bin = i.toString(2).padStart(numVarsManual, '0');
      const varValues: Record<string, number> = {};
      for (let v = 0; v < numVarsManual; v++) {
        varValues[manualVariables[v]] = parseInt(bin[v], 10);
      }
      r.push({
        index: i,
        binary: bin,
        varValues,
        out: manualValues[i] ?? 0,
      });
    }
    return r;
  }, [numVarsManual, manualVariables, manualValues]);

  const activeRows = mode === 'expression' ? rows : manualRows;
  const activeVars = mode === 'expression' ? variables : manualVariables;

  const mintermList = activeRows.filter((r) => r.out === 1).map((r) => r.index);
  const dontCareList = activeRows.filter((r) => r.out === 'X').map((r) => r.index);
  const maxtermList = activeRows.filter((r) => r.out === 0).map((r) => r.index);

  const toggleManualValue = (index: number) => {
    setManualValues((prev) => {
      const cur = prev[index] ?? 0;
      let next: LogicValue = 1;
      if (cur === 0) next = 1;
      else if (cur === 1) next = 'X';
      else next = 0;
      return { ...prev, [index]: next };
    });
  };

  const handleTransfer = () => {
    if (!onTransferToKMap) return;
    const valuesMap: Record<number, LogicValue> = {};
    activeRows.forEach((r) => {
      valuesMap[r.index] = r.out;
    });
    const varsCount = Math.min(Math.max(activeVars.length, 2), 4);
    onTransferToKMap(valuesMap, varsCount);
  };

  const insertSymbol = (sym: string) => {
    setExpression((prev) => prev + sym);
  };

  return (
    <div className="space-y-8">
      {/* Educational Header - Clean & Academic */}
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-3xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Table className="w-3.5 h-3.5" />
            2. Ünite: Fonksiyon Temsili
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Doğruluk Tablosu & Kanonik İfadeler
          </h1>
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
            Her Boole fonksiyonu olası tüm giriş durumları için bir doğruluk tablosu oluşturur.
            Burada fonksiyon ifadesi girerek ya da doğrudan çıkışları belirleyerek minterm (Σm) ve maxterm (ΠM) açılımlarını elde edebilirsiniz.
          </p>
        </div>

        <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 self-start md:self-auto shrink-0">
          <button
            onClick={() => setMode('expression')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              mode === 'expression'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            İfade Girerek
          </button>
          <button
            onClick={() => setMode('manual')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              mode === 'manual'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tablodan Seçerek
          </button>
        </div>
      </div>

      {/* Input Section */}
      {mode === 'expression' ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-5">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
            Boole Cebri İfadesi
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="Örn: A'B + BC' + AC"
              className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-5 py-3 text-base sm:text-lg font-mono text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all"
            />
            {expression && (
              <button
                onClick={() => setExpression('')}
                className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-semibold cursor-pointer border border-slate-200"
              >
                Temizle
              </button>
            )}
          </div>

          {/* Virtual Logic Keypad */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs sm:text-sm">
            <span className="text-slate-500 font-semibold mr-1">Hızlı Semboller:</span>
            {[
              { sym: "'", label: "' (NOT)" },
              { sym: " + ", label: "+ (OR)" },
              { sym: " · ", label: "· (AND)" },
              { sym: " ⊕ ", label: "⊕ (XOR)" },
              { sym: "(", label: "(" },
              { sym: ")", label: ")" },
              { sym: "A", label: "A" },
              { sym: "B", label: "B" },
              { sym: "C", label: "C" },
              { sym: "D", label: "D" },
            ].map((btn, bIdx) => (
              <button
                key={bIdx}
                onClick={() => insertSymbol(btn.sym)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-slate-700 rounded-xl font-mono border border-slate-200 transition-colors cursor-pointer shadow-2xs font-semibold"
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Preset Expressions */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 text-xs sm:text-sm">
            <span className="text-slate-500 font-semibold mr-1">Örnek Fonksiyonlar:</span>
            {EXAMPLES.map((ex, exIdx) => (
              <button
                key={exIdx}
                onClick={() => setExpression(ex.expr)}
                className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200 font-mono transition-colors cursor-pointer"
                title={ex.desc}
              >
                {ex.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs sm:text-sm text-red-700 flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Değişken Sayısı:</span>
              <div className="flex gap-2">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setNumVarsManual(n)}
                    className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold cursor-pointer border ${
                      numVarsManual === n
                        ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {n} Değişken ({['A, B', 'A, B, C', 'A, B, C, D'][n - 2]})
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <button
                onClick={() => {
                  const total = Math.pow(2, numVarsManual);
                  const reset: Record<number, LogicValue> = {};
                  for (let i = 0; i < total; i++) reset[i] = 0;
                  setManualValues(reset);
                }}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 border border-slate-200 cursor-pointer font-semibold"
              >
                Tümü 0
              </button>
              <button
                onClick={() => {
                  const total = Math.pow(2, numVarsManual);
                  const reset: Record<number, LogicValue> = {};
                  for (let i = 0; i < total; i++) reset[i] = 1;
                  setManualValues(reset);
                }}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 border border-slate-200 cursor-pointer font-semibold"
              >
                Tümü 1
              </button>
              <button
                onClick={() => {
                  const total = Math.pow(2, numVarsManual);
                  const rnd: Record<number, LogicValue> = {};
                  for (let i = 0; i < total; i++) {
                    const r = Math.random();
                    rnd[i] = r > 0.6 ? 1 : r > 0.4 ? 'X' : 0;
                  }
                  setManualValues(rnd);
                }}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 border border-slate-200 cursor-pointer flex items-center gap-1.5 font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                <span>Rastgele Doldur</span>
              </button>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Aşağıdaki tabloda "Çıkış F" sütunundaki kutulara tıklayarak değerleri değiştirebilirsiniz: <strong className="text-slate-800">0 → 1 → X (Farketmez)</strong>
          </p>
        </div>
      )}

      {/* Canonical Form Cards - Spacious */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Canonical SOP */}
        <div className="bg-white p-7 rounded-3xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Kanonik Minterm Toplamı (SOP)
            </span>
            <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg">Σ m</span>
          </div>
          <div className="text-lg sm:text-xl font-mono font-bold text-slate-900 pt-1">
            {mintermList.length > 0 ? (
              <>
                F = Σ m({mintermList.join(', ')})
                {dontCareList.length > 0 && <span className="text-amber-700"> + d({dontCareList.join(', ')})</span>}
              </>
            ) : (
              'F = 0'
            )}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed pt-1">
            Çıkışı 1 yapan giriş kombinasyonlarının mantıksal toplamı (Çarpımların Toplamı).
          </p>
        </div>

        {/* Canonical POS */}
        <div className="bg-white p-7 rounded-3xl border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Kanonik Maxterm Çarpımı (POS)
            </span>
            <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg">Π M</span>
          </div>
          <div className="text-lg sm:text-xl font-mono font-bold text-slate-900 pt-1">
            {maxtermList.length > 0 ? (
              <>
                F = Π M({maxtermList.join(', ')})
                {dontCareList.length > 0 && <span className="text-amber-700"> · d({dontCareList.join(', ')})</span>}
              </>
            ) : (
              'F = 1'
            )}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed pt-1">
            Çıkışı 0 yapan giriş kombinasyonlarının mantıksal çarpımı (Toplamların Çarpımı).
          </p>
        </div>
      </div>

      {/* Transfer to K-Map Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-blue-50/70 p-6 rounded-3xl border border-blue-200">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">Bu fonksiyonu Karnaugh Haritasında sadeleştir</h2>
            <p className="text-xs sm:text-sm text-slate-600">Tablodaki mintermleri otomatik olarak K-Map'e aktarıp en sade devreyi bulun.</p>
          </div>
        </div>

        <button
          onClick={handleTransfer}
          className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold rounded-2xl shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all shrink-0"
        >
          <span>Karnaugh'da Çöz</span>
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Truth Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5 text-sm sm:text-base font-bold text-slate-800">
            <Layers className="w-5 h-5 text-blue-600" />
            <span>Doğruluk Tablosu ({activeRows.length} Durum)</span>
          </div>
          <span className="text-xs text-slate-500">
            {mode === 'manual' ? 'Hücreye tıklayarak çıkışı değiştirin' : 'İfadeden türetildi'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center text-xs sm:text-sm font-mono">
            <thead>
              <tr className="bg-slate-100/90 text-slate-700 border-b border-slate-200 font-semibold">
                <th className="py-3 px-5 text-slate-500">İndeks</th>
                {activeVars.map((v) => (
                  <th key={v} className="py-3 px-5 font-bold text-slate-800">
                    {v}
                  </th>
                ))}
                <th className="py-3 px-5 text-slate-600">Minterm</th>
                <th className="py-3 px-5 text-slate-600">Maxterm</th>
                <th className="py-3 px-5 font-bold text-blue-800 bg-blue-50/60">
                  Çıkış F
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeRows.map((row) => {
                const isOne = row.out === 1;
                const isDC = row.out === 'X';

                return (
                  <tr
                    key={row.index}
                    className={`transition-colors duration-100 ${
                      isOne
                        ? 'bg-blue-50/30 hover:bg-blue-50/60'
                        : isDC
                        ? 'bg-amber-50/30 hover:bg-amber-50/60'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2.5 px-5 text-slate-400 font-sans">{row.index}</td>
                    {activeVars.map((v) => (
                      <td key={v} className="py-2.5 px-5 font-semibold text-slate-800">
                        {row.varValues[v]}
                      </td>
                    ))}
                    <td className="py-2.5 px-5 text-slate-600">m{row.index}</td>
                    <td className="py-2.5 px-5 text-slate-600">M{row.index}</td>
                    <td className="py-2.5 px-5 bg-slate-50/50">
                      {mode === 'manual' ? (
                        <button
                          onClick={() => toggleManualValue(row.index)}
                          className={`w-9 h-8 rounded-lg font-bold text-xs sm:text-sm inline-flex items-center justify-center cursor-pointer transition-all border ${
                            isOne
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : isDC
                              ? 'bg-amber-100 text-amber-800 border-amber-300'
                              : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {row.out}
                        </button>
                      ) : (
                        <span
                          className={`px-3 py-1 rounded-md font-bold text-xs sm:text-sm inline-block ${
                            isOne
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {row.out}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
