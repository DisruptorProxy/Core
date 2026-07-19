import type { Protocol, ProxyConfig, Transport } from '../proxy/types';
import type { Rule, RuleAction } from '../routing/types';

/**
 * Turns a parsed ProxyConfig + routing profile into a real Xray config.
 *
 * This is the bridge between Guardian's model and the actual proxy core: every
 * field the parsers recovered (REALITY keys, vless flow, ws path, ss cipher) has
 * to land in the exact place app-xray.exe expects, or the connection silently fails.
 * The functions here are pure and JSON-only, so they can be unit-tested against
 * known-good output with no network and no Tauri.
 *
 * The bundled app-xray.exe is a TUN-capable fork; it supports vmess/vless/trojan/
 * shadowsocks outbounds (and hysteria/wireguard, not wired here). tuic is absent.
 */

/**
 * Local SOCKS inbound port for a live connection. Deliberately NOT 1080: that port
 * is the near-universal default for other proxy clients (v2rayN, Clash, a user's
 * own xray), and if one already holds it the core cannot bind and the connection
 * dies at startup with "Only one usage of each socket address". This uncommon port
 * keeps Guardian out of their way. Guardian routes the whole device via TUN anyway;
 * this inbound is only for apps that opt into the SOCKS proxy directly.
 */
const CONNECT_SOCKS_PORT = 1080;
/** Distinct port for the throwaway ping xray, so it never clashes with a live one. */
const PING_PORT = 1081;
/**
 * Loopback gRPC port Xray's StatsService listens on during a live connection, so the
 * app can poll cumulative uplink/downlink counters. Must match the port the Rust
 * `xray_traffic` command queries.
 */
const API_PORT = 10085;

/** Protocols the config builder can produce an outbound for today. */
const SUPPORTED_PROTOCOLS: ReadonlySet<Protocol> = new Set<Protocol>(['vmess', 'vless', 'trojan', 'shadowsocks']);

/**
 * Whether Guardian can connect to this protocol with the current core. hysteria2
 * and tuic parse and list fine, but connecting needs an outbound mapper the core
 * (hysteria) or the core itself (tuic) does not yet give us.
 */
export const canConnect = (protocol: Protocol): boolean => SUPPORTED_PROTOCOLS.has(protocol);

interface XrayStreamSettings
{
    network: string;
    security: string;
    tlsSettings?: Record<string, unknown>;
    realitySettings?: Record<string, unknown>;
    wsSettings?: Record<string, unknown>;
    grpcSettings?: Record<string, unknown>;
    httpSettings?: Record<string, unknown>;
    xhttpSettings?: Record<string, unknown>;
}

interface XrayOutbound
{
    tag: string;
    protocol: string;
    settings: Record<string, unknown>;
    streamSettings?: XrayStreamSettings;
}

interface XrayInbound
{
    tag: string;
    protocol: string;
    listen?: string;
    port?: number;
    settings?: Record<string, unknown>;
    sniffing?: Record<string, unknown>;
}

interface XrayRoutingRule
{
    type: 'field';
    outboundTag: string;
    domain?: string[];
    ip?: string[];
    network?: string;
    /** Destination port(s): a number, or an Xray range string like `"1000-2000"`. */
    port?: number | string;
    /** Match by originating inbound tag - used to route the API inbound to the `api` handler. */
    inboundTag?: string[];
}

interface XrayConfig
{
    log: Record<string, unknown>;
    dns?: Record<string, unknown>;
    /** Enables the internal traffic counters; `api`/`policy` expose and populate them. */
    stats?: Record<string, unknown>;
    api?: Record<string, unknown>;
    policy?: Record<string, unknown>;
    inbounds: XrayInbound[];
    outbounds: XrayOutbound[];
    routing: { domainStrategy: string; rules: XrayRoutingRule[] };
}

/** Xray network names differ slightly from our transport names; map the odd ones. */
const NETWORK: Record<Transport, string> =
{
    tcp: 'tcp',
    ws: 'ws',
    grpc: 'grpc',
    http: 'http',
    quic: 'quic',
    httpupgrade: 'httpupgrade',
    xhttp: 'xhttp'
};

