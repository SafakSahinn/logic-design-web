import { useState } from 'react';
import { Navbar } from './components/Navbar';
import type { UnitTab } from './components/Navbar';
import { HomePage } from './components/HomePage';
import { StandaloneKMapSolver } from './components/StandaloneKMapSolver';
import { StandaloneNumberConverter } from './components/StandaloneNumberConverter';
import { LogicCircuitSimulator } from './components/LogicCircuitSimulator';
import { TruthTableSection } from './components/TruthTableSection';
import { Unit1NumberSystems } from './components/Unit1NumberSystems';
import { Unit2BooleanLogic } from './components/Unit2BooleanLogic';
import { Unit3KMap } from './components/Unit3KMap';
import { Unit4Combinational } from './components/Unit4Combinational';
import { QuizSection } from './components/QuizSection';
import type { LogicValue } from './types/logic';
import { GraduationCap, BookOpen, ExternalLink, ArrowLeft, ArrowRight, Home } from 'lucide-react';

export function App() {
  const getInitialTab = (): UnitTab => {
    if (typeof window !== 'undefined') {
      const paramTab = new URLSearchParams(window.location.search).get('tab') as UnitTab;
      if (paramTab) return paramTab;
      const hash = window.location.hash.replace('#', '') as UnitTab;
      if (hash) return hash;
    }
    return 'circuit-simulator';
  };

  const [activeTab, setActiveTab] = useState<UnitTab>(getInitialTab);
  const [sharedKMapValues, setSharedKMapValues] = useState<Record<number, LogicValue> | undefined>(undefined);
  const [sharedNumVars, setSharedNumVars] = useState<number>(3);

  const handleTransferToKMap = (values: Record<number, LogicValue>, numVars: number) => {
    setSharedKMapValues(values);
    setSharedNumVars(numVars);
    setActiveTab('kmap-solver');
  };

  const isBookUnit =
    activeTab === 'unit1' ||
    activeTab === 'unit2' ||
    activeTab === 'unit3' ||
    activeTab === 'unit4';

  const UNIT_SEQUENCE: { id: UnitTab; title: string }[] = [
    { id: 'unit1', title: 'Bölüm 1: Sayı Sistemleri ve Kodlama' },
    { id: 'unit2', title: 'Bölüm 2: Bool Cebri ve Mantık Kapıları' },
    { id: 'unit3', title: 'Bölüm 3: K-map ile Sadeleştirme' },
    { id: 'unit4', title: 'Bölüm 4: Kombinasyonel Mantık Devreleri' },
  ];

  const currentUnitIdx = UNIT_SEQUENCE.findIndex((u) => u.id === activeTab);
  const prevUnit = currentUnitIdx > 0 ? UNIT_SEQUENCE[currentUnitIdx - 1] : null;
  const nextUnit = currentUnitIdx < UNIT_SEQUENCE.length - 1 ? UNIT_SEQUENCE[currentUnitIdx + 1] : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Navigation */}
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Container - Spacious & Breathing Room */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 lg:px-10 py-8 sm:py-12">
        {/* Breadcrumb Bar when inside a book chapter */}
        {isBookUnit && (
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 text-xs sm:text-sm shadow-2xs">
            <button
              onClick={() => {
                setActiveTab('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 rounded-xl text-slate-700 font-semibold border border-slate-200 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Home className="w-4 h-4 text-blue-600" />
              <span>← Ana Sayfa (İçindekiler)</span>
            </button>

            <div className="flex items-center gap-2.5">
              {prevUnit && (
                <button
                  onClick={() => {
                    setActiveTab(prevUnit.id);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-600 border border-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">Önceki:</span> {prevUnit.title.split(':')[0]}
                </button>
              )}
              {nextUnit && (
                <button
                  onClick={() => {
                    setActiveTab(nextUnit.id);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-xl border border-blue-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <span className="hidden sm:inline">Sonraki:</span> {nextUnit.title.split(':')[0]}
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content by Active Tab */}
        {activeTab === 'home' && <HomePage onSelectUnit={setActiveTab} />}
        {activeTab === 'circuit-simulator' && <LogicCircuitSimulator />}
        {activeTab === 'kmap-solver' && (
          <StandaloneKMapSolver
            initialValues={sharedKMapValues}
            initialNumVars={sharedNumVars}
          />
        )}
        {activeTab === 'number-converter' && <StandaloneNumberConverter />}
        {activeTab === 'truth-table-tool' && (
          <div className="space-y-6">
            <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-xs space-y-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Bağımsız Doğruluk Tablosu Motoru
              </h1>
              <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
                İstediğiniz Boole fonksiyonunu yazarak doğruluk tablosunu oluşturun veya hücreleri kendiniz düzenleyin. Kanonik SOP (Σm) ve POS (ΠM) açılımlarını anında hesaplayın.
              </p>
            </div>
            <TruthTableSection onTransferToKMap={handleTransferToKMap} />
          </div>
        )}
        {activeTab === 'quiz' && <QuizSection />}

        {/* Book Chapter Views */}
        {activeTab === 'unit1' && <Unit1NumberSystems />}
        {activeTab === 'unit2' && (
          <Unit2BooleanLogic onTransferToKMap={handleTransferToKMap} />
        )}
        {activeTab === 'unit3' && (
          <Unit3KMap
            key={`${sharedNumVars}-${JSON.stringify(sharedKMapValues)}`}
            initialValues={sharedKMapValues}
            initialNumVars={sharedNumVars}
          />
        )}
        {activeTab === 'unit4' && <Unit4Combinational />}

        {/* Bottom Unit Switcher when reading a chapter */}
        {isBookUnit && (
          <div className="mt-16 pt-8 border-t border-slate-200 flex items-center justify-between text-xs sm:text-sm">
            {prevUnit ? (
              <button
                onClick={() => {
                  setActiveTab(prevUnit.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-5 py-3 bg-white hover:bg-slate-100 rounded-2xl border border-slate-200 text-slate-700 font-semibold flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-slate-500" />
                <span>{prevUnit.title}</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setActiveTab('home');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-5 py-3 bg-white hover:bg-slate-100 rounded-2xl border border-slate-200 text-slate-700 font-semibold flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
              >
                <Home className="w-4 h-4 text-blue-600" />
                <span>Ana Sayfa (İçindekiler)</span>
              </button>
            )}

            {nextUnit ? (
              <button
                onClick={() => {
                  setActiveTab(nextUnit.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-2xl text-white font-semibold flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
              >
                <span>{nextUnit.title}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => {
                  setActiveTab('quiz');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-2xl text-white font-semibold flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
              >
                <span>Alıştırmalar & Kendini Sına</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </main>

      {/* Academic Clean Footer */}
      <footer className="bg-white border-t border-slate-200 mt-20 py-12 text-xs text-slate-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="space-y-3 md:col-span-2">
              <div className="flex items-center gap-2.5 text-slate-900 font-bold text-base">
                <GraduationCap className="w-5 h-5 text-blue-600" />
                <span>Sıfırdan İşlemciye — Sayısal Donanım Tasarımı</span>
              </div>
              <p className="text-slate-600 leading-relaxed pr-6 text-xs sm:text-sm">
                Bu web platformu, <strong>Şafak Şahin</strong> ve <strong>Dr. Batuhan Hangün</strong> tarafından yazılan
                <em> "Sıfırdan İşlemciye: Sayısal Donanım Tasarımı"</em> kitabındaki 4 temel ünitenin teorik temellerini,
                birebir elle doğrulanmış örneklerini ve bağımsız interaktif çözüm araçlarını sunar.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <a
                  href="https://github.com/SafakSahinn/sifirdan-islemciye"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-blue-700 hover:text-blue-800 font-semibold text-xs sm:text-sm underline"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>github.com/SafakSahinn/sifirdan-islemciye</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">Kitap Bölümleri</h3>
              <ul className="space-y-2 text-xs sm:text-sm">
                <li>
                  <button onClick={() => { setActiveTab('unit1'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-blue-600 transition-colors cursor-pointer text-left">
                    Bölüm 1: Sayı Sistemleri ve Kodlama
                  </button>
                </li>
                <li>
                  <button onClick={() => { setActiveTab('unit2'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-blue-600 transition-colors cursor-pointer text-left">
                    Bölüm 2: Bool Cebri ve Mantık Kapıları
                  </button>
                </li>
                <li>
                  <button onClick={() => { setActiveTab('unit3'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-blue-600 transition-colors cursor-pointer text-left">
                    Bölüm 3: K-map ile Sadeleştirme
                  </button>
                </li>
                <li>
                  <button onClick={() => { setActiveTab('unit4'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-blue-600 transition-colors cursor-pointer text-left">
                    Bölüm 4: Kombinasyonel Mantık Devreleri
                  </button>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">Bağımsız Araçlar</h3>
              <ul className="space-y-2 text-xs sm:text-sm text-slate-600">
                <li>
                  <button onClick={() => { setActiveTab('kmap-solver'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-blue-600 transition-colors cursor-pointer text-left flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    <span>K-Map Çözücü (Serbest Araç)</span>
                  </button>
                </li>
                <li>
                  <button onClick={() => { setActiveTab('number-converter'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-blue-600 transition-colors cursor-pointer text-left flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    <span>Sayı Dönüştürücü Laboratuvarı</span>
                  </button>
                </li>
                <li>
                  <button onClick={() => { setActiveTab('truth-table-tool'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-blue-600 transition-colors cursor-pointer text-left flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    <span>Doğruluk Tablosu Motoru</span>
                  </button>
                </li>
                <li>
                  <button onClick={() => { setActiveTab('quiz'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-blue-600 transition-colors cursor-pointer text-left flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    <span>Alıştırmalar & Test</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <span>Sıfırdan İşlemciye: Açık Kaynak Sayısal Tasarım Eğitim Platformu</span>
            <span>Yazarlar: Şafak Şahin · Dr. Batuhan Hangün</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
