import React, { useState } from 'react';
import { LogicGatesSection } from './LogicGatesSection';
import { TruthTableSection } from './TruthTableSection';
import type { LogicValue } from '../types/logic';
import { Cpu, Table, BookOpen, Layers } from 'lucide-react';

interface Unit2Props {
  onTransferToKMap?: (values: Record<number, LogicValue>, numVars: number) => void;
}

export const Unit2BooleanLogic: React.FC<Unit2Props> = ({ onTransferToKMap }) => {
  const [activeSubTab, setActiveSubTab] = useState<'gates' | 'truthTable' | 'axioms'>('gates');

  return (
    <div className="space-y-6">
      {/* Chapter Intro Banner */}
      <div className="bg-white p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              <Cpu className="w-3.5 h-3.5" />
              Bölüm 2 (Sıfırdan İşlemciye)
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Bool Cebri ve Mantık Kapıları
            </h1>
            <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
              Bu bölümde ikili mantık değişkenleri, Huntington aksiyomları, düalite ilkesi,
              temel mantık kapıları (AND, OR, NOT, NAND, NOR, XOR, XNOR), kanonik minterm/maxterm formları
              ve TTL/CMOS mantık entegreleri incelenmektedir.
            </p>
          </div>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveSubTab('gates')}
          className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer border ${
            activeSubTab === 'gates'
              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>Mantık Kapıları & Laboratuvar</span>
        </button>

        <button
          onClick={() => setActiveSubTab('truthTable')}
          className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer border ${
            activeSubTab === 'truthTable'
              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Table className="w-4 h-4" />
          <span>Doğruluk Tablosu & Kanonik Formlar</span>
        </button>

        <button
          onClick={() => setActiveSubTab('axioms')}
          className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer border ${
            activeSubTab === 'axioms'
              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Aksiyomlar, Düalite & İspatlar</span>
        </button>
      </div>

      {/* Content Rendering */}
      {activeSubTab === 'gates' && <LogicGatesSection />}
      {activeSubTab === 'truthTable' && (
        <TruthTableSection onTransferToKMap={onTransferToKMap} />
      )}
      {activeSubTab === 'axioms' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Huntington Postulates */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                Huntington Aksiyomları (Postülatlar)
              </h3>
              <p className="text-xs text-slate-500">
                1904 yılında E. V. Huntington tarafından ortaya konan ve modern ikili mantığın temelini oluşturan kurallar:
              </p>
              <div className="space-y-2 text-xs font-mono">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-sans block">Postülat 2 (Birim Eleman):</span>
                  <div className="font-bold text-blue-800">x + 0 = x &nbsp;|&nbsp; x · 1 = x</div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-sans block">Postülat 3 (Değişme Özelliği):</span>
                  <div className="font-bold text-blue-800">x + y = y + x &nbsp;|&nbsp; x · y = y · x</div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-sans block">Postülat 4 (Dağılma Özelliği):</span>
                  <div className="font-bold text-blue-800">x · (y + z) = (x·y) + (x·z) &nbsp;|&nbsp; x + (y·z) = (x+y) · (x+z)</div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-sans block">Postülat 5 (Tümleyen):</span>
                  <div className="font-bold text-blue-800">x + x' = 1 &nbsp;|&nbsp; x · x' = 0</div>
                </div>
              </div>
            </div>

            {/* Duality Principle & Consensus Theorem */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600" />
                Düalite İlkesi & Konsensüs Teoremi
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                <strong>Düalite (İkizlik) İlkesi:</strong> Geçerli bir Boole denklemindeki tüm $+$ işlemleri $\cdot$ ile,
                tüm $\cdot$ işlemleri $+$ ile, $0$'lar $1$ ile ve $1$'ler $0$ ile değiştirilirse elde edilen yeni denklem de daima doğrudur.
              </p>

              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200 space-y-1.5 text-xs">
                <span className="font-bold text-blue-900 block">Kitap Örneği 2.7: Konsensüs Teoreminin İspatı</span>
                <div className="font-mono text-slate-800 font-semibold">
                  xy + x'z + yz = xy + x'z
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  İspat Adımı: $yz$ terimi $yz \cdot 1 = yz(x + x') = xyz + x'yz$ olarak açılır.
                  $xy + xyz = xy(1+z) = xy$ ve $x'z + x'yz = x'z(1+y) = x'z$ terimleri birbirini yutar ve $yz$ terimi elenir.
                </p>
              </div>

              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200 space-y-1 text-xs">
                <span className="font-bold text-emerald-900 block">De Morgan Teoremleri</span>
                <div className="font-mono text-emerald-950 font-semibold">
                  (x + y)' = x' · y' &nbsp;|&nbsp; (x · y)' = x' + y'
                </div>
                <p className="text-slate-600 text-[11px]">
                  NOR kapısı değillenmiş girişli AND kapısına; NAND kapısı ise değillenmiş girişli OR kapısına eşdeğerdir.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
