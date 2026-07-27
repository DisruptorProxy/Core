import { decodeBase64, looksLikeBase64 } from '../proxy/uri';

type SubscriptionFormat = 'uri-list' | 'base64' | 'singbox' | 'clash' | 'unknown';

interface DecodedSubscription
{
    format: SubscriptionFormat;
    /** A newline-separated list of config URIs, whatever the source format was. */
    body: string;
    /** Set when the format is recognized but Disruptor Proxy cannot read it yet. */
    unsupported?: string;
}

/**
 * A "subscription" is four different things in practice. Guessing wrong produces a
 * silently empty import - the single most common complaint about every client - so
 * the format is detected explicitly and an unreadable one says so out loud.
 */
export const decodeSubscription = (raw: string): DecodedSubscription =>
{
    const text = raw.trim();

    if (text === '')
    {
        return { format: 'unknown', body: '', unsupported: 'The file or response was empty' };
    }

    if (text.includes('://'))
    {
        return { format: 'uri-list', body: text };
    }

    if (text.startsWith('{') || text.startsWith('['))
    {
        return decodeJson(text);
    }

    // Clash ships YAML. Parsing it needs a YAML reader, which Disruptor Proxy does not
    // carry yet - so it is named and refused, not half-read.
    if (/^\s*(proxies|proxy-groups|mixed-port|port)\s*:/m.test(text))
    {
        return {
            format: 'clash',
            body: '',
            unsupported: 'Clash YAML subscriptions are not supported yet - use the base64 or URI list from your provider'
        };
    }

    if (looksLikeBase64(text))
    {
        try
        {
            const decoded = decodeBase64(text);

            // A base64 blob that decodes to something without a single URI was not
            // a subscription at all; say that rather than importing zero servers.
            return decoded.includes('://')
                ? { format: 'base64', body: decoded.trim() }
                : { format: 'unknown', body: '', unsupported: 'Decoded, but it contains no config links' };
        }
        catch
        {
            return { format: 'unknown', body: '', unsupported: 'Looks like base64 but could not be decoded' };
        }
    }

    return { format: 'unknown', body: '', unsupported: 'Unrecognized format - expected config links, base64, or a sing-box profile' };
};

/**
 * sing-box profiles carry their servers as structured outbounds rather than URIs.
 * Only the fields Disruptor Proxy models are read back out; an outbound it cannot express
 * as a URI is skipped rather than mangled.
 */
const decodeJson = (text: string): DecodedSubscription =>
{
    let parsed: unknown;

    try
    {
        parsed = JSON.parse(text);
    }
    catch
    {
        return { format: 'unknown', body: '', unsupported: 'Not valid JSON' };
    }

    const outbounds = readOutbounds(parsed);

    if (outbounds === null)
    {
        return { format: 'unknown', body: '', unsupported: 'JSON with no "outbounds" - not a sing-box profile' };
    }

    const uris = outbounds
        .map(toUri)
        .filter((uri): uri is string => uri !== null);

    return {
        format: 'singbox',
        body: uris.join('\n'),
        unsupported: uris.length === 0 ? 'The profile had no servers Disruptor Proxy can read' : undefined
    };
};

interface SingboxOutbound
{
    type?: string;
    tag?: string;
    server?: string;
    server_port?: number;
    uuid?: string;
    password?: string;
    method?: string;
}

const readOutbounds = (parsed: unknown): SingboxOutbound[] | null =>
{
    if (Array.isArray(parsed))
    {
        return parsed as SingboxOutbound[];
    }

    if (typeof parsed === 'object' && parsed !== null && 'outbounds' in parsed)
    {
        const outbounds = (parsed as { outbounds: unknown }).outbounds;

        return Array.isArray(outbounds) ? (outbounds as SingboxOutbound[]) : null;
    }

    return null;
};

const toUri = (outbound: SingboxOutbound): string | null =>
{
    const { type, tag, server, server_port: port } = outbound;

    if (server === undefined || port === undefined)
    {
        return null;
    }

    const name = encodeURIComponent(tag ?? server);

    if (type === 'vless' && outbound.uuid !== undefined)
    {
        return `vless://${ outbound.uuid }@${ server }:${ port }#${ name }`;
    }

    if (type === 'trojan' && outbound.password !== undefined)
    {
        return `trojan://${ encodeURIComponent(outbound.password) }@${ server }:${ port }#${ name }`;
    }

    if (type === 'hysteria2' && outbound.password !== undefined)
    {
        return `hysteria2://${ encodeURIComponent(outbound.password) }@${ server }:${ port }#${ name }`;
    }

    if (type === 'shadowsocks' && outbound.method !== undefined && outbound.password !== undefined)
    {
        const credential = btoa(`${ outbound.method }:${ outbound.password }`);

        return `ss://${ credential }@${ server }:${ port }#${ name }`;
    }

    return null;
};
