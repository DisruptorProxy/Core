import type { CountryMode, ProfileId, Rule } from './types';

/**
 * The two country-agnostic modes. Rules are ORDERED - first match wins - and
 * every profile ends in a `final` rule so nothing is ever unrouted. Country-
 * specific modes (once dedicated `rules`/`bypass-iran` presets, Iran-only) now
 * live entirely in {@link countryRules} below - one mechanism for every
 * supported country, Iran included, instead of a hardcoded special case.
 *
 * These are the SAME rule primitives a real Xray/sing-box config uses, so a
 * profile here lowers directly to an engine routing table when the sidecar lands.
 */

const rule = (id: string, type: Rule['type'], value: string, action: Rule['action']): Rule =>
    ({ id, type, value, action });

/** Private and loopback ranges - the "local network" a preset keeps direct. */
const PRIVATE_RANGES = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7'];

const privateDirect = (): Rule[] =>
    PRIVATE_RANGES.map((cidr, i) => rule(`p-lan-${ i }`, 'ip-cidr', cidr, 'direct'));

export const PRESET_RULES: Record<Exclude<ProfileId, 'custom' | 'country'>, Rule[]> =
{
    // Everything through the proxy - the safest default under heavy filtering.
    global:
    [
        rule('g-final', 'final', '', 'proxy')
    ],

    // Only the local network is direct; everything else is proxied.
    'direct-lan':
    [
        ...privateDirect(),
        rule('dl-final', 'final', '', 'proxy')
    ]
};

export const PRESET_IDS: Exclude<ProfileId, 'custom' | 'country'>[] = ['global', 'direct-lan'];

/**
 * The country picker: ten markets where a proxy client matters most. Names render
 * via Intl.DisplayNames so they localize for free.
 */
export const BYPASS_COUNTRIES = ['ir', 'cn', 'ru', 'tr', 'ae', 'sa', 'in', 'pk', 'id', 'vn'] as const;

// Only these have a curated per-country category in the standard geosite.dat;
// every other country relies on geoip + its ccTLD, which is still the bulk of
// what "domestic web" means in practice.
const GEOSITE_BY_COUNTRY: Record<string, string> =
{
    ir: 'category-ir',
    cn: 'cn',
    ru: 'category-ru'
};

/** The direct-traffic rules shared by both country modes: sites (where curated) + IPs + ccTLD. */
const countryDirect = (country: string): Rule[] =>
{
    const list: Rule[] = [];
    const site = GEOSITE_BY_COUNTRY[country];

    if (site !== undefined)
    {
        list.push(rule(`bc-geosite-${ country }`, 'geosite', site, 'direct'));
    }

    list.push(rule(`bc-geoip-${ country }`, 'geoip', country, 'direct'));
    list.push(rule(`bc-suffix-${ country }`, 'domain-suffix', `.${ country }`, 'direct'));

    return list;
};

/**
 * Builds one country's ordered rules for either mode - `smart` layers the 'rules'
 * preset's ad-block + local-network-direct recipe on top of the country-direct
 * rules; `bypass` is just the country direct, everything else proxied (the
 * original bypass-iran recipe, generalized).
 */
export const countryRules = (country: string, mode: CountryMode): Rule[] =>
{
    const list: Rule[] = [];

    if (mode === 'smart')
    {
        list.push(rule(`bc-ads-${ country }`, 'geosite', 'category-ads-all', 'block'));
        list.push(...privateDirect());
    }

    list.push(...countryDirect(country));
    list.push(rule(`bc-final-${ country }`, 'final', '', 'proxy'));

    return list;
};
