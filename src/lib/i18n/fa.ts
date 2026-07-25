import type { Strings } from './types';

export const fa: Strings =
{
    app:
    {
        name: 'The Disruptor Proxy',
        tagline: 'سرورهای شما، اندازه‌گیری‌شده.',
        crashTitle: 'مشکلی پیش آمد',
        crashHint: 'این صفحه با خطای غیرمنتظره‌ای مواجه شد. سرورها و تنظیمات شما در امان هستند.',
        crashRetry: 'تلاش دوباره',
        expandWindow: 'بزرگ‌کردن پنجره',
        shrinkWindow: 'کوچک‌کردن پنجره',
        minimizeWindow: 'کمینه‌کردن پنجره',
        hideWindow: 'پنهان‌کردن در سینی سیستم',
        trayShow: 'نمایش The Disruptor Proxy',
        trayQuit: 'خروج'
    },

    nav:
    {
        home: 'اتصال',
        servers: 'سرورها',
        routing: 'مسیریابی',
        settings: 'تنظیمات'
    },

    home:
    {
        title: 'اتصال',
        subtitle: 'یک ضربه تا سریع‌ترین سرور سالم.',
        disconnected: 'متصل نیستید',
        noServerSelected: 'برای شروع یک سرور انتخاب کنید.',
        switching: 'در حال تعویض…',
        connecting: 'در حال اتصال…',
        connected: 'متصل',
        disconnecting: 'در حال قطع…',
        failed: 'اتصال ناموفق',
        disconnect: 'قطع اتصال',
        connectFastest: 'اتصال به سریع‌ترین',
        switchServer: 'تعویض سرور'
    },

    status:
    {
        duration: 'مدت',
        upload: 'آپلود',
        download: 'دانلود',
        transferred: 'داده منتقل‌شده'
    },

    servers:
    {
        title: 'سرورها',
        empty: 'هنوز سروری ندارید.',
        emptyAction: 'یک اشتراک اضافه کنید یا لینک کانفیگ را بچسبانید.',
        // Persian numerals: a count of servers is read text, not a measured value,
        // so it is localized. Latency and ports stay Latin digits in the readouts.
        countLabel: (count: number) => `${ count.toLocaleString('fa-IR') } سرور`,
        searchPlaceholder: 'جستجوی نام، میزبان، کشور…',
        noMatches: 'سروری با این فیلترها یافت نشد.',
        sort: 'ترتیب',
        sortName: 'نام',
        sortLatency: 'تأخیر',
        sortCountry: 'کشور',
        sortSubscription: 'اشتراک',
        select: 'انتخاب',
        selectAll: 'انتخاب همه',
        selectedLabel: (count: number) => `${ count.toLocaleString('fa-IR') } انتخاب‌شده`,
        deletedLabel: (count: number) => `${ count.toLocaleString('fa-IR') } سرور حذف شد`,
        delete: 'حذف',
        cancel: 'انصراف',
        favoritesOnly: 'برگزیده‌ها',
        protocol: 'پروتکل',
        source: 'منبع',
        all: 'همه',
        allSources: 'همه منابع',
        searchSource: 'جستجوی منابع',
        test: 'تست',
        testing: (done: number, total: number) =>
            `تست ${ done.toLocaleString('fa-IR') } / ${ total.toLocaleString('fa-IR') }`,
        stop: 'توقف',
        otherServers: 'سایر سرورها',
        collapseAll: 'بستن همه',
        expandAll: 'باز کردن همه',
        groupEmpty: 'هنوز سروری اینجا نیست',
        activeHere: 'سرور متصل در این گروه است',
        actions: 'اقدامات',
        matchCount: (matching, total) => `${ matching } / ${ total }`
    },

    importing:
    {
        progress: (parsed: number, total: number) =>
            `خواندن ${ parsed.toLocaleString('fa-IR') } از ${ total.toLocaleString('fa-IR') } خط…`,
        added: 'افزوده‌شده',
        duplicates: 'تکراری',
        invalid: 'ناخوانا',
        elapsed: 'زمان',
        duplicatesHint: 'سرورهای یکسان که با نام‌های متفاوت فهرست شده بودند، در یکی ادغام شدند.',
        title: 'دریافت سرورها',
        openAction: 'دریافت',
        placeholder: 'لینک کانفیگ‌ها، نشانی اشتراک، یا فهرست base64 را بچسبانید…',
        paste: 'چسباندن',
        fromClipboard: 'از کلیپ‌بورد',
        fromFile: 'از فایل',
        scanQr: 'اسکن QR',
        qrScanning: 'دوربین را روی کد QR بگیرید…',
        submit: 'دریافت',
        invalidDetail: 'خط‌های ناخوانا',
        lineLabel: (line: number) => `خط ${ line.toLocaleString('fa-IR') }`
    },

    subscriptions:
    {
        add: 'افزودن اشتراک',
        addTitle: 'افزودن اشتراک',
        editTitle: 'ویرایش اشتراک',
        urlLabel: 'نشانی اشتراک',
        urlPlaceholder: 'https://…',
        nameLabel: 'نام',
        namePlaceholder: 'اختیاری — به‌صورت پیش‌فرض میزبان',
        intervalLabel: 'به‌روزرسانی خودکار',
        intervalManual: 'دستی',
        intervalHourly: 'ساعتی',
        intervalDaily: 'روزانه',
        save: 'ذخیره',
        cancel: 'انصراف',
        update: 'به‌روزرسانی',
        updating: 'در حال به‌روزرسانی…',
        delete: 'حذف',
        countLabel: (count: number) => `${ count.toLocaleString('fa-IR') } سرور`,
        updatedAgo: (text: string) => `به‌روزرسانی ${ text }`,
        justNow: 'همین حالا',
        minutesAgo: (n: number) => `${ n.toLocaleString('fa-IR') } دقیقه پیش`,
        hoursAgo: (n: number) => `${ n.toLocaleString('fa-IR') } ساعت پیش`,
        daysAgo: (n: number) => `${ n.toLocaleString('fa-IR') } روز پیش`,
        deleteTitle: 'حذف اشتراک',
        deletePrompt: (name: string) => `سرورهای «${ name }» چه شوند؟`,
        deleteRemoveConfigs: 'حذف سرورهایش',
        deleteKeepConfigs: 'نگه‌داشتن به‌صورت بدون‌مدیریت',
        remaining: 'باقی‌مانده',
        daysLeft: (n: number) => `${ n.toLocaleString('fa-IR') } روز مانده`,
        expired: 'منقضی‌شده'
    },

    routing:
    {
        title: 'مسیریابی',
        empty: 'انتخاب کنید ترافیک چگونه بین پروکسی و اتصال مستقیم تقسیم شود.',
        subtitle: 'تعیین کنید چه چیزی از پروکسی عبور کند و چه چیزی مستقیم بماند.',
        presets: 'حالت‌ها',
        bypassCountry: 'دور زدن بر اساس کشور',
        bypassCountryHint: 'کشور خود را انتخاب کنید: سایت‌ها و IPهای آن کشور مستقیم می‌مانند و بقیه از پروکسی عبور می‌کند.',
        countryModeLabel: 'حالت مسیریابی',
        countryModeSmart: 'هوشمند',
        countryModeBypass: 'دور زدن',
        countryModeSmartHint: 'مسدودسازی تبلیغات، شبکه محلی و سایت‌های آن کشور مستقیم، بقیه از پروکسی.',
        rulesHeader: 'قوانین',
        rulesHint: 'از بالا به پایین بررسی می‌شود — نخستین قانون منطبق اعمال می‌شود.',
        addRule: 'افزودن قانون',
        editRule: 'ویرایش قانون',
        matchType: 'تطبیق',
        matchValue: 'مقدار',
        matchValuePlaceholder: 'مثلاً ‎.ir‎، category-ads-all، 192.168.0.0/16',
        action: 'اقدام',
        actionProxy: 'پروکسی',
        actionDirect: 'مستقیم',
        actionBlock: 'مسدود',
        save: 'ذخیره',
        cancel: 'انصراف',
        delete: 'حذف',
        moveUp: 'بالا',
        moveDown: 'پایین',
        presetGlobalName: 'سراسری',
        presetGlobalDesc: 'همه ترافیک از پروکسی عبور کند.',
        presetDirectLanName: 'شبکه محلی مستقیم',
        presetDirectLanDesc: 'فقط شبکه محلی مستقیم؛ بقیه از پروکسی.',
        presetCustomName: 'سفارشی',
        typeDomainSuffix: 'دامنه پایان‌یابنده به',
        typeDomain: 'دامنه دقیق',
        typeDomainKeyword: 'دامنه شامل',
        typeGeosite: 'دسته سایت',
        typeGeoip: 'کشور IP',
        typeIpCidr: 'محدوده IP',
        typeProcess: 'برنامه',
        descDomainsEndingIn: (value: string) => `دامنه‌های پایان‌یابنده به ${ value }`,
        descExactDomain: (value: string) => value,
        descDomainsContaining: (value: string) => `دامنه‌های شامل «${ value }»`,
        descIranianSites: 'سایت‌های ایرانی',
        descAdsTrackers: 'تبلیغات و ردیاب‌ها',
        descChineseSites: 'سایت‌های چینی',
        descIranianIps: 'نشانی‌های IP ایران',
        descLocalNetwork: 'شبکه محلی',
        descIpRange: (value: string) => `IPهای محدوده ${ value }`,
        descGeosite: (value: string) => `سایت‌های ${ value }`,
        descGeoip: (value: string) => `نشانی‌های IP ${ value.toUpperCase() }`,
        descApp: (value: string) => `برنامه «${ value }»`,
        descEverythingElse: 'بقیه موارد'
    },

    settings:
    {
        title: 'تنظیمات',
        subtitle: 'زبان، پوسته و رفتار برنامه.',
        appearance: 'ظاهر',
        theme: 'پوسته',
        themeSystem: 'سیستم',
        themeLight: 'روشن',
        themeDark: 'تیره',
        language: 'زبان',
        about: 'درباره',
        version: 'نسخه',
        checkUpdate: 'بررسی به‌روزرسانی',
        checking: 'در حال بررسی…',
        upToDate: 'شما آخرین نسخه را دارید.',
        updateAvailable: (version: string) => `نسخه ${ version } در دسترس است.`,
        installUpdate: 'نصب به‌روزرسانی',
        installingUpdate: 'در حال نصب به‌روزرسانی…',
        geoFiles: 'فایل‌های جغرافیایی',
        geoFilesDesc: 'پایگاه‌داده‌های قوانین مسیریابی بر پایه کشور و دسته سایت. برای دقیق‌ماندن قوانین دور زدن و مسدودسازی، آن‌ها را به‌روز کنید.',
        geoInstalled: 'نصب‌شده',
        geoMissing: 'نصب‌نشده',
        updateGeoFiles: 'به‌روزرسانی فایل‌های جغرافیایی',
        updatingGeoFiles: 'در حال دریافت…',
        geoFilesUpdated: 'فایل‌های جغرافیایی به‌روز هستند.'
    },

    detail:
    {
        protocol: 'پروتکل',
        transport: 'انتقال',
        security: 'امنیت',
        latency: 'تأخیر',
        successRate: 'نرخ موفقیت',
        source: 'از',
        unmanaged: 'بدون اشتراک',
        health: 'سلامت',
        untested: 'هنوز تست نشده.',
        lastError: 'آخرین خطا',
        connect: 'اتصال',
        disconnect: 'قطع اتصال',
        copyLink: 'کپی لینک',
        copied: 'کپی شد',
        addFavorite: 'افزودن به برگزیده‌ها',
        removeFavorite: 'حذف از برگزیده‌ها',
        delete: 'حذف',
        ping: 'پینگ',
        pinging: 'در حال پینگ…',
        notSupported: 'این پروتکل توسط هسته فعلی پشتیبانی نمی‌شود.',
        emptyTitle: 'سروری انتخاب نشده',
        emptyHint: 'برای دیدن جزئیات، سروری را از فهرست انتخاب کنید.'
    },

    ping:
    {
        tcp: 'پینگ TCP',
        proxy: 'پینگ پروکسی',
        tcpLabel: 'TCP',
        proxyLabel: 'پروکسی'
    },

    common:
    {
        close: 'تمام',
        dismiss: 'بستن',
        serverNotFound: 'سرور پیدا نشد. احتمالاً حذف شده.'
    }
};
