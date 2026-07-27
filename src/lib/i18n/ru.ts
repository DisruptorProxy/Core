import type { Strings } from './types';

export const ru: Strings =
{
    app:
    {
        name: 'Disruptor Proxy',
        tagline: 'Ваши серверы — как на ладони.',
        crashTitle: 'Что-то пошло не так',
        crashHint: 'На этом экране произошла непредвиденная ошибка. Ваши серверы и настройки в безопасности.',
        crashRetry: 'Повторить',
        expandWindow: 'Развернуть окно',
        shrinkWindow: 'Уменьшить окно',
        minimizeWindow: 'Свернуть окно',
        hideWindow: 'Скрыть в трей',
        trayShow: 'Показать Disruptor Proxy',
        trayQuit: 'Выход'
    },

    nav:
    {
        home: 'Подключение',
        servers: 'Серверы',
        routing: 'Маршруты',
        settings: 'Настройки'
    },

    home:
    {
        title: 'Подключение',
        subtitle: 'Одно касание — и вы на самом быстром сервере.',
        disconnected: 'Не подключено',
        noServerSelected: 'Выберите сервер, чтобы начать.',
        switching: 'Переключение…',
        connecting: 'Подключение…',
        connected: 'Подключено',
        disconnecting: 'Отключение…',
        failed: 'Не удалось подключиться',
        disconnect: 'Отключить',
        connectFastest: 'К самому быстрому',
        switchServer: 'Сменить сервер'
    },

    status:
    {
        duration: 'Время',
        upload: 'Отдано',
        download: 'Принято',
        transferred: 'Передано'
    },

    servers:
    {
        title: 'Серверы',
        empty: 'Серверов пока нет.',
        emptyAction: 'Добавьте подписку или вставьте ссылку конфигурации.',
        countLabel: (count: number) => `${ count.toLocaleString('ru-RU') } серверов`,
        searchPlaceholder: 'Поиск по имени, хосту, стране…',
        noMatches: 'Нет серверов по этим фильтрам.',
        sort: 'Сортировка',
        sortName: 'Имя',
        sortLatency: 'Задержка',
        sortCountry: 'Страна',
        sortSubscription: 'Подписка',
        select: 'Выбрать',
        selectAll: 'Выбрать все',
        selectedLabel: (count: number) => `Выбрано: ${ count.toLocaleString('ru-RU') }`,
        deletedLabel: (count: number) => `Удалено серверов: ${ count.toLocaleString('ru-RU') }`,
        delete: 'Удалить',
        cancel: 'Отмена',
        favoritesOnly: 'Избранное',
        protocol: 'Протокол',
        source: 'Источник',
        all: 'Все',
        allSources: 'Все источники',
        searchSource: 'Поиск источников',
        test: 'Тест',
        testing: (done: number, total: number) =>
            `Тестирование ${ done.toLocaleString('ru-RU') } / ${ total.toLocaleString('ru-RU') }`,
        stop: 'Стоп',
        otherServers: 'Другие серверы',
        collapseAll: 'Свернуть все',
        expandAll: 'Развернуть все',
        groupEmpty: 'Здесь пока нет серверов',
        activeHere: 'Подключённый сервер в этой группе',
        actions: 'Действия',
        matchCount: (matching, total) => `${ matching } / ${ total }`
    },

    importing:
    {
        progress: (parsed: number, total: number) =>
            `Чтение ${ parsed.toLocaleString('ru-RU') } из ${ total.toLocaleString('ru-RU') } строк…`,
        added: 'Добавлено',
        duplicates: 'Дубликаты',
        invalid: 'Нечитаемые',
        elapsed: 'Заняло',
        duplicatesHint: 'Одинаковые серверы под разными именами объединены в один.',
        title: 'Импорт серверов',
        openAction: 'Импорт',
        placeholder: 'Вставьте ссылки конфигураций, URL подписки или список base64…',
        paste: 'Вставить',
        fromClipboard: 'Из буфера обмена',
        fromFile: 'Из файла',
        scanQr: 'Сканировать QR',
        qrScanning: 'Наведите камеру на QR-код…',
        submit: 'Импорт',
        invalidDetail: 'Нечитаемые строки',
        lineLabel: (line: number) => `Строка ${ line }`
    },

    subscriptions:
    {
        add: 'Добавить подписку',
        addTitle: 'Добавить подписку',
        editTitle: 'Изменить подписку',
        urlLabel: 'URL подписки',
        urlPlaceholder: 'https://…',
        nameLabel: 'Имя',
        namePlaceholder: 'Необязательно — по умолчанию хост',
        intervalLabel: 'Автообновление',
        intervalManual: 'Вручную',
        intervalHourly: 'Каждый час',
        intervalDaily: 'Каждый день',
        save: 'Сохранить',
        cancel: 'Отмена',
        update: 'Обновить',
        updating: 'Обновление…',
        delete: 'Удалить',
        countLabel: (count: number) => `${ count.toLocaleString('ru-RU') } серверов`,
        updatedAgo: (text: string) => `Обновлено ${ text }`,
        justNow: 'только что',
        minutesAgo: (n: number) => `${ n } мин назад`,
        hoursAgo: (n: number) => `${ n } ч назад`,
        daysAgo: (n: number) => `${ n } дн назад`,
        deleteTitle: 'Удалить подписку',
        deletePrompt: (name: string) => `Что сделать с серверами из «${ name }»?`,
        deleteRemoveConfigs: 'Удалить её серверы',
        deleteKeepConfigs: 'Оставить как неуправляемые',
        remaining: 'Осталось',
        daysLeft: (n: number) => `Осталось ${ n } дн.`,
        expired: 'Истекла'
    },

    routing:
    {
        title: 'Маршруты',
        empty: 'Выберите, как делить трафик между прокси и прямым подключением.',
        subtitle: 'Решите, что идёт через прокси, а что напрямую.',
        presets: 'Режимы',
        bypassCountry: 'Обход по стране',
        bypassCountryHint: 'Выберите, где вы находитесь: сайты и IP этой страны идут напрямую, всё остальное — через прокси.',
        countryModeLabel: 'Режим маршрутизации',
        countryModeSmart: 'Умный',
        countryModeBypass: 'Обход',
        countryModeSmartHint: 'Блокировать рекламу, локальную сеть и сайты этой страны напрямую, остальное через прокси.',
        rulesHeader: 'Правила',
        rulesHint: 'Проверяются сверху вниз — срабатывает первое совпавшее.',
        addRule: 'Добавить правило',
        editRule: 'Изменить правило',
        matchType: 'Совпадение',
        matchValue: 'Значение',
        matchValuePlaceholder: 'напр. .ir, category-ads-all, 192.168.0.0/16',
        action: 'Действие',
        actionProxy: 'Прокси',
        actionDirect: 'Напрямую',
        actionBlock: 'Блокировать',
        save: 'Сохранить',
        cancel: 'Отмена',
        delete: 'Удалить',
        moveUp: 'Вверх',
        moveDown: 'Вниз',
        presetGlobalName: 'Глобальный',
        presetGlobalDesc: 'Весь трафик через прокси.',
        presetDirectLanName: 'Локальная сеть',
        presetDirectLanDesc: 'Только локальная сеть напрямую; остальное через прокси.',
        presetCustomName: 'Свой',
        typeDomainSuffix: 'Домен оканчивается на',
        typeDomain: 'Точный домен',
        typeDomainKeyword: 'Домен содержит',
        typeGeosite: 'Категория сайтов',
        typeGeoip: 'Страна IP',
        typeIpCidr: 'Диапазон IP',
        typeProcess: 'Приложение',
        descDomainsEndingIn: (value: string) => `Домены на ${ value }`,
        descExactDomain: (value: string) => value,
        descDomainsContaining: (value: string) => `Домены с «${ value }»`,
        descIranianSites: 'Иранские сайты',
        descAdsTrackers: 'Реклама и трекеры',
        descChineseSites: 'Китайские сайты',
        descIranianIps: 'Иранские IP-адреса',
        descLocalNetwork: 'Локальная сеть',
        descIpRange: (value: string) => `IP из ${ value }`,
        descGeosite: (value: string) => `Сайты: ${ value }`,
        descGeoip: (value: string) => `IP-адреса ${ value.toUpperCase() }`,
        descApp: (value: string) => `Приложение «${ value }»`,
        descEverythingElse: 'Всё остальное'
    },

    settings:
    {
        title: 'Настройки',
        subtitle: 'Язык, тема и поведение приложения.',
        appearance: 'Оформление',
        theme: 'Тема',
        themeSystem: 'Системная',
        themeLight: 'Светлая',
        themeDark: 'Тёмная',
        language: 'Язык',
        about: 'О приложении',
        version: 'Версия',
        checkUpdate: 'Проверить обновления',
        checking: 'Проверка…',
        upToDate: 'У вас последняя версия.',
        updateAvailable: (version: string) => `Доступна версия ${ version }.`,
        installUpdate: 'Установить обновление',
        installingUpdate: 'Установка обновления…',
        geoFiles: 'Geo-файлы',
        geoFilesDesc: 'Базы для правил маршрутизации по странам и категориям сайтов. Обновляйте их, чтобы обход и блокировки оставались точными.',
        geoInstalled: 'Установлен',
        geoMissing: 'Не установлен',
        updateGeoFiles: 'Обновить geo-файлы',
        updatingGeoFiles: 'Загрузка…',
        geoFilesUpdated: 'Geo-файлы актуальны.'
    },

    detail:
    {
        protocol: 'Протокол',
        transport: 'Транспорт',
        security: 'Безопасность',
        latency: 'Задержка',
        successRate: 'Успешность',
        source: 'Откуда',
        unmanaged: 'Не из подписки',
        health: 'Состояние',
        untested: 'Ещё не тестировался.',
        lastError: 'Последняя ошибка',
        connect: 'Подключить',
        disconnect: 'Отключить',
        copyLink: 'Копировать ссылку',
        copied: 'Скопировано',
        addFavorite: 'В избранное',
        removeFavorite: 'Убрать из избранного',
        delete: 'Удалить',
        ping: 'Пинг',
        pinging: 'Пинг…',
        notSupported: 'Этот протокол не поддерживается текущим ядром.',
        emptyTitle: 'Сервер не выбран',
        emptyHint: 'Выберите сервер из списка, чтобы увидеть детали.'
    },

    ping:
    {
        tcp: 'TCP-пинг',
        proxy: 'Пинг через прокси',
        tcpLabel: 'TCP',
        proxyLabel: 'Прокси'
    },

    common:
    {
        close: 'Готово',
        dismiss: 'Скрыть',
        serverNotFound: 'Сервер не найден. Возможно, он был удалён.'
    }
};
