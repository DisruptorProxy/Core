// A flag emoji is two regional-indicator code points; each maps to a letter.
const FLAG = /\p{RI}\p{RI}/u;
const REGIONAL_OFFSET = 0x1f1e6;

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

/**
 * Extract ISO-3166 alpha-2 from the first flag emoji in the input.
 * e.g. `🇩🇪` → `DE`, `🇺🇸` → `US`.
 * Returns `undefined` when no flag emoji is found.
 */
export const countryFromFlag = (input: string): string | undefined =>
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

/** Extract tags from provider marketing-speak in the name. */
export const extractTagsFromName = (input: string): string[] =>
{
    const tags: string[] = [];

    const multiplier = MULTIPLIER.exec(input);

    if (multiplier !== null)
    {
        tags.push(`${ multiplier[1] ?? multiplier[2] }x`);
    }

    for (const [pattern, tag] of KEYWORD_TAGS)
    {
        if (pattern.test(input))
        {
            tags.push(tag);
        }
    }

    return tags;
};
