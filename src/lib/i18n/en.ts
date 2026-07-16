import type { Strings } from './types';

export const en: Strings =
{
    app:
    {
        name: 'Guardian',
        tagline: 'Your servers, measured.',
        crashTitle: 'Something went wrong',
        crashHint: 'This screen hit an unexpected error. Your servers and settings are safe.',
        crashRetry: 'Try again',
        expandWindow: 'Expand window',
        shrinkWindow: 'Shrink window',
        trayShow: 'Show Guardian',
        trayQuit: 'Quit'
    },

    nav:
    {
        home: 'Connect',
        servers: 'Servers',
        subscriptions: 'Subscriptions',
        routing: 'Routing',
        settings: 'Settings'
    },

    home:
    {
        title: 'Connect',
        disconnected: 'Not connected',
        connectAction: 'Connect',
        noServerSelected: 'Pick a server to get started.',
        connecting: 'Connecting…',
        connected: 'Connected',
        disconnecting: 'Disconnecting…',
        failed: 'Connection failed',
        disconnect: 'Disconnect',
        connectFastest: 'Connect fastest',
        duration: (text: string) => `Connected for ${ text }`,
        protocolLabel: 'Protocol',
        noneTested: 'Test your servers to find the fastest.'
    },

    servers:
    {
        title: 'Servers',
        empty: 'No servers yet.',
        emptyAction: 'Add a subscription or paste a config link.',
        countLabel: (count: number) => `${ count.toLocaleString('en-US') } servers`,
        searchPlaceholder: 'Search name, host, country…',
        noMatches: 'No servers match these filters.',
        sortName: 'Name',
        sortLatency: 'Latency',
        sortCountry: 'Country',
        select: 'Select',
        selectAll: 'Select all',
        selectedLabel: (count: number) => `${ count.toLocaleString('en-US') } selected`,
        delete: 'Delete',
        cancel: 'Cancel',
        favoritesOnly: 'Favorites',
        protocol: 'Protocol',
        source: 'Source',
        all: 'All',
        allSources: 'All sources',
        searchSource: 'Search sources',
        test: 'Test',
        testing: (done: number, total: number) =>
            `Testing ${ done.toLocaleString('en-US') } / ${ total.toLocaleString('en-US') }`,
        stop: 'Stop'
    },

    importing:
    {
        progress: (parsed: number, total: number) =>
            `Reading ${ parsed.toLocaleString('en-US') } of ${ total.toLocaleString('en-US') } lines…`,
        added: 'Added',
        duplicates: 'Duplicates',
        invalid: 'Unreadable',
        elapsed: 'Took',
        duplicatesHint: 'Identical servers listed under different names, collapsed into one.',
        title: 'Import servers',
        openAction: 'Import',
        placeholder: 'Paste config links, a subscription URL, or a base64 list…',
        paste: 'Paste',
        fromClipboard: 'From clipboard',
        fromFile: 'From file',
        scanQr: 'Scan QR',
        qrUnsupported: 'QR scanning is not available on this device.',
        qrScanning: 'Point the camera at a QR code…',
        submit: 'Import',
        invalidDetail: 'Unreadable lines',
        lineLabel: (line: number) => `Line ${ line }`,
        clipboardEmpty: 'The clipboard is empty.',
        clipboardDenied: 'Clipboard access was denied.'
    },

    subscriptions:
    {
        title: 'Subscriptions',
        empty: 'No subscriptions yet.',
        emptyAction: 'Add a subscription link to pull servers in automatically.',
        add: 'Add subscription',
        addTitle: 'Add subscription',
        editTitle: 'Edit subscription',
        urlLabel: 'Subscription URL',
        urlPlaceholder: 'https://…',
        nameLabel: 'Name',
        namePlaceholder: 'Optional — defaults to the host',
        intervalLabel: 'Auto-update',
        intervalManual: 'Manual',
        intervalHourly: 'Hourly',
        intervalDaily: 'Daily',
        save: 'Save',
        cancel: 'Cancel',
        update: 'Update',
        updating: 'Updating…',
        delete: 'Delete',
        countLabel: (count: number) => `${ count.toLocaleString('en-US') } servers`,
        statusNever: 'Never updated',
        statusOk: 'Up to date',
        statusStale: 'Stale',
        statusFailed: 'Update failed',
        updatedAgo: (text: string) => `Updated ${ text }`,
        justNow: 'just now',
        minutesAgo: (n: number) => `${ n }m ago`,
        hoursAgo: (n: number) => `${ n }h ago`,
        daysAgo: (n: number) => `${ n }d ago`,
        deleteTitle: 'Delete subscription',
        deletePrompt: (name: string) => `What should happen to the servers from “${ name }”?`,
        deleteRemoveConfigs: 'Delete its servers',
        deleteKeepConfigs: 'Keep them as unmanaged',
        added: 'Added',
        removed: 'Removed',
        unchanged: 'Unchanged',
        keptFavorites: 'Kept favorites'
    },

    routing:
    {
        title: 'Routing',
        empty: 'Choose how traffic is split between the proxy and your direct connection.',
        subtitle: 'Decide what goes through the proxy and what stays direct.',
        presets: 'Modes',
        rulesHeader: 'Rules',
        rulesHint: 'Checked top to bottom — the first rule that matches wins.',
        addRule: 'Add rule',
        editRule: 'Edit rule',
        matchType: 'Match',
        matchValue: 'Value',
        matchValuePlaceholder: 'e.g. .ir, category-ads-all, 192.168.0.0/16',
        action: 'Action',
        actionProxy: 'Proxy',
        actionDirect: 'Direct',
        actionBlock: 'Block',
        save: 'Save',
        cancel: 'Cancel',
        delete: 'Delete',
        moveUp: 'Move up',
        moveDown: 'Move down',
        presetRulesName: 'Smart',
        presetRulesDesc: 'Block ads, keep local and Iranian sites direct, proxy the rest.',
        presetBypassName: 'Bypass Iran',
        presetBypassDesc: 'Iranian sites direct, everything else through the proxy.',
        presetGlobalName: 'Global',
        presetGlobalDesc: 'Send all traffic through the proxy.',
        presetDirectLanName: 'Direct LAN',
        presetDirectLanDesc: 'Only the local network is direct; proxy everything else.',
        presetCustomName: 'Custom',
        typeDomainSuffix: 'Domain ends with',
        typeDomain: 'Exact domain',
        typeDomainKeyword: 'Domain contains',
        typeGeosite: 'Site category',
        typeGeoip: 'IP country',
        typeIpCidr: 'IP range',
        typeProcess: 'App',
        descDomainsEndingIn: (value: string) => `Domains ending in ${ value }`,
        descExactDomain: (value: string) => value,
        descDomainsContaining: (value: string) => `Domains containing “${ value }”`,
        descIranianSites: 'Iranian sites',
        descAdsTrackers: 'Ads & trackers',
        descChineseSites: 'Chinese sites',
        descIranianIps: 'Iranian IP addresses',
        descLocalNetwork: 'Local network',
        descIpRange: (value: string) => `IPs in ${ value }`,
        descGeosite: (value: string) => `${ value } sites`,
        descGeoip: (value: string) => `${ value.toUpperCase() } IP addresses`,
        descApp: (value: string) => `App “${ value }”`,
        descEverythingElse: 'Everything else'
    },

    settings:
    {
        title: 'Settings',
        appearance: 'Appearance',
        theme: 'Theme',
        themeSystem: 'System',
        themeLight: 'Light',
        themeDark: 'Dark',
        language: 'Language',
        languageEnglish: 'English',
        languagePersian: 'فارسی',
        about: 'About',
        version: 'Version',
        checkUpdate: 'Check for updates',
        checking: 'Checking…',
        upToDate: 'You’re on the latest version.',
        updateAvailable: (version: string) => `Version ${ version } is available.`,
        download: 'Download'
    },

    detail:
    {
        protocol: 'Protocol',
        transport: 'Transport',
        security: 'Security',
        latency: 'Latency',
        successRate: 'Success rate',
        source: 'From',
        unmanaged: 'Not from a subscription',
        health: 'Health',
        untested: 'Not tested yet.',
        lastError: 'Last error',
        connect: 'Connect',
        copyLink: 'Copy link',
        copied: 'Copied',
        addFavorite: 'Add to favorites',
        removeFavorite: 'Remove favorite',
        delete: 'Delete',
        ping: 'Ping',
        pinging: 'Pinging…',
        notSupported: 'This protocol is not supported by the current core.'
    },

    common:
    {
        comingSoon: 'Not built yet.',
        close: 'Done'
    }
};
