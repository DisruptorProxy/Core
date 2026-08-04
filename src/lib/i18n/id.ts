import type { Strings } from './types';

export const id: Strings =
{
    app:
    {
        name: 'Disruptor Proxy',
        tagline: 'Server Anda, terukur.',
        crashTitle: 'Terjadi kesalahan',
        crashHint: 'Layar ini mengalami galat tak terduga. Server dan pengaturan Anda aman.',
        crashRetry: 'Coba lagi',
        expandWindow: 'Perbesar jendela',
        shrinkWindow: 'Perkecil jendela',
        minimizeWindow: 'Minimalkan jendela',
        hideWindow: 'Sembunyikan ke baki',
        trayShow: 'Tampilkan Disruptor Proxy',
        trayQuit: 'Keluar'
    },

    nav:
    {
        home: 'Sambungkan',
        servers: 'Server',
        routing: 'Perutean',
        settings: 'Pengaturan'
    },

    home:
    {
        title: 'Sambungkan',
        subtitle: 'Satu ketukan ke server sehat tercepat.',
        disconnected: 'Tidak tersambung',
        noServerSelected: 'Pilih server untuk memulai.',
        switching: 'Beralih…',
        connecting: 'Menyambungkan…',
        connected: 'Tersambung',
        disconnecting: 'Memutuskan…',
        failed: 'Sambungan gagal',
        disconnect: 'Putuskan',
        connectFastest: 'Sambung ke tercepat',
        switchServer: 'Ganti server'
    },

    status:
    {
        duration: 'Durasi',
        upload: 'Unggah',
        download: 'Unduh',
        transferred: 'Ditransfer',
        exitIp: 'Alamat IP',
        refreshIp: 'Segarkan alamat IP'
    },

    servers:
    {
        title: 'Server',
        empty: 'Belum ada server.',
        emptyAction: 'Tambahkan langganan atau tempel tautan konfigurasi.',
        countLabel: (count: number) => `${ count.toLocaleString('id-ID') } server`,
        searchPlaceholder: 'Cari nama, host, negara…',
        noMatches: 'Tidak ada server yang cocok dengan filter ini.',
        sort: 'Urutan',
        sortName: 'Nama',
        sortLatency: 'Latensi',
        sortCountry: 'Negara',
        sortSubscription: 'Langganan',
        select: 'Pilih',
        selectAll: 'Pilih semua',
        selectedLabel: (count: number) => `${ count.toLocaleString('id-ID') } dipilih`,
        deletedLabel: (count: number) => `${ count.toLocaleString('id-ID') } server dihapus`,
        delete: 'Hapus',
        cancel: 'Batal',
        favoritesOnly: 'Favorit',
        protocol: 'Protokol',
        source: 'Sumber',
        all: 'Semua',
        allSources: 'Semua sumber',
        searchSource: 'Cari sumber',
        test: 'Uji',
        testing: (done: number, total: number) =>
            `Menguji ${ done.toLocaleString('id-ID') } / ${ total.toLocaleString('id-ID') }`,
        stop: 'Berhenti',
        otherServers: 'Server lainnya',
        collapseAll: 'Tutup semua',
        expandAll: 'Buka semua',
        groupEmpty: 'Belum ada server di sini',
        activeHere: 'Server yang terhubung ada di grup ini',
        actions: 'Tindakan',
        matchCount: (matching, total) => `${ matching } / ${ total }`
    },

    importing:
    {
        progress: (parsed: number, total: number) =>
            `Membaca ${ parsed.toLocaleString('id-ID') } dari ${ total.toLocaleString('id-ID') } baris…`,
        added: 'Ditambahkan',
        duplicates: 'Duplikat',
        invalid: 'Tak terbaca',
        elapsed: 'Memakan waktu',
        duplicatesHint: 'Server identik dengan nama berbeda digabung menjadi satu.',
        title: 'Impor server',
        openAction: 'Impor',
        placeholder: 'Tempel tautan konfigurasi, URL langganan, atau daftar base64…',
        paste: 'Tempel',
        fromClipboard: 'Dari papan klip',
        fromFile: 'Dari berkas',
        scanQr: 'Pindai QR',
        qrScanning: 'Arahkan kamera ke kode QR…',
        submit: 'Impor',
        invalidDetail: 'Baris tak terbaca',
        lineLabel: (line: number) => `Baris ${ line }`
    },

    subscriptions:
    {
        add: 'Tambah langganan',
        addTitle: 'Tambah langganan',
        editTitle: 'Ubah langganan',
        urlLabel: 'URL langganan',
        urlPlaceholder: 'https://…',
        nameLabel: 'Nama',
        namePlaceholder: 'Opsional — bawaan mengikuti host',
        intervalLabel: 'Pembaruan otomatis',
        intervalManual: 'Manual',
        intervalHourly: 'Tiap jam',
        intervalDaily: 'Harian',
        save: 'Simpan',
        cancel: 'Batal',
        update: 'Perbarui',
        updating: 'Memperbarui…',
        delete: 'Hapus',
        countLabel: (count: number) => `${ count.toLocaleString('id-ID') } server`,
        updatedAgo: (text: string) => `Diperbarui ${ text }`,
        justNow: 'baru saja',
        minutesAgo: (n: number) => `${ n } mnt lalu`,
        hoursAgo: (n: number) => `${ n } jam lalu`,
        daysAgo: (n: number) => `${ n } hari lalu`,
        deleteTitle: 'Hapus langganan',
        deletePrompt: (name: string) => `Apa yang terjadi pada server dari “${ name }”?`,
        deleteRemoveConfigs: 'Hapus server-nya',
        deleteKeepConfigs: 'Simpan sebagai tak terkelola',
        remaining: 'Tersisa',
        daysLeft: (n: number) => `${ n } hari lagi`,
        expired: 'Kedaluwarsa'
    },

    routing:
    {
        title: 'Perutean',
        empty: 'Pilih cara membagi lalu lintas antara proxy dan sambungan langsung.',
        subtitle: 'Tentukan mana yang lewat proxy dan mana yang langsung.',
        presets: 'Mode',
        customName: 'Kustom',
        customDesc: 'Aturan yang Anda tulis sendiri.',
        bypassCountry: 'Lewati per negara',
        bypassCountryHint: 'Pilih lokasi Anda: situs dan IP negara itu tetap langsung, sisanya lewat proxy.',
        countryModeLabel: 'Mode perutean',
        countryModeSmart: 'Cerdas',
        countryModeBypass: 'Lewati',
        countryModeSmartHint: 'Blokir iklan, jaringan lokal dan situs negara itu langsung, sisanya lewat proxy.',
        rulesHeader: 'Aturan',
        rulesHint: 'Diperiksa dari atas ke bawah — aturan pertama yang cocok menang.',
        addRule: 'Tambah aturan',
        editRule: 'Ubah aturan',
        matchType: 'Pencocokan',
        matchValue: 'Nilai',
        matchValuePlaceholder: 'mis. .ir, category-ads-all, 192.168.0.0/16',
        action: 'Tindakan',
        actionProxy: 'Proxy',
        actionDirect: 'Langsung',
        actionBlock: 'Blokir',
        save: 'Simpan',
        cancel: 'Batal',
        delete: 'Hapus',
        moveUp: 'Naik',
        moveDown: 'Turun',
        presetGlobalName: 'Global',
        presetGlobalDesc: 'Semua lalu lintas lewat proxy.',
        presetDirectLanName: 'LAN langsung',
        presetDirectLanDesc: 'Hanya jaringan lokal yang langsung; sisanya lewat proxy.',
        presetCustomName: 'Kustom',
        typeDomainSuffix: 'Domain berakhiran',
        typeDomain: 'Domain persis',
        typeDomainKeyword: 'Domain mengandung',
        typeGeosite: 'Kategori situs',
        typeGeoip: 'Negara IP',
        typeIpCidr: 'Rentang IP',
        typeProcess: 'Aplikasi',
        descDomainsEndingIn: (value: string) => `Domain berakhiran ${ value }`,
        descExactDomain: (value: string) => value,
        descDomainsContaining: (value: string) => `Domain mengandung “${ value }”`,
        descIranianSites: 'Situs Iran',
        descAdsTrackers: 'Iklan & pelacak',
        descChineseSites: 'Situs Tiongkok',
        descIranianIps: 'Alamat IP Iran',
        descLocalNetwork: 'Jaringan lokal',
        descIpRange: (value: string) => `IP dalam ${ value }`,
        descGeosite: (value: string) => `Situs ${ value }`,
        descGeoip: (value: string) => `Alamat IP ${ value.toUpperCase() }`,
        descApp: (value: string) => `Aplikasi “${ value }”`,
        descEverythingElse: 'Semua yang lain'
    },

    settings:
    {
        title: 'Pengaturan',
        subtitle: 'Bahasa, tema, dan perilaku aplikasi.',
        appearance: 'Tampilan',
        theme: 'Tema',
        themeSystem: 'Sistem',
        themeLight: 'Terang',
        themeDark: 'Gelap',
        language: 'Bahasa',
        about: 'Tentang',
        version: 'Versi',
        checkUpdate: 'Periksa pembaruan',
        checking: 'Memeriksa…',
        upToDate: 'Anda memakai versi terbaru.',
        updateAvailable: (version: string) => `Versi ${ version } tersedia.`,
        installUpdate: 'Pasang pembaruan',
        installingUpdate: 'Memasang pembaruan…',
        geoFiles: 'Berkas geo',
        geoFilesDesc: 'Basis data untuk aturan perutean negara dan kategori situs. Perbarui agar aturan lewati dan blokir tetap akurat.',
        geoInstalled: 'Terpasang',
        geoMissing: 'Belum terpasang',
        updateGeoFiles: 'Perbarui berkas geo',
        updatingGeoFiles: 'Mengunduh…',
        geoFilesUpdated: 'Berkas geo sudah terbaru.'
    },

    detail:
    {
        protocol: 'Protokol',
        transport: 'Transpor',
        security: 'Keamanan',
        latency: 'Latensi',
        successRate: 'Tingkat keberhasilan',
        source: 'Dari',
        unmanaged: 'Bukan dari langganan',
        health: 'Kesehatan',
        untested: 'Belum diuji.',
        lastError: 'Galat terakhir',
        connect: 'Sambungkan',
        disconnect: 'Putuskan',
        copyLink: 'Salin tautan',
        copied: 'Tersalin',
        addFavorite: 'Tambah ke favorit',
        removeFavorite: 'Hapus favorit',
        delete: 'Hapus',
        ping: 'Ping',
        pinging: 'Melakukan ping…',
        notSupported: 'Protokol ini tidak didukung inti saat ini.',
        emptyTitle: 'Belum ada server dipilih',
        emptyHint: 'Pilih server dari daftar untuk melihat detailnya.'
    },

    ping:
    {
        proxyLabel: 'Proxy'
    },

    common:
    {
        close: 'Selesai',
        dismiss: 'Tutup',
        serverNotFound: 'Server tidak ditemukan. Mungkin sudah dihapus.'
    }
};
