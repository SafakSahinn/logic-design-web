import React, { useState } from 'react';
import { Binary, Calculator, Cpu, Hash, ArrowRightLeft, BookOpen, Layers } from 'lucide-react';

export const Unit1NumberSystems: React.FC = () => {
  const [decInput, setDecInput] = useState<string>('53');
  const [activeTab, setActiveTab] = useState<'converter' | 'twosComplement' | 'ieee754' | 'grayCode'>('converter');

  const [numA, setNumA] = useState<number>(45);
  const [numB, setNumB] = useState<number>(-19);
  const [bitWidth, setBitWidth] = useState<number>(8);

  const [floatInput, setFloatInput] = useState<string>('13.625');

  const parseDec = parseInt(decInput, 10);
  const isValidDec = !isNaN(parseDec) && parseDec >= 0;

  const binValue = isValidDec ? parseDec.toString(2) : '-';
  const octValue = isValidDec ? parseDec.toString(8) : '-';
  const hexValue = isValidDec ? parseDec.toString(16).toUpperCase() : '-';

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

    return { sign, exponent, mantissa, expVal, unbiasedExp, hex: uint32.toString(16).toUpperCase().padStart(8, '0') };
  };

  const ieeeData = getIEEE754(floatInput);
  const toGray = (n: number) => (n ^ (n >> 1)).toString(2);
  const grayResult = isValidDec ? toGray(parseDec) : '-';

  return (
    <div className="space-y-10">
      {/* Chapter Intro Banner */}
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-xs space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Binary className="w-3.5 h-3.5" />
          Bölüm 1 (Sıfırdan İşlemciye)
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Sayı Sistemleri ve Kodlama
        </h1>
        <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-4xl">
          Sayısal donanımın temel dili ikili (binary) sayılardır.
          Bu ünitede sayı tabanları, ikili aritmetik, tümleyenler, işaretli sayılar,
          IEEE 754 kayan noktalı sayı standardı ve Gray/BCD kodlama sistemleri incelenmektedir.
        </p>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap gap-2.5 border-b border-slate-200 pb-3">
        {[
          { id: 'converter', label: 'Taban Dönüştürücü (2, 8, 10, 16)', icon: Hash },
          { id: 'twosComplement', label: '2\'ye Tümleyen & İşaretli Aritmetik', icon: Calculator },
          { id: 'ieee754', label: 'IEEE 754 Kayan Nokta (Float32)', icon: Cpu },
          { id: 'grayCode', label: 'Gray Kodu ve BCD', icon: Layers },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer border ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Base Converter */}
      {activeTab === 'converter' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-blue-600" />
              Canlı Sayı Tabanı Çevirici
            </h2>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                Onlu (Decimal - Taban 10) Sayı Girin:
              </label>
              <input
                type="number"
                min="0"
                value={decInput}
                onChange={(e) => setDecInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-5 py-3.5 font-mono text-lg text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all"
                placeholder="Örn: 53"
              />
            </div>

            {/* Converted Values Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">İkili (Binary, r=2)</span>
                <div className="text-lg font-mono font-bold text-blue-700 break-all">{binValue}₂</div>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sekizli (Octal, r=8)</span>
                <div className="text-lg font-mono font-bold text-slate-800 break-all">{octValue}₈</div>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Onaltılı (Hex, r=16)</span>
                <div className="text-lg font-mono font-bold text-emerald-700 break-all">{hexValue}₁₆</div>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Gray Kodu</span>
                <div className="text-lg font-mono font-bold text-indigo-700 break-all">{grayResult}</div>
              </div>
            </div>

            {/* Preset Examples from the Book */}
            <div className="pt-4 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
                Kitaptaki Birebir Dönüşüm Örnekleri:
              </span>
              <div className="flex flex-wrap gap-2 text-xs sm:text-sm">
                {[
                  { label: '(101)₂ = (5)₁₀', val: '5' },
                  { label: '(1011)₂ = (11)₁₀', val: '11' },
                  { label: '(110101)₂ = (53)₁₀', val: '53' },
                  { label: '(25)₁₀ = (11001)₂', val: '25' },
                  { label: '(247)₈ = (167)₁₀', val: '167' },
                  { label: '(2AF)₁₆ = (687)₁₀', val: '687' },
                ].map((ex, idx) => (
                  <button
                    key={idx}
                    onClick={() => setDecInput(ex.val)}
                    className="px-3 py-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 rounded-xl border border-slate-200 font-mono transition-colors cursor-pointer"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Theory card */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-4 text-xs sm:text-sm text-slate-600">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              Taban Dönüşüm Formülü
            </h2>
            <p className="leading-relaxed">
              Herhangi bir $r$ tabanındaki bir sayı, basamak ağırlıklarının toplamı şeklinde ondalık sayıya çevrilir:
            </p>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-center text-slate-800 font-bold text-sm">
              (aₙ...a₁a₀)ᵣ = aₙ·rⁿ + ... + a₁·r¹ + a₀·r⁰
            </div>
            <p className="leading-relaxed">
              <strong>Örnek (Kitaptan):</strong> (110101)₂ sayısının açılımı:<br />
              $1\cdot 2^5 + 1\cdot 2^4 + 0\cdot 2^3 + 1\cdot 2^2 + 0\cdot 2^1 + 1\cdot 2^0 = 32 + 16 + 0 + 4 + 0 + 1 = 53_{10}$
            </p>
          </div>
        </div>
      )}

      {/* Tab 2: 2's Complement */}
      {activeTab === 'twosComplement' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                2'ye Tümleyen İşaretli Aritmetik
              </h2>
              <div className="flex gap-1.5 text-xs">
                {[8, 16].map((b) => (
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">A Sayısı (Onlu):</label>
                <input
                  type="number"
                  value={numA}
                  onChange={(e) => setNumA(parseInt(e.target.value, 10) || 0)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 font-mono text-base text-slate-900"
                />
                <span className="text-xs font-mono text-blue-700 mt-2 block font-semibold">A ({bitWidth}-bit 2'ye tümleyen): {binA}</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">B Sayısı (Onlu):</label>
                <input
                  type="number"
                  value={numB}
                  onChange={(e) => setNumB(parseInt(e.target.value, 10) || 0)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 font-mono text-base text-slate-900"
                />
                <span className="text-xs font-mono text-blue-700 mt-2 block font-semibold">B ({bitWidth}-bit 2'ye tümleyen): {binB}</span>
              </div>
            </div>

            {/* Calculation Result */}
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between text-sm font-mono">
                <span className="text-slate-500 font-sans">İşlem:</span>
                <span className="font-bold text-slate-900">{numA} + ({numB}) = {sumVal}</span>
              </div>
              <div className="flex items-center justify-between text-sm font-mono">
                <span className="text-slate-500 font-sans">İkili Sonuç ({bitWidth}-bit):</span>
                <span className="font-bold text-blue-700">{binSum}</span>
              </div>

              {isOverflow && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs sm:text-sm font-semibold">
                  ⚠️ Taşma (Overflow) Gerçekleşti! {bitWidth}-bit sınırları aşıldı (Geçerli aralık: {-Math.pow(2, bitWidth-1)} ile {Math.pow(2, bitWidth-1)-1}).
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-4 text-xs sm:text-sm text-slate-600">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              Tümleyenler Mantığı (Complements)
            </h2>
            <p className="leading-relaxed">
              Sayısal donanımda çıkarma devresi kurmak yerine, çıkarılan sayının <strong>2'ye tümleyeni</strong> alınarak toplama devresi kullanılır ($A - B = A + (-B)$).
            </p>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs">
              2'ye tümleyen kuralı: Tüm bitleri tersle (1'e tümleyen) ve +1 ekle.
            </div>
            <p className="leading-relaxed">
              <strong>Örnek:</strong> $+19 = 00010011_2 \implies$ 1'e tümleyen: $11101100_2 \implies$ 2'ye tümleyen ($-19$): $11101101_2$.
            </p>
          </div>
        </div>
      )}

      {/* Tab 3: IEEE 754 */}
      {activeTab === 'ieee754' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-6">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-blue-600" />
              IEEE 754 Tek Duyarlıklı (32-Bit Float) Gösterimi
            </h2>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                Kayan Noktalı Sayı (Float):
              </label>
              <input
                type="text"
                value={floatInput}
                onChange={(e) => setFloatInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-5 py-3.5 font-mono text-base text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                placeholder="Örn: 13.625 veya -13.625"
              />
            </div>

            {ieeeData && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">32-Bit Donanım Dizilimi:</span>
                  <div className="grid grid-cols-12 gap-1.5 text-center font-mono text-xs">
                    <div className="col-span-2 sm:col-span-1 bg-red-100 border border-red-300 text-red-800 p-3 rounded-xl">
                      <div className="text-[10px] text-red-600 font-sans font-bold">S (1b)</div>
                      <div className="font-bold text-base mt-1">{ieeeData.sign}</div>
                    </div>

                    <div className="col-span-4 bg-blue-100 border border-blue-300 text-blue-800 p-3 rounded-xl">
                      <div className="text-[10px] text-blue-600 font-sans font-bold">Üs (8b)</div>
                      <div className="font-bold text-xs mt-1.5 tracking-wider">{ieeeData.exponent}</div>
                    </div>

                    <div className="col-span-6 sm:col-span-7 bg-emerald-100 border border-emerald-300 text-emerald-800 p-3 rounded-xl overflow-hidden">
                      <div className="text-[10px] text-emerald-600 font-sans font-bold">Mantissa (23b)</div>
                      <div className="font-bold text-xs mt-1.5 truncate">{ieeeData.mantissa}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs sm:text-sm font-mono">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-sans font-bold uppercase block">İşaret (Sign)</span>
                    <span className="font-bold text-slate-800">{ieeeData.sign === '0' ? '+ (Pozitif)' : '- (Negatif)'}</span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-sans font-bold uppercase block">Hesaplanan Üs</span>
                    <span className="font-bold text-slate-800">{ieeeData.expVal} - 127 = {ieeeData.unbiasedExp}</span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-sans font-bold uppercase block">Hex Değeri</span>
                    <span className="font-bold text-slate-800">0x{ieeeData.hex}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-4 text-xs sm:text-sm text-slate-600">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              Kitap Örneği & NaN (Bölüm 1.6)
            </h2>
            <p className="leading-relaxed">
              Kitabın 1.6 bölümünde incelenen <strong>NaN (Not a Number)</strong> değeri, geçersiz işlemlerde üretilir.
            </p>
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-xs text-slate-800 font-semibold">
              Üs = 255 (tümü 1) ve Mantissa ≠ 0 ise sayı NaN'dır.
            </div>
            <p className="leading-relaxed">
              IEEE standardında NaN, <strong>kendisine bile eşit olmayan</strong> tek sayıdır (`x != x` daima doğrudur).
            </p>
          </div>
        </div>
      )}

      {/* Tab 4: Gray Code */}
      {activeTab === 'grayCode' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-5">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              Gray Kodu & BCD Karşılaştırması
            </h2>

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

          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs space-y-4 text-xs sm:text-sm text-slate-600">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              Gray Kodunun Önemi (K-Map Bağlantısı)
            </h2>
            <p className="leading-relaxed">
              Gray kodunda ardışık iki sayı arasında <strong>yalnızca tek bir bit</strong> değişir (Hamming mesafesi = 1).
            </p>
            <p className="leading-relaxed">
              Bu özellik, Karnaugh haritalarında komşu hücrelerin yalnızca bir değişken farkıyla sıralanmasını sağlar ($00, 01, 11, 10$) ve harita gruplaması yapıldığında değişen değişkenin sadeleşerek elenmesini mümkün kılar.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
