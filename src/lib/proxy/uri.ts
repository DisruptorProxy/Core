import type { Protocol, Security, Transport } from './types';

/**
 * A parsed server before Guardian owns it: no id, no display name, no tags. The
 * dispatcher in parse.ts finishes the job (fingerprint, name normalization), so
 * each protocol parser only has to understand its own URI shape.
 */
export interface ProxyDraft
{
    protocol: Protocol;
    rawName: string;
    host: string;
    port: number;
    credential: string;
    transport: Transport;
    security: Security;
    sni?: string;
    path?: string;
    hostHeader?: string;
    flow?: string;
    tlsFingerprint?: string;
    publicKey?: string;
    shortId?: string;
    method?: string;
    alpn?: string;
    allowInsecure: boolean;
    rawUri: string;
}

/** Thrown by a parser when a URI is malformed. Carries a human reason, not a stack trace. */
export class ParseFailure extends Error
{
    constructor(reason: string)
    {
        super(reason);
        this.name = 'ParseFailure';
    }
}

/**
 * Base64 as it appears in the wild: URL-safe alphabet, padding often missing, and
 * frequently carrying UTF-8 names (Persian, Chinese, emoji) that `atob` alone
 * would mangle - so bytes go through TextDecoder rather than being read as latin1.
 */
export const decodeBase64 = (input: string): string =>
{
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

    let binary: string;

    try
    {
        binary = atob(padded);
    }
    catch
    {
        throw new ParseFailure('Not valid base64');
    }

    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

    return new TextDecoder().decode(bytes);
};

/** True when the text is plausibly a base64 blob rather than a list of URIs. */
export const looksLikeBase64 = (input: string): boolean =>
{
    const trimmed = input.trim();

    return trimmed.length > 0
        && !trimmed.includes('://')
        && /^[A-Za-z0-9+/\-_=\s]+$/.test(trimmed);
};

/** The `#fragment` of a URI, percent-decoded. Providers put the display name here. */
export const readFragment = (uri: string): string =>
{
    const hash = uri.indexOf('#');

    if (hash === -1)
    {
        return '';
    }

    const raw = uri.slice(hash + 1);

    try
    {
        return decodeURIComponent(raw);
    }
    catch
    {
        // A provider that emits a stray `%` should not cost us the whole server.
        return raw;
    }
};

export const requirePort = (raw: string | number): number =>
{
    const port = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);

    if (!Number.isInteger(port) || port < 1 || port > 65535)
    {
        return raise(`Port "${ raw }" is not between 1 and 65535`);
    }

    return port;
};

export const requireHost = (host: string): string =>
{
    const cleaned = host.trim().replace(/^\[|\]$/g, '');

    if (cleaned === '')
    {
        return raise('No server address');
    }

    return cleaned;
};

const raise = (reason: string): never =>
{
    throw new ParseFailure(reason);
};

const TRANSPORTS: Record<string, Transport> =
{
    tcp: 'tcp',
    raw: 'tcp',
    none: 'tcp',
    ws: 'ws',
    websocket: 'ws',
    grpc: 'grpc',
    gun: 'grpc',
    http: 'http',
    h2: 'http',
    quic: 'quic',
    httpupgrade: 'httpupgrade',
    xhttp: 'xhttp',
    splithttp: 'xhttp'
};

/** Providers spell the same transport half a dozen ways; collapse them all. */
export const readTransport = (raw: string | undefined | null): Transport =>
    TRANSPORTS[(raw ?? 'tcp').toLowerCase()] ?? 'tcp';

export const readSecurity = (raw: string | undefined | null): Security =>
{
    const value = (raw ?? '').toLowerCase();

    if (value === 'reality')
    {
        return 'reality';
    }

    if (value === 'tls' || value === 'xtls')
    {
        return 'tls';
    }

    return 'none';
};

/** Truthy in the several ways a provider might write it (`1`, `true`, empty-but-present). */
export const readFlag = (raw: string | undefined | null): boolean =>
    raw === '1' || raw?.toLowerCase() === 'true';

/** Drops empty strings so an absent field stays `undefined` rather than `''`. */
export const optional = (value: string | undefined | null): string | undefined =>
{
    const trimmed = value?.trim();

    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

/**
 * Splits `scheme://body` into its userinfo, host, port and query, without URL().
 * `new URL()` rejects the several shapes providers actually ship - passwords with
 * unescaped `@`, missing brackets on IPv6, empty userinfo - and losing a server to
 * a spec-correct parser helps nobody.
 */
export interface UriParts
{
    userinfo: string;
    host: string;
    port: string;
    params: URLSearchParams;
    fragment: string;
}

export const splitUri = (uri: string, scheme: string): UriParts =>
{
    const body = uri.slice(scheme.length + 3);
    const hash = body.indexOf('#');
    const withoutFragment = hash === -1 ? body : body.slice(0, hash);

    const question = withoutFragment.indexOf('?');
    const authority = question === -1 ? withoutFragment : withoutFragment.slice(0, question);
    const query = question === -1 ? '' : withoutFragment.slice(question + 1);

    // Last `@` wins: a password may legally contain one, a host may not.
    const at = authority.lastIndexOf('@');
    const userinfo = at === -1 ? '' : authority.slice(0, at);
    const hostPort = at === -1 ? authority : authority.slice(at + 1);

    // IPv6 hosts are bracketed: [::1]:443 - the colon inside must not split the port.
    const bracket = hostPort.lastIndexOf(']');
    const colon = hostPort.indexOf(':', bracket === -1 ? 0 : bracket);

    if (colon === -1)
    {
        return raise('No port');
    }

    return {
        userinfo,
        host: hostPort.slice(0, colon),
        port: hostPort.slice(colon + 1),
        params: new URLSearchParams(query),
        fragment: readFragment(uri)
    };
};
