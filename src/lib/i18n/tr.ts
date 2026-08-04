import type { Strings } from './types';

export const tr: Strings =
{
    app:
    {
        name: 'Disruptor Proxy',
        tagline: 'Sunucularınız, ölçülmüş.',
        crashTitle: 'Bir şeyler ters gitti',
        crashHint: 'Bu ekran beklenmeyen bir hatayla karşılaştı. Sunucularınız ve ayarlarınız güvende.',
        crashRetry: 'Tekrar dene',
        expandWindow: 'Pencereyi büyüt',
        shrinkWindow: 'Pencereyi küçült',
        minimizeWindow: 'Simge durumuna küçült',
        hideWindow: 'Tepsiye gizle',
        trayShow: 'Disruptor Proxy’yi göster',
        trayQuit: 'Çık'
    },

    nav:
    {
        home: 'Bağlan',
        servers: 'Sunucular',
        routing: 'Yönlendirme',
        settings: 'Ayarlar'
    },

    home:
    {
        title: 'Bağlan',
        subtitle: 'Tek dokunuşla en hızlı sağlıklı sunucuya.',
        disconnected: 'Bağlı değil',
        noServerSelected: 'Başlamak için bir sunucu seçin.',
        switching: 'Geçiliyor…',
        connecting: 'Bağlanıyor…',
        connected: 'Bağlandı',
        disconnecting: 'Bağlantı kesiliyor…',
        failed: 'Bağlantı başarısız',
        disconnect: 'Bağlantıyı kes',
        connectFastest: 'En hızlıya bağlan',
        switchServer: 'Sunucu değiştir'
    },

    status:
    {
        duration: 'Süre',
        upload: 'Yükleme',
        download: 'İndirme',
        transferred: 'Aktarılan',
        exitIp: 'IP adresi',
        refreshIp: 'IP adresini yenile'
    },

    servers:
    {
        title: 'Sunucular',
        empty: 'Henüz sunucu yok.',
        emptyAction: 'Bir abonelik ekleyin veya yapılandırma bağlantısı yapıştırın.',
        countLabel: (count: number) => `${ count.toLocaleString('tr-TR') } sunucu`,
        searchPlaceholder: 'Ad, sunucu, ülke ara…',
        noMatches: 'Bu filtrelere uyan sunucu yok.',
        sort: 'Sıralama',
        sortName: 'Ad',
        sortLatency: 'Gecikme',
        sortCountry: 'Ülke',
        sortSubscription: 'Abonelik',
        select: 'Seç',
        selectAll: 'Tümünü seç',
        selectedLabel: (count: number) => `${ count.toLocaleString('tr-TR') } seçili`,
        deletedLabel: (count: number) => `${ count.toLocaleString('tr-TR') } sunucu silindi`,
        delete: 'Sil',
        cancel: 'İptal',
        favoritesOnly: 'Favoriler',
        protocol: 'Protokol',
        source: 'Kaynak',
        all: 'Tümü',
        allSources: 'Tüm kaynaklar',
        searchSource: 'Kaynak ara',
        test: 'Test',
        testing: (done: number, total: number) =>
            `Test ediliyor ${ done.toLocaleString('tr-TR') } / ${ total.toLocaleString('tr-TR') }`,
        stop: 'Durdur',
        otherServers: 'Diğer sunucular',
        collapseAll: 'Tümünü daralt',
        expandAll: 'Tümünü genişlet',
        groupEmpty: 'Burada henüz sunucu yok',
        activeHere: 'Bağlı sunucu bu grupta',
        actions: 'İşlemler',
        matchCount: (matching, total) => `${ matching } / ${ total }`
    },

    importing:
    {
        progress: (parsed: number, total: number) =>
            `${ total.toLocaleString('tr-TR') } satırın ${ parsed.toLocaleString('tr-TR') } tanesi okunuyor…`,
        added: 'Eklendi',
        duplicates: 'Yinelenen',
        invalid: 'Okunamayan',
        elapsed: 'Sürdü',
        duplicatesHint: 'Farklı adlarla listelenen aynı sunucular tek kayıtta birleştirildi.',
        title: 'Sunucu içe aktar',
        openAction: 'İçe aktar',
        placeholder: 'Yapılandırma bağlantıları, abonelik URL’si veya base64 listesi yapıştırın…',
        paste: 'Yapıştır',
        fromClipboard: 'Panodan',
        fromFile: 'Dosyadan',
        scanQr: 'QR tara',
        qrScanning: 'Kamerayı QR koduna doğrultun…',
        submit: 'İçe aktar',
        invalidDetail: 'Okunamayan satırlar',
        lineLabel: (line: number) => `Satır ${ line }`
    },

    subscriptions:
    {
        add: 'Abonelik ekle',
        addTitle: 'Abonelik ekle',
        editTitle: 'Aboneliği düzenle',
        urlLabel: 'Abonelik URL’si',
        urlPlaceholder: 'https://…',
        nameLabel: 'Ad',
        namePlaceholder: 'İsteğe bağlı — varsayılan olarak sunucu adı',
        intervalLabel: 'Otomatik güncelleme',
        intervalManual: 'Elle',
        intervalHourly: 'Saatlik',
        intervalDaily: 'Günlük',
        save: 'Kaydet',
        cancel: 'İptal',
        update: 'Güncelle',
        updating: 'Güncelleniyor…',
        delete: 'Sil',
        countLabel: (count: number) => `${ count.toLocaleString('tr-TR') } sunucu`,
        updatedAgo: (text: string) => `Güncellendi: ${ text }`,
        justNow: 'az önce',
        minutesAgo: (n: number) => `${ n } dk önce`,
        hoursAgo: (n: number) => `${ n } sa önce`,
        daysAgo: (n: number) => `${ n } gün önce`,
        deleteTitle: 'Aboneliği sil',
        deletePrompt: (name: string) => `“${ name }” aboneliğinin sunucularına ne olsun?`,
        deleteRemoveConfigs: 'Sunucularını sil',
        deleteKeepConfigs: 'Yönetimsiz olarak tut',
        remaining: 'Kalan',
        daysLeft: (n: number) => `${ n } gün kaldı`,
        expired: 'Süresi doldu'
    },

    routing:
    {
        title: 'Yönlendirme',
        empty: 'Trafiğin vekil ile doğrudan bağlantı arasında nasıl bölüneceğini seçin.',
        subtitle: 'Neyin vekilden geçeceğine, neyin doğrudan kalacağına karar verin.',
        presets: 'Modlar',
        customName: 'Özel',
        customDesc: 'Kendi yazdığınız kurallar.',
        bypassCountry: 'Ülkeye göre atla',
        bypassCountryHint: 'Bulunduğunuz yeri seçin: o ülkenin siteleri ve IP’leri doğrudan kalır, geri kalan her şey vekilden geçer.',
        countryModeLabel: 'Yönlendirme modu',
        countryModeSmart: 'Akıllı',
        countryModeBypass: 'Atla',
        countryModeSmartHint: 'Reklamları engelle, yerel ağ ve o ülkenin siteleri doğrudan kalsın, kalanı vekilden geçsin.',
        rulesHeader: 'Kurallar',
        rulesHint: 'Yukarıdan aşağıya denetlenir — eşleşen ilk kural kazanır.',
        addRule: 'Kural ekle',
        editRule: 'Kuralı düzenle',
        matchType: 'Eşleşme',
        matchValue: 'Değer',
        matchValuePlaceholder: 'örn. .ir, category-ads-all, 192.168.0.0/16',
        action: 'Eylem',
        actionProxy: 'Vekil',
        actionDirect: 'Doğrudan',
        actionBlock: 'Engelle',
        save: 'Kaydet',
        cancel: 'İptal',
        delete: 'Sil',
        moveUp: 'Yukarı taşı',
        moveDown: 'Aşağı taşı',
        presetGlobalName: 'Küresel',
        presetGlobalDesc: 'Tüm trafiği vekilden geçir.',
        presetDirectLanName: 'Yerel ağ doğrudan',
        presetDirectLanDesc: 'Yalnızca yerel ağ doğrudan; kalan her şey vekilden.',
        presetCustomName: 'Özel',
        typeDomainSuffix: 'Alan adı şununla biter',
        typeDomain: 'Tam alan adı',
        typeDomainKeyword: 'Alan adı şunu içerir',
        typeGeosite: 'Site kategorisi',
        typeGeoip: 'IP ülkesi',
        typeIpCidr: 'IP aralığı',
        typeProcess: 'Uygulama',
        descDomainsEndingIn: (value: string) => `${ value } ile biten alan adları`,
        descExactDomain: (value: string) => value,
        descDomainsContaining: (value: string) => `“${ value }” içeren alan adları`,
        descIranianSites: 'İran siteleri',
        descAdsTrackers: 'Reklamlar ve izleyiciler',
        descChineseSites: 'Çin siteleri',
        descIranianIps: 'İran IP adresleri',
        descLocalNetwork: 'Yerel ağ',
        descIpRange: (value: string) => `${ value } içindeki IP’ler`,
        descGeosite: (value: string) => `${ value } siteleri`,
        descGeoip: (value: string) => `${ value.toUpperCase() } IP adresleri`,
        descApp: (value: string) => `“${ value }” uygulaması`,
        descEverythingElse: 'Geri kalan her şey'
    },

    settings:
    {
        title: 'Ayarlar',
        subtitle: 'Dil, tema ve uygulama davranışı.',
        appearance: 'Görünüm',
        theme: 'Tema',
        themeSystem: 'Sistem',
        themeLight: 'Açık',
        themeDark: 'Koyu',
        language: 'Dil',
        about: 'Hakkında',
        version: 'Sürüm',
        checkUpdate: 'Güncellemeleri denetle',
        checking: 'Denetleniyor…',
        upToDate: 'En son sürümdesiniz.',
        updateAvailable: (version: string) => `${ version } sürümü mevcut.`,
        installUpdate: 'Güncellemeyi yükle',
        installingUpdate: 'Güncelleme yükleniyor…',
        geoFiles: 'Geo dosyaları',
        geoFilesDesc: 'Ülke ve site kategorisi yönlendirme kuralları için veritabanları. Atlama ve engelleme kurallarının doğru kalması için güncelleyin.',
        geoInstalled: 'Yüklü',
        geoMissing: 'Yüklü değil',
        updateGeoFiles: 'Geo dosyalarını güncelle',
        updatingGeoFiles: 'İndiriliyor…',
        geoFilesUpdated: 'Geo dosyaları güncel.'
    },

    detail:
    {
        protocol: 'Protokol',
        transport: 'Taşıma',
        security: 'Güvenlik',
        latency: 'Gecikme',
        successRate: 'Başarı oranı',
        source: 'Kaynak',
        unmanaged: 'Bir abonelikten değil',
        health: 'Sağlık',
        untested: 'Henüz test edilmedi.',
        lastError: 'Son hata',
        connect: 'Bağlan',
        disconnect: 'Bağlantıyı kes',
        copyLink: 'Bağlantıyı kopyala',
        copied: 'Kopyalandı',
        addFavorite: 'Favorilere ekle',
        removeFavorite: 'Favorilerden çıkar',
        delete: 'Sil',
        ping: 'Ping',
        pinging: 'Ping atılıyor…',
        notSupported: 'Bu protokol mevcut çekirdek tarafından desteklenmiyor.',
        emptyTitle: 'Sunucu seçilmedi',
        emptyHint: 'Ayrıntılarını görmek için listeden bir sunucu seçin.'
    },

    ping:
    {
        proxyLabel: 'Proxy'
    },

    common:
    {
        close: 'Bitti',
        dismiss: 'Kapat',
        serverNotFound: 'Sunucu bulunamadı. Silinmiş olabilir.'
    }
};
