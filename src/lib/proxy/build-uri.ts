import type { ProxyConfig } from './types';

/**
 * Turns a config back into the link it came from - the inverse of `parse.ts`.
 *
 * Every config imported from a subscription keeps its `rawUri` untouched, so exporting
 * one has never needed this. A config the USER built in the editor has no original to
 * keep, and a config the user EDITED has one that is now a lie - the stored link would
 * still name the old host. Both need the link derived from the fields.
 *
 * The contract that matters is the ROUND TRIP: `parseUri(buildUri(c))` must produce a
 * config equal to `c` on every connection-defining field, because those fields are what
 * `fingerprint` hashes into the id. A serialiser that drops one silently changes the
 * server's identity on the next import.
 *
 * Emits the modern SIP002/standard form for each protocol, not whatever dialect the
 * original happened to use - a provider's link and this one may differ textually while
 * describing the same server.
 */

/** Percent-encodes a fragment while keeping the characters names actually use readable. */
const encodeName = (name: string): string => encodeURIComponent(name).replace(/%20/g, ' ');

const query = (pairs: [string, string | undefined][]): string =>
{
    const parts = pairs
        .filter((pair): pair is [string, string] => pair[1] !== undefined && pair[1] !== '')
        .map(([key, value]) => `${ key }=${ encodeURIComponent(value) }`);

    return parts.length === 0 ? '' : `?${ parts.join('&') }`;
};

/** A v6 literal has to be bracketed in an authority, or the port reads as part of it. */
const authority = (host: string, port: number): string =>
    (host.includes(':') ? `[${ host }]:${ port }` : `${ host }:${ port }`);

const fragment = (name: string): string => (name === '' ? '' : `#${ encodeName(name) }`);

/** Only emitted when true: absent means false to every parser, including ours. */
const flag = (on: boolean): string | undefined => (on ? '1' : undefined);

const buildVless = (config: ProxyConfig): string =>
    `vless://${ encodeURIComponent(config.credential) }@${ authority(config.host, config.port) }`
    + query([
        ['type', config.transport],
        ['security', config.security],
        ['sni', config.sni],
        ['path', config.path],
        ['host', config.hostHeader],
        ['flow', config.flow],
        ['fp', config.tlsFingerprint],
        ['pbk', config.publicKey],
        ['sid', config.shortId],
        ['alpn', config.alpn],
        ['encryption', config.encryption],
        ['mode', config.mode],
        ['extra', config.extra],
        ['allowInsecure', flag(config.allowInsecure)]
    ])
    + fragment(config.name);

const buildTrojan = (config: ProxyConfig): string =>
    `trojan://${ encodeURIComponent(config.credential) }@${ authority(config.host, config.port) }`
    + query([
        ['type', config.transport],
        ['security', config.security],
        ['sni', config.sni],
        ['path', config.path],
        ['host', config.hostHeader],
        ['fp', config.tlsFingerprint],
        ['alpn', config.alpn],
        ['allowInsecure', flag(config.allowInsecure)]
    ])
    + fragment(config.name);

/**
 * SIP002: `ss://base64(method:password)@host:port#name`. The userinfo is base64 of the
 * pair, which is why `method` is connection-defining here and absent everywhere else.
 */
const buildShadowsocks = (config: ProxyConfig): string =>
{
    const pair = `${ config.method ?? '' }:${ config.credential }`;
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(pair)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    // SIP002 carries an obfs/v2ray plugin in `?plugin=`, which the parser reads into `path`.
    // `fingerprint` hashes path, so dropping it made a plugin-bearing server come back with a
    // different id - found against a real subscription, where one config in 490 used obfs.
    return `ss://${ encoded }@${ authority(config.host, config.port) }`
        + query([['plugin', config.path]])
        + fragment(config.name);
};

/**
 * vmess is the odd one: the whole config is base64 of a JSON object, so there is no query
 * string at all. `v: '2'` is the format version every current client expects.
 */
const buildVmess = (config: ProxyConfig): string =>
{
    const body = {
        v: '2',
        ps: config.name,
        add: config.host,
        port: String(config.port),
        id: config.credential,
        aid: '0',
        // `scy` parses back into `method`, which `fingerprint` hashes - so defaulting it
        // to 'auto' when the original omitted it gave the same server a different id on
        // re-import. Emit only what the config actually carries.
        scy: config.method ?? '',
        net: config.transport,
        type: 'none',
        host: config.hostHeader ?? '',
        path: config.path ?? '',
        tls: config.security === 'none' ? '' : config.security,
        sni: config.sni ?? '',
        alpn: config.alpn ?? '',
        fp: config.tlsFingerprint ?? ''
    };

    const json = JSON.stringify(body);

    return `vmess://${ btoa(String.fromCharCode(...new TextEncoder().encode(json))) }`;
};

const buildHysteria2 = (config: ProxyConfig): string =>
    `hysteria2://${ encodeURIComponent(config.credential) }@${ authority(config.host, config.port) }`
    + query([
        ['sni', config.sni],
        ['alpn', config.alpn],
        ['insecure', flag(config.allowInsecure)]
    ])
    + fragment(config.name);

const buildTuic = (config: ProxyConfig): string =>
    `tuic://${ encodeURIComponent(config.credential) }@${ authority(config.host, config.port) }`
    + query([
        ['sni', config.sni],
        ['alpn', config.alpn],
        ['insecure', flag(config.allowInsecure)]
    ])
    + fragment(config.name);

const BUILDERS: Record<string, (config: ProxyConfig) => string> =
{
    vless: buildVless,
    vmess: buildVmess,
    trojan: buildTrojan,
    shadowsocks: buildShadowsocks,
    hysteria2: buildHysteria2,
    tuic: buildTuic
};

/**
 * The share link for a config. Returns the stored `rawUri` for anything this cannot
 * express, so an exotic imported server still exports exactly as it arrived rather than
 * being flattened into something that no longer connects.
 */
export const buildUri = (config: ProxyConfig): string =>
{
    const builder = BUILDERS[config.protocol];

    return builder === undefined ? config.rawUri : builder(config);
};
