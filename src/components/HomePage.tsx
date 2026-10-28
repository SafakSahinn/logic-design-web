import React from 'react';
import type { UnitTab } from './Navbar';
import {
  BookOpen,
  Binary,
  Cpu,
  Grid,
  Layers,
  HelpCircle,
  ArrowRight,
  ExternalLink,
  GraduationCap,
  Sparkles,
  GitBranch,
  CheckCircle2,
} from 'lucide-react';

interface HomePageProps {
  onSelectUnit: (tab: UnitTab) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onSelectUnit }) => {
  const CHAPTERS = [
    {
      id: 'unit1' as UnitTab,
      num: '01',
      title: 'Sayı Sistemleri ve Kodlama',
      subtitle: 'Sayı Tabanları, İkili Aritmetik, Tümleyenler, IEEE 754 & Gray Kodu',
      desc: 'Sayısal elektroniğin temel alfabesi olan ikili taban, tabanlar arası dönüşümler, işaretli ikili sayılar, 2\'ye tümleyen mantığı, taşma (overflow) kuralları ve tek duyarlıklı 32-bit IEEE 754 kayan nokta formatı.',
      topics: [
        'Sayı Tabanları: İkili (r=2), Sekizli (r=8), Onlu (r=10), Onaltılı (r=16)',
        'İkili Aritmetik: Toplama, Çıkarma, Çarpma ve Bölme İşlemleri',
        'Tümleyenler: 1\'e ve 2\'ye Tümleyen, Çıkarma Devresi Mantığı',
        'İşaretli Sayılar ve Donanımsal Taşma (Overflow) Tespiti',
        'IEEE 754 Kayan Noktalı Sayı Formatı (İşaret, Üs, Mantissa ve NaN Analizi)',
        'BCD (8421) ve Gray Kodu Dönüşümleri (Hamming Mesafesi)',
      ],
      interactiveTool: 'Canlı Taban Çevirici, 2\'ye Tümleyen Toplayıcı & IEEE 754 Görselleştiricisi',
      icon: Binary,
      color: 'blue',
    },
    {
      id: 'unit2' as UnitTab,
      num: '02',
      title: 'Bool Cebiri ve Mantık Kapıları',
      subtitle: 'Aksiyomlar, Düalite, Mantık Kapıları, Doğruluk Tablosu & Kanonik Formlar',
      desc: 'Sayısal devrelerin cebirsel temeli olan Huntington aksiyomları, düalite ilkesi, De Morgan teoremleri, mantık kapılarının (AND, OR, NOT, NAND, NOR, XOR, XNOR) iç yapısı ve TTL 74xx entegre devreleri.',
      topics: [
        'İkili Değişkenler ve Gerilim Eşikleri (TTL / CMOS Lojik Seviyeleri)',
        'Huntington Aksiyomları ve Temel Boole Teoremleri',
        'Düalite (İkizlik) İlkesi ve Konsensüs Teoreminin İspatı',
        'De Morgan Teoremleri ve Evrensel Kapı Dönüşümleri',
        'Mantık Kapıları: IEEE/ANSI ve Alternatif Semboller, TTL 74xx Entegreleri',
        'Kanonik ve Standart Formlar: Minterm (Σm) ve Maxterm (ΠM) Açılımları',
      ],
      interactiveTool: 'İnteraktif Kapı Laboratuvarı & İfade Ayrıştırıcı Doğruluk Tablosu Motoru',
      icon: Cpu,
      color: 'indigo',
    },
    {
      id: 'unit3' as UnitTab,
      num: '03',
      title: 'Kapı Seviyesinde Sadeleştirme (K-Map)',
      subtitle: 'Karnaugh Haritaları, Asal Bileşenler, Torus & Quine-McCluskey',
      desc: 'Boole fonksiyonlarının donanım maliyetini ve kapı gecikmesini en aza indiren Karnaugh haritası yöntemi. Kitaptaki Örnek 3.1 ile 3.15 arasındaki tüm devreler tek tıkla incelenebilir.',
      topics: [
        'Gray Kodu Ardışıklığı ve 2, 3, 4 Değişkenli K-Map Yerleşimi',
        'Prime Implicant (PI) ve Essential Prime Implicant (EPI) Seçimi',
        'Torus (Simit) Yapısı ve 4 Köşe Bitişikliği Sadeleştirmesi',
        'Önemsenmeyen Durumlar (Don\'t Care - X Koşulları) ile Genişletme',
        'NAND ve NOR ile İki Seviyeli Mantık Devresi Gerçeklemesi',
        'Quine-McCluskey (Tablo) Algoritması ile Sadeleştirme',
      ],
      interactiveTool: '2, 3 ve 4 Değişkenli K-Map Çözücü & 12 Adet Birebir Kitap Örneği',
      icon: Grid,
      color: 'emerald',
    },
    {
      id: 'unit4' as UnitTab,
      num: '04',
      title: 'Kombinasyonel Mantık Devreleri',
      subtitle: 'Toplayıcılar, Çıkarıcılar, Karşılaştırıcı, MUX & Decoder',
      desc: 'Bellek içermeyen, çıkışı anlık giriş kombinasyonlarına bağlı devreler: Yarım/Tam toplayıcılar, 4-bit Ripple Carry Adder, 2-bit büyüklük karşılaştırıcı, kod çözücüler ve çoğullayıcılar.',
      topics: [
        'Kombinasyonel Mantık Tasarım Prosedürü ve İşlem Adımları',
        'Yarım Toplayıcı (Half Adder) & Tam Toplayıcı (Full Adder)',
        '4-Bit Paralel Toplayıcı (Ripple Carry Adder) ve Taşıma Gecikmesi',
        'Yarım ve Tam Çıkarıcı (Subtractor) Devre Mimarisi',
        '2-Bit Büyüklük Karşılaştırıcı (Magnitude Comparator: A>B, A=B, A<B)',
        '2-to-4 ve 3-to-8 Decoder ile 4:1 Multiplexer (MUX) Fonksiyon Gerçekleme',
      ],
      interactiveTool: 'Canlı Toplayıcı Simülatörü, 4-Bit Ripple Carry Adder & MUX Laboratuvarı',
      icon: Layers,
      color: 'amber',
    },
  ];

  return (
    <div className="space-y-16 py-4">
      {/* Book Cover Hero - Spacious & Atmospheric */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 sm:p-12 md:p-16 relative overflow-hidden">
        {/* Soft atmospheric gradient backdrops */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-blue-50/80 via-indigo-50/40 to-transparent rounded-full blur-3xl pointer-events-none -mr-32 -mt-32" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-slate-100/60 to-transparent rounded-full blur-2xl pointer-events-none -ml-24 -mb-24" />

        <div className="relative z-10 max-w-4xl space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200/80 shadow-2xs">
            <GraduationCap className="w-4 h-4 text-blue-600" />
            <span>Akademik Kitap & Etkileşimli Çalışma Portalı</span>
          </div>

          {/* Book Title & Subtitle */}
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-slate-900 tracking-tight leading-[1.12]">
              Sıfırdan İşlemciye
            </h1>
            <p className="text-xl sm:text-2xl text-slate-600 font-medium leading-snug">
              Sayısal Donanım Tasarımı: Sayı Sistemlerinden Basit Bir CPU Mimarisine
            </p>
          </div>

          {/* Authors & Metadata */}
          <div className="flex flex-wrap items-center gap-y-3 gap-x-6 text-sm text-slate-600 border-y border-slate-100 py-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Yazarlar:</span>
              <strong className="text-slate-900">Şafak Şahin</strong>
              <span className="text-slate-300">·</span>
              <strong className="text-slate-900">Dr. Batuhan Hangün</strong>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Kapsam:</span>
              <span className="px-2.5 py-0.5 rounded-md bg-blue-50 font-semibold text-blue-700 border border-blue-200/60 text-xs font-mono">
                4 Temel Ünite
              </span>
            </div>
          </div>

          {/* Book Summary */}
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-3xl">
            Bu portal, bilgisayar ve elektrik-elektronik mühendisliği "Sayısal Tasarım / Mantık Devreleri"
            dersi için teorik altyapıyı somut donanımsal simülasyon araçlarıyla birleştirir.
            Her konu yalnızca matematiksel tanımla bırakılmayıp sezgisi, "neden"i ve elle doğrulanmış
            kitap örnekleriyle adım adım işlenmiştir.
          </p>

          {/* Primary Action Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <button
              onClick={() => onSelectUnit('unit1')}
              className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-2xl shadow-sm hover:shadow-md transition-all flex items-center gap-2.5 cursor-pointer"
            >
              <span>1. Üniteden Başla</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <a
              href="https://github.com/SafakSahinn/sifirdan-islemciye"
              target="_blank"
              rel="noreferrer"
              className="px-5 py-3.5 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-2xl border border-slate-200 transition-colors flex items-center gap-2.5 shadow-2xs"
            >
              <BookOpen className="w-4 h-4 text-blue-600" />
              <span>GitHub Kitap Projesi</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>

            <button
              onClick={() => onSelectUnit('circuit-simulator')}
              className="px-5 py-3.5 bg-blue-50 hover:bg-blue-100/80 text-blue-700 text-sm font-semibold rounded-2xl border border-blue-200 transition-colors flex items-center gap-2.5 cursor-pointer shadow-2xs"
            >
              <Cpu className="w-4 h-4 text-blue-600" />
              <span>Devre Simülatörü & Laboratuvar</span>
            </button>

            <button
              onClick={() => onSelectUnit('quiz')}
              className="px-5 py-3.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-2xl border border-slate-200 transition-colors flex items-center gap-2.5 cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-blue-600" />
              <span>Kendini Sına (Test)</span>
            </button>
          </div>
        </div>
      </section>

      {/* Table of Contents Section (Spacious Chapter Cards) */}
      <section className="space-y-8">
        <div className="border-b border-slate-200 pb-5">
          <div className="flex items-center gap-2.5 text-blue-600 font-bold text-xs uppercase tracking-wider mb-1">
            <BookOpen className="w-4 h-4" />
            <span>Müfredat Akışı</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            İçindekiler ve Ünite Seçimi
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Aşağıdaki ünite kartlarından dilediğinizi seçerek hem kapsamlı konu anlatımına hem de ilgili canlı laboratuvar araçlarına erişebilirsiniz.
          </p>
        </div>

        {/* 4 Spacious Chapter Cards (Stacked / Generous Width) */}
        <div className="grid grid-cols-1 gap-8">
          {CHAPTERS.map((ch) => {
            const Icon = ch.icon;
            return (
              <div
                key={ch.id}
                onClick={() => onSelectUnit(ch.id)}
                className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-xs hover:border-blue-400 hover:shadow-md transition-all duration-200 flex flex-col lg:flex-row lg:items-center justify-between gap-8 cursor-pointer group"
              >
                {/* Left: Main info */}
                <div className="space-y-5 max-w-3xl flex-1">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200/80 flex items-center justify-center text-blue-700 group-hover:bg-blue-600 group-hover:text-white transition-colors shrink-0 shadow-2xs">
                      <Icon className="w-7 h-7" />
                    </div>
                    <div>
                      <span className="text-xs font-mono font-bold text-blue-700 uppercase tracking-widest block">
                        Bölüm {ch.num}
                      </span>
                      <h3 className="text-xl sm:text-2xl font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                        {ch.title}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-500 font-medium">
                        {ch.subtitle}
                      </p>
                    </div>
                  </div>

                  <p className="text-sm text-slate-600 leading-relaxed">
                    {ch.desc}
                  </p>

                  {/* Topic list */}
                  <div className="pt-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
                      Bölüm İçeriğindeki Ana Başlıklar:
                    </span>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm text-slate-700">
                      {ch.topics.map((t, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Interactive Tool Pill */}
                  <div className="p-3.5 bg-blue-50/60 rounded-2xl border border-blue-200/60 text-xs sm:text-sm text-blue-900 flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
                    <span><strong>İnteraktif Araç:</strong> {ch.interactiveTool}</span>
                  </div>
                </div>

                {/* Right: Action button */}
                <div className="lg:border-l lg:border-slate-100 lg:pl-8 flex lg:flex-col items-center justify-between lg:justify-center gap-4 shrink-0">
                  <div className="text-right lg:text-center hidden sm:block">
                    <span className="text-xs text-slate-400 block font-mono">Bölüm Durumu</span>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full inline-block mt-0.5">
                      ✓ Tamamlandı
                    </span>
                  </div>
                  <div className="px-5 py-3 rounded-xl bg-blue-600 group-hover:bg-blue-700 text-white font-semibold text-sm flex items-center gap-2 shadow-xs transition-colors">
                    <span>Bölümü Aç</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Book Methodology Section */}
      <section className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-12 shadow-xs space-y-6">
        <div>
          <div className="flex items-center gap-2 text-blue-600 font-bold text-xs uppercase tracking-wider mb-1">
            <GitBranch className="w-4 h-4" />
            <span>Pedagojik Yaklaşım</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Kitabın Dört Sütunlu Donanım Metodolojisi
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">
            "Sıfırdan İşlemciye" kitabında öğrenilen her kavram, soyut kalmaması için birbirini tamamlayan dört aşamadan geçirilir:
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-2">
          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-sm">
              1
            </div>
            <h3 className="font-bold text-sm text-slate-900">Teori ve Dokümantasyon</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              XeLaTeX ile hazırlanan, elle doğrulanmış matematiksel modeller, teoremler ve ispatlar.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
              2
            </div>
            <h3 className="font-bold text-sm text-slate-900">Temel Simülasyon</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              İnteraktif sayısal devre simülatörüyle mantık kapıları ve sinyal seviyesinde canlı görselleştirme.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-800 flex items-center justify-center font-bold text-sm">
              3
            </div>
            <h3 className="font-bold text-sm text-slate-900">Sektörel Pratik (HDL)</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Xilinx Vivado ve Verilog ile yapısal, veri akışı ve davranışsal RTL modelleme.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-sm">
              4
            </div>
            <h3 className="font-bold text-sm text-slate-900">Açık Kaynak ASIC Akışı</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Icarus, GTKWave, Yosys ve OpenLane (SKY130 PDK) ile silikon çip fiziksel yerleşimi (GDSII).
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
