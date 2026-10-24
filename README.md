# LogicDesign Studio — Dijital Mantık Devre Tasarımı & CAD Simülasyon Platformu

Modern, yüksek performanslı ve tarayıcı/masaüstü tabanlı **Dijital Mantık Devre CAD (Computer-Aided Design), Şematik Tasarım ve Canlı Simülasyon Platformu**.

LogicDesign Studio; temel mantık kapılarından 16-bit işlemci mimarilerine, ses synthesizer'larından renkli video grafik birimlerine kadar her seviyedeki dijital elektronik sistemin tasarlanmasını, test edilmesini ve endüstri standardı formatlara aktarılmasını sağlar.

---

## 🚀 Öne Çıkan Temel Özellikler

### 1. Profesyonel CAD Çizim Tuvali & Manhattan Kablolama
* **Akıllı Manhattan Yönlendirme:** Çapraz geçişleri önleyen, 90 derecelik dik açılı profesyonel EDA kablo çizimi.
* **Dirsek & Orta Segment Sürükleme:** Çizilmiş kabloların köşe dirsek noktaları veya orta segmentleri fareyle tutularak tuval üzerinde serbestçe genişletilebilir, taşınabilir veya çift tıklamayla başlangıç konumuna sıfırlanabilir.
* **Akıcı Gezinme (Pan & Zoom):** Farenin sağ tuşuyla tuvali dilediğiniz gibi kaydırabilir (`Right-click Drag`), `Space + Sol Tık` veya araç çubuğundaki **Kaydırma Aracı (Hand Tool)** ile gezinip, fare tekerleğiyle hassas yakınlaştırma (`Zoom %40 - %250`) yapabilirsiniz.
* **Toplu Seçim & Düzenleme:** Çerçeve seçim kutusu (`Selection Box`), çoklu taşıma, 90° döndürme (`R`), çoğaltma (`Ctrl+D`) ve silme (`Delete / Backspace`).

### 2. Kapsamlı Bileşen Kütüphanesi
* **Mantık Kapıları:** AND, OR, NOT, NAND, NOR, XOR, XNOR, Üç Durumlu Tampon (Tri-State Buffer).
* **Giriş / Çıkış Birimleri:** Mekanik Anahtarlar (Switch), Anlık Bas-Bırak Butonlar (Pushbutton), 4'lü DIP Switch, Frekans Ayarlı Saat Jeneratörleri (0.5 Hz - 8 Hz), Mantık Probları, LED'ler, 4'lü LED Barları, 7-Segment ve Hex Sayısal Göstergeler.
* **Aritmetik & Mantık Blokları:** Yarım Toplayıcı, Tam Toplayıcı, Tam Çıkarıcı, 2:1 & 8:1 Çoklayıcılar (MUX), 1:2 Demultiplexer, 2:4 & 3:8 Kod Çözücüler, Öncelikli Kodlayıcı, 4-Bit Sayısal Karşılaştırıcı ve **74HC181 4-Bit ALU**.
* **Ardışıl Devre Elemanları (Sequential Logic):** D Flip-Flop, J-K Flip-Flop, T Flip-Flop, SR Latch, 4-Bit Senkron Sayaç, 4-Bit Kaydırma Yazmacı (Shift Register), 16x4 RAM ve 16x4 ROM bellekler.

### 3. Multimedya & Gelişmiş Donanım Modülleri
* **8-Bit Chiptune Piezo Buzzer:** Uluslararası A440 akortlu 16 notalık tam skala (Do-Re-Mi / Hz). Tekil (singleton) Web Audio motoru, saatin yükselen kenarında tetiklenen 6ms keskin vuruş (attack) ve %82 sequencer gate release içeren otantik NES / Game Boy pulse wave zarfı.
* **16x16 RGB VRAM Renkli Video Ekranı:** 256 bağımsız renkli pikselli video göstergesi. 4-bit X ve Y koordinat veri yolları, Yazma İzni (WE) pimi, CLK darbesi ve interaktif fare tıklamasıyla tuvalde doğrudan piksel boyama desteği.
* **8x8 LED Grafik Matrisi (GPU):** Satır ve sütun mantık sinyalleriyle piksel animasyonları ve grafik gösterimi.
* **7-Bit ASCII Klavye Matrisi Terminali:** Tuvaldeki tuşlara basıldığında gerçek ASCII ikili kodunu üreten ve Veri Hazır Strobe (ST) sinyali veren mikrobilgisayar giriş terminali.

