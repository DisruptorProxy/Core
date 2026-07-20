/** The protocols The Disruptor Proxy can read. Anything else is reported, never silently dropped. */
export type Protocol = 'vmess' | 'vless' | 'trojan' | 'shadowsocks' | 'hysteria2' | 'tuic';

/** Stream transport. Providers spell these a dozen ways; parsers normalize to these. */
export type Transport = 'tcp' | 'ws' | 'grpc' | 'http' | 'quic' | 'httpupgrade' | 'xhttp';

/** Transport security. `reality` is its own state, not a flavour of TLS - it changes what identifies a server. */
export type Security = 'none' | 'tls' | 'reality';

/**
 * One server, normalized. Everything the UI shows, the fingerprint hashes, or the
 * engine will need is a named field; anything protocol-specific that we do not
 * model lives in `rawUri`, which is always preserved so a config can be exported
 * or handed to a core byte-for-byte.
 */
export interface ProxyConfig
{
    /** Content fingerprint - the primary key. Identical servers from six subscriptions share it. */
    id: string;

    protocol: Protocol;

    /** Cleaned display name: emoji and provider spam stripped out. */
    name: string;

    /** Exactly what the provider called it. Kept for the detail view and for export. */
    rawName: string;

    host: string;
    port: number;

    /** UUID (vmess/vless/tuic), password (trojan/ss), or auth string (hysteria2). */
    credential: string;

    transport: Transport;
    security: Security;

    /** ISO-3166 alpha-2, when the provider's name or flag emoji revealed one. */
    country?: string;

    /** Tags mined out of the name: `2.5x`, `IPv6`, `Game`, provider labels... */
    tags: string[];

    sni?: string;
    /** WebSocket path, gRPC service name, or HTTP path. */
    path?: string;
    /** Host header / SNI override sent by ws+http transports. */
    hostHeader?: string;

    /** vless flow, e.g. `xtls-rprx-vision`. */
    flow?: string;
    /** uTLS fingerprint, e.g. `chrome`. */
    tlsFingerprint?: string;
    /** REALITY public key (`pbk`). */
    publicKey?: string;
    /** REALITY short id (`sid`). */
    shortId?: string;

    /** shadowsocks cipher, e.g. `aes-256-gcm`. */
    method?: string;
    alpn?: string;

    /** vless `encryption`: `none`, or a modern post-quantum value (mlkem768...). */
    encryption?: string;
    /** xhttp transport mode: `auto`, `packet-up`, `stream-up`, `stream-one`. */
    mode?: string;
    /** xhttp `extra`: a JSON object string of advanced transport options. */
    extra?: string;

    /** True when the provider asked clients to skip certificate verification. */
    allowInsecure: boolean;

    /** The original URI, untouched. */
    rawUri: string;

    /** The subscription this came from; absent for a hand-pasted config. */
    subId?: string;

    favorite: boolean;
    addedAt: number;
}

/** Why one line could not be read. Kept per-line so the import report can point at it. */
export interface ParseError
{
    /** 1-based line number within the source the user gave us. */
    line: number;
    reason: string;
    /** A short, safe excerpt - never the whole URI, which carries credentials. */
    snippet: string;
}