/**
 * Stream settings shared by every protocol: transport + security. REALITY and TLS
 * are distinct security modes with different setting blocks; ws/grpc/http each
 * carry their own transport block. A fingerprint is defaulted to `chrome` under
 * TLS/REALITY because the core requires one for uTLS.
 */
const streamSettings = (config: ProxyConfig): XrayStreamSettings =>
{
    const stream: XrayStreamSettings =
    {
        network: NETWORK[config.transport],
        security: config.security === 'none' ? 'none' : config.security
    };

    if (config.security === 'reality')
    {
        stream.realitySettings =
        {
            serverName: config.sni ?? '',
            fingerprint: config.tlsFingerprint ?? 'chrome',
            publicKey: config.publicKey ?? '',
            shortId: config.shortId ?? '',
            spiderX: ''
        };
    }
    else if (config.security === 'tls')
    {
        stream.tlsSettings =
        {
            serverName: config.sni ?? config.hostHeader ?? config.host,
            allowInsecure: config.allowInsecure,
            fingerprint: config.tlsFingerprint ?? 'chrome',
            ...(config.alpn !== undefined ? { alpn: config.alpn.split(',') } : {})
        };
    }

    if (config.transport === 'ws' || config.transport === 'httpupgrade')
    {
        stream.wsSettings =
        {
            path: config.path ?? '/',
            ...(config.hostHeader !== undefined ? { headers: { Host: config.hostHeader } } : {})
        };
    }
    else if (config.transport === 'grpc')
    {
        stream.grpcSettings = { serviceName: config.path ?? '' };
    }
    else if (config.transport === 'http')
    {
        stream.httpSettings =
        {
            path: config.path ?? '/',
            ...(config.hostHeader !== undefined ? { host: [config.hostHeader] } : {})
        };
    }
    else if (config.transport === 'xhttp')
    {
        stream.xhttpSettings =
        {
            path: config.path ?? '/',
            mode: config.mode ?? 'auto',
            ...(config.hostHeader !== undefined ? { host: config.hostHeader } : {}),
            ...parseExtra(config.extra)
        };
    }

    return stream;
};

/** xhttp `extra` is a JSON object string; parse it into `{ extra: {...} }`, or drop it if malformed. */
const parseExtra = (extra: string | undefined): { extra?: unknown } =>
{
    if (extra === undefined)
    {
        return {};
    }

    try
    {
        return { extra: JSON.parse(extra) };
    }
    catch
    {
        return {};
    }
};

/** The proxy outbound for the server, protocol-specific settings + shared stream. */
const proxyOutbound = (config: ProxyConfig): XrayOutbound =>
{
    const stream = streamSettings(config);

    if (config.protocol === 'vmess')
    {
        return {
            tag: 'proxy',
            protocol: 'vmess',
            settings: { vnext: [{ address: config.host, port: config.port, users: [{ id: config.credential, security: config.method ?? 'auto', alterId: 0 }] }] },
            streamSettings: stream
        };
    }

    if (config.protocol === 'vless')
    {
        return {
            tag: 'proxy',
            protocol: 'vless',
            // `encryption` is `none` for classic vless but a real post-quantum value
            // for modern servers; pass through what the URI carried.
            settings: { vnext: [{ address: config.host, port: config.port, users: [{ id: config.credential, encryption: config.encryption ?? 'none', ...(config.flow !== undefined ? { flow: config.flow } : {}) }] }] },
            streamSettings: stream
        };
    }

    if (config.protocol === 'trojan')
    {
        return {
            tag: 'proxy',
            protocol: 'trojan',
            settings: { servers: [{ address: config.host, port: config.port, password: config.credential }] },
            streamSettings: stream
        };
    }

    // shadowsocks
    return {
        tag: 'proxy',
        protocol: 'shadowsocks',
        settings: { servers: [{ address: config.host, port: config.port, method: config.method ?? 'aes-256-gcm', password: config.credential }] },
        streamSettings: stream
    };
};

