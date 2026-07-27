import type { Strings } from './types';

export const zh: Strings =
{
    app:
    {
        name: 'Disruptor Proxy',
        tagline: '你的服务器，一目了然。',
        crashTitle: '出错了',
        crashHint: '此页面遇到意外错误。你的服务器和设置安全无损。',
        crashRetry: '重试',
        expandWindow: '放大窗口',
        shrinkWindow: '缩小窗口',
        minimizeWindow: '最小化窗口',
        hideWindow: '隐藏到托盘',
        trayShow: '显示 Disruptor Proxy',
        trayQuit: '退出'
    },

    nav:
    {
        home: '连接',
        servers: '服务器',
        routing: '路由',
        settings: '设置'
    },

    home:
    {
        title: '连接',
        subtitle: '一键连接最快的可用服务器。',
        disconnected: '未连接',
        noServerSelected: '请选择一个服务器。',
        switching: '切换中…',
        connecting: '连接中…',
        connected: '已连接',
        disconnecting: '断开中…',
        failed: '连接失败',
        disconnect: '断开连接',
        connectFastest: '连接最快',
        switchServer: '切换服务器'
    },

    status:
    {
        duration: '时长',
        upload: '上传',
        download: '下载',
        transferred: '已传输'
    },

    servers:
    {
        title: '服务器',
        empty: '还没有服务器。',
        emptyAction: '添加订阅或粘贴配置链接。',
        countLabel: (count: number) => `${ count.toLocaleString('zh-CN') } 个服务器`,
        searchPlaceholder: '搜索名称、主机、国家…',
        noMatches: '没有符合筛选条件的服务器。',
        sort: '排序',
        sortName: '名称',
        sortLatency: '延迟',
        sortCountry: '国家',
        sortSubscription: '订阅',
        select: '选择',
        selectAll: '全选',
        selectedLabel: (count: number) => `已选 ${ count.toLocaleString('zh-CN') } 个`,
        deletedLabel: (count: number) => `已删除 ${ count.toLocaleString('zh-CN') } 个服务器`,
        delete: '删除',
        cancel: '取消',
        favoritesOnly: '收藏',
        protocol: '协议',
        source: '来源',
        all: '全部',
        allSources: '所有来源',
        searchSource: '搜索来源',
        test: '测试',
        testing: (done: number, total: number) =>
            `测试中 ${ done.toLocaleString('zh-CN') } / ${ total.toLocaleString('zh-CN') }`,
        stop: '停止',
        otherServers: '其他服务器',
        collapseAll: '全部折叠',
        expandAll: '全部展开',
        groupEmpty: '这里还没有服务器',
        activeHere: '已连接的服务器在此分组中',
        actions: '操作',
        matchCount: (matching, total) => `${ matching } / ${ total }`
    },

    importing:
    {
        progress: (parsed: number, total: number) =>
            `正在读取 ${ parsed.toLocaleString('zh-CN') } / ${ total.toLocaleString('zh-CN') } 行…`,
        added: '已添加',
        duplicates: '重复',
        invalid: '无法读取',
        elapsed: '耗时',
        duplicatesHint: '同一服务器以不同名称出现，已合并为一个。',
        title: '导入服务器',
        openAction: '导入',
        placeholder: '粘贴配置链接、订阅地址或 base64 列表…',
        paste: '粘贴',
        fromClipboard: '从剪贴板',
        fromFile: '从文件',
        scanQr: '扫描二维码',
        qrScanning: '将摄像头对准二维码…',
        submit: '导入',
        invalidDetail: '无法读取的行',
        lineLabel: (line: number) => `第 ${ line } 行`
    },

    subscriptions:
    {
        add: '添加订阅',
        addTitle: '添加订阅',
        editTitle: '编辑订阅',
        urlLabel: '订阅地址',
        urlPlaceholder: 'https://…',
        nameLabel: '名称',
        namePlaceholder: '可选 — 默认使用主机名',
        intervalLabel: '自动更新',
        intervalManual: '手动',
        intervalHourly: '每小时',
        intervalDaily: '每天',
        save: '保存',
        cancel: '取消',
        update: '更新',
        updating: '更新中…',
        delete: '删除',
        countLabel: (count: number) => `${ count.toLocaleString('zh-CN') } 个服务器`,
        updatedAgo: (text: string) => `更新于${ text }`,
        justNow: '刚刚',
        minutesAgo: (n: number) => `${ n } 分钟前`,
        hoursAgo: (n: number) => `${ n } 小时前`,
        daysAgo: (n: number) => `${ n } 天前`,
        deleteTitle: '删除订阅',
        deletePrompt: (name: string) => `如何处理来自“${ name }”的服务器？`,
        deleteRemoveConfigs: '删除其服务器',
        deleteKeepConfigs: '保留为未托管',
        remaining: '剩余',
        daysLeft: (n: number) => `剩余 ${ n } 天`,
        expired: '已到期'
    },

    routing:
    {
        title: '路由',
        empty: '选择流量如何在代理与直连之间分配。',
        subtitle: '决定哪些走代理、哪些保持直连。',
        presets: '模式',
        bypassCountry: '按国家绕行',
        bypassCountryHint: '选择你所在的国家：该国的网站和 IP 保持直连，其余全部走代理。',
        countryModeLabel: '路由模式',
        countryModeSmart: '智能',
        countryModeBypass: '绕行',
        countryModeSmartHint: '拦截广告，局域网和该国网站直连，其余走代理。',
        rulesHeader: '规则',
        rulesHint: '自上而下匹配 — 第一条命中的规则生效。',
        addRule: '添加规则',
        editRule: '编辑规则',
        matchType: '匹配',
        matchValue: '值',
        matchValuePlaceholder: '例如 .ir、category-ads-all、192.168.0.0/16',
        action: '动作',
        actionProxy: '代理',
        actionDirect: '直连',
        actionBlock: '拦截',
        save: '保存',
        cancel: '取消',
        delete: '删除',
        moveUp: '上移',
        moveDown: '下移',
        presetGlobalName: '全局',
        presetGlobalDesc: '所有流量都走代理。',
        presetDirectLanName: '局域网直连',
        presetDirectLanDesc: '仅局域网直连，其余全部走代理。',
        presetCustomName: '自定义',
        typeDomainSuffix: '域名结尾为',
        typeDomain: '精确域名',
        typeDomainKeyword: '域名包含',
        typeGeosite: '网站类别',
        typeGeoip: 'IP 国家',
        typeIpCidr: 'IP 段',
        typeProcess: '应用',
        descDomainsEndingIn: (value: string) => `以 ${ value } 结尾的域名`,
        descExactDomain: (value: string) => value,
        descDomainsContaining: (value: string) => `包含“${ value }”的域名`,
        descIranianSites: '伊朗网站',
        descAdsTrackers: '广告与跟踪器',
        descChineseSites: '中国网站',
        descIranianIps: '伊朗 IP 地址',
        descLocalNetwork: '局域网',
        descIpRange: (value: string) => `${ value } 段的 IP`,
        descGeosite: (value: string) => `${ value } 网站`,
        descGeoip: (value: string) => `${ value.toUpperCase() } IP 地址`,
        descApp: (value: string) => `应用“${ value }”`,
        descEverythingElse: '其余全部'
    },

    settings:
    {
        title: '设置',
        subtitle: '语言、主题与应用行为。',
        appearance: '外观',
        theme: '主题',
        themeSystem: '跟随系统',
        themeLight: '浅色',
        themeDark: '深色',
        language: '语言',
        about: '关于',
        version: '版本',
        checkUpdate: '检查更新',
        checking: '检查中…',
        upToDate: '已是最新版本。',
        updateAvailable: (version: string) => `新版本 ${ version } 可用。`,
        installUpdate: '安装更新',
        installingUpdate: '正在安装更新…',
        geoFiles: 'Geo 数据库',
        geoFilesDesc: '用于国家和网站类别路由规则的数据库。及时更新以保证绕行与拦截规则准确。',
        geoInstalled: '已安装',
        geoMissing: '未安装',
        updateGeoFiles: '更新 Geo 文件',
        updatingGeoFiles: '下载中…',
        geoFilesUpdated: 'Geo 文件已是最新。'
    },

    detail:
    {
        protocol: '协议',
        transport: '传输',
        security: '安全',
        latency: '延迟',
        successRate: '成功率',
        source: '来源',
        unmanaged: '不属于任何订阅',
        health: '健康度',
        untested: '尚未测试。',
        lastError: '最近错误',
        connect: '连接',
        disconnect: '断开',
        copyLink: '复制链接',
        copied: '已复制',
        addFavorite: '加入收藏',
        removeFavorite: '取消收藏',
        delete: '删除',
        ping: '测速',
        pinging: '测速中…',
        notSupported: '当前内核不支持此协议。',
        emptyTitle: '未选择服务器',
        emptyHint: '从列表中选择一个服务器查看详情。'
    },

    ping:
    {
        tcp: 'TCP 测速',
        proxy: '代理测速',
        tcpLabel: 'TCP',
        proxyLabel: '代理'
    },

    common:
    {
        close: '完成',
        dismiss: '关闭',
        serverNotFound: '找不到服务器，可能已被删除。'
    }
};
