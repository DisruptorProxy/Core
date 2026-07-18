interface NormalizedName
{
    /** What the row shows: the provider's name with the noise taken out. */
    name: string;
    /** ISO-3166 alpha-2, recovered from a flag emoji or an explicit code. */
    country?: string;
    /** Facts that were buried in the name and are better shown as badges. */
    tags: string[];
}

/**
 * Provider names are advertising, not labels: "🚀🇩🇪 DE-04 | 2.5x | @free_v2ray_ch".
 * Truncating that in a list wastes the row on emoji and tells the user nothing.
 *
 * This pulls the FACTS out (country, bandwidth multiplier, IPv6, ...) so the UI
 * can show them as structured badges, and leaves a name that is actually a name.
 * The original is never lost - it is kept on the config as `rawName`.
 */

// A flag emoji is two regional-indicator code points; each maps to a letter.
const FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const REGIONAL_OFFSET = 0x1f1e6;

// An alternation, not a character class: a class that mixes pictographs with the
// combining variation selector and keycap mark can split a grapheme in half.
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{20E3}/gu;

/** `2.5x`, `1.5X`, `×3` - the bandwidth multiplier providers charge you. */
const MULTIPLIER = /(\d+(?:\.\d+)?)\s*[x×]|[x×]\s*(\d+(?:\.\d+)?)/i;

const KEYWORD_TAGS: [RegExp, string][] =
[
    [/\bipv6\b/i, 'IPv6'],
    [/\b(vip|premium)\b/i, 'VIP'],
    [/\b(trial|test)\b/i, 'Trial'],
    [/\b(game|gaming|游戏)\b/i, 'Game'],
    [/\b(netflix|nf)\b/i, 'Netflix'],
    [/\b(relay|中转)\b/i, 'Relay'],
    [/\b(direct|直连)\b/i, 'Direct']
];

/** Only accept a bare two-letter token as a country when it really is one. */
const ISO_CODES = new Set([
    'AE', 'AM', 'AR', 'AT', 'AU', 'AZ', 'BE', 'BG', 'BR', 'CA', 'CH', 'CL', 'CN', 'CY', 'CZ',
    'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GE', 'GR', 'HK', 'HU', 'ID', 'IE', 'IL', 'IN',
    'IR', 'IS', 'IT', 'JP', 'KR', 'KZ', 'LT', 'LU', 'LV', 'MD', 'MX', 'MY', 'NL', 'NO', 'NZ',
    'PL', 'PT', 'RO', 'RS', 'RU', 'SA', 'SE', 'SG', 'SK', 'TH', 'TR', 'TW', 'UA', 'UK', 'US',
    'VN', 'ZA'
]);

const countryFromFlag = (input: string): string | undefined =>
{
    const match = FLAG.exec(input);

    if (match === null)
    {
        return undefined;
    }

    const points = [...match[0]].map((character) =>
        String.fromCharCode((character.codePointAt(0) ?? 0) - REGIONAL_OFFSET + 65));

    return points.join('');
};

const countryFromText = (input: string): string | undefined =>
{
    for (const token of input.toUpperCase().split(/[^A-Z]+/))
    {
        if (ISO_CODES.has(token))
        {
            return token === 'UK' ? 'GB' : token;
        }
    }

    return undefined;
};

export const normalizeName = (rawName: string, fallback: string): NormalizedName =>
{
    const tags: string[] = [];

    const country = countryFromFlag(rawName) ?? countryFromText(rawName);

    const multiplier = MULTIPLIER.exec(rawName);

    if (multiplier !== null)
    {
        tags.push(`${ multiplier[1] ?? multiplier[2] }x`);
    }

    // A fact promoted to a badge is REMOVED from the name: leaving it in both
    // places spends the row's width saying "IPv6" twice.
    let stripped = rawName;

    for (const [pattern, tag] of KEYWORD_TAGS)
    {
        if (pattern.test(stripped))
        {
            tags.push(tag);
            stripped = stripped.replace(pattern, ' ');
        }
    }

    const name = stripped
        .replace(EMOJI, '')
        .replace(MULTIPLIER, '')
        // Telegram handles and URLs are the provider advertising itself.
        .replace(/@[\w-]+/g, '')
        .replace(/https?:\/\/\S+/g, '')
        // Collapse the separator soup that is left behind.
        .replace(/[|•·_]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, '')
        .trim();

    return {
        // A name that was ONLY emoji leaves nothing behind - fall back to the
        // address, which at least identifies the server.
        name: name === '' ? fallback : name,
        country,
        tags
    };
};
