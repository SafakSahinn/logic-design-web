import React, { useState } from 'react';
import { KMapSection } from './KMapSection';
import { BOOK_KMAP_EXAMPLES } from '../data/bookExamples';
import type { BookExampleKMap } from '../data/bookExamples';
import type { LogicValue } from '../types/logic';
import { Grid, BookOpen, Sparkles, ArrowRight } from 'lucide-react';

interface Unit3Props {
  initialValues?: Record<number, LogicValue>;
  initialNumVars?: number;
}

export const Unit3KMap: React.FC<Unit3Props> = ({
  initialValues,
  initialNumVars = 3,
}) => {
  const [selectedExample, setSelectedExample] = useState<BookExampleKMap | null>(null);
  const [kmapValues, setKmapValues] = useState<Record<number, LogicValue> | undefined>(initialValues);
  const [numVars, setNumVars] = useState<number>(initialNumVars);

  const handleLoadBookExample = (ex: BookExampleKMap) => {
    setSelectedExample(ex);
    setNumVars(ex.numVars);

    const total = Math.pow(2, ex.numVars);
    const newVals: Record<number, LogicValue> = {};
    for (let i = 0; i < total; i++) {
      if (ex.minterms.includes(i)) newVals[i] = 1;
      else if (ex.dontCares.includes(i)) newVals[i] = 'X';
      else newVals[i] = 0;
    }
    setKmapValues(newVals);
  };

  return (
    <div className="space-y-10">
      {/* Chapter Intro Banner */}
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-xs space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Grid className="w-3.5 h-3.5" />
          Bölüm 3 (Sıfırdan İşlemciye)
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Kapı Seviyesinde Sadeleştirme (K-Map & Quine-McCluskey)
        </h1>
        <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-4xl">
          Bu bölümde Karnaugh haritaları (2, 3 ve 4 değişkenli), Gray kodu yerleşimi, asal (prime)
          ve temel asal (essential prime) bileşenler, çevresel/torus bitişikliği, önemsenmeyen durumlar (Don't Care)
          ve Quine-McCluskey algoritması işlenmektedir.
        </p>
      </div>

      {/* Book Examples Gallery Bar - Spacious & Categorized */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2.5">
              <BookOpen className="w-5 h-5 text-blue-600" />
              "Sıfırdan İşlemciye" Kitabındaki K-Map Örnekleri
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Aşağıdaki örneklerden birini seçerek haritaya anında aktarabilir ve sadeleştirme adımlarını görebilirsiniz:
            </p>
          </div>
          <span className="text-xs font-mono font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 self-start sm:self-auto">
            12 Doğrulanmış Örnek
          </span>
        </div>

        {/* Spacious Example Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {BOOK_KMAP_EXAMPLES.map((ex) => {
            const isCurrent = selectedExample?.id === ex.id;
            return (
              <div
                key={ex.id}
                onClick={() => handleLoadBookExample(ex)}
                className={`p-5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                  isCurrent
                    ? 'bg-blue-50/80 border-blue-400 shadow-sm ring-2 ring-blue-300'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100/90 hover:border-slate-300'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs sm:text-sm text-slate-900">{ex.name.split(':')[0]}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-semibold">
                      {ex.numVars} Değişken
                    </span>
                  </div>
                  <div className="font-mono text-blue-700 font-bold text-sm">{ex.label}</div>
                  <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{ex.description}</p>
                </div>

                <div className="pt-2.5 border-t border-slate-200/60 flex items-center justify-between text-xs font-mono">
                  <span className="font-semibold text-emerald-800">SOP: {ex.expectedSOP}</span>
                  <span className="text-blue-600 font-sans font-semibold flex items-center gap-1 group-hover:underline">
                    Yükle <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Example Detail Note */}
      {selectedExample && (
        <div className="p-6 bg-blue-50/80 border border-blue-200 rounded-3xl flex items-start gap-4 shadow-2xs">
          <Sparkles className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-1.5 text-xs sm:text-sm">
            <div className="font-bold text-blue-900 flex items-center gap-2.5 text-sm sm:text-base">
              <span>{selectedExample.name}</span>
              <span className="text-xs font-mono bg-blue-100 px-2.5 py-0.5 rounded-lg text-blue-800 border border-blue-200">
                {selectedExample.chapter}
              </span>
            </div>
            <p className="text-slate-700 leading-relaxed">{selectedExample.explanation}</p>
          </div>
        </div>
      )}

      {/* K-Map Interactive Engine */}
      <KMapSection
        key={`${numVars}-${JSON.stringify(kmapValues)}`}
        initialValues={kmapValues}
        initialNumVars={numVars}
      />
    </div>
  );
};