const RULE_TAG: Record<RuleAction, string> =
{
    proxy: 'proxy',
    direct: 'direct',
    block: 'block'
};

/**
 * Which geo databases are present next to xray.exe. A `geosite:`/`geoip:` rule
 * whose `.dat` is missing makes the core reject the entire config on startup, so
 * such rules are dropped rather than emitted. Defaults to present so the pure
 * builder and its tests stay geo-agnostic; the connect path passes real status.
 */
export interface GeoAssets
{
    geoip: boolean;
    geosite: boolean;
}

const GEO_PRESENT: GeoAssets = { geoip: true, geosite: true };

/** A geo rule whose backing `.dat` is absent - dropping it keeps the config loadable. */
const isUnresolvableGeoRule = (rule: Rule, geo: GeoAssets): boolean =>
    (rule.type === 'geosite' && !geo.geosite) || (rule.type === 'geoip' && !geo.geoip);

/**
 * Translates Guardian's plain-language routing rules into Xray routing rules,
 * preserving order (first match wins in both models). The `final` rule becomes a
 * catch-all that matches all TCP+UDP, so nothing is ever left unrouted. Geo rules
 * are skipped when their database is missing, so a config never references a
 * `.dat` the core cannot load.
 */
const routingRulesFrom = (rules: Rule[], geo: GeoAssets = GEO_PRESENT): XrayRoutingRule[] =>
    rules.filter((rule) => !isUnresolvableGeoRule(rule, geo)).map((rule): XrayRoutingRule =>
    {
        const outboundTag = RULE_TAG[rule.action];

        switch (rule.type)
        {
            case 'final':
                return { type: 'field', outboundTag, network: 'tcp,udp' };
            case 'geosite':
                return { type: 'field', outboundTag, domain: [`geosite:${ rule.value }`] };
            case 'geoip':
                return { type: 'field', outboundTag, ip: [`geoip:${ rule.value }`] };
            case 'domain':
                return { type: 'field', outboundTag, domain: [`full:${ rule.value }`] };
            case 'domain-keyword':
                return { type: 'field', outboundTag, domain: [`keyword:${ rule.value }`] };
            case 'domain-suffix':
                return { type: 'field', outboundTag, domain: [normalizeSuffix(rule.value)] };
            case 'ip-cidr':
                return { type: 'field', outboundTag, ip: [rule.value] };
            case 'process':
                // The core has no process matcher in this config path; route direct
                // rather than emit an invalid rule that would reject the whole config.
                return { type: 'field', outboundTag: 'direct', domain: [] };
        }
    }).filter((rule) => rule.domain === undefined || rule.domain.length > 0 || rule.ip !== undefined || rule.network !== undefined);

/** Xray treats a bare `domain:x` as a subdomain match, so `.ir` and `ir` both mean the `.ir` zone. */
const normalizeSuffix = (value: string): string => `domain:${ value.replace(/^\./, '') }`;

const DIRECT: XrayOutbound = { tag: 'direct', protocol: 'freedom', settings: {} };
const BLOCK: XrayOutbound = { tag: 'block', protocol: 'blackhole', settings: {} };
/**
 * Answers hijacked DNS in-core. Per Xray's `dns` outbound schema
 * (xtls.github.io/config/outbounds/dns.html), `rewriteAddress`/`rewritePort`/
 * `rewriteNetwork` force every captured query - even ones the OS aimed at the LAN
 * router - onto a real resolver over UDP; the rewritten query still travels the
 * tunnel (routing dispatches it to `proxy`), so it is never exposed on the physical
 * NIC.
 */
const DNS_OUT: XrayOutbound =
{
    tag: 'dns-out',
    protocol: 'dns',
    settings: { rewriteNetwork: 'udp', rewriteAddress: '1.1.1.1', rewritePort: 53 }
};

/**
 * Hijacks every DNS query - including ones the OS aims at the LAN router - into the
 * `dns-out` outbound, so no lookup escapes the tunnel in plaintext. It must sit
 * first in the routing table, ahead of the `direct` rules that would otherwise send
 * a query to a private resolver straight out the physical NIC.
 */
