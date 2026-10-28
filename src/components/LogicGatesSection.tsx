import React, { useState } from 'react';
import { LOGIC_GATES, BOOLEAN_LAWS } from '../data/logicGatesData';
import { GateDiagram } from './GateDiagram';
import { Cpu, BookOpen, Layers, CheckCircle2, Lightbulb, Zap } from 'lucide-react';

export const LogicGatesSection: React.FC = () => {
  const [selectedGateId, setSelectedGateId] = useState<string>('and');
  const [inputA, setInputA] = useState<number>(1);
  const [inputB, setInputB] = useState<number>(1);

  const currentGate = LOGIC_GATES.find((g) => g.id === selectedGateId) || LOGIC_GATES[0];

  const computeOutput = (gateId: string, a: number, b: number): number => {
    switch (gateId) {
      case 'and': return a & b;
      case 'or': return a | b;
      case 'not': return a === 1 ? 0 : 1;
      case 'nand': return (a & b) === 1 ? 0 : 1;
      case 'nor': return (a | b) === 0 ? 1 : 0;
      case 'xor': return a ^ b;
      case 'xnor': return (a ^ b) === 0 ? 1 : 0;
      case 'buffer': return a;
      default: return 0;
    }
  };

  const currentOut = computeOutput(currentGate.id, inputA, inputB);

  return (
    <div className="space-y-10">
      {/* Educational Header - Clean & Academic */}
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-xs space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Cpu className="w-3.5 h-3.5" />
          Bölüm 2: Temel Mantık Elemanları
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Mantık Kapıları ve İşlevleri (Logic Gates)
        </h1>
        <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-3xl">
          Mantık kapıları, ikili (binary) tabanda 0 ve 1 sinyallerini işleyen temel elektronik devre elemanlarıdır.
          Aşağıdaki laboratuvarda kapıları seçebilir, girişleri değiştirerek çıkış değerini ve doğruluk tablosunu inceleyebilirsiniz.
        </p>
      </div>

      {/* Gate Selector Buttons - Spacious Pills */}
      <div className="flex flex-wrap gap-2.5">
        {LOGIC_GATES.map((gate) => {
          const isSelected = gate.id === selectedGateId;
          return (
            <button
              key={gate.id}
              onClick={() => setSelectedGateId(gate.id)}
              className={`px-4 py-2.5 rounded-2xl font-semibold text-xs sm:text-sm transition-all duration-150 flex items-center gap-2.5 cursor-pointer border shadow-2xs ${
                isSelected
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
              }`}
            >
              <span className={`font-mono text-xs px-2 py-0.5 rounded-lg ${isSelected ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {gate.symbol}
              </span>
              <span>{gate.name}</span>
              <span className={`text-xs ${isSelected ? 'text-blue-100' : 'text-slate-400'} hidden sm:inline`}>
                ({gate.turkishName.split(' ')[0]})
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Interactive Diagram & Truth Table Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Circuit Diagram */}
        <div className="lg:col-span-7 space-y-6">
          <GateDiagram
            gateId={currentGate.id}
            a={inputA}
            b={inputB}
            out={currentOut}
            onToggleA={() => setInputA(inputA === 1 ? 0 : 1)}
            onToggleB={() => setInputB(inputB === 1 ? 0 : 1)}
          />

          {/* Quick Specifications Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-1.5">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Boole Fonksiyonu</span>
              <div className="text-xl font-mono font-bold text-blue-700">{currentGate.expression}</div>
              <div className="text-xs text-slate-500 font-mono">{currentGate.altExpression}</div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-1.5">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Standart Entegre (IC) Kodu</span>
              <div className="text-base font-mono font-bold text-slate-800">{currentGate.icCode}</div>
              <div className="text-xs text-slate-500">TTL 74xx serisi standart lojik ailesi</div>
            </div>
          </div>
        </div>

        {/* Right: Truth Table & Theoretical Summary */}
        <div className="lg:col-span-5 space-y-6">
          {/* Truth Table */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <h2 className="font-bold text-slate-900 text-sm sm:text-base">Doğruluk Tablosu (Truth Table)</h2>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {currentGate.inputs === 1 ? '2 Durum (2¹)' : '4 Durum (2²)'}
              </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-center text-xs sm:text-sm font-mono">
                <thead>
                  <tr className="bg-slate-100/80 text-slate-700 border-b border-slate-200 font-semibold">
                    <th className="py-3 px-4">Giriş A</th>
                    {currentGate.inputs === 2 && <th className="py-3 px-4">Giriş B</th>}
                    <th className="py-3 px-4 text-blue-700 font-bold bg-blue-50/50">Çıkış Y</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentGate.table.map((row, idx) => {
                    const isActive =
                      currentGate.inputs === 1
                        ? row.a === inputA
                        : row.a === inputA && row.b === inputB;

                    return (
                      <tr
                        key={idx}
                        className={`transition-colors duration-150 ${
                          isActive
                            ? 'bg-blue-50 text-blue-900 font-bold ring-2 ring-inset ring-blue-300'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <td className="py-3 px-4">{row.a}</td>
                        {currentGate.inputs === 2 && <td className="py-3 px-4">{row.b}</td>}
                        <td className={`py-3 px-4 ${row.out === 1 ? 'text-emerald-700 font-bold' : 'text-slate-500'}`}>
                          {row.out}
                          {isActive && <span className="ml-2 text-xs font-sans text-blue-600">◄ Aktif Durum</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Academic Gate Explanations */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-xs space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <BookOpen className="w-4 h-4 text-blue-600" />
              <h2 className="font-bold text-slate-900 text-sm sm:text-base">{currentGate.turkishName}</h2>
            </div>

            <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">{currentGate.description}</p>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs sm:text-sm space-y-1">
              <div className="flex items-center gap-1.5 text-blue-800 font-semibold">
                <Zap className="w-4 h-4 text-blue-600" />
                <span>Çalışma Mantığı</span>
              </div>
              <p className="text-slate-600">{currentGate.behavior}</p>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs sm:text-sm space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-800 font-semibold">
                <Lightbulb className="w-4 h-4 text-emerald-600" />
                <span>Devre Eşdeğeri & Analoji</span>
              </div>
              <p className="text-slate-600">{currentGate.analogy}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Matrix of all Gates - Spacious Table */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
            Mantık Kapıları Karşılaştırma Matrisi
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tüm temel mantık kapılarının 1 ve 0 çıkışı üretme şartları bir arada:
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-semibold font-mono">
              <tr>
                <th className="py-3 px-4">Kapı Adı</th>
                <th className="py-3 px-4">Sembol</th>
                <th className="py-3 px-4">Boole İfadesi</th>
                <th className="py-3 px-4">Çıkışın 1 Olma Koşulu</th>
                <th className="py-3 px-4">Standart IC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {LOGIC_GATES.map((gate) => (
                <tr
                  key={gate.id}
                  onClick={() => setSelectedGateId(gate.id)}
                  className={`cursor-pointer transition-colors ${
                    gate.id === selectedGateId ? 'bg-blue-50/70 text-blue-900 font-medium' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-3 px-4 font-semibold">
                    {gate.name} <span className="text-slate-400 font-normal">({gate.turkishName.split(' ')[0]})</span>
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-blue-600">{gate.symbol}</td>
                  <td className="py-3 px-4 font-mono text-slate-800">{gate.expression}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {gate.id === 'and' ? 'Tüm girişler 1 iken' :
                     gate.id === 'or' ? 'En az bir giriş 1 iken' :
                     gate.id === 'nand' ? 'En az bir giriş 0 iken' :
                     gate.id === 'nor' ? 'Tüm girişler 0 iken' :
                     gate.id === 'xor' ? 'Girişler birbirinden farklı iken' :
                     gate.id === 'xnor' ? 'Girişler birbirine eşit iken' :
                     gate.id === 'not' ? 'Giriş 0 iken' : 'Giriş 1 iken'}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500">{gate.icCode.split(' ')[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Boolean Algebra Axioms & Theorems */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-6">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600" />
            Temel Bool Cebiri Teoremleri ve Özdeşlikleri
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Sayısal devrelerde kapı sayısını ve donanım maliyetini azaltmak için kullanılan cebirsel kurallar.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {BOOLEAN_LAWS.map((group, idx) => (
            <div
              key={idx}
              className="bg-slate-50 p-5 rounded-2xl border border-slate-200/90 space-y-3 hover:border-slate-300 transition-colors"
            >
              <h3 className="font-bold text-xs sm:text-sm text-slate-900">{group.name}</h3>
              <p className="text-xs text-slate-500">{group.desc}</p>
              <div className="space-y-2 pt-1 text-xs font-mono">
                {group.laws.map((law, lIdx) => (
                  <div key={lIdx} className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <div className="font-bold text-blue-700">{law.rule}</div>
                    <div className="text-[11px] text-slate-500 font-sans mt-0.5">{law.note}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
