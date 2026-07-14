import type { Strings } from '../i18n/types';
import type { Rule, RuleAction } from './types';

export interface RuleSentence
{
    /** The plain-language subject: "Iranian sites", "Domains ending in .ir". */
    subject: string;
    action: RuleAction;
    /** True for the fallback `final` rule, which the UI styles as the catch-all. */
    isFinal: boolean;
}

/** Private/loopback CIDRs recognised so they read as "Local network", not raw numbers. */
const PRIVATE = new Set(['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7']);

/** Well-known geosite categories that deserve a human name instead of their code. */
const GEOSITE_NAMES: Record<string, (s: Strings) => string> =
{
    'category-ads-all': (s) => s.routing.descAdsTrackers,
    'category-ads': (s) => s.routing.descAdsTrackers,
    ir: (s) => s.routing.descIranianSites,
    cn: (s) => s.routing.descChineseSites
};

/**
 * Turns a routing rule into a sentence a person can read and trust.
 *
 * Routing is where every other client loses its users: a wall of `geosite:ir`,
 * `ip-cidr`, `DIRECT`. The rules are the same underneath, but here each one says
 * what it does in words - "Iranian sites → Direct" - so the routing table is
 * legible instead of cryptic. Well-known categories and private ranges get real
 * names; anything custom falls back to a faithful literal description.
 */
export const describeRule = (rule: Rule, strings: Strings): RuleSentence =>
{
    const r = strings.routing;

    if (rule.type === 'final')
    {
        return { subject: r.descEverythingElse, action: rule.action, isFinal: true };
    }

    return { subject: subjectFor(rule, strings), action: rule.action, isFinal: false };
};

const subjectFor = (rule: Rule, strings: Strings): string =>
{
    const r = strings.routing;

    switch (rule.type)
    {
        case 'domain-suffix':
            return r.descDomainsEndingIn(rule.value);
        case 'domain':
            return r.descExactDomain(rule.value);
        case 'domain-keyword':
            return r.descDomainsContaining(rule.value);
        case 'geosite':
            return (GEOSITE_NAMES[rule.value.toLowerCase()] ?? ((_s: Strings) => r.descGeosite(rule.value)))(strings);
        case 'geoip':
            return rule.value.toLowerCase() === 'ir' ? r.descIranianIps : r.descGeoip(rule.value);
        case 'ip-cidr':
            return PRIVATE.has(rule.value) ? r.descLocalNetwork : r.descIpRange(rule.value);
        case 'process':
            return r.descApp(rule.value);
        default:
            return rule.value;
    }
};
