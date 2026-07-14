import type { ProxyConfig, Protocol, Transport } from '../proxy/types';
import type { Rule, RuleAction } from '../routing/types';

/**
 * Turns a parsed ProxyConfig + routing profile into a real Xray config.
 *
 * This is the bridge between Guardian's model and the actual proxy core: every
 * field the parsers recovered (REALITY keys, vless flow, ws path, ss cipher) has
 * to land in the exact place xray.exe expects, or the connection silently fails.
 * The functions here are pure and JSON-only, so they can be unit-tested against
 * known-good output with no network and no Tauri.
 *
 * The bundled xray.exe is a TUN-capable fork; it supports vmess/vless/trojan/
 * shadowsocks outbounds (and hysteria/wireguard, not wired here). tuic is absent.
 */

/** Local SOCKS inbound port for a live connection. */
export const CONNECT_SOCKS_PORT = 10808;
/** Distinct port for the throwaway ping xray, so it never clashes with a live one. */
export const PING_PORT = 10809;

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
}

export interface XrayConfig
{
    log: Record<string, unknown>;
    dns?: Record<string, unknown>;
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
 * Translates Guardian's plain-language routing rules into Xray routing rules,
 * preserving order (first match wins in both models). The `final` rule becomes a
 * catch-all that matches all TCP+UDP, so nothing is ever left unrouted.
 */
export const routingRulesFrom = (rules: Rule[]): XrayRoutingRule[] =>
    rules.map((rule): XrayRoutingRule =>
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
 * The full connect config: a SOCKS inbound (for apps that honour it) plus the TUN
 * inbound that routes the whole device, the proxy/direct/block outbounds, and the
 * routing table. The TUN inbound schema matches the fork's `proxy/tun` config
 * (`name`/`mtu`/`address`); confirm against a known-good config from the fork.
 */
export const buildConnectConfig = (config: ProxyConfig, rules: Rule[]): XrayConfig =>
    ({
        log: { loglevel: 'warning' },
        dns: { servers: ['1.1.1.1', 'https://1.1.1.1/dns-query', { address: '223.5.5.5', domains: ['geosite:ir'] }] },
        inbounds:
    [
        { tag: 'socks-in', protocol: 'socks', listen: '127.0.0.1', port: CONNECT_SOCKS_PORT, settings: { udp: true }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] } },
        { tag: 'tun-in', protocol: 'tun', settings: { name: 'guardian-tun', mtu: 1500, address: ['172.19.0.1/30'] }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] } }
    ],
        outbounds: [proxyOutbound(config), DIRECT, BLOCK],
        routing: { domainStrategy: 'IPIfNonMatch', rules: routingRulesFrom(rules) }
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