### 4. İleri Düzey Mühendislik & Analiz Araçları
* **Çok Kanallı Zamanlama Osiloskobu (Timing Scope):** Devredeki saat, veri yolları ve giriş/çıkış sinyallerini canlı mantık dalga formları (0 ve 1) halinde çizer; **VCD (Value Change Dump)** formatında dışa aktarım sağlar.
* **Doğruluk Tablosu & Karnaugh Haritası (K-Map):** Seçili çıkışların doğruluk tablosunu otomatik üretir, K-Map minimizasyonunu (SOP) hesaplar.
* **Otomatik Devre Sentezleyici:** Herhangi bir Boole cebri ifadesini (örneğin `(A & B) | ~C`) saniyeler içinde tuvalde kapı şeması olarak otomatik çizer.
* **Sonlu Durum Makinesi (FSM) Tasarımcısı:** Durumlar (States) ve Geçişler (Transitions) tanımlanarak tek tıkla durum tablosunu ve flip-flop/kapı sentezini gerçekleştirir.
* **İnteraktif Hex Bellek Editörü:** RAM ve ROM bellek hücrelerini canlı hex/bin olarak düzenler; Super Mario, Star Wars ve Tetris hazır melodilerini tek tıkla yükler.
* **Otomatik Testbench Doğrulayıcı:** Test vektörleriyle devrenin doğruluk tablosunu otomatik test eder ve raporlar.
* **Endüstri Standardı CAD (.circ) Dışa & İçe Aktarımı:** Tasarımları standart `.circ` XML formatında Logisim/Logisim-Evolution ile çift yönlü paylaşır.
* **FPGA Verilog & VHDL Kod Üreticisi:** Şematik tasarımları tek tıkla FPGA sentezine hazır RTL donanım tanımlama koduna dönüştürür.
* **Hiyerarşik Alt Devre Paketleme (Subcircuits / ICs):** Tuvaldeki herhangi bir devreyi entegre (IC) bloğu haline getirip kendi giriş/çıkış bacaklarıyla paketler; çift tıklamayla içine girilip incelenebilir.

---

## 🎛️ Hazır Devre Kitleri (Presets)

Studio içerisinde tek tıkla yüklenebilen ve canlı çalışan hazır mühendislik kitleri:

1. **Yarım ve Tam Toplayıcı Devresi:** Mantık kapılarıyla 1-bit toplama ve elde (Cout) transferi.
2. **4-Bit Aritmetik Mantık Birimi (ALU - 74HC181):** Aritmetik toplama/çıkarma ve mantıksal AND/OR/XOR işlemlerini fonksiyon seçici pinlerle yürüten işlemci çekirdeği.
3. **4-Bit İşlemci Veri Yolu (CPU Datapath):** Program Sayacı (PC), 16x4 Program ROM'u, Komut Kaydı (IR) ve ALU birimini içeren mikrobilgisayar mimarisi.
4. **8-Bit Chiptune Müzik Kutusu:** CLK saat darbesi, 4-bit senkron sayaç, Super Mario melodisi yüklü 16x4 ROM ve piezo buzzer içeren ses işlemcisi.
5. **8-Bit Retro Ses Synthesizer & Müzik İstasyonu:** Star Wars ana fanfar melodisi, 7-Segment nota göstergesi ve durum LED'leri içeren synthesizer kiti.
6. **16x16 RGB VRAM Renkli Video Ekranı:** X-Y sayaçları, renk seçiciler ve yazma izniyle 256 piksellik renkli GPU çizim devresi.
7. **ASCII Klavye Terminal Kiti:** Klavye tuş takımı, 7-bit ASCII veri yolu, LED barları ve IRQ strobe sinyali içeren terminal birimi.
8. **8x8 LED Grafik Matrisi (GPU):** Piksel sanatı ve animasyon üreten LED matris devresi.

---

## 💻 Kurulum ve Çalıştırma

### Gereksinimler
* **Node.js** (v18 veya üzeri önerilir)
* **npm** veya modern paket yöneticisi

### Web Uygulaması Olarak Çalıştırma
```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirme sunucusunu başlatın
npm run dev

# Üretim derlemesi (Production Build)
npm run build
```

---

## 🖥️ Masaüstü Uygulaması (Desktop App)

LogicDesign Studio, **Electron** altyapısıyla bağımsız bir masaüstü uygulaması (Windows, macOS, Linux) olarak çalıştırılabilir.

### Masaüstü Geliştirme Modunda Çalıştırma:
```bash
# 1. Terminalde dev sunucusunu başlatın:
npm run dev

# 2. İkinci terminalde Electron masaüstü uygulamasını açın:
npm run electron:dev
```

### Masaüstü Kurulum Paketini (EXE / Installer) Oluşturma:
```bash
npm run electron:build
```

---

## ⌨️ Temel Klavye Kısayolları

| Kısayol | İşlev |
| :--- | :--- |
| **Fare Sağ Tuş Sürükle** | Tuvali akıcı kaydırma (Canvas Pan) |
| **Space + Sol Tuş Sürükle** | Tuvali kaydırma (Alternatif el aracı) |
| **Fare Tekerleği** | Yakınlaştırma / Uzaklaştırma (Zoom In / Out) |
| **Ctrl + Z / Ctrl + Y** | Geri Al (Undo) / İleri Al (Redo) |
| **Ctrl + C / Ctrl + V** | Seçili bileşenleri kopyala ve yapıştır |
| **Ctrl + D** | Seçili bileşenleri çoğalt (Duplicate) |
| **R** | Seçili bileşenleri saat yönünde 90° döndür |
| **Delete / Backspace** | Seçili bileşen veya kabloları sil |
| **F2** | Seçili bileşeni yeniden adlandır |
| **Shift + Tıklama** | Çoklu seçim moduna bileşen ekle/çıkar |

---

## 📄 Lisans
Bu proje eğitim, akademik araştırma ve açık kaynaklı mühendislik çalışmaları için geliştirilmiştir.
