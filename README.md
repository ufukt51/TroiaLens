# TroiaLens

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22.12+-5FA04E?logo=nodedotjs&logoColor=white)
![Tarayıcıda çalışır](https://img.shields.io/badge/sunucu-yok-0f9e8f)
![License](https://img.shields.io/github/license/ufukt51/TroiaLens)

Canias ERP'nin oluşturduğu **TROIA CODE EXECUTION TRACE** dosyalarını okunur hâle getiren bir web uygulaması.
Trace dosyasını açtığınızda hangi metodun ne kadar sürdüğünü, hangi sorguların çalıştığını ve sorunların
nerede olduğunu tek ekranda görürsünüz.

Analiz tamamen tarayıcınızda yapılır. Dosyanız hiçbir yere gönderilmez.

## Nasıl kullanılır?

Trace dosyasını (`.trace`, `.txt` veya `.log`) ana sayfaya sürükleyin ya da seçin. Elinizde dosya yoksa
**Örnek trace ile dene** düğmesiyle uygulamayı deneyebilirsiniz.

## Neler yapabilirsiniz?

- **Özet:** Toplam süre, sorgu sayısı ve en uzun çağrı derinliği gibi temel göstergeler. Bulunan sorunlar önerilerle birlikte listelenir.
- **Çağrı ağacı:** Event, metot ve sınıf çağrılarını iç içe görürsünüz. Her satırda süre ve sorgu sayısı görünür.
  Ağacın kaç seviye açılacağını ↑ ve ↓ düğmeleriyle seçebilirsiniz. Ağaçta arama yapabilir, yalnızca SQL satırlarını
  ya da belirli bir süreyi aşan satırları gösterebilirsiniz.
- **Kaynak görünümü:** Ağaçta seçtiğiniz satır, trace dosyasının içinde işaretlenmiş olarak gösterilir.
- **Satır ayrıntısı:** Bir satıra çift tıkladığınızda kodu, değerlendirmesini ve veritabanına giden sorguyu görürsünüz.
  Ayrıntı alt bölmede ya da sağdan kayan panelde açılabilir.
- **SQL:** SELECT, INSERT, UPDATE ve DELETE sorguları türlerine göre ayrılır. Aynı sorgunun tekrarları tek satırda
  toplanır. Veritabanına giden sorgularla önbellekten gelenler ayrı sayılır.
- **Tekrarlar:** Bir döngünün içinde defalarca çalışan sorguları ve metotları bulur (N+1 sorunu).
- **Mesajlar:** İşlem sırasında verilen hata, uyarı, bilgi ve başarı mesajları.
- **Hata/Uyarı:** Trace'te geçen hatalar, uyarılar ve eksik parametreler tek bir listede.
- Ham dosya görünümü, geçmiş (yalnızca bu tarayıcıda saklanır), açık ve koyu tema.
- **Büyük dosyalar:** Dosya parça parça okunur, tamamı belleğe alınmaz; 1 GB'ı aşan trace'ler de açılır. Ham dosya
  ve kaynak görünümü satırları ekrana geldikçe dosyadan okur. Çok uzun satır değerleri ayrıntı panelinde kısaltılır;
  tamamı dosyada durur. 400 MB'tan büyük dosyalar geçmişe kaydedilmez; 60 MB'a kadar olanların içeriği de saklanır.

## Ekran görüntüleri

Görüntülerdeki veriler örnektir, gerçek değildir.

![Özet](docs/screenshots/overview.png)

| | |
|---|---|
| ![Ana sayfa](docs/screenshots/home.png) | ![Çağrı ağacı ve satır ayrıntısı](docs/screenshots/call-tree.png) |
| Ana sayfa | Çağrı ağacı, kaynak görünümü ve satır ayrıntısı |
| ![SQL](docs/screenshots/sql.png) | ![Tekrarlar](docs/screenshots/repeats.png) |
| SQL | Tekrarlar |
| ![Koyu tema](docs/screenshots/overview-dark.png) | |
| Koyu tema | |

## Kendi bilgisayarınızda çalıştırma

Node.js 22.12 veya daha yeni bir sürüm gerekir.

Kodu git ile indirin:

```bash
git clone https://github.com/ufukt51/TroiaLens.git
cd TroiaLens
```

Git kullanmıyorsanız kodu [zip olarak indirip](https://github.com/ufukt51/TroiaLens/archive/refs/heads/main.zip)
bir klasöre açın ve komutları o klasörde çalıştırın.

Ardından:

```bash
npm install        # bağımlılıkları yükler
npm run dev        # geliştirme sunucusunu başlatır
npm run build      # yayınlanacak dosyaları dist/ klasöründe oluşturur
npm run preview    # dist/ klasörünü yerelde açar
npm test           # örnek dosyalarla testleri çalıştırır
```

`dist/` klasörünü herhangi bir web sunucusunda (IIS, nginx, GitHub Pages vb.) yayınlayabilirsiniz.
`index.html` dosyasına çift tıklayarak açmak işe yaramaz; uygulama bir web sunucusu üzerinden açılmalıdır.
