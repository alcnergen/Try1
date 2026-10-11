# Vitrin

Pazaryeri satıcıları için yapay zeka destekli ürün görseli ve ilan stüdyosu.
Telefonla çekilmiş bir ürün fotoğrafını stüdyo kalitesinde bir görsele ve Trendyol, Hepsiburada, Amazon ya da Instagram'a hazır bir ilana dönüştürür.

Bu depo üç katmandan oluşur:

| Katman | Adres | Açıklama |
|---|---|---|
| Tanıtım sitesi | `/` | Statik tek sayfa (`index.html`, `css/`, `js/`, `img/`) |
| Giriş | `/giris` | E-posta + şifre; demo hesabı ya da herhangi bir e-posta ile giriş |
| Panel ve üretim aracı | `/panel` | Yalnızca oturum açıkken erişilir; araç panelin içinde açılır |

## Kurulum

```bash
ONNXRUNTIME_NODE_INSTALL=skip npm ci   # CPU sürümü yeterli; GPU ek indirmesini atlar
npm run model                          # segmentasyon modelini indirir (~170 MB, SHA-256 doğrulamalı)
npm start                              # http://localhost:3000
```

Node.js 20+ gerekir. Demo hesabı: **demo@vitrin.app / vitrin2026**. Sunucu ilk açılışta bu hesap için örnek fotoğraflardan 4 gerçek üretim yapar.
Bilinmeyen bir e-posta ile ilk girişte hesap otomatik açılır; sonraki girişlerde aynı şifre istenir.

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | HTTP portu |
| `NODE_ENV` | — | `production` olduğunda çerezler `Secure` işaretlenir, statik dosyalar önbelleğe alınır |
| `DATA_DIR` | `./data` | Veri deposu (`db.json`) ve kullanıcı dosyaları |
| `MODEL_PATH` | `./models/isnet-general-use.onnx` | Segmentasyon modeli |
| `ANTHROPIC_API_KEY` | — | Tanımlıysa ilan metnini Claude, ürün görselini görerek yazar. Yoksa kural tabanlı şablon motoru kullanılır |
| `LISTING_PROVIDER` | — | `template` verilirse anahtar olsa bile şablon motoru kullanılır |
| `JOB_CONCURRENCY` | `1` | Aynı anda çalışan üretim sayısı |
| `INFERENCE_THREADS` | CPU sayısı (en fazla 4) | Model çıkarımında kullanılan iş parçacığı |

## Üretim hattı

`POST /api/jobs` bir iş oluşturur ve hemen `202` döner. İstemci `GET /api/jobs/:id` ile ilerlemeyi yoklar (polling). İşler sırayla çalıştırılır:

1. **Hazırlık:** EXIF yönü düzeltilir, görüntü en fazla 1600 piksele indirilir.
2. **Ürün ayırma:** IS-Net (ONNX Runtime, CPU) ürün maskesini çıkarır.
3. **Işık ve renk:** Arka plandan renk kayması tahmin edilir (sınırlı gri-dünya düzeltmesi), pozlama dengelenir. Baskın renk, renk histogramından bulunup Türkçe renk adına eşlenir.
4. **Sahne:** Seçilen stilin arka planı (SVG → raster) kurulur, yumuşak gölge ve zemin gölgesi eklenir. Ürün, pazaryeri ölçüsüne yerleştirilir.
5. **Dışa aktarım:** `result.jpg`, aynı hizada `before.jpg` (karşılaştırma için), `thumb.webp` ve şeffaf `cutout.png`.
6. **İlan metni:** Başlık, açıklama maddeleri, özellikler ve anahtar kelimeler. Claude ya da şablon motoru kullanılır.

Tipik süre 4–10 saniyedir (CPU'ya bağlı). Claude ile metin üretimi birkaç saniye daha ekler.

"Yeniden üret" aynı girdiyi yeniden yüklemeden kullanır ve yeni bir varyant ister: farklı arka plan yorumu ve farklı anlatım. Her üretim aylık görsel hakkından düşer.

## API

| Uç | Açıklama |
|---|---|
| `POST /api/auth/login` | `{ email, password }` → oturum çerezi |
| `POST /api/auth/logout` | Oturumu kapatır |
| `GET /api/me` | Kullanıcı, istatistikler, seçenek listeleri, motor durumu |
| `POST /api/jobs` | Çok parçalı form: `image` + `options` (JSON). Ya da JSON: `{ sample, ...options }`. Ya da `{ fromJobId, overrides? }` (yeniden üretim) |
| `GET /api/jobs/:id` | Durum, aşama, sıra, sonuç |
| `POST /api/jobs/:id/save` | Sonucu kütüphaneye kaydeder; güncel istatistikleri döner |
| `GET /api/works` · `DELETE /api/works/:id` | Kütüphane |
| `GET /files/:jobId/:name` | Yalnızca sahibine açık üretim dosyaları (`?download=1` ile indirme) |

Güvenlik: scrypt ile parola özeti, sunucu tarafında saklanan oturum jetonu (HttpOnly, SameSite=Lax), durum değiştiren isteklerde Origin denetimi, CSP ve temel güvenlik başlıkları, kullanıcı başına en fazla 3 eşzamanlı iş, 15 MB yükleme sınırı ve sunucuda format doğrulaması.

## Yapı

```
index.html, css/, js/, img/, fonts/   Tanıtım sitesi (css/tokens.css site ve uygulama için ortak)
server/index.js                       Express uygulaması, rotalar, demo verisi
server/auth.js, db.js, jobs.js        Oturum, JSON veri deposu, iş kuyruğu
server/pipeline/                      segment.js, process.js, backgrounds.js, color.js, listing.js
server/views/                         giris.html, panel.html
app/                                  app.css, giris.js, panel.js, samples/ (örnek fotoğraflar)
scripts/download-model.js             Model indirme
test/                                 node:test birim testleri (npm test)
tools/gorsel-uretici/                 Tanıtım sitesindeki örnek görselleri üreten betikler
```

## Bilinen sınırlar (MVP)

- Veri deposu tek süreçli bir JSON dosyasıdır. Birden fazla sunucu ya da yüksek trafik için PostgreSQL ve nesne depolama (S3 vb.) gerekir.
- İş kuyruğu bellektedir. Sunucu yeniden başlarsa yarım kalan işler "başarısız" olarak işaretlenir.
- Bilinmeyen e-posta ile giriş hesap açar (demo davranışı). Gerçek kayıtta e-posta doğrulaması ve şifre sıfırlama eklenmeli.
- Hayalet manken ve yapay modelle giydirme henüz yok. Mevcut stiller ürünün piksellerini değiştirmez, yalnızca arka planı, ışığı ve sunumu düzenler.

## Tanıtım sitesi için notlar

- Hero'daki puan/kullanıcı sayısı ve müşteri yorumları yer tutucudur; yayından önce gerçek ve izinli verilerle değiştirilmelidir.
- `img/` içindeki görseller illüstrasyondur. `tools/gorsel-uretici` ile yeniden üretilebilir (`python3 gen.py && node render.js && ./export.sh`).
- `vitrin.app` alan adı yer tutucudur.
