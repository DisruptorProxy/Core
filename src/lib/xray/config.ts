import type { Protocol, ProxyConfig, Transport } from '../proxy/types';
import type { Rule, RuleAction } from '../routing/types';

/**
 * Turns a parsed ProxyConfig + routing profile into a real Xray config.
 *
 * This is the bridge between The Disruptor Proxy's model and the actual proxy core: every
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
 * keeps The Disruptor Proxy out of their way. The Disruptor Proxy routes the whole device via TUN anyway;
 * this inbound is only for apps that opt into the SOCKS proxy directly.
 */
const CONNECT_SOCKS_PORT = 1080;
/** Distinct port for the throwaway ping xray, so it never clashes with a live one. */
const PING_PORT = 1081;
/**
 * The loopback SOCKS port the LIVE core exposes for probing. A single inbound carries
 * one authenticated user per server (the username IS the server's id), and a `user`
 * routing rule sends each user's traffic out that server's own outbound - so a whole
 * "test all" while connected reuses the running tunnel core instead of spawning a
 * second app-xray.exe.
 */
export const PROBE_SOCKS_PORT = 1082;
/**
 * The IDLE prober's own port - deliberately NOT the live core's.
 *
 * These two cores were once assumed never to overlap, so they shared one port. They DO
 * overlap in practice (a prober left by a cancelled test, or a test starting as a
 * connection comes up), and the second one to bind died with "Only one usage of each
 * socket address" - taking the whole connection, or the whole test, down with it.
 * Separate ports let them coexist harmlessly.
 */
export const PROBER_SOCKS_PORT = 1083;
/** Inbound tag for that shared probe SOCKS listener. */
const PROBE_IN_TAG = 'probe-in';
/**
 * Loopback gRPC port Xray's StatsService listens on during a live connection, so the
 * app can poll cumulative uplink/downlink counters. Must match the port the Rust
 * `xray_traffic` command queries.
 */
const API_PORT = 10085;

/** Protocols the config builder can produce an outbound for today. */
const SUPPORTED_PROTOCOLS: ReadonlySet<Protocol> = new Set<Protocol>(['vmess', 'vless', 'trojan', 'shadowsocks']);

/**
 * Whether The Disruptor Proxy can connect to this protocol with the current core. hysteria2
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
    /** Match by authenticated inbound user - routes each probe user to its server's outbound. */
    user?: string[];
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

/**
 * The proxy outbound for the server, protocol-specific settings + shared stream.
 * The `tag` defaults to `proxy` for a live connection; the prober passes a distinct
 * tag per server so a single config can hold every server's outbound at once.
 */
