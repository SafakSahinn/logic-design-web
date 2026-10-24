import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable, Image
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# 1. Register TrueType Fonts with Full Turkish Unicode Support
font_dir = r"C:\Windows\Fonts"
arial_regular = os.path.join(font_dir, "arial.ttf")
arial_bold = os.path.join(font_dir, "arialbd.ttf")
arial_italic = os.path.join(font_dir, "ariali.ttf")
arial_bold_italic = os.path.join(font_dir, "arialbi.ttf")
consolas_regular = os.path.join(font_dir, "consola.ttf")

pdfmetrics.registerFont(TTFont("Arial", arial_regular))
pdfmetrics.registerFont(TTFont("Arial-Bold", arial_bold))
pdfmetrics.registerFont(TTFont("Arial-Italic", arial_italic))
pdfmetrics.registerFont(TTFont("Arial-BoldItalic", arial_bold_italic))
pdfmetrics.registerFont(TTFont("Consolas", consolas_regular))

# Register full font family so <b> and <i> tags seamlessly resolve to Arial-Bold and Arial-Italic
pdfmetrics.registerFontFamily(
    'Arial',
    normal='Arial',
    bold='Arial-Bold',
    italic='Arial-Italic',
    boldItalic='Arial-BoldItalic'
)

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        # Header (Pages > 1)
        if self._pageNumber > 1:
            self.setFont("Arial", 8)
            self.setFillColor(colors.HexColor("#64748b"))
            self.drawString(54, 802, "LogicDesign Studio — Sıfırdan İleri Düzeye Kullanım Kılavuzu & Mühendislik Rehberi")
            self.setStrokeColor(colors.HexColor("#cbd5e1"))
            self.setLineWidth(0.6)
            self.line(54, 794, 541, 794)

        # Footer (All Pages)
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.6)
        self.line(54, 45, 541, 45)

        self.setFont("Arial", 8)
        self.setFillColor(colors.HexColor("#64748b"))
        self.drawString(54, 32, "LogicDesign Studio | Dijital Devre CAD & Simülasyon Platformu")
        page_text = f"Sayfa {self._pageNumber} / {page_count}"
        self.drawRightString(541, 32, page_text)
        self.restoreState()

