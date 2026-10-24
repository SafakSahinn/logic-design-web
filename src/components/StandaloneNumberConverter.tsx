import React, { useState } from 'react';
import { Binary, Calculator, Cpu, ArrowRightLeft, Layers } from 'lucide-react';

export const StandaloneNumberConverter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'baseConverter' | 'twosComplement' | 'ieee754' | 'grayCode'>('baseConverter');

  // Any-base converter state
  const [inputBase, setInputBase] = useState<'10' | '2' | '8' | '16'>('10');
  const [inputValue, setInputValue] = useState<string>('53');

  // Convert input value to decimal integer
  const parseToDecimal = (val: string, base: string): number | null => {
    const clean = val.trim();
    if (!clean) return null;
    try {
      const radix = parseInt(base, 10);
      const res = parseInt(clean, radix);
      return isNaN(res) ? null : res;
    } catch {
      return null;
    }
  };

  const decNumber = parseToDecimal(inputValue, inputBase);
  const isValid = decNumber !== null && decNumber >= 0;

  const binStr = isValid ? decNumber.toString(2) : '-';
  const octStr = isValid ? decNumber.toString(8) : '-';
  const decStr = isValid ? decNumber.toString(10) : '-';
  const hexStr = isValid ? decNumber.toString(16).toUpperCase() : '-';
  const grayStr = isValid ? (decNumber ^ (decNumber >> 1)).toString(2) : '-';

  // Division steps for decimal to binary
  const getDivisionSteps = (n: number) => {
    if (n === 0) return [{ dividend: 0, quotient: 0, remainder: 0 }];
    const steps = [];
    let current = n;
    while (current > 0) {
      const quotient = Math.floor(current / 2);
      const remainder = current % 2;
      steps.push({ dividend: current, quotient, remainder });
      current = quotient;
    }
    return steps;
  };

  const divisionSteps = isValid && decNumber <= 10000 ? getDivisionSteps(decNumber) : [];

  // 2's Complement State
  const [numA, setNumA] = useState<number>(45);
  const [numB, setNumB] = useState<number>(-19);
  const [bitWidth, setBitWidth] = useState<number>(8);

  const toTwosComplement = (val: number, bits: number): string => {
    const maxVal = Math.pow(2, bits - 1) - 1;
    const minVal = -Math.pow(2, bits - 1);
    if (val > maxVal || val < minVal) return 'Aralık Dışı';
    let unsigned = val;
    if (val < 0) {
      unsigned = Math.pow(2, bits) + val;
    }
    return unsigned.toString(2).padStart(bits, '0');
  };

  const binA = toTwosComplement(numA, bitWidth);
  const binB = toTwosComplement(numB, bitWidth);
  const sumVal = numA + numB;
  const binSum = toTwosComplement(sumVal, bitWidth);
  const isOverflow =
    sumVal > Math.pow(2, bitWidth - 1) - 1 ||
    sumVal < -Math.pow(2, bitWidth - 1);

  // IEEE 754 Float32 State
  const [floatInput, setFloatInput] = useState<string>('13.625');

  const getIEEE754 = (valStr: string) => {
    const f = parseFloat(valStr);
    if (isNaN(f)) return null;

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, f, false);
    const uint32 = view.getUint32(0, false);
    const bits = uint32.toString(2).padStart(32, '0');

    const sign = bits[0];
    const exponent = bits.slice(1, 9);
    const mantissa = bits.slice(9);
    const expVal = parseInt(exponent, 2);
    const unbiasedExp = expVal - 127;

    return { sign, exponent, mantissa, expVal, unbiasedExp, hex: uint32.toString(16).toUpperCase().padStart(8, '0'), floatVal: f };
  };

  const ieeeData = getIEEE754(floatInput);

  return (
    <div className="space-y-10 max-w-6xl mx-auto">
      {/* Title Header */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Binary className="w-3.5 h-3.5" />
            <span>Sayısal Dönüşüm Laboratuvarı</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Sayı Tabanı & Aritmetik Dönüştürücü
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            İkili, sekizli, onlu ve onaltılı tabanlar arasında anlık çift yönlü dönüşüm yapın; 2'ye tümleyen aritmetiğini ve IEEE 754 kayan nokta formatını inceleyin.
          </p>
        </div>

        {/* Quick Navigation Tabs */}
        <div className="flex flex-wrap gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 self-start md:self-auto shrink-0">
          {[
            { id: 'baseConverter', label: 'Taban Çevirici' },
            { id: 'twosComplement', label: '2\'ye Tümleyen' },
            { id: 'ieee754', label: 'IEEE 754 (Float32)' },
            { id: 'grayCode', label: 'Gray Kodu' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as typeof activeTab)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer focus:outline-none focus:ring-0 select-none ${
                activeTab === t.id
                  ? 'bg-white text-blue-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 1: Any Base Converter */}
      {activeTab === 'baseConverter' && (
        <div className="space-y-8">
          <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-600" />
                <span>Çoklu Taban Çevirici (Serbest Giriş)</span>
              </h2>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Giriş Tabanı:</span>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200">
                  {[
                    { id: '10' as const, label: 'Onlu (10)', badge: 'DEC' },
                    { id: '2' as const, label: 'İkili (2)', badge: 'BIN' },
                    { id: '8' as const, label: 'Sekizli (8)', badge: 'OCT' },
                    { id: '16' as const, label: 'Onaltılı (16)', badge: 'HEX' },
                  ].map((b) => {
                    const isSelected = inputBase === b.id;
                    return (
                      <button
                        key={b.id}
                        onClick={() => setInputBase(b.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150 flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-0 select-none ${
                          isSelected
                            ? 'bg-white text-blue-700 shadow-xs border border-slate-200/90 font-bold'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                      >
                        <span>{b.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                Dönüştürülecek Değeri Girin (Taban {inputBase}):
              </label>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-5 py-3.5 font-mono text-xl text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all"
                placeholder={inputBase === '2' ? 'Örn: 110101' : inputBase === '16' ? 'Örn: 2AF' : 'Örn: 53'}
              />
            </div>

            {/* Converted Results Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-2">
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">İkili (Binary - Taban 2)</span>
                <div className="text-xl font-mono font-bold text-blue-700 break-all">{binStr}₂</div>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sekizli (Octal - Taban 8)</span>
                <div className="text-xl font-mono font-bold text-slate-800 break-all">{octStr}₈</div>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Onlu (Decimal - Taban 10)</span>
                <div className="text-xl font-mono font-bold text-slate-900 break-all">{decStr}₁₀</div>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Onaltılı (Hex - Taban 16)</span>
                <div className="text-xl font-mono font-bold text-emerald-700 break-all">{hexStr}₁₆</div>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gray Kodu</span>
                <div className="text-xl font-mono font-bold text-indigo-700 break-all">{grayStr}</div>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="pt-4 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
                Hızlı Deneme Sayıları:
              </span>
              <div className="flex flex-wrap gap-2 text-xs">
                {['5', '25', '53', '167', '255', '687', '1024'].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInputBase('10');
                      setInputValue(s);
                    }}
                    className="px-3 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 text-slate-700 rounded-xl border border-slate-200 font-mono transition-colors cursor-pointer"
                  >
                    {s}₁₀
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Step-by-Step Division Table */}
          {divisionSteps.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">
                  Adım Adım 2'ye Bölme Yöntemi (Decimal → Binary)
                </h3>
                <span className="text-xs text-slate-500">Kalanlar tersten okunur: <strong>{binStr}₂</strong></span>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-center text-xs sm:text-sm font-mono">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Adım</th>
                      <th className="py-3 px-4">Bölünen</th>
                      <th className="py-3 px-4">İşlem</th>
                      <th className="py-3 px-4">Bölüm</th>
                      <th className="py-3 px-4 text-blue-700 font-bold bg-blue-50/50">Kalan (Bit)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {divisionSteps.map((st, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-sans text-slate-400">{idx + 1}</td>
                        <td className="py-2.5 px-4 font-bold text-slate-800">{st.dividend}</td>
                        <td className="py-2.5 px-4 text-slate-500">{st.dividend} ÷ 2</td>
                        <td className="py-2.5 px-4 text-slate-700">{st.quotient}</td>
                        <td className="py-2.5 px-4 font-bold text-blue-700 bg-blue-50/30">
                          {st.remainder}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: 2's Complement */}
      {activeTab === 'twosComplement' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                <span>İşaretli Sayılar & 2'ye Tümleyen Toplama/Çıkarma</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Sayısal donanımda negatif sayılar 2'ye tümleyen formatında saklanır.</p>
            </div>

            <div className="flex gap-2 text-xs">
              {[4, 8, 16].map((b) => (
                <button
                  key={b}
                  onClick={() => setBitWidth(b)}
                  className={`px-3 py-1.5 rounded-xl font-mono font-bold cursor-pointer border ${
                    bitWidth === b ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {b}-Bit
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">A Sayısı (Onlu):</label>
              <input
                type="number"
                value={numA}
                onChange={(e) => setNumA(parseInt(e.target.value, 10) || 0)}
                className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-5 py-3 font-mono text-base text-slate-900"
              />
              <span className="text-xs font-mono text-blue-700 font-semibold block">A ({bitWidth}-bit 2'ye tümleyen): {binA}</span>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">B Sayısı (Onlu):</label>
              <input
                type="number"
                value={numB}
                onChange={(e) => setNumB(parseInt(e.target.value, 10) || 0)}
                className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-5 py-3 font-mono text-base text-slate-900"
              />
              <span className="text-xs font-mono text-blue-700 font-semibold block">B ({bitWidth}-bit 2'ye tümleyen): {binB}</span>
            </div>
          </div>

          {/* Results Box */}
          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-sm sm:text-base font-mono">
              <span className="text-slate-500 font-sans">İşlem:</span>
              <span className="font-bold text-slate-900">{numA} + ({numB}) = {sumVal}</span>
            </div>
            <div className="flex items-center justify-between text-sm sm:text-base font-mono">
              <span className="text-slate-500 font-sans">İkili Toplam ({bitWidth}-bit):</span>
              <span className="font-bold text-blue-700">{binSum}</span>
            </div>

            {isOverflow && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs sm:text-sm font-semibold">
                ⚠️ Taşma (Overflow) Gerçekleşti! {bitWidth}-bit sınırları aşıldı (İzin verilen aralık: {-Math.pow(2, bitWidth-1)} ile {Math.pow(2, bitWidth-1)-1}).
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: IEEE 754 */}
      {activeTab === 'ieee754' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-8">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-blue-600" />
              <span>IEEE 754 Tek Duyarlıklı (32-Bit Float) Görselleştirici</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">32-bit kayan noktalı sayıların işaret (1b), üs (8b, bias 127) ve kesir (23b) bitlerine ayrılması.</p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Kayan Noktalı Sayı Girin (Float):
            </label>
            <input
              type="text"
              value={floatInput}
              onChange={(e) => setFloatInput(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-5 py-3.5 font-mono text-lg text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
              placeholder="Örn: 13.625 veya -13.625"
            />
          </div>

          {ieeeData && (
            <div className="space-y-6">
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">32-Bit Donanım Dizilimi:</span>
                <div className="grid grid-cols-12 gap-2 text-center font-mono text-xs">
                  <div className="col-span-2 sm:col-span-1 bg-red-100 border border-red-300 text-red-800 p-3.5 rounded-2xl">
                    <div className="text-[10px] text-red-600 font-sans font-bold">S (1b)</div>
                    <div className="font-bold text-lg mt-1">{ieeeData.sign}</div>
                  </div>

                  <div className="col-span-4 bg-blue-100 border border-blue-300 text-blue-800 p-3.5 rounded-2xl">
                    <div className="text-[10px] text-blue-600 font-sans font-bold">Üs (8b)</div>
                    <div className="font-bold text-sm mt-1.5 tracking-wider">{ieeeData.exponent}</div>
                  </div>

                  <div className="col-span-6 sm:col-span-7 bg-emerald-100 border border-emerald-300 text-emerald-800 p-3.5 rounded-2xl overflow-hidden">
                    <div className="text-[10px] text-emerald-600 font-sans font-bold">Mantissa (23b)</div>
                    <div className="font-bold text-xs mt-1.5 truncate">{ieeeData.mantissa}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs sm:text-sm font-mono">
                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-[11px] text-slate-400 font-sans font-bold uppercase block">İşaret (Sign)</span>
                  <span className="font-bold text-slate-900 text-base">{ieeeData.sign === '0' ? '+ (Pozitif)' : '- (Negatif)'}</span>
                </div>
                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-[11px] text-slate-400 font-sans font-bold uppercase block">Hesaplanan Üs</span>
                  <span className="font-bold text-slate-900 text-base">{ieeeData.expVal} - 127 = {ieeeData.unbiasedExp}</span>
                </div>
                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-[11px] text-slate-400 font-sans font-bold uppercase block">Hexadecimal</span>
                  <span className="font-bold text-slate-900 text-base">0x{ieeeData.hex}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Gray Code */}
      {activeTab === 'grayCode' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              <span>Gray Kodu & İkili Dönüşüm Tablosu (0 - 15)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Gray kodunun temel kuralı ardışık her adımda yalnızca tek bir bitin değişmesidir.</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-center text-xs sm:text-sm font-mono">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Onlu (Dec)</th>
                  <th className="py-3 px-4">İkili (Binary)</th>
                  <th className="py-3 px-4 text-blue-700 font-bold bg-blue-50/50">Gray Kodu</th>
                  <th className="py-3 px-4 text-emerald-700">BCD (8421)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((val) => (
                  <tr key={val} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-sans text-slate-500">{val}</td>
                    <td className="py-2.5 px-4 text-slate-800">{val.toString(2).padStart(4, '0')}</td>
                    <td className="py-2.5 px-4 font-bold text-blue-700 bg-blue-50/30">
                      {(val ^ (val >> 1)).toString(2).padStart(4, '0')}
                    </td>
                    <td className="py-2.5 px-4 text-emerald-800">
                      {val <= 9 ? val.toString(2).padStart(4, '0') : 'Geçersiz (Hata)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
