# Vitrin — pazarlama sitesi

Pazaryeri satıcıları için yapay zeka destekli ürün görseli ve ilan stüdyosu **Vitrin**'in tanıtım sitesi.
Bağımlılık yok, derleme adımı yok: düz HTML + CSS + JS.

## Çalıştırma

```bash
npx serve .        # ya da: python3 -m http.server 8080
```

## Yapı

```
index.html           Tek sayfa (menü, hero, önizleme, nasıl çalışır, örnekler, fiyatlar, yorumlar, SSS, CTA, footer)
css/styles.css       Tema (renk/tipografi değişkenleri :root içinde), bileşenler, responsive kurallar
js/main.js           Mobil menü, önce/sonra kaydırıcı, stil çipleri, pazaryeri sekmeleri, aylık/yıllık fiyat, giriş animasyonları
fonts/               Kendi sunucumuzdan sunulan Bricolage Grotesque + Inter (latin + latin-ext, Türkçe karakterler dahil)
img/                 Ürün görselleri (WebP) ve paylaşım görseli (og.jpg)
tools/gorsel-uretici Örnek görselleri üreten betikler (SVG → PNG → WebP)
```

## Yayına almadan önce

- **Yer tutucular:** Hero'daki puan/kullanıcı sayısı ("4,9/5 · 2.400+ satıcı") ve üç müşteri yorumu
  örnek içeriktir. Gerçek ve izinli verilerle değiştirin. Ticaret Bakanlığı mevzuatı yanıltıcı
  yorum ve puan kullanımını yasaklar.
- **Görseller:** `img/` içindeki ürün görselleri illüstrasyondur. Gerçek önce/sonra çıktılarıyla aynı
  dosya adlarını kullanarak değiştirebilirsiniz (hero: 1000×1250, galeri: 800×1000, "önce" küçük resimleri: 320×400).
- **Bağlantılar:** `/giris`, `/kayit`, `/kvkk` vb. sayfalar uygulama ve yasal metinler hazır olduğunda eklenecek.
- **Alan adı:** `vitrin.app` yer tutucudur (`canonical`, `og:image`, e-posta adresi).

## Görselleri yeniden üretmek

```bash
cd tools/gorsel-uretici
python3 gen.py          # svg/ klasörüne sahneleri yazar
mkdir -p png && node render.js   # Playwright ile PNG'ye çevirir
./export.sh                     # "önce" efekti + WebP dönüşümü (ImageMagick), img/ klasörüne yazar
```
