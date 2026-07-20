/** What a rule matches on. These map to Xray/sing-box routing rule kinds. */
export type MatchType =
    | 'domain-suffix'
    | 'domain'
    | 'domain-keyword'
    | 'geosite'
    | 'geoip'
    | 'ip-cidr'
    | 'process'
    | 'final';

/** Where matched traffic goes. `block` drops it - the basis of ad/tracker blocking. */
export type RuleAction = 'proxy' | 'direct' | 'block';

export interface Rule
{
    id: string;
    type: MatchType;
    /** The pattern: `.ir`, `category-ads`, `192.168.0.0/16`, … Empty for `final`. */
    value: string;
    action: RuleAction;
}

/**
 * A preset id, `country` (parameterized by {@link RoutingProfile.country} and
 * {@link RoutingProfile.countryMode}), or `custom` once the user has edited the rules.
 * Country-specific presets (once dedicated `rules`/`bypass-iran` ids) are now just
 * `country` with `country: 'ir'` and the matching mode - one mechanism, not two.
 */
export type ProfileId = 'global' | 'direct-lan' | 'country' | 'custom';

/** `smart` blocks ads too (the 'rules' preset's recipe); `bypass` is sites/IPs direct only. */
export type CountryMode = 'smart' | 'bypass';

export interface RoutingProfile
{
    id: ProfileId;
    rules: Rule[];
    /** The ISO-3166 alpha-2 code a `country` profile keeps direct. */
    country?: string;
    /** Which recipe built a `country` profile's rules. */
    countryMode?: CountryMode;
}

/** A stable rule id without a uuid dependency. */
export const newRuleId = (): string => `rule_${ Date.now().toString(36) }${ Math.random().toString(36).slice(2, 7) }`;
