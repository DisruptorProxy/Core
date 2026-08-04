/**
 * CSS class for flag-icons. Returns a `fi fi-xx` class string for the given
 * ISO-3166 alpha-2 country code, or an empty string if the code is not one.
 * Renders a crisp SVG flag via CSS background sprites, no emoji font needed.
 *
 * Two ASCII LETTERS, not just two characters: the code is derived from whatever
 * the provider put in the server's name, so `a1` and `12` reach here from a
 * mangled label. Those used to pass the length check and emit `fi-a1`, which
 * flag-icons has no sprite for, so the row drew a blank box where the rule is
 * to draw nothing at all. A well-formed pair that is not a real country still
 * renders whatever flag-icons has, which is nothing - the same outcome.
 *
 * Usage in AzerothJS: `<span class={ flagIcon('us') }></span>`
 */
export const flagIcon = (country: string | undefined): string =>
{
    if (country === undefined || !/^[a-z]{2}$/i.test(country))
    {
        return '';
    }

    return `fi fi-${ country.toLowerCase() }`;
};
