# Portföyüm

Telefonda ana ekrana eklenen, yalnızca kişisel kullanım için fon portföyü takip uygulaması (PWA). Mağazada yayınlanmaz.

## Ne yapar

| Sekme | İçerik |
|---|---|
| **Özet** | Toplam değer (₺/$), günlük değişim, brüt ve net (stopaj sonrası) kâr, dolar bazında getiri, günlük ortalama ve yıllık karşılığı, değer grafiği, gün gün kayıt tablosu |
| **Fonlar** | Fon başına adet, ortalama maliyet, kâr; alış/satış işlemleri; elle fiyat girişi; fon başına stopaj oranı; fon grafiği ve kıyaslar |
| **Kıyas** | "Aynı parayı aynı günlerde dolara / altına / BIST 100 / S&P 500 / Nasdaq / DAX / Nikkei / MSCI Dünya / mevduata yatırsaydım" tablosu ve grafiği; 1 ay–5 yıl ve tüm zamanlar dönemsel getiri tablosu (TL veya USD bazında) |
| **Senaryo** | Fon bazında beklenen yıllık getiri, kötümser/baz/iyimser senaryolar, aylık ek yatırım, dönem sonu kur, hedef değere ulaşma süresi |
| **Diğer** | Gayrimenkul, arsa, araç, BES, nakit: tarih tarih değerleme, TL/USD toplam, tarihlere göre izlence tablosu |

## Veri nereden gelir

- `.github/workflows/portfoy.yml` her iş günü 18:35 ve 22:50'de, her gün 08:20'de (TR saati) `scripts/veri-cek.mjs`'i çalıştırır.
- Fon fiyatları **TEFAS**'tan (YAT/EMK/BYF), bulunamazsa Yahoo Finance'ten (`KOD.IS`); döviz, altın ve endeksler Yahoo Finance'ten, Dolar/Euro için TCMB yedek.
- Sonuçlar `data/series/*.json` olarak depoya kaydedilir; böylece uygulama hiç açılmasa da fiyat geçmişi gün gün birikir.
- Yeni bir fonu otomatik takibe almak için `data/config.json` içindeki `fonlar` listesine kodunu ekle.

## Otomatik yedek

Ayarlar → *Otomatik yedek*: veri telefonda kullanıcının parolasıyla şifrelenir (AES-GCM-256, PBKDF2-SHA256 310.000 tur) ve GitHub hesabındaki gizli bir Gist'e (`portfoyum-yedek.json`) yazılır. Her değişiklikten birkaç saniye sonra yeniden yedeklenir; eski sürümler Gist geçmişinde kalır. Yeni cihazda *GitHub yedeğinden geri yükle* ile anahtar + parola girilerek geri alınır. Parola cihazdan çıkmaz; unutulursa yedek açılamaz.

## Enflasyon

TÜFE aylık endeksi (TradingView `ECONOMICS:TRCPI`) günlük seriye çevrilir (her ay o ayın 15'ine yerleşir, aralar bileşik doldurulur). Son açıklanan aydan sonrası son 3 ayın ortalama artışıyla tahmin edilir. Özet'te enflasyona göre gerçek getiri, Kıyas'ta "Enflasyon (TÜFE)" satırı, Senaryo'da bugünün parasıyla değer gösterilir.

## Gizlilik

Depo herkese açık olduğundan **adet, maliyet ve diğer varlık değerleri depoya yazılmaz**; yalnızca telefonun tarayıcı deposunda (localStorage) tutulur. Depoda yalnızca herkese açık fiyatlar ve takip edilen fon kodları bulunur. Ayarlar → *Yedeği indir* ile düzenli yedek al.

## Kurulum (bir kez)

1. Bu klasör ve iş akışı `master` dalında olmalı (zamanlanmış iş akışları yalnızca varsayılan dalda çalışır).
2. GitHub → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions → Portföy verisi ve yayın → Run workflow** ile ilk veriyi çek (ilk çalıştırma 10 yıllık geçmişi indirir, birkaç dakika sürer).
4. Telefonda `https://alcnergen.github.io/Try1/` adresini aç → iPhone: Paylaş → *Ana Ekrana Ekle* / Android: menü → *Ana ekrana ekle*.
5. Ana ekrandaki uygulamayı aç → Ayarlar (⚙︎) → **Bağlantıyı yapıştır** ile sana verilen aktarım bağlantısını yapıştır ya da portföyü elle gir.

> iPhone'da ana ekrandaki uygulama Safari'den ayrı bir depolama alanı kullanabilir; bu yüzden aktarımı ana ekrandaki uygulamanın içinden yapmak en sağlamı.

## Geliştirme

```bash
node --test portfoy/test/*.test.js     # hesaplama ve ayrıştırma testleri
node portfoy/scripts/veri-cek.mjs       # veriyi yerelde çek
npx http-server portfoy -p 8088         # http://localhost:8088
```

Bağımlılık yoktur; grafikler kendi SVG bileşeniyle çizilir.
