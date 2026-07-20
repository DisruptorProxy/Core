/**
 * Classifies whatever the user pasted, scanned, or opened.
 *
 * "Import" is one box that accepts everything a provider might hand you - a single
 * config link, thousands of them, a base64 blob, a subscription URL, or one of the
 * other clients' deep links - and figures out which it is. Guessing wrong is the
 * failure that makes users think an app ate their configs, so classification is
 * explicit and the empty case is named, never silently a no-op.
 */
type ImportInput =
    | { kind: 'subscription'; url: string }
    | { kind: 'configs'; text: string }
    | { kind: 'empty' };

/** The config URI schemes The Disruptor Proxy reads - a line starting with one is raw configs. */
const CONFIG_SCHEMES = ['vmess://', 'vless://', 'trojan://', 'ss://', 'hysteria2://', 'hy2://', 'tuic://'];

/**
 * Other clients wrap a subscription URL in a deep link. Each carries the real URL
 * in a `url=` query parameter; unwrap it rather than trying to import the deep link
 * itself.
 */
const DEEP_LINK_SCHEMES = [
    'v2rayng://install-config',
    'v2rayng://install-sub',
    'clash://install-config',
    'sing-box://import-remote-profile',
    'happ://add',
    'hiddify://install-config',
    'sn://subscription'
];

const extractUrlParam = (raw: string): string | null =>
{
    try
    {
        const url = new URL(raw);
        const nested = url.searchParams.get('url');

        return nested !== null && nested !== '' ? nested : null;
    }
    catch
    {
        return null;
    }
};

export const classifyImport = (raw: string): ImportInput =>
{
    const text = raw.trim();

    if (text === '')
    {
        return { kind: 'empty' };
    }

    const lower = text.toLowerCase();

    // A known deep link: unwrap its `url=` to the real subscription.
    if (DEEP_LINK_SCHEMES.some((scheme) => lower.startsWith(scheme)))
    {
        const nested = extractUrlParam(text);

        return nested !== null ? { kind: 'subscription', url: nested } : { kind: 'configs', text };
    }

    // Raw config links (one or many) - import them directly.
    if (CONFIG_SCHEMES.some((scheme) => lower.startsWith(scheme)))
    {
        return { kind: 'configs', text };
    }

    // A single bare http(s) URL on its own is a subscription to fetch. More than one
    // line, or anything else, is treated as a config body (base64, a list, JSON).
    if (/^https?:\/\/\S+$/.test(text) && !text.includes('\n'))
    {
        return { kind: 'subscription', url: text };
    }

    return { kind: 'configs', text };
};
