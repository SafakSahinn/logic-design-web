import React, { useState } from 'react';
import { Cpu, Zap } from 'lucide-react';

export const Unit4Combinational: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'adders' | 'rippleCarry' | 'comparator' | 'mux' | 'decoder'>('adders');

  // Half Adder state
  const [haA, setHaA] = useState<number>(1);
  const [haB, setHaB] = useState<number>(1);
  const haSum = haA ^ haB;
  const haCarry = haA & haB;

  // Full Adder state
  const [faA, setFaA] = useState<number>(1);
  const [faB, setFaB] = useState<number>(1);
  const [faCin, setFaCin] = useState<number>(0);
  const faSum = faA ^ faB ^ faCin;
  const faCout = (faA & faB) | (faCin & (faA ^ faB));

  // 4-Bit Ripple Carry Adder state
  const [rcaA, setRcaA] = useState<number[]>([1, 0, 1, 1]); // 11
  const [rcaB, setRcaB] = useState<number[]>([0, 1, 1, 0]); // 6
  const [rcaCin, setRcaCin] = useState<number>(0);

  const compute4BitSum = () => {
    let carry = rcaCin;
    const sum = [0, 0, 0, 0];
    const carries = [carry];

    for (let i = 3; i >= 0; i--) {
      const a = rcaA[i];
      const b = rcaB[i];
      const s = a ^ b ^ carry;
      carry = (a & b) | (carry & (a ^ b));
      sum[i] = s;
      carries.unshift(carry);
    }

    const valA = rcaA[0] * 8 + rcaA[1] * 4 + rcaA[2] * 2 + rcaA[3];
    const valB = rcaB[0] * 8 + rcaB[1] * 4 + rcaB[2] * 2 + rcaB[3];
    const totalVal = valA + valB + rcaCin;

    return { sum, finalCarry: carry, valA, valB, totalVal, carries };
  };

  const rcaResult = compute4BitSum();

  // 2-bit Comparator state
  const [compA1, setCompA1] = useState<number>(1);
  const [compA0, setCompA0] = useState<number>(0);
  const [compB1, setCompB1] = useState<number>(0);
  const [compB0, setCompB0] = useState<number>(1);

  const valCompA = compA1 * 2 + compA0;
  const valCompB = compB1 * 2 + compB0;
  const isAgtB = valCompA > valCompB;
  const isAeqB = valCompA === valCompB;
  const isAltB = valCompA < valCompB;

  // 4:1 MUX state
  const [muxInputs, setMuxInputs] = useState<number[]>([0, 1, 1, 0]);
  const [muxS1, setMuxS1] = useState<number>(0);
  const [muxS0, setMuxS0] = useState<number>(1);
  const selIndex = muxS1 * 2 + muxS0;
  const muxOutput = muxInputs[selIndex];

  // 2-to-4 Decoder state
  const [decA1, setDecA1] = useState<number>(1);
  const [decA0, setDecA0] = useState<number>(0);
  const [decEnable, setDecEnable] = useState<number>(1);
  const decActiveIdx = decEnable ? decA1 * 2 + decA0 : -1;

  return (
    <div className="space-y-10">
      {/* Chapter Intro Banner */}
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-xs space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Cpu className="w-3.5 h-3.5" />
          Bölüm 4 (Sıfırdan İşlemciye)
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Kombinasyonel Mantık Devreleri
        </h1>
        <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-4xl">
          Çıkışları yalnızca o anki girişlerin mantıksal durumuna bağlı olan (bellek içermeyen) devrelerdir.
          Bu ünitede toplayıcılar (Half/Full Adder), 4-bit paralel toplayıcı, karşılaştırıcı,
          kod çözücüler (Decoder) ve çoğullayıcılar (Multiplexer) interaktif olarak modellenmiştir.
        </p>
      </div>

      {/* Sub Navigation */}
      <div className="flex flex-wrap gap-2.5 border-b border-slate-200 pb-3">
        {[
          { id: 'adders', label: 'Yarım & Tam Toplayıcı (Half / Full Adder)' },
          { id: 'rippleCarry', label: '4-Bit Paralel Toplayıcı (Ripple Carry)' },
          { id: 'comparator', label: '2-Bit Büyüklük Karşılaştırıcı' },
          { id: 'mux', label: '4:1 Çoğullayıcı (Multiplexer - MUX)' },
          { id: 'decoder', label: '2-to-4 Kod Çözücü (Decoder)' },
        ].map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as typeof activeSubTab)}
              className={`px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition-all cursor-pointer border ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 1. Adders (Half & Full Adder) */}
      {activeSubTab === 'adders' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Half Adder */}
          <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-600" />
                Yarım Toplayıcı (Half Adder)
              </h2>
              <span className="text-xs font-mono text-slate-500">2 Giriş, 2 Çıkış</span>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              İki adet 1-bitlik sayıyı toplar. Elde girişini (Cin) dikkate almaz.
            </p>

            <div className="flex items-center justify-center gap-6 py-6 bg-slate-50 rounded-2xl border border-slate-200">
              <button
                onClick={() => setHaA(haA === 1 ? 0 : 1)}
                className={`px-5 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer shadow-2xs ${
                  haA === 1 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Giriş A: {haA}
              </button>
              <span className="font-bold text-xl text-slate-400">+</span>
              <button
                onClick={() => setHaB(haB === 1 ? 0 : 1)}
                className={`px-5 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer shadow-2xs ${
                  haB === 1 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Giriş B: {haB}
              </button>
            </div>

            {/* Circuit outputs */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50/70 rounded-2xl border border-blue-200 text-center space-y-1">
                <span className="text-xs text-slate-500 uppercase block font-bold">Toplam S (A ⊕ B)</span>
                <span className="text-2xl font-mono font-bold text-blue-700">{haSum}</span>
              </div>
              <div className="p-4 bg-emerald-50/70 rounded-2xl border border-emerald-200 text-center space-y-1">
                <span className="text-xs text-slate-500 uppercase block font-bold">Elde C (A · B)</span>
                <span className="text-2xl font-mono font-bold text-emerald-700">{haCarry}</span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs sm:text-sm font-mono text-slate-700 space-y-1">
              <div>S = A ⊕ B (XOR kapısı)</div>
              <div>C = A · B (AND kapısı)</div>
            </div>
          </div>

          {/* Full Adder */}
          <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-600" />
                Tam Toplayıcı (Full Adder)
              </h2>
              <span className="text-xs font-mono text-slate-500">3 Giriş, 2 Çıkış</span>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              İki veri biti (A, B) ve önceki basamaktan gelen elde bitini (Cin) toplayarak tam ikili toplama yapar.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4 py-6 bg-slate-50 rounded-2xl border border-slate-200">
              <button
                onClick={() => setFaA(faA === 1 ? 0 : 1)}
                className={`px-4 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer shadow-2xs ${
                  faA === 1 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                A: {faA}
              </button>
              <button
                onClick={() => setFaB(faB === 1 ? 0 : 1)}
                className={`px-4 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer shadow-2xs ${
                  faB === 1 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                B: {faB}
              </button>
              <button
                onClick={() => setFaCin(faCin === 1 ? 0 : 1)}
                className={`px-4 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer shadow-2xs ${
                  faCin === 1 ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Cin: {faCin}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50/70 rounded-2xl border border-blue-200 text-center space-y-1">
                <span className="text-xs text-slate-500 uppercase block font-bold">Toplam S</span>
                <span className="text-2xl font-mono font-bold text-blue-700">{faSum}</span>
              </div>
              <div className="p-4 bg-emerald-50/70 rounded-2xl border border-emerald-200 text-center space-y-1">
                <span className="text-xs text-slate-500 uppercase block font-bold">Elde Çıkışı Cout</span>
                <span className="text-2xl font-mono font-bold text-emerald-700">{faCout}</span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs sm:text-sm font-mono text-slate-700 space-y-1">
              <div>S = A ⊕ B ⊕ Cin</div>
              <div>Cout = AB + Cin(A ⊕ B)</div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 4-Bit Ripple Carry Adder */}
      {activeSubTab === 'rippleCarry' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">4-Bit İkili Paralel Toplayıcı (Ripple Carry Adder)</h2>
              <p className="text-xs sm:text-sm text-slate-500">4 adet Full Adder'ın kaskat bağlanması ile çok bitli toplama devresi.</p>
            </div>
            <div className="text-sm font-mono font-bold text-blue-700 bg-blue-50 px-3.5 py-1.5 rounded-xl border border-blue-200">
              {rcaResult.valA} + {rcaResult.valB} + {rcaCin} = {rcaResult.totalVal}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <span className="w-28 text-xs sm:text-sm font-bold text-slate-700">A (4-Bit):</span>
              <div className="flex gap-2.5">
                {rcaA.map((bit, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      const updated = [...rcaA];
                      updated[idx] = updated[idx] === 1 ? 0 : 1;
                      setRcaA(updated);
                    }}
                    className={`w-14 h-12 rounded-2xl font-mono font-bold text-base cursor-pointer border shadow-2xs ${
                      bit === 1 ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    A{3 - idx}: {bit}
                  </button>
                ))}
              </div>
              <span className="text-sm font-mono font-bold text-slate-600">= ({rcaResult.valA})₁₀</span>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <span className="w-28 text-xs sm:text-sm font-bold text-slate-700">B (4-Bit):</span>
              <div className="flex gap-2.5">
                {rcaB.map((bit, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      const updated = [...rcaB];
                      updated[idx] = updated[idx] === 1 ? 0 : 1;
                      setRcaB(updated);
                    }}
                    className={`w-14 h-12 rounded-2xl font-mono font-bold text-base cursor-pointer border shadow-2xs ${
                      bit === 1 ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    B{3 - idx}: {bit}
                  </button>
                ))}
              </div>
              <span className="text-sm font-mono font-bold text-slate-600">= ({rcaResult.valB})₁₀</span>
            </div>

            <div className="flex items-center gap-4">
              <span className="w-28 text-xs sm:text-sm font-bold text-slate-700">Giriş Eldesi C₀:</span>
              <button
                onClick={() => setRcaCin(rcaCin === 1 ? 0 : 1)}
                className={`w-14 h-10 rounded-xl font-mono font-bold text-sm cursor-pointer border ${
                  rcaCin === 1 ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-100 text-slate-700 border-slate-300'
                }`}
              >
                {rcaCin}
              </button>
            </div>
          </div>

          <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Toplam Çıkışı (C₄ S₃ S₂ S₁ S₀):</span>
              <div className="flex items-center gap-2.5 font-mono text-xl sm:text-2xl font-bold mt-2">
                <span className="px-3 py-1 rounded-xl bg-amber-100 text-amber-900 border border-amber-300" title="Son Elde (C4)">
                  {rcaResult.finalCarry}
                </span>
                {rcaResult.sum.map((s, idx) => (
                  <span key={idx} className="px-3 py-1 rounded-xl bg-blue-100 text-blue-900 border border-blue-200">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right font-mono text-lg font-bold text-blue-900">
              = ({rcaResult.totalVal})₁₀
            </div>
          </div>
        </div>
      )}

      {/* 3. 2-Bit Magnitude Comparator */}
      {activeSubTab === 'comparator' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base sm:text-lg font-bold text-slate-900">2-Bit Büyüklük Karşılaştırıcı (Magnitude Comparator)</h2>
            <p className="text-xs sm:text-sm text-slate-500">A = A₁A₀ ve B = B₁B₀ ikili sayılarını karşılaştırarak A&gt;B, A=B veya A&lt;B sinyallerini üretir.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">A Sayısı (A₁ A₀):</span>
              <div className="flex gap-3">
                <button
                  onClick={() => setCompA1(compA1 === 1 ? 0 : 1)}
                  className={`px-4 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer ${
                    compA1 === 1 ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  A₁: {compA1}
                </button>
                <button
                  onClick={() => setCompA0(compA0 === 1 ? 0 : 1)}
                  className={`px-4 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer ${
                    compA0 === 1 ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  A₀: {compA0}
                </button>
              </div>
              <div className="text-sm font-mono font-bold text-blue-700">A Değeri = ({valCompA})₁₀</div>
            </div>

            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">B Sayısı (B₁ B₀):</span>
              <div className="flex gap-3">
                <button
                  onClick={() => setCompB1(compB1 === 1 ? 0 : 1)}
                  className={`px-4 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer ${
                    compB1 === 1 ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  B₁: {compB1}
                </button>
                <button
                  onClick={() => setCompB0(compB0 === 1 ? 0 : 1)}
                  className={`px-4 py-2.5 rounded-xl border font-mono font-bold text-sm cursor-pointer ${
                    compB0 === 1 ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  B₀: {compB0}
                </button>
              </div>
              <div className="text-sm font-mono font-bold text-blue-700">B Değeri = ({valCompB})₁₀</div>
            </div>
          </div>

          {/* Comparison Output LEDs */}
          <div className="grid grid-cols-3 gap-4">
            <div className={`p-6 rounded-2xl border text-center transition-all ${
              isAgtB ? 'bg-emerald-50 border-emerald-400 text-emerald-900 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}>
              <div className="text-sm font-bold">A &gt; B</div>
              <div className="text-2xl font-mono font-bold mt-2">{isAgtB ? '1 (Aktif)' : '0'}</div>
            </div>

            <div className={`p-6 rounded-2xl border text-center transition-all ${
              isAeqB ? 'bg-blue-50 border-blue-400 text-blue-900 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}>
              <div className="text-sm font-bold">A = B</div>
              <div className="text-2xl font-mono font-bold mt-2">{isAeqB ? '1 (Aktif)' : '0'}</div>
            </div>

            <div className={`p-6 rounded-2xl border text-center transition-all ${
              isAltB ? 'bg-amber-50 border-amber-400 text-amber-900 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}>
              <div className="text-sm font-bold">A &lt; B</div>
              <div className="text-2xl font-mono font-bold mt-2">{isAltB ? '1 (Aktif)' : '0'}</div>
            </div>
          </div>
        </div>
      )}

      {/* 4. 4:1 Multiplexer (MUX) */}
      {activeSubTab === 'mux' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base sm:text-lg font-bold text-slate-900">4:1 Çoğullayıcı (Multiplexer - MUX)</h2>
            <p className="text-xs sm:text-sm text-slate-500">2 seçici giriş (S₁, S₀) ile 4 veri girişinden (I₀..I₃) birini seçip tek bir çıkışa (Y) aktarır.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            {/* Inputs & Selector */}
            <div className="md:col-span-7 space-y-5">
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Veri Girişleri (I₀..I₃):</span>
                <div className="grid grid-cols-4 gap-3">
                  {muxInputs.map((val, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        const updated = [...muxInputs];
                        updated[idx] = updated[idx] === 1 ? 0 : 1;
                        setMuxInputs(updated);
                      }}
                      className={`p-3.5 rounded-2xl border text-center font-mono font-bold text-sm cursor-pointer ${
                        idx === selIndex
                          ? 'ring-4 ring-blue-500/20 bg-blue-50 border-blue-500 text-blue-900 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="block text-[11px] text-slate-400">I{idx}</span>
                      <span className="text-base">{val}</span>
                      {idx === selIndex && <span className="text-[10px] block text-blue-700 font-sans font-semibold mt-1">Seçili</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Seçici Hatlar (S₁, S₀):</span>
                <div className="flex gap-4 items-center">
                  <button
                    onClick={() => setMuxS1(muxS1 === 1 ? 0 : 1)}
                    className={`px-4 py-2 rounded-xl border font-mono font-bold text-sm cursor-pointer ${
                      muxS1 === 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    S₁: {muxS1}
                  </button>
                  <button
                    onClick={() => setMuxS0(muxS0 === 1 ? 0 : 1)}
                    className={`px-4 py-2 rounded-xl border font-mono font-bold text-sm cursor-pointer ${
                      muxS0 === 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    S₀: {muxS0}
                  </button>
                  <span className="text-xs sm:text-sm font-mono text-slate-600">
                    Seçilen Hat: <strong className="text-blue-700">I{selIndex}</strong> (İkili: {muxS1}{muxS0})
                  </span>
                </div>
              </div>
            </div>

            {/* Output */}
            <div className="md:col-span-5 bg-slate-50 p-8 rounded-3xl border border-slate-200 text-center space-y-2">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-bold">Çıkış Y</span>
              <div className="text-4xl font-mono font-extrabold text-blue-700">{muxOutput}</div>
              <p className="text-xs text-slate-500 leading-relaxed pt-1">
                Giriş <strong>I{selIndex}</strong> sinyali doğrudan çıkışa iletilmektedir.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 5. 2-to-4 Decoder */}
      {activeSubTab === 'decoder' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base sm:text-lg font-bold text-slate-900">2-to-4 Kod Çözücü (Decoder)</h2>
            <p className="text-xs sm:text-sm text-slate-500">2 giriş bitine (A₁, A₀) ve Etkinleştirme (Enable) girişine göre 4 çıkış hattından birini aktif (1) yapar.</p>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Etkinleştirme (Enable):</span>
              <button
                onClick={() => setDecEnable(decEnable === 1 ? 0 : 1)}
                className={`px-4 py-2 rounded-xl border font-mono font-bold text-xs sm:text-sm cursor-pointer ${
                  decEnable === 1 ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 border-slate-300'
                }`}
              >
                E: {decEnable} ({decEnable === 1 ? 'Açık' : 'Devre Dışı'})
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Girişler:</span>
              <button
                onClick={() => setDecA1(decA1 === 1 ? 0 : 1)}
                className={`px-4 py-2 rounded-xl border font-mono font-bold text-xs sm:text-sm cursor-pointer ${
                  decA1 === 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 border-slate-300'
                }`}
              >
                A₁: {decA1}
              </button>
              <button
                onClick={() => setDecA0(decA0 === 1 ? 0 : 1)}
                className={`px-4 py-2 rounded-xl border font-mono font-bold text-xs sm:text-sm cursor-pointer ${
                  decA0 === 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 border-slate-300'
                }`}
              >
                A₀: {decA0}
              </button>
            </div>
          </div>

          {/* Decoder Outputs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((idx) => {
              const isActive = idx === decActiveIdx;
              return (
                <div
                  key={idx}
                  className={`p-6 rounded-2xl border text-center transition-all ${
                    isActive
                      ? 'bg-blue-50 border-blue-400 text-blue-900 shadow-xs ring-2 ring-blue-300'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <span className="text-xs font-mono font-semibold block">Çıkış D{idx} (m{idx})</span>
                  <span className="text-2xl font-mono font-bold mt-2 block">{isActive ? '1' : '0'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
