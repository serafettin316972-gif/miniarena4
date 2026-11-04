# MINI ARENA 4 — Online

4 kişiye kadar oynanan, tarayıcı tabanlı mini oyun koleksiyonu. Bu sürüm LAN adresi kullanmaz; sunucu internette barındırılır.

## Nasıl çalışır?

- Oda sahibi siteyi açıp **ODA OLUŞTUR** der.
- Sunucu her yeni oda için rastgele 6 karakterli kod üretir.
- Arkadaşlar aynı siteyi açıp isim ve kodla katılır.
- En fazla 4 oyuncu ve tek aktif oda bulunur.
- Altı mod: Tank Savaşı, Sumo Güreş, İtişme, Top Kapmaca, Elmas Avı, Hayatta Kal.
- Arkadaşların yalnızca tarayıcı kullanır; Node.js veya indirme gerekmez.

## Yerel test

Node.js 18+ gerekir (yalnızca geliştirici/host makinesinde):

```bash
npm start
```

Sonra `http://localhost:10000` adresini aç.

## Render'a yayınlama

Bu proje `render.yaml` Blueprint dosyası ile gelir.

1. Projeyi bir GitHub deposuna yükle.
2. Render hesabında **New → Blueprint** seç.
3. GitHub deposunu bağla ve `render.yaml` dosyasını seç.
4. Ücretsiz planı onayla ve Deploy et.
5. Render sana `https://...onrender.com` biçiminde genel site adresi verir. Arkadaşlar bu adresi açar; oda kodunu seninle paylaşırlar.

Render dokümanı: https://render.com/docs/infrastructure-as-code

## Ücretsiz planla ilgili notlar

- Render ücretsiz web servisleri 15 dakika istek/bağlantı almazsa uykuya geçer; bir sonraki açılış yaklaşık bir dakika sürebilir.
- Render ücretsiz servisler yeniden başlatılabilir. Oda verisi bellekte tutulduğu için sunucu yeniden başlarsa oda ve davet kodu sıfırlanır.
- Bu küçük sürüm tek servis / tek aktif oda / dört oyuncu için tasarlandı; ölçekli veya kalıcı hizmet değildir.
- Okul ağı `.onrender.com` alan adını da filtreleyebilir. Yayınlamak filtreyi otomatik aşmaz.

## Güvenlik ve gizlilik

Davet kodunu yalnızca oynamak istediğin kişilerle paylaş. İsimler sadece geçerli oyun oturumu boyunca gösterilir; hesap veya parola sistemi yoktur.
