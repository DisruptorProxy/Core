/**
 * The full string surface of the app. Every locale must satisfy this interface,
 * so a missing Persian translation is a build error rather than an English word
 * leaking into an RTL screen.
 */
export interface Strings
{
    app:
    {
        name: string;
        tagline: string;
        crashTitle: string;
        crashHint: string;
        crashRetry: string;
        expandWindow: string;
        shrinkWindow: string;
        trayShow: string;
        trayQuit: string;
    };

    nav:
    {
        home: string;
        servers: string;
        subscriptions: string;
        routing: string;
        settings: string;
    };

    home:
    {
        title: string;
        subtitle: string;
        disconnected: string;
        noServerSelected: string;
        switching: string;
        connecting: string;
        connected: string;
        disconnecting: string;
        failed: string;
        disconnect: string;
        connectFastest: string;
        switchServer: string;
    };

    /** The live-connection readout, shared by the Connect screen and the servers side panel. */
    status:
    {
        duration: string;
        upload: string;
        download: string;
        /** Label before the total bytes moved this session, e.g. "Transferred 12.4 MB". */
        transferred: string;
    };

    servers:
    {
        title: string;
        empty: string;
        emptyAction: string;
        countLabel: (count: number) => string;
        searchPlaceholder: string;
        noMatches: string;
        sort: string;
        sortName: string;
        sortLatency: string;
        sortCountry: string;
        sortSubscription: string;
        select: string;
        selectAll: string;
        selectedLabel: (count: number) => string;
        deletedLabel: (count: number) => string;
        delete: string;
        cancel: string;
        favoritesOnly: string;
        protocol: string;
        source: string;
        all: string;
        allSources: string;
        searchSource: string;
        test: string;
        testing: (done: number, total: number) => string;
        stop: string;
    };

    importing:
    {
        /** Progress while the worker chews through a subscription. */
        progress: (parsed: number, total: number) => string;
        added: string;
        duplicates: string;
        invalid: string;
        elapsed: string;
        /** Stated plainly, because every other client hides it. */
        duplicatesHint: string;
        title: string;
        openAction: string;
        placeholder: string;
        paste: string;
        fromClipboard: string;
        fromFile: string;
        scanQr: string;
        qrScanning: string;
        submit: string;
        invalidDetail: string;
        lineLabel: (line: number) => string;
    };

    subscriptions:
    {
        title: string;
        subtitle: string;
        empty: string;
        emptyAction: string;
        add: string;
        addTitle: string;
        editTitle: string;
        urlLabel: string;
        urlPlaceholder: string;
        nameLabel: string;
        namePlaceholder: string;
        intervalLabel: string;
        intervalManual: string;
        intervalHourly: string;
        intervalDaily: string;
        save: string;
        cancel: string;
        update: string;
        updating: string;
        delete: string;
        countLabel: (count: number) => string;
        statusNever: string;
        statusOk: string;
        statusStale: string;
        statusFailed: string;
        updatedAgo: (text: string) => string;
        justNow: string;
        minutesAgo: (n: number) => string;
        hoursAgo: (n: number) => string;
        daysAgo: (n: number) => string;
        deleteTitle: string;
        deletePrompt: (name: string) => string;
        deleteRemoveConfigs: string;
        deleteKeepConfigs: string;
        added: string;
        removed: string;
        unchanged: string;
        keptFavorites: string;
        // Quota + expiry from the provider's `Subscription-Userinfo` header.
        remaining: string;
        daysLeft: (n: number) => string;
        expired: string;
    };

    routing:
    {
        title: string;
        empty: string;
        subtitle: string;
        presets: string;
        bypassCountry: string;
        bypassCountryHint: string;
        countryModeLabel: string;
        countryModeSmart: string;
        countryModeBypass: string;
        countryModeSmartHint: string;
        rulesHeader: string;
        rulesHint: string;
        addRule: string;
        editRule: string;
        matchType: string;
        matchValue: string;
        matchValuePlaceholder: string;
        action: string;
        actionProxy: string;
        actionDirect: string;
        actionBlock: string;
        save: string;
        cancel: string;
        delete: string;
        moveUp: string;
        moveDown: string;
        // Preset names + one-line descriptions.
        presetGlobalName: string;
        presetGlobalDesc: string;
        presetDirectLanName: string;
        presetDirectLanDesc: string;
        presetCustomName: string;
        // Match-type labels (for the editor).
        typeDomainSuffix: string;
        typeDomain: string;
        typeDomainKeyword: string;
        typeGeosite: string;
        typeGeoip: string;
        typeIpCidr: string;
        typeProcess: string;
        // Plain-language subject phrases for the rule sentences.
        descDomainsEndingIn: (value: string) => string;
        descExactDomain: (value: string) => string;
        descDomainsContaining: (value: string) => string;
        descIranianSites: string;
        descAdsTrackers: string;
        descChineseSites: string;
        descIranianIps: string;
        descLocalNetwork: string;
        descIpRange: (value: string) => string;
        descGeosite: (value: string) => string;
        descGeoip: (value: string) => string;
        descApp: (value: string) => string;
        descEverythingElse: string;
    };

    settings:
    {
        title: string;
        subtitle: string;
        appearance: string;
        theme: string;
        themeSystem: string;
        themeLight: string;
        themeDark: string;
        language: string;
        about: string;
        version: string;
        checkUpdate: string;
        checking: string;
        upToDate: string;
        updateAvailable: (version: string) => string;
        installUpdate: string;
        installingUpdate: string;
        // Geo databases (geoip.dat / geosite.dat) used by country/site routing rules.
        geoFiles: string;
        geoFilesDesc: string;
        geoInstalled: string;
        geoMissing: string;
        updateGeoFiles: string;
        updatingGeoFiles: string;
        geoFilesUpdated: string;
    };

    detail:
    {
        protocol: string;
        transport: string;
        security: string;
        latency: string;
        successRate: string;
        source: string;
        unmanaged: string;
        health: string;
        untested: string;
        lastError: string;
        connect: string;
        disconnect: string;
        copyLink: string;
        copied: string;
        addFavorite: string;
        removeFavorite: string;
        delete: string;
        ping: string;
        pinging: string;
        /** Shown when the core cannot run this protocol (hysteria2/tuic). */
        notSupported: string;
        /** Wide-layout side panel with nothing selected. */
        emptyTitle: string;
        emptyHint: string;
    };

    ping:
    {
        /** Menu item / action: a raw TCP handshake to the server. */
        tcp: string;
        /** Menu item / action: a real round-trip through the proxy. */
        proxy: string;
        /** Short column label for the TCP figure in the detail health card. */
        tcpLabel: string;
        /** Short column label for the proxy figure in the detail health card. */
        proxyLabel: string;
    };

    common:
    {
        close: string;
        dismiss: string;
        /** Shown when a connect-by-id call finds no server in the database. */
        serverNotFound: string;
    };
}