const DNS_RULE: XrayRoutingRule = { type: 'field', outboundTag: 'dns-out', port: 53 };

/**
 * Live-traffic telemetry. `STATS` plus the `system` policy counters make Xray tally
 * per-outbound uplink/downlink; `API` + `API_INBOUND` + `API_RULE` expose those
 * counters over a loopback gRPC port the app polls with `xray api statsquery`. The
 * app reads `outbound>>>proxy>>>traffic>>>{uplink,downlink}`.
 */
const STATS: Record<string, unknown> = {};
const API: Record<string, unknown> = { tag: 'api', services: ['StatsService'] };
const POLICY: Record<string, unknown> =
{
    system:
    {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true
    }
};
const API_INBOUND: XrayInbound = { tag: 'api-in', protocol: 'dokodemo-door', listen: '127.0.0.1', port: API_PORT, settings: { address: '127.0.0.1' } };
const API_RULE: XrayRoutingRule = { type: 'field', inboundTag: ['api-in'], outboundTag: 'api' };

/**
 * The full connect config: a SOCKS inbound (for apps that honour it) plus the TUN
 * inbound that routes the whole device, the proxy/direct/block/dns outbounds, and
 * the routing table.
 *
 * The TUN inbound follows Xray's native `tun` schema (xtls.github.io/config/
 * inbounds/tun.html): `gateway` is the interface's own address, `dns` is what the
 * adapter advertises to the OS. `autoSystemRoutingTable: ['0.0.0.0/0']` writes a
 * default route into the Windows routing table so every IPv4 packet is pulled into
 * the tunnel (the tunnel is IPv4-only, so IPv6 is intentionally left unrouted), and
 * `autoOutboundsInterface: 'auto'` binds Xray's own outbounds to the physical NIC so
 * the proxy connection to the server is not caught by that route and looped back.
 *
 * DNS is forced through Xray to stop leaks: `DNS_RULE` hijacks all port-53 traffic
 * into `DNS_OUT`, which resolves via the `dns` servers (DoH first, IPv4-only), and
 * `domainStrategy: 'IPIfNonMatch'` resolves in-core rather than via the OS resolver.
 */
export const buildConnectConfig = (config: ProxyConfig, rules: Rule[], geo: GeoAssets = GEO_PRESENT): XrayConfig =>
    ({
        log: { loglevel: 'debug' },
        dns: { servers: ['1.1.1.1', '8.8.8.8'], queryStrategy: 'UseIPv4' },
        stats: STATS,
        api: API,
        policy: POLICY,
        inbounds:
    [
        { tag: 'socks-in', protocol: 'socks', listen: '127.0.0.1', port: CONNECT_SOCKS_PORT, settings: { udp: true }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] } },
        {
            tag: 'tun-in',
            protocol: 'tun',
            settings:
            {
                name: 'app-tun',
                mtu: 1500,
                gateway: ['172.19.19.1/30'],
                dns: ['1.1.1.1'],
                autoSystemRoutingTable: ['0.0.0.0/0'],
                autoOutboundsInterface: 'auto'
            },
            sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] }
        },
        API_INBOUND
    ],
        outbounds: [proxyOutbound(config), DIRECT, BLOCK, DNS_OUT],
        routing: { domainStrategy: 'IPIfNonMatch', rules: [API_RULE, DNS_RULE, ...routingRulesFrom(rules, geo)] }
    });

/**
 * A minimal config for a latency probe. `ping_xray_windows` reads `inbounds[0]`'s
 * port and protocol, so the SOCKS inbound must be first; the port is distinct from
 * a live connection's so a probe never collides with an active tunnel. No TUN, no
 * routing - everything goes straight out the proxy.
 */
export const buildPingConfig = (config: ProxyConfig): XrayConfig =>
    ({
        log: { loglevel: 'none' },
        inbounds: [{ tag: 'ping-in', protocol: 'socks', listen: '127.0.0.1', port: PING_PORT, settings: { udp: false } }],
        outbounds: [proxyOutbound(config), DIRECT],
        routing: { domainStrategy: 'AsIs', rules: [] }
    });
