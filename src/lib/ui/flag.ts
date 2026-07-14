/**
 * ISO-3166 alpha-2 to its flag emoji, by mapping each letter to a regional
 * indicator. Reversing what the name normalizer did: the flag was stripped from
 * the name into a country code, and here it becomes a single clean glyph in a
 * badge - one flag, in a known place, instead of emoji scattered through the name.
 */
export const flagEmoji = (country: string | undefined): string =>
{
    if (country === undefined || country.length !== 2)
    {
        return '';
    }

    const base = 0x1f1e6;
    const upper = country.toUpperCase();

    return String.fromCodePoint(
        base + (upper.charCodeAt(0) - 65),
        base + (upper.charCodeAt(1) - 65)
    );
};
