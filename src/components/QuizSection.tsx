import React, { useState, useMemo } from 'react';
import { HelpCircle, CheckCircle, XCircle, RotateCcw, Award, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';

export type QuizCategory = 'Tümü' | 'Sayı Sistemleri' | 'Boole Cebri' | 'K-Map' | 'Kombinasyonel' | 'Ardışıl Mantık';

interface Question {
  id: number;
  question: string;
  category: 'Sayı Sistemleri' | 'Boole Cebri' | 'K-Map' | 'Kombinasyonel' | 'Ardışıl Mantık';
  options: string[];
  correctIndex: number;
  explanation: string;
}

const QUESTIONS: Question[] = [
  {
    id: 1,
    question: "Hangi mantık kapısı yalnızca girişleri birbirinden FARKLI olduğunda (biri 1, diğeri 0) çıkışa 1 verir?",
    category: 'Boole Cebri',
    options: ['AND (VE)', 'OR (VEYA)', 'XOR (Özel VEYA)', 'NAND (VE DEĞİL)'],
    correctIndex: 2,
    explanation: "XOR (Exclusive OR) kapısı, girişlerin birbirine eşit olmadığı durumlarda 1, eşit olduğu durumlarda (0-0 veya 1-1) 0 verir.",
  },
  {
    id: 2,
    question: "Boole cebirinde De Morgan kuralına göre (A + B)' ifadesinin eşiti nedir?",
    category: 'Boole Cebri',
    options: ["A' + B'", "A' · B'", "(A · B)'", "A + B'"],
    correctIndex: 1,
    explanation: "De Morgan teoremine göre toplamın değili, değillerin çarpımına eşittir: (A + B)' = A' · B'.",
  },
  {
    id: 3,
    question: "Karnaugh Haritasında yatay veya dikey komşu hücreler arasında neden ikili (binary) sıra değil de Gray kodu kullanılır?",
    category: 'K-Map',
    options: [
      'Bellek tüketimini azaltmak için',
      'Komşu hücreler arasında yalnızca tek bir bitin değişmesini sağlamak için',
      'Sayıları daha hızlı toplamak için',
      'Yalnızca 2 değişkenli haritalarda çalıştığı için',
    ],
    correctIndex: 1,
    explanation: "Gray kodunun temel özelliği, ardışık her adımda yalnızca TEK bir bitin değişmesidir (Hamming mesafesi = 1). Bu sayede komşu iki hücre birleştirildiğinde değişen değişken sadeleşerek elenir.",
  },
  {
    id: 4,
    question: "4 değişkenli bir Karnaugh haritasında (A, B, C, D) 4 köşe hücresi (m0, m2, m8, m10) birleştirildiğinde hangi sadeleşmiş terim elde edilir?",
    category: 'K-Map',
    options: ["A'C'", "B'D'", "BD", "A'B'C'D'"],
    correctIndex: 1,
    explanation: "4 köşede: m0(0000), m2(0010), m8(1000), m10(1010). Burada A (0 ve 1) ve C (0 ve 1) değişerek elenir. B = 0 ve D = 0 sabit kaldığından sonuç B'D' olur.",
  },
  {
    id: 5,
    question: "Tek başına kullanılarak diğer TÜM mantık kapılarının yerine geçebilen 'Evrensel (Universal)' kapı çifti hangisidir?",
    category: 'Boole Cebri',
    options: ['AND ve OR', 'NOT ve XOR', 'NAND ve NOR', 'BUFFER ve XNOR'],
    correctIndex: 2,
    explanation: "NAND ve NOR kapıları evrensel (universal) kapılardır. Yalnızca NAND veya yalnızca NOR kullanılarak AND, OR, NOT dahil tüm mantık kapıları üretilebilir.",
  },
  {
    id: 6,
    question: "3 değişkenli bir doğruluk tablosunda kaç satır (giriş kombinasyonu) bulunur?",
    category: 'Boole Cebri',
    options: ['3', '6', '8', '16'],
    correctIndex: 2,
    explanation: "n değişkenli bir tabloda 2^n kombinasyon bulunur. 3 değişken için 2^3 = 8 satır (0'dan 7'ye kadar mintermler) bulunur.",
  },
  {
    id: 7,
    question: "İkili (101101)₂ sayısının onluk (decimal) tabandaki karşılığı nedir?",
    category: 'Sayı Sistemleri',
    options: ['43', '45', '47', '53'],
    correctIndex: 1,
    explanation: "1·32 + 0·16 + 1·8 + 1·4 + 0·2 + 1·1 = 32 + 8 + 4 + 1 = 45.",
  },
  {
    id: 8,
    question: "8-bitlik işaretli 2'ye tümleyen (Two's Complement) formatında temsil edilebilecek en küçük ve en büyük tamsayı aralığı nedir?",
    category: 'Sayı Sistemleri',
    options: ['-127 ile +127', '-128 ile +127', '-256 ile +255', '0 ile 255'],
    correctIndex: 1,
    explanation: "n bitlik 2'ye tümleyen sisteminde aralık: [-2^(n-1), +2^(n-1) - 1]'dir. n=8 için [-128, +127] elde edilir.",
  },
  {
    id: 9,
    question: "IEEE 754 tek duyarlıklı (Single Precision 32-Bit) kayan noktalı formatında Sign, Exponent (Üs) ve Mantissa (Kesir) bit sayıları sırasıyla nasıldır?",
    category: 'Sayı Sistemleri',
    options: [
      '1 bit İşaret, 8 bit Üs, 23 bit Mantissa',
      '1 bit İşaret, 11 bit Üs, 20 bit Mantissa',
      '2 bit İşaret, 8 bit Üs, 22 bit Mantissa',
      '1 bit İşaret, 7 bit Üs, 24 bit Mantissa',
    ],
    correctIndex: 0,
    explanation: "Standart IEEE 754 tek duyarlıklı formatı: 1 bit işaret (Sign), 8 bit eğimli üs (Exponent bias=127) ve 23 bit kesir (Mantissa) olmak üzere toplam 32 bitten oluşur.",
  },
  {
    id: 10,
    question: "İki pozitif işaretli 2'ye tümleyen sayının toplanması sonucunda işaret bitinin 1 (negatif) çıkması donanımda neyi ifade eder?",
    category: 'Sayı Sistemleri',
    options: [
      'Normal bir negatif sonuçtur',
      'Aritmetik Taşma (Overflow) meydana gelmiştir',
      'Sıfıra bölme hatası oluşmuştur',
      'Elde bayrağı (Carry Flag) sıfırlanmıştır',
    ],
    correctIndex: 1,
    explanation: "Aynı işaretli iki sayı toplandığında zıt işaretli bir sonuç elde ediliyorsa, mevcut bit genişliği sonuca yetmemiş demektir ve Aritmetik Taşma (Overflow) bayrağı (V=1) tetiklenir.",
  },
  {
    id: 11,
    question: "Boole cebirinde AB + A'C + BC = AB + A'C denkleminde elenen 'BC' terimi hangi teorem gereğince fazlalıktır (redundant)?",
    category: 'Boole Cebri',
    options: [
      'De Morgan Teoremi',
      'Konsensüs (Consensus) Teoremi',
      'Dağılma (Distributive) Aksiyomu',
      'Yutma (Absorption) Teoremi',
    ],
    correctIndex: 1,
    explanation: "Konsensüs Teoremine göre, A ve A' zıt değişkenlerini içeren iki terimin kalan değişkenlerinin çarpımı (B·C) bu iki terim tarafından tamamen kapsandığından güvenle elenebilir.",
  },
  {
    id: 12,
    question: "Bir Boole ifadesine Düalite (Duality) ilkesi uygulanırken hangi dönüşümler yapılır?",
    category: 'Boole Cebri',
    options: [
      'Yalnızca değişkenlerin değilleri alınır',
      'AND (·) ile OR (+) yer değiştirir, 0 ile 1 yer değiştirir; değişkenler DEĞİŞMEZ',
      'AND yerine NAND, OR yerine NOR yazılır',
      'Tüm mintermler maxterm yapılır ve ifade terslenir',
    ],
    correctIndex: 1,
    explanation: "Düalite ilkesinde ifadenin matematiksel ikizi alınır: Her VE işlemi VEYA, her VEYA işlemi VE yapılır; 0 sabitleri 1, 1 sabitleri 0 yapılır. Değişkenlerin kendilerine dokunulmaz.",
  },
  {
    id: 13,
    question: "Bir Karnaugh haritasında önemsenmeyen durumlar (Don't Care - X) sadeleştirme yaparken nasıl ele alınır?",
    category: 'K-Map',
    options: [
      'Her zaman 0 kabul edilerek ihmal edilir',
      'Her zaman 1 kabul edilip tümü gruplanır',
      'Daha büyük 2^k gruplar oluşturmaya yarıyorsa 1, yaramıyorsa 0 kabul edilir',
      'Haritadan tamamen silinir',
    ],
    correctIndex: 2,
    explanation: "Don't care (X) giriş kombinasyonları pratik sistemde asla oluşmayacak veya çıksalar dahi sonucu etkilemeyecek durumlardır. Sadeleştirmede terimleri büyütüp kapı sayısını düşürüyorsa 1, aksi halde 0 sayılırlar.",
  },
  {
    id: 14,
    question: "K-Map üzerinde en az bir adet başka hiçbir grup tarafından kapsanmayan minterm içeren kapalı döngüye ne ad verilir?",
    category: 'K-Map',
    options: [
      'Asal Bileşen (Prime Implicant)',
      'Temel Asal Bileşen (Essential Prime Implicant)',
      'Gereksiz Bileşen (Redundant Implicant)',
      'Kanonik Minterm',
    ],
    correctIndex: 1,
    explanation: "Essential Prime Implicant (EPI), haritada yalnızca kendisine ait en az bir '1' hücresi barındıran gruptur ve nihai sadeleşmiş ifadede MUTLAKA yer almak zorundadır.",
  },
  {
    id: 15,
    question: "1-Bit Tam Toplayıcı (Full Adder) ile Yarım Toplayıcı (Half Adder) arasındaki temel fark nedir?",
    category: 'Kombinasyonel',
    options: [
      'Tam toplayıcı iki çıkış, yarım toplayıcı tek çıkış verir',
      'Tam toplayıcı önceki basamaktan gelen elde girişini (Cin) de hesaba katar',
      'Yarım toplayıcı çıkarma işlemi de yapabilir',
      'Tam toplayıcı yalnızca 4-bit verilerde çalışır',
    ],
    correctIndex: 1,
    explanation: "Yarım toplayıcı yalnızca A ve B girişlerini toplarken (Cin girişi yoktur), Tam Toplayıcı alt basamaktan gelen eldeyi (Cin) de ekleyerek A + B + Cin işlemini yapar.",
  },
  {
    id: 16,
    question: "8:1 Multiplexer (Çoklayıcı) devresinde 8 farklı veri girişinden birini Y çıkışına aktarmak için kaç adet seçici (Select) hattı gerekir?",
    category: 'Kombinasyonel',
    options: ['2', '3', '4', '8'],
    correctIndex: 1,
    explanation: "2^n = Giriş Sayısı kuralı gereğince 2^n = 8 => n = 3 seçici giriş (S2, S1, S0) gereklidir.",
  },
  {
    id: 17,
    question: "İki adet 2-bit ikili sayı A(A1,A0) ve B(B1,B0) büyüklük karşılaştırıcısında A = B eşitlik şartı hangi mantık ifadesiyle sağlanır?",
    category: 'Kombinasyonel',
    options: [
      '(A1 XOR B1) · (A0 XOR B0)',
      '(A1 XNOR B1) · (A0 XNOR B0)',
      '(A1 + B1) · (A0 + B0)',
      "(A1 · B1)' + (A0 · B0)'",
    ],
    correctIndex: 1,
    explanation: "İki bitin eşit olması XNOR (denklik) kapısıyla tespit edilir: A1=B1 için (A1 XNOR B1)=1 ve A0=B0 için (A0 XNOR B0)=1 olmalıdır. İkisi VE kapısıyla bağlanır.",
  },
  {
    id: 18,
    question: "Öncelikli Kodlayıcıda (Priority Encoder) aynı anda birden fazla giriş lojik 1 aktif olursa devrenin davranışı ne olur?",
    category: 'Kombinasyonel',
    options: [
      'Devre hata (contention) durumuna geçer ve 0 üretir',
      'En yüksek öncelik indeksine sahip aktif girişin ikili kodu çıkışa verilir',
      'Girişlerin aritmetik ortalaması kodlanır',
      'Saat darbesine kadar çıkış sabit tutulur',
    ],
    correctIndex: 1,
    explanation: "Standart kodlayıcılardan farklı olarak Öncelikli Kodlayıcı (örn. 74HC148), eşzamanlı aktif girişler arasında en yüksek hiyerarşideki pini (örn. D7) seçer ve onun adresini üretir.",
  },
  {
    id: 19,
    question: "Bir D Flip-Flop'un Q' (ters) çıkışı doğrudan D girişine geri bağlanırsa, saat darbesi uygulandığında devre nasıl davranır?",
    category: 'Ardışıl Mantık',
    options: [
      'Sürekli sabit 1 kalır',
      'Her yükselen saat kenarında durum değiştirerek (Toggle) frekansı ikiye böler (f/2)',
      'Kararsız osilasyona girip kilitlenir',
      'Saat darbesini bloke eder',
    ],
    correctIndex: 1,
    explanation: "D = Q' yapıldığında, Q=0 iken D=1 olur ve saat vurduğunda Q=1'e geçer; Q=1 iken D=0 olur ve saat vurduğunda Q=0'a döner. Bu davranış T Flip-Flop modudur ve frekansı tam yarıya (f/2) böler.",
  },
  {
    id: 20,
    question: "JK Flip-Flop'ta J = 1 ve K = 1 iken saat darbesi (CLK) geldiğinde Q çıkışının sonraki durumu (Qn+1) ne olur?",
    category: 'Ardışıl Mantık',
    options: [
      '0 olur (Sıfırlama / Reset)',
      '1 olur (Kurma / Set)',
      'Qn kalır (Durumu koru / Hold)',
      'Qn\' olur (Durum değiştir / Toggle)',
    ],
    correctIndex: 3,
    explanation: "JK flip-flop'un en önemli yeteneği J=1, K=1 girişidir. Bu modda her saat tetiklemesinde çıkış bir önceki durumunun tam tersine döner (Toggle). İkili sayıcıların omurgasıdır.",
  },
];

export const QuizSection: React.FC = () => {
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);
  const [answeredCount, setAnsweredCount] = useState<number>(0);
  const [activeCategory, setActiveCategory] = useState<QuizCategory>('Tümü');

  const filteredQuestions = useMemo(() => {
    if (activeCategory === 'Tümü') return QUESTIONS;
    return QUESTIONS.filter((q) => q.category === activeCategory);
  }, [activeCategory]);

  const safeIdx = Math.min(currentIdx, filteredQuestions.length - 1);
  const q = filteredQuestions[safeIdx] || filteredQuestions[0];

  const handleSelect = (idx: number) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(idx);
    setShowExplanation(true);
    setAnsweredCount((prev) => prev + 1);
    if (idx === q.correctIndex) {
      setScore((prev) => prev + 1);
    }
  };

  const handleNext = () => {
    setSelectedAnswer(null);
    setShowExplanation(false);
    setCurrentIdx((prev) => (prev + 1) % filteredQuestions.length);
  };

  const handlePrev = () => {
    setSelectedAnswer(null);
    setShowExplanation(false);
    setCurrentIdx((prev) => (prev - 1 + filteredQuestions.length) % filteredQuestions.length);
  };

  const handleReset = () => {
    setCurrentIdx(0);
    setSelectedAnswer(null);
    setShowExplanation(false);
    setScore(0);
    setAnsweredCount(0);
  };

  const categories: QuizCategory[] = [
    'Tümü',
    'Sayı Sistemleri',
    'Boole Cebri',
    'K-Map',
    'Kombinasyonel',
    'Ardışıl Mantık',
  ];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Educational Header */}
      <div className="bg-white p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              <HelpCircle className="w-3.5 h-3.5" />
              Alıştırmalar ve Değerlendirme Testi
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Sayısal Tasarım Sınav & Test Soruları
            </h1>
            <p className="text-slate-600 text-xs sm:text-sm">
              Sayı sistemleri, Boole teoremleri, K-Map, kombinasyonel bloklar ve flip-floplar hakkındaki bilginizi test edin.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200 shrink-0">
            <Award className="w-5 h-5 text-amber-500" />
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block uppercase font-medium">Başarı Puanı</span>
              <span className="text-base font-bold font-mono text-slate-900">
                {score} / {answeredCount}
              </span>
            </div>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="pt-4 mt-4 border-t border-slate-100 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5 text-blue-600" /> Kategori:
          </span>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setActiveCategory(cat);
                setCurrentIdx(0);
                setSelectedAnswer(null);
                setShowExplanation(false);
              }}
              className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeCategory === cat
                  ? 'bg-blue-600 text-white shadow-xs font-bold'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Question Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-7 space-y-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <span className="text-xs font-bold text-blue-700 uppercase tracking-wider font-mono">
            Soru {safeIdx + 1} / {filteredQuestions.length}
          </span>
          <span className="px-2.5 py-0.5 bg-blue-50 text-blue-800 rounded-full text-xs font-semibold border border-blue-200/80">
            {q.category}
          </span>
        </div>

        <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-relaxed">
          {q.question}
        </h2>

        {/* Options */}
        <div className="space-y-2.5">
          {q.options.map((opt, optIdx) => {
            let btnStyle = 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-100/70';

            if (selectedAnswer !== null) {
              if (optIdx === q.correctIndex) {
                btnStyle = 'bg-emerald-50 border-emerald-400 text-emerald-900 font-semibold';
              } else if (optIdx === selectedAnswer) {
                btnStyle = 'bg-red-50 border-red-300 text-red-900 font-semibold';
              } else {
                btnStyle = 'bg-slate-50/50 border-slate-200 text-slate-400 opacity-60';
              }
            }

            return (
              <button
                key={optIdx}
                onClick={() => handleSelect(optIdx)}
                disabled={selectedAnswer !== null}
                className={`w-full text-left p-3.5 sm:p-4 rounded-xl border text-xs sm:text-sm transition-all flex items-center justify-between gap-3 cursor-pointer ${btnStyle}`}
              >
                <span>{opt}</span>
                {selectedAnswer !== null && optIdx === q.correctIndex && (
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                {selectedAnswer !== null && optIdx === selectedAnswer && optIdx !== q.correctIndex && (
                  <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Explanation Card */}
        {showExplanation && (
          <div
            className={`p-4 rounded-xl border text-xs leading-relaxed animate-in fade-in ${
              selectedAnswer === q.correctIndex
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                : 'bg-amber-50/80 border-amber-200 text-amber-900'
            }`}
          >
            <strong>{selectedAnswer === q.correctIndex ? '✓ Tebrikler, Doğru Cevap!' : 'ℹ Çözüm Açıklaması:'}</strong>{' '}
            {q.explanation}
          </div>
        )}

        {/* Question Footer Controls */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrev}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1 cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Önceki</span>
            </button>
            <button
              onClick={handleNext}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
            >
              <span>Sonraki</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={handleReset}
            className="px-3 py-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Testi Sıfırla</span>
          </button>
        </div>
      </div>
    </div>
  );
};