const proxyOutbound = (config: ProxyConfig, tag = 'proxy'): XrayOutbound =>
{
    const stream = streamSettings(config);

    if (config.protocol === 'vmess')
    {
        return {
            tag,
            protocol: 'vmess',
            settings: { vnext: [{ address: config.host, port: config.port, users: [{ id: config.credential, security: config.method ?? 'auto', alterId: 0 }] }] },
            streamSettings: stream
        };
    }

    if (config.protocol === 'vless')
    {
        return {
            tag,
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
            tag,
            protocol: 'trojan',
            settings: { servers: [{ address: config.host, port: config.port, password: config.credential }] },
            streamSettings: stream
        };
    }

    // shadowsocks
    return {
        tag,
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
 * Translates The Disruptor Proxy's plain-language routing rules into Xray routing rules,
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
 * The SOCKS username whose traffic routes to a given server's probe outbound. It is
 * simply the server's content id, so a probe authenticates as the right user knowing
 * only the server - identical whether the outbound lives in the live connect core or
 * the idle prober, so no test depends on the order servers happened to be loaded in.
 */
export const probeUser = (config: ProxyConfig): string => config.id;

/**
 * A fixed password shared by every probe account. The probe inbound is loopback-only,
 * so the value is irrelevant to security; it exists only because SOCKS `user` routing
 * needs password auth turned on so an authenticated user is attached to match against.
 */
const PROBE_PASS = 'probe';

interface ProbeLayer
{
    /** The single shared SOCKS inbound, one account per connectable server. */
    inbound: XrayInbound;
    /** One tagged proxy outbound per connectable server. */
    outbounds: XrayOutbound[];
    /** `user -> outbound` routing rules, one per connectable server. */
    rules: XrayRoutingRule[];
    /** Server id -> the SOCKS username that reaches it. Only connectable servers appear. */
    users: Map<string, string>;
}

/**
 * The shared probe plumbing used by both the live connect config and the idle
 * prober: ONE SOCKS inbound whose accounts and `user` routing rules fan every server
 * out to its own tagged outbound. A probe of server X is then just an HTTP request
 * through this port authenticated as X's user - the core routes it out X's outbound,
 * so hundreds of servers share one inbound on one core with no per-server port and no
 * restart. Servers whose protocol the core cannot connect to are omitted entirely (no
 * account, no outbound, no rule), so the caller reports them unsupported without ever
 * probing.
 */
const buildProbeLayer = (configs: ProxyConfig[], port: number): ProbeLayer =>
{
    const accounts: { user: string; pass: string }[] = [];
    const outbounds: XrayOutbound[] = [];
    const rules: XrayRoutingRule[] = [];
    const users = new Map<string, string>();

    configs.filter((config) => canConnect(config.protocol)).forEach((config) =>
    {
        const user = probeUser(config);
        const tag = `probe-out-${ user }`;

        accounts.push({ user, pass: PROBE_PASS });
        outbounds.push(proxyOutbound(config, tag));
        rules.push({ type: 'field', inboundTag: [PROBE_IN_TAG], user: [user], outboundTag: tag });
        users.set(config.id, user);
    });

    return {
        inbound: { tag: PROBE_IN_TAG, protocol: 'socks', listen: '127.0.0.1', port, settings: { auth: 'password', udp: false, accounts } },
        outbounds,
        rules,
        users
    };
};

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
 *
 * The config also carries the shared probe layer (`buildProbeLayer`) for EVERY known
 * server in `allConfigs`: a single loopback SOCKS inbound with one user per server
 * and a `user` route sending each out its own outbound. This is what lets a test run
 * while connected reuse this one running core - a probe is just a request on the
 * probe port authenticated as that server's user - instead of spawning a second
 * app-xray.exe. The probe users/routes sit ahead of the user routing rules so a
 * probe's authenticated traffic is matched before the `final` catch-all, while
 * ordinary TUN/SOCKS traffic (which carries no probe user) skips them untouched.
 */
export const buildConnectConfig = (config: ProxyConfig, rules: Rule[], allConfigs: ProxyConfig[], geo: GeoAssets = GEO_PRESENT): XrayConfig =>
{
    const probe = buildProbeLayer(allConfigs, PROBE_SOCKS_PORT);

    return {
        // 'warning' keeps the core quiet in production; bump to 'debug' when
        // diagnosing a connection the config builder isn't obviously at fault for.
        log: { loglevel: 'warning' },
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
            API_INBOUND,
            probe.inbound
        ],
        outbounds: [proxyOutbound(config), DIRECT, BLOCK, DNS_OUT, ...probe.outbounds],
        routing: { domainStrategy: 'IPIfNonMatch', rules: [API_RULE, DNS_RULE, ...probe.rules, ...routingRulesFrom(rules, geo)] }
    };
};

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

/**
 * A bulk-test plan: one xray config that carries every tested server's outbound at
 * once, plus the map telling the caller which SOCKS user reaches which server.
 *
 * This is the IDLE prober - used only when no live connection exists. It is the same
 * shared probe layer the connect config embeds (`buildProbeLayer`): one SOCKS inbound
 * on `PROBE_SOCKS_PORT`, one authenticated user per server, each routed to that
 * server's outbound by the `user` field. So a probe of server X is just an HTTP
 * request on that one port authenticated as X's user; the core dials X's outbound
 * lazily, and no server needs its own port, its own xray, or a restart.
 *
 * Unlike the live config there is no TUN and no elevation - only loopback inbounds -
 * so this runs as a plain child process. While a connection IS active, this is not
 * used at all: the live core already carries the same layer, so probing reuses it.
 *
 * Servers whose protocol the core cannot connect to are left out entirely (no
 * account, no outbound); the caller reports them as unsupported without ever probing.
 */
export interface ProbePlan
{
    config: XrayConfig;
    /** Server id -> the SOCKS username whose traffic routes through that server. */
    users: Map<string, string>;
}

export const buildProbeConfig = (configs: ProxyConfig[]): ProbePlan =>
{
    const probe = buildProbeLayer(configs, PROBER_SOCKS_PORT);

    return {
        config:
        {
            log: { loglevel: 'none' },
            inbounds: [probe.inbound],
            outbounds: [...probe.outbounds, DIRECT, BLOCK],
            routing: { domainStrategy: 'AsIs', rules: probe.rules }
        },
        users: probe.users
    };
};