def build_pdf(filename="Logic_Design_Studio_Kullanim_Kilavuzu.pdf"):
    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    title_style = ParagraphStyle(
        'DocTitle',
        fontName='Arial-Bold',
        fontSize=24,
        leading=29,
        textColor=colors.HexColor("#0f172a"),
        alignment=1,
        spaceAfter=6
    )

    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        fontName='Arial',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#2563eb"),
        alignment=1,
        spaceAfter=15
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        fontName='Arial-Bold',
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#1e3a8a"),
        spaceBefore=14,
        spaceAfter=7,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        fontName='Arial-Bold',
        fontSize=11,
        leading=15,
        textColor=colors.HexColor("#0f766e"),
        spaceBefore=10,
        spaceAfter=5,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        fontName='Arial',
        fontSize=9,
        leading=13.5,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=5
    )

    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=body_style,
        leftIndent=14,
        bulletIndent=4,
        spaceAfter=3.5
    )

    callout_style = ParagraphStyle(
        'Callout',
        fontName='Arial',
        fontSize=8.8,
        leading=13,
        textColor=colors.HexColor("#1e3a8a")
    )

    caption_style = ParagraphStyle(
        'Caption',
        fontName='Arial-Italic',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#475569"),
        alignment=1
    )

    table_header = ParagraphStyle(
        'TableHeader',
        fontName='Arial-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white,
        alignment=1
    )

    table_cell = ParagraphStyle(
        'TableCell',
        fontName='Arial',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#1e293b")
    )

    table_cell_bold = ParagraphStyle(
        'TableCellBold',
        fontName='Arial-Bold',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#0f172a")
    )

    def make_screenshot_card(img_path, caption_text, width=475, height=267):
        if not os.path.exists(img_path):
            return []
        img = Image(img_path, width=width, height=height)
        caption = Paragraph(f"<b>Ekran Görüntüsü:</b> {caption_text}", caption_style)
        card_table = Table([[img], [caption]], colWidths=[width])
        card_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
            ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor("#f1f5f9")),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, 0), 2),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 2),
            ('TOPPADDING', (0, 1), (-1, 1), 3),
            ('BOTTOMPADDING', (0, 1), (-1, 1), 4),
        ]))
        return [Spacer(1, 5), card_table, Spacer(1, 7)]

    story = []

    # ================= BAŞLIK VE GENEL BAKIŞ =================
    story.append(Spacer(1, 10))
    story.append(Paragraph("LogicDesign Studio", title_style))
    story.append(Paragraph("Sıfırdan İleri Düzeye Kullanım Kılavuzu & Mühendislik Rehberi", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#2563eb"), spaceAfter=12))

    # Giriş Kutusu
    info_data = [[
        Paragraph(
            "<b>Bu Kılavuzun Amacı:</b> Daha önce hiç mantık simülatörü veya CAD yazılımı kullanmamış bir kullanıcının dahi "
            "ilk saniyeden itibaren kolaylıkla devre çizebilmesi, simülasyon yapabilmesi ve ileri düzey işlemci mimarilerini "
            "çözümleyebilmesi için adım adım hazırlanmıştır. Programın tüm arayüzü, kapıları, anahtarları, osiloskobu, "
            "müzik synthesizer'ı ve kurulabilir masaüstü versiyonu detaylı şekilde ele alınmıştır.",
            callout_style
        )
    ]]
    info_table = Table(info_data, colWidths=[487])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f0f9ff")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#0284c7")),
        ('PADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 10))

    # ================= BÖLÜM 1: SIFIRDAN İLK DEVRENİZİ ÇİZME ADIMLARI =================
    story.append(Paragraph("1. Sıfırdan Başlayanlar İçin: İlk Devrenizi Çizin (4 Kolay Adım)", h1_style))
    story.append(Paragraph(
        "Dijital elektronikte her şey <b>0 (LOW / 0 Volt)</b> ve <b>1 (HIGH / +5 Volt)</b> seviyeleriyle ifade edilir. "
        "LogicDesign Studio'da devre kurmak legoları birleştirmek kadar basittir:",
        body_style
    ))
    story.append(Paragraph("<b>1. Adım (Giriş Elemanı Ekleyin):</b> Sol taraftaki 'Giriş / Çıkış' çekmecesine tıklayın. Buradaki <b>Anahtar (Switch)</b> bileşenini farenizle tutup tuvalin sol tarafına sürükleyip bırakın. Bir tane daha sürükleyip altına koyun (A ve B girişlerimiz hazır).", bullet_style))
    story.append(Paragraph("<b>2. Adım (Mantık Kapısı Ekleyin):</b> Sol menüden 'Mantık Kapıları' sekmesini açın. Bir adet <b>AND (VE) Kapısı</b> sürükleyip anahtarların sağına yerleştirin. (AND kapısı, iki girişi de 1 olduğunda çıkışına 1 verir).", bullet_style))
    story.append(Paragraph("<b>3. Adım (Gösterge Ekleyin):</b> 'Giriş / Çıkış' sekmesinden bir adet <b>LED</b> veya <b>Mantık Probu</b> alıp AND kapısının sağ tarafına bırakın.", bullet_style))
    story.append(Paragraph("<b>4. Adım (Kabloları Bağlayın):</b> Birinci anahtarın sağındaki küçük bağlantı noktasına (pim) farenin sol tuşuyla tıklayıp elinizi kaldırmadan AND kapısının üst giriş pinine sürükleyip bırakın. Aynı şekilde ikinci anahtarı alt pine, AND kapısının çıkış pinini de LED'in giriş pinine bağlayın. Tebrikler! İlk devreniz hazır. Şimdi anahtarlara fareyle tıklayarak açıp kapatın; iki anahtar da açık olduğunda LED'in yandığını ve mekanik klik sesini canlı olarak duyacaksınız.", bullet_style))
    story.append(Spacer(1, 6))

    # Ana CAD Arayüz Resmi
    story.extend(make_screenshot_card(
        "assets/screenshots/screenshot_cad_main.png",
        "LogicDesign Studio Ana Çalışma Alanı: Sol Bileşen Çekmecesi, Merkezi CAD Tuvali ve Üst Mühendislik Araçları"
    ))

    # ================= BÖLÜM 2: ARAYÜZ VE GEZİNME =================
    story.append(Paragraph("2. Arayüz Düzeni ve Tuval Kontrolleri", h1_style))
    story.append(Paragraph(
        "LogicDesign Studio, karmaşık mimarilerin çiziminde dahi maksimum rahatlık sağlamak için profesyonel bir vektör CAD tuvaline sahiptir:",
        body_style
    ))
    story.append(Paragraph("• <b>Üst Araç Çubuğu:</b> Simülasyonu Canlı Çalıştır / Duraklat butonu, Tek Adım (Single-Step) ilerleme butonu, Saat Hızı (0.5Hz, 1Hz, 2Hz, 4Hz, 6Hz, 8Hz) seçicisi ve Analiz Araçları yer alır.", bullet_style))
    story.append(Paragraph("• <b>Akıcı Gezinme (Pan):</b> Farenin sağ tuşuna basılı tutarak tuvali istediğiniz yöne sınırsızca kaydırabilirsiniz (Right-click Drag). Alternatif olarak klavyedeki <b>Space (Boşluk)</b> tuşuna basılı tutup sol tıkla da kaydırabilirsiniz.", bullet_style))
    story.append(Paragraph("• <b>Hassas Yakınlaştırma (Zoom):</b> Fare tekerleğini ileri/geri çevirerek imlecinizin bulunduğu merkeze %40 ile %250 oranında mikroskobik veya panoramik yakınlaşma sağlayabilirsiniz.", bullet_style))
    story.append(Paragraph("• <b>Çerçeve Seçim Kutusu:</b> Tuvalin boş bir yerinden tutup fareyi sürüklediğinizde mavi bir seçim kutusu açılır; bu kutunun içine giren tüm elemanlar topluca seçilir, taşınabilir veya silinebilir.", bullet_style))
    story.append(Paragraph("• <b>Döndürme ve Çoğaltma:</b> Seçili herhangi bir bileşeni klavyedeki <b>R</b> tuşuyla 90 derece döndürebilir, <b>Ctrl+D</b> ile birebir kopyasını anında çoğaltabilirsiniz.", bullet_style))
    story.append(Spacer(1, 6))

    # ================= BÖLÜM 3: MANHATTAN KABLOLAMA =================
    story.append(Paragraph("3. Akıllı Manhattan Kablolama ve Tel Düzenleme", h1_style))
    story.append(Paragraph(
        "Geleneksel çizim araçlarında kablolar çapraz geçerek karmaşaya yol açar. LogicDesign Studio'da ise profesyonel "
        "entegre devre (EDA) standartlarında 90 derecelik dik açılı (Manhattan) yönlendirme uygulanır:",
        body_style
    ))
    story.append(Paragraph("• <b>Otomatik Köşe Kırma:</b> İki pimi birbirine bağladığınızda kablo otomatik olarak dik açılarla yönlendirilir ve en temiz yolu bulur.", bullet_style))
    story.append(Paragraph("• <b>Dirsek ve Orta Segment Tutamaçları:</b> Çizilmiş bir kablonun üzerine fareyle geldiğinizde köşelerde ve düz hatların ortasında mavi tutamaçlar belirir. Bu noktaları fareyle tutup istediğiniz yöne çekerek kablo yolunu genişletebilir veya aradaki başka bir bileşenin etrafından dolaştırabilirsiniz.", bullet_style))
    story.append(Paragraph("• <b>Kabloyu Orijinal Haline Sıfırlama:</b> Bir kablonun dirsek tutamacı üzerine fareyle <b>çift tıkladığınızda</b>, kablo anında en kısa geometrik rotasına geri döner.", bullet_style))
    story.append(Paragraph("• <b>Kablo Silme:</b> Kabloya tıklayıp klavyeden <b>Delete</b> veya <b>Backspace</b> tuşuna basarak kablo bağlantısını kesebilirsiniz.", bullet_style))
    story.append(Spacer(1, 6))

    # ================= BÖLÜM 4: TÜM BİLEŞENLERİN DETAYLI KATALOĞU =================
    story.append(Paragraph("4. Uygulamadaki Tüm Bileşenlerin Detaylı Kataloğu ve Görselleri", h1_style))
    story.append(Paragraph(
        "Studio kütüphanesindeki tüm elemanlar endüstri standardı ANSI/IEEE sembolleri ve fotogerçekçi grafiklerle donatılmıştır. "
        "Aşağıdaki tabloda her bir devre elemanının gerçek görseli, bağlantı pimleri ve çalışma mantığı yer almaktadır:",
        body_style
    ))

    # Bileşen genel bakış paneli
    story.extend(make_screenshot_card(
        "assets/components/components_sheet.png",
        "LogicDesign Studio Entegre Bileşen Ailesi (Mantık Kapıları, Giriş/Çıkış Aygıtları, Göstergeler, Flip-Floplar ve Çipler)",
        width=475,
        height=300
    ))
    story.append(Spacer(1, 6))

    def make_comp_thumb(img_name):
        path = os.path.join("assets", "components", img_name)
        if os.path.exists(path):
            return Image(path, width=54, height=36)
        return Paragraph("-", table_cell)

    comp_table_data = [
        [
            Paragraph("Görsel", table_header),
            Paragraph("Bileşen Adı", table_header),
            Paragraph("Kategori & Pimler", table_header),
            Paragraph("Ne İşe Yarar? (Çalışma Prensibi)", table_header)
        ],
        [
            make_comp_thumb("comp_and.png"),
            Paragraph("<b>AND (VE) Kapısı</b>", table_cell_bold),
            Paragraph("Mantık Kapısı<br/>2 Giriş, 1 Çıkış", table_cell),
            Paragraph("Sadece tüm girişleri 1 olduğunda çıkışına 1 verir. Girişlerden biri dahi 0 ise çıkışı 0'dır.", table_cell)
        ],
        [
            make_comp_thumb("comp_or.png"),
            Paragraph("<b>OR (VEYA) Kapısı</b>", table_cell_bold),
            Paragraph("Mantık Kapısı<br/>2 Giriş, 1 Çıkış", table_cell),
            Paragraph("Girişlerinden en az biri 1 olduğunda çıkışına 1 verir. Sadece 0-0 iken çıkışı 0 olur.", table_cell)
        ],
        [
            make_comp_thumb("comp_not.png"),
            Paragraph("<b>NOT (DEĞİL) Kapısı</b>", table_cell_bold),
            Paragraph("Mantık Kapısı<br/>1 Giriş, 1 Çıkış", table_cell),
            Paragraph("Tersleyicidir. Girişine 0 gelirse çıkışa 1, girişine 1 gelirse çıkışa 0 verir.", table_cell)
        ],
        [
            make_comp_thumb("comp_nand.png"),
            Paragraph("<b>NAND (VE-DEĞİL)</b>", table_cell_bold),
            Paragraph("Mantık Kapısı<br/>2 Giriş, 1 Çıkış", table_cell),
            Paragraph("AND kapısının tersidir. Sadece tüm girişleri 1 iken 0 üretir, diğer hallerde 1 verir.", table_cell)
        ],
        [
            make_comp_thumb("comp_nor.png"),
            Paragraph("<b>NOR (VEYA-DEĞİL)</b>", table_cell_bold),
            Paragraph("Mantık Kapısı<br/>2 Giriş, 1 Çıkış", table_cell),
            Paragraph("OR kapısının tersidir. Sadece tüm girişleri 0 iken çıkışına 1 verir. Diğer durumlarda 0'dır.", table_cell)
        ],
        [
            make_comp_thumb("comp_xor.png"),
            Paragraph("<b>XOR (ÖZEL VEYA)</b>", table_cell_bold),
            Paragraph("Mantık Kapısı<br/>2 Giriş, 1 Çıkış", table_cell),
            Paragraph("Girişleri birbirinden farklı olduğunda (0-1 veya 1-0) 1, aynı olduğunda 0 verir.", table_cell)
        ],
        [
            make_comp_thumb("comp_xnor.png"),
            Paragraph("<b>XNOR (EŞDEĞERLİK)</b>", table_cell_bold),
            Paragraph("Mantık Kapısı<br/>2 Giriş, 1 Çıkış", table_cell),
            Paragraph("Girişleri birbiriyle aynı olduğunda (0-0 veya 1-1) 1, farklı olduğunda 0 üretir.", table_cell)
        ],
        [
            make_comp_thumb("comp_tristate.png"),
            Paragraph("<b>Üç Durumlu Tampon</b>", table_cell_bold),
            Paragraph("Kontrol Elemanı<br/>Giriş, EN, Çıkış", table_cell),
            Paragraph("EN=1 iken sinyali geçirir. EN=0 iken kabloyu tamamen yalıtır (Yüksek Empedans / Hi-Z).", table_cell)
        ],
        [
            make_comp_thumb("comp_switch.png"),
            Paragraph("<b>Mekanik Anahtar</b>", table_cell_bold),
            Paragraph("Giriş Elemanı<br/>1 Çıkış Pini", table_cell),
            Paragraph("Mekanik aç-kapa anahtar. Tıklandığında açık (1 / Yeşil) ve kapalı (0 / Kırmızı) olur.", table_cell)
        ],
        [
            make_comp_thumb("comp_pushbutton.png"),
            Paragraph("<b>Basmalı Buton</b>", table_cell_bold),
            Paragraph("Giriş Elemanı<br/>1 Çıkış Pini", table_cell),
            Paragraph("Anlık basmalı buton. Fare basılı tutulduğunda 1 verir, bırakıldığında anında 0'a döner.", table_cell)
        ],
        [
            make_comp_thumb("comp_clock.png"),
            Paragraph("<b>Saat Jeneratörü</b>", table_cell_bold),
            Paragraph("Sinyal Kaynağı<br/>1 Çıkış Pini", table_cell),
            Paragraph("Belirlenen frekansta (0.5Hz - 8Hz) otomatik olarak 0 ve 1 darbeleri üreten kalp atışıdır.", table_cell)
        ],
        [
            make_comp_thumb("comp_vcc_gnd.png"),
            Paragraph("<b>VCC (+5V) & GND</b>", table_cell_bold),
            Paragraph("Sabit Güç<br/>1 Çıkış Pini", table_cell),
            Paragraph("VCC sürekli mantık 1 (+5V), GND ise sürekli mantık 0 (Toprak) seviyesi sağlar.", table_cell)
        ],
        [
            make_comp_thumb("comp_led.png"),
            Paragraph("<b>Işıklı Gösterge (LED)</b>", table_cell_bold),
            Paragraph("Çıkış / Gösterge<br/>1 Giriş Pini", table_cell),
            Paragraph("Hatta elektrik varsa (1 seviyesi) seçilen renkte parlar; yoksa (0 seviyesi) sönük kalır.", table_cell)
        ],
        [
            make_comp_thumb("comp_probe.png"),
            Paragraph("<b>Mantık Probu</b>", table_cell_bold),
            Paragraph("Ölçüm Cihazı<br/>1 Giriş Pini", table_cell),
            Paragraph("Bağlandığı hattaki canlı mantık seviyesini dijital ekranda '0' veya '1' olarak gösterir.", table_cell)
        ],
        [
            make_comp_thumb("comp_7seg.png"),
            Paragraph("<b>7-Segment Display</b>", table_cell_bold),
            Paragraph("Sayısal Ekran<br/>4-Bit Veri Girişi", table_cell),
            Paragraph("Gelen ikili kodu 0'dan 9'a ve onaltılık A, B, C, D, E, F karakterlerine dönüştürür.", table_cell)
        ],
        [
            make_comp_thumb("comp_hex.png"),
            Paragraph("<b>4-Bit Hex Display</b>", table_cell_bold),
            Paragraph("Büyük Ekran<br/>4-Bit Veri Girişi", table_cell),
            Paragraph("4-bitlik binary (0000..1111) veriyi doğrudan büyük monolitik Hex karakteri olarak basar.", table_cell)
        ],
        [
            make_comp_thumb("comp_adder.png"),
            Paragraph("<b>Tam Toplayıcı</b>", table_cell_bold),
            Paragraph("Aritmetik Birim<br/>A, B, Cin -> S, Cout", table_cell),
            Paragraph("İki biti ve alt basamaktan gelen eldeyi (Cin) toplayıp Toplam (Sum) ve Elde (Cout) üretir.", table_cell)
        ],
        [
            make_comp_thumb("comp_mux.png"),
            Paragraph("<b>Multiplexer (MUX)</b>", table_cell_bold),
            Paragraph("Veri Seçici<br/>D0, D1, SEL -> Y", table_cell),
            Paragraph("Seçici hat (SEL) 0 iken D0 girişini, 1 iken D1 girişini ana çıkış hattına (Y) yönlendirir.", table_cell)
        ],
        [
            make_comp_thumb("comp_dff.png"),
            Paragraph("<b>D Flip-Flop</b>", table_cell_bold),
            Paragraph("Ardışıl Mantık<br/>D, CLK -> Q, ~Q", table_cell),
            Paragraph("Saat darbesinin yükselen kenarında D girişindeki 1 bitlik veriyi yakalar ve hafızasında saklar.", table_cell)
        ],
        [
            make_comp_thumb("comp_jkff.png"),
            Paragraph("<b>JK Flip-Flop</b>", table_cell_bold),
            Paragraph("Ardışıl Mantık<br/>J, K, CLK -> Q, ~Q", table_cell),
            Paragraph("Universal flip-floptur. J=1 K=0 iken kurar (Set), J=0 K=1 iken siler (Reset), 1-1 iken tersler.", table_cell)
        ],
        [
            make_comp_thumb("comp_counter.png"),
            Paragraph("<b>4-Bit Senkron Sayaç</b>", table_cell_bold),
            Paragraph("Ardışıl Mantık<br/>CLK, RST -> Q[3:0]", table_cell),
            Paragraph("Her saat darbesinde 0'dan 15'e kadar (0000-1111) ileri sayar. RST pimiyle anında sıfırlanır.", table_cell)
        ],
        [
            make_comp_thumb("comp_ram.png"),
            Paragraph("<b>16x4 RAM & ROM</b>", table_cell_bold),
            Paragraph("SRAM Bellek<br/>Adres, WE, Veri", table_cell),
            Paragraph("16 farklı adrese 4-bitlik verileri kaydeder veya okur. Dahili canlı hex editörü bulunur.", table_cell)
        ],
        [
            make_comp_thumb("comp_buzzer.png"),
            Paragraph("<b>Chiptune Buzzer</b>", table_cell_bold),
            Paragraph("Multimedya<br/>EN, Nota[3:0]", table_cell),
            Paragraph("16 müzik notasını gerçek analog kare dalga ve ADSR vuruş zarfıyla ses olarak çalar.", table_cell)
        ],
        [
            make_comp_thumb("comp_rgbmatrix.png"),
            Paragraph("<b>16x16 RGB Matrix</b>", table_cell_bold),
            Paragraph("GPU Ekranı<br/>X, Y, R, G, B, WE", table_cell),
            Paragraph("256 piksellik renkli ekran. Koordinat verilip R-G-B renkleriyle piksel boyama yapar.", table_cell)
        ],
    ]

    comp_table = Table(comp_table_data, colWidths=[60, 95, 95, 237])
    comp_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
    ]))
    story.append(comp_table)
    story.append(Spacer(1, 10))

    # ================= BÖLÜM 5: İLERİ DÜZEY MÜHENDİSLİK ARAÇLARI =================
    story.append(Paragraph("5. İleri Düzey Mühendislik ve Analiz Araçları", h1_style))

    story.append(Paragraph("5.1 Çok Kanallı Zamanlama Osiloskobu (Logic Analyzer)", h2_style))
    story.append(Paragraph(
        "Üst araç çubuğundaki <b>Osiloskop</b> butonuyla açılır. Devredeki tüm sinyalleri zaman ekseninde grafik olarak çizer. "
        "Saat darbelerinin hangi milisaniyede yükseldiğini, sayaçların ne zaman arttığını ve kapıların tepki sürelerini "
        "aynı anda gözlemleyebilirsiniz. <b>VCD (Value Change Dump)</b> formatında kaydedilerek profesyonel test araçlarına aktarılabilir.",
        body_style
    ))

    story.append(Paragraph("5.2 Doğruluk Tablosu & Karnaugh Haritası (K-Map) Çözücü", h2_style))
    story.append(Paragraph(
        "Tasarladığınız devrenin matematiksel doğruluk tablosunu (Truth Table) tek tıkla üretir. "
        "K-Map sekmesinde en sade Boole cebri ifadesini (Minimal SOP) renkli çerçevelerle gruplandırarak bulur.",
        body_style
    ))
    story.extend(make_screenshot_card(
        "assets/screenshots/screenshot_kmap.png",
        "Karnaugh Haritası (K-Map) Çözücü: Canlı Hücre Matrisi ve Renkli Minimal SOP Gruplandırması"
    ))

    story.append(Paragraph("5.3 Boole İfadesinden Otomatik Devre Sentezleyici (Logic Synthesizer)", h2_style))
    story.append(Paragraph(
        "Herhangi bir mantık formülü yazdığınızda (örneğin <b>(A & B) | (~C ^ D)</b>), sistem bu ifadeyi saniyeler içinde "
        "tuval üzerinde gerçek kapılarla ve hatasız kablolarla bağlayarak canlı devre şeması olarak çizer.",
        body_style
    ))

    story.append(Paragraph("5.4 Sonlu Durum Makinesi (FSM) Tasarımcısı", h2_style))
    story.append(Paragraph(
        "Trafik ışıkları, asansör veya otomat kontrolü gibi durum makineleri için durumlar (S0, S1...) ve geçiş şartları girilir. "
        "FSM aracı gerekli D Flip-Flop ve kapı kombinasyonlarını hesaplayıp otomatik olarak sentezler.",
        body_style
    ))

    story.append(Paragraph("5.5 İnteraktif Hex Bellek Editörü & Müzik Yükleyici", h2_style))
    story.append(Paragraph(
        "RAM ve ROM belleklerin üzerine tıklandığında açılır. 16 adresin her birine dilediğiniz veriyi yazabilirsiniz. "
        "Üstteki hızlı butonlarla <b>Super Mario</b>, <b>Star Wars</b> ve <b>Tetris</b> melodilerini tek tıkla belleğe aktarabilirsiniz.",
        body_style
    ))

    story.append(Paragraph("5.6 Hiyerarşik Alt Devre Paketleme (Subcircuits / ICs)", h2_style))
    story.append(Paragraph(
        "Tuvaldeki devrenizi seçip 'Paketle (IC)' butonuna basarak tek bir entegre çip bloğu haline getirebilirsiniz. "
        "Çoklu sekme mimarisi sayesinde alt devreye çift tıklayarak içine girebilir, şemayı düzenleyip ana devreye dönebilirsiniz.",
        body_style
    ))
    story.append(Spacer(1, 8))

    # ================= BÖLÜM 6: HAZIR DEVRE KİTLERİ (UYGULAMALI ÖRNEKLER) =================
    story.append(Paragraph("6. Hazır Devre Kitleri (Presets) ve Uygulamalı Örnekler", h1_style))
    story.append(Paragraph(
        "Uygulamanın gücünü görmek için 'Hazır Sistemler' menüsünden tek tıkla yükleyebileceğiniz kitler:",
        body_style
    ))

    # Kit 1: Mario Chiptune
    story.append(Paragraph("Örnek 1: 8-Bit Chiptune Müzik Kutusu (Super Mario Melodisi)", h2_style))
    story.append(Paragraph(
        "<b>Devre Elemanları:</b> Tempo Saati (CLK 4Hz), Başa Sar Butonu (RST), 4-Bit Sayaç, 16x4 Melodi ROM'u ve Piezo Buzzer.<br/>"
        "<b>Çalışma Mantığı:</b> Saat her vurduğunda sayaç 0'dan 15'e doğru bir artar. Sayacın çıkışları ROM belleğin adresine bağlıdır. "
        "ROM belleğin içinde Super Mario'nun intro notaları (E5, E5, sessiz, E5, C5, E5, G5, G4...) yazılıdır. "
        "Bu nota kodları piezo buzzer'a ulaşır ve hoparlörden orijinal NES oyun konsolu tonuyla Mario müziği çalınır. "
        "RST butonuna basıldığında melodi anında başa sarar.",
        body_style
    ))
    story.extend(make_screenshot_card(
        "assets/screenshots/screenshot_chiptune_music.png",
        "8-Bit Chiptune Müzik Kutusu: Saat Jeneratörü, 4-Bit Sayaç, Super Mario Melodi ROM'u ve Piezo Buzzer"
    ))

    # Kit 2: Star Wars Synth
    story.append(Paragraph("Örnek 2: 8-Bit Retro Synthesizer & Müzik İstasyonu (Star Wars Fanfarı)", h2_style))
    story.append(Paragraph(
        "<b>Devre Elemanları:</b> Saat, sayaç, 16x4 ROM, 7-Segment nota göstergesi, durum LED'i ve ses synthesizer'ı.<br/>"
        "<b>Çalışma Mantığı:</b> ROM bellekte John Williams'ın unutulmaz Star Wars ana fanfarı (Sol-Sol-Sol, Do, Sol, Fa-Mi-Re, Tiz Do...) "
        "kodlanmıştır. Çalan her notanın sıra numarası 7-Segment ekranda anlık olarak görünürken hoparlörden melodi üretilir.",
        body_style
    ))

    # Kit 3: 4-Bit ALU
    story.append(Paragraph("Örnek 3: 4-Bit Aritmetik Mantık Birimi (ALU - 74HC181)", h2_style))
    story.append(Paragraph(
        "<b>Devre Elemanları:</b> 74HC181 ALU çipi, A ve B giriş anahtarları, fonksiyon seçici (S) anahtarları ve Hex gösterge.<br/>"
        "<b>Çalışma Mantığı:</b> İşlemcilerin kalbidir. Girişteki A ve B sayılarını (Örn: 5 ve 3), seçtiğiniz fonksiyona göre "
        "toplar (5+3=8), çıkarır (5-3=2) veya mantıksal AND/OR işlemlerine sokarak sonucu Hex ekranda anında gösterir.",
        body_style
    ))
    story.extend(make_screenshot_card(
        "assets/screenshots/screenshot_alu_kit.png",
        "4-Bit Aritmetik Mantık Birimi (ALU - 74HC181) Laboratuvar Kiti ve Sayısal Sonuç Göstergeleri"
    ))

    # Kit 4: 16x16 RGB GPU
    story.append(Paragraph("Örnek 4: 16x16 RGB VRAM Renkli Video Ekranı & GPU Çizim Kiti", h2_style))
    story.append(Paragraph(
        "<b>Devre Elemanları:</b> 256 piksellik RGB video matrisi, X ve Y koordinat sayaçları, Kırmızı-Yeşil-Mavi anahtarları ve Yazma İzni (WE).<br/>"
        "<b>Çalışma Mantığı:</b> X ve Y sayaçları ekran koordinatlarını tararken renk anahtarlarındaki renk ekrana yazılır. "
        "Ayrıca ekrandaki piksellere fareyle tıklayarak doğrudan piksel sanatı ve çizimler yapabilirsiniz.",
        body_style
    ))
    story.extend(make_screenshot_card(
        "assets/screenshots/screenshot_rgb_gpu.png",
        "16x16 RGB VRAM Renkli Video Ekranı: 256 Piksellik Renkli GPU Belleği ve Koordinat Sayaçları"
    ))

    # Kit 5: ASCII Keyboard
    story.append(Paragraph("Örnek 5: ASCII Klavye Terminal Kiti", h2_style))
    story.append(Paragraph(
        "<b>Devre Elemanları:</b> ASCII klavye tuş matrisi, 7-Bit LED veri yolu, Strobe (ST) sinyali ve Hex gösterge.<br/>"
        "<b>Çalışma Mantığı:</b> Tuvaldeki klavye tuşlarına bastığınızda (Örn: 'A' tuşu), entegre 7-bit ikili ASCII kodunu "
        "(01000001 = 65) üretir, Strobe ledi yanarak bilginin hazır olduğunu bildirir.",
        body_style
    ))
    story.append(Spacer(1, 8))

    # ================= BÖLÜM 7: MASAÜSTÜ UYGULAMASI (HAZIR KURULU PORTABLE & SETUP EXE) =================
    story.append(Paragraph("7. Masaüstü Uygulaması (Hazır Kurulu Portable & Kurulum .EXE Rehberi)", h1_style))
    story.append(Paragraph(
        "LogicDesign Studio, tarayıcı bağımlılığı olmadan Windows üzerinde doğrudan çalışan profesyonel bir masaüstü CAD "
        "yazılımına dönüştürülmüştür. Kullanıcı tercihlerine göre iki farklı dağıtım modeli mevcuttur:",
        body_style
    ))

    story.append(Paragraph("7.1 Hazır Kurulu / Taşınabilir Sürüm (Portable .EXE - Sıfır Kurulum)", h2_style))
    story.append(Paragraph(
        "Geliştirme aşamasında veya bilgisayarınıza herhangi bir kurulum yapmadan doğrudan çalıştırmak istediğinizde kullanılır:",
        body_style
    ))
    story.append(Paragraph("• <b>Tek Dosya Taşınabilir EXE:</b> <code>dist_electron/LogicDesign Studio-Portable-1.0.0.exe</code> dosyasına çift tıklamanız yeterlidir. Hiçbir kurulum sihirbazı veya yönetici yetkisi gerektirmeden saniyeler içinde doğrudan açılır. USB belleğe atıp istediğiniz bilgisayarda tak-çalıştır kullanabilirsiniz.", bullet_style))
    story.append(Paragraph("• <b>Hazır Kurulu Klasör (Unpacked):</b> <code>dist_electron/win-unpacked/LogicDesign Studio.exe</code> dosyası zaten açılmış ve hazır haldedir. Doğrudan bu exe'ye tıklayarak geliştirme hızında anında başlatabilirsiniz.", bullet_style))
    story.append(Spacer(1, 4))

    story.append(Paragraph("7.2 Kurulumlu Sürüm (Setup / Installer .EXE)", h2_style))
    story.append(Paragraph(
        "Geliştirmeler tamamlandığında veya son kullanıcıya sunulurken resmi Windows yazılımı olarak kurmak için kullanılır:",
        body_style
    ))
    story.append(Paragraph("• <b>Kurulum Paketi:</b> <code>dist_electron/LogicDesign Studio-Kurulum-1.0.0.exe</code>", bullet_style))
    story.append(Paragraph("• Çift tıklandığında standart Windows kurulum sihirbazı başlar; Program Files klasörünü belirlemenize, masaüstü simgesi ve Windows Başlat Menüsü kısayolu oluşturmanıza olanak tanır.", bullet_style))
    story.append(Paragraph("• Tamamen çevrimdışı (offline), donanım hızlandırmalı WebGL tuvali ve ultra düşük gecikmeli Web Audio motoruyla çalışır.", bullet_style))
    story.append(Spacer(1, 8))

    # ================= BÖLÜM 8: KLAVYE KISAYOLLARI TABLOSU =================
    story.append(Paragraph("8. Hızlı Klavye Kısayolları Referansı", h1_style))

    shortcut_data = [
        [Paragraph("Kısayol Tuşu", table_header), Paragraph("Komut / Eylem", table_header), Paragraph("Detaylı Açıklama", table_header)],
        [Paragraph("Fare Sağ Tuş Sürükle", table_cell_bold), Paragraph("Tuvali Kaydır (Pan)", table_cell), Paragraph("Tuvalin herhangi bir yerinde sağ tıkla basılı tutup sınırsız kaydırma.", table_cell)],
        [Paragraph("Space + Sol Tuş", table_cell_bold), Paragraph("Kaydırma Aracı (Hand)", table_cell), Paragraph("Boşluk tuşuna basılı tutarak sol fare tuşuyla çizim alanını kaydırma.", table_cell)],
        [Paragraph("Fare Tekerleği", table_cell_bold), Paragraph("Yakınlaştır / Uzaklaştır", table_cell), Paragraph("İmlecin bulunduğu merkeze doğru %40 ile %250 arasında hassas yakınlaştırma.", table_cell)],
        [Paragraph("Ctrl + Z", table_cell_bold), Paragraph("Geri Al (Undo)", table_cell), Paragraph("Son yapılan çizim, kablolama veya bileşen işlemini geri alır.", table_cell)],
        [Paragraph("Ctrl + Y", table_cell_bold), Paragraph("İleri Al (Redo)", table_cell), Paragraph("Geri alınan işlemi tekrar uygular.", table_cell)],
        [Paragraph("Ctrl + D", table_cell_bold), Paragraph("Çoğalt (Duplicate)", table_cell), Paragraph("Seçili bileşenlerin birebir kopyasını oluşturup tuvale yapıştırır.", table_cell)],
        [Paragraph("R", table_cell_bold), Paragraph("90° Döndür (Rotate)", table_cell), Paragraph("Seçili bileşenlerin yönünü saat yönünde 90 derece döndürür.", table_cell)],
        [Paragraph("Delete / Backspace", table_cell_bold), Paragraph("Sil (Delete)", table_cell), Paragraph("Seçili bileşenleri veya kabloları çizimden kaldırır.", table_cell)],
        [Paragraph("F2", table_cell_bold), Paragraph("Yeniden Adlandır (Rename)", table_cell), Paragraph("Seçili bileşenin etiketini ve yazı konumunu düzenleme penceresini açar.", table_cell)],
        [Paragraph("Shift + Tık", table_cell_bold), Paragraph("Çoklu Seçim", table_cell), Paragraph("Var olan seçime yeni bileşenler ekler veya seçimden çıkarır.", table_cell)],
    ]

    sc_table = Table(shortcut_data, colWidths=[110, 130, 247])
    sc_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#0f766e")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
    ]))
    story.append(sc_table)

    # Dokümanı Derle
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Pedagogical PDF successfully created with TrueType Unicode: {filename}")

if __name__ == "__main__":
    out_pdf = "Logic_Design_Studio_Kullanim_Kilavuzu.pdf"
    build_pdf(out_pdf)
