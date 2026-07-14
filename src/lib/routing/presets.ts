import type { ProfileId, Rule } from './types';

/**
 * The four routing modes, tuned for the audience: someone in Iran who wants the
 * censored web through the proxy and the local/Iranian web direct (fast, and not
 * pointlessly tunnelled). Rules are ORDERED - first match wins - and every profile
 * ends in a `final` rule so nothing is ever unrouted.
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

export const PRESET_RULES: Record<Exclude<ProfileId, 'custom'>, Rule[]> =
{
    // Everything through the proxy - the safest default under heavy filtering.
    global:
    [
        rule('g-final', 'final', '', 'proxy')
    ],

    // The smart default: block ads, keep the local and Iranian web direct, proxy
    // the rest. What most people actually want, spelled out.
    rules:
    [
        rule('r-ads', 'geosite', 'category-ads-all', 'block'),
        ...privateDirect(),
        rule('r-geosite-ir', 'geosite', 'ir', 'direct'),
        rule('r-geoip-ir', 'geoip', 'ir', 'direct'),
        rule('r-suffix-ir', 'domain-suffix', '.ir', 'direct'),
        rule('r-final', 'final', '', 'proxy')
    ],

    // Iranian sites direct, everything else proxied. The classic circumvention
    // setup - do not tunnel domestic traffic that already works.
    'bypass-iran':
    [
        rule('bi-geosite-ir', 'geosite', 'ir', 'direct'),
        rule('bi-geoip-ir', 'geoip', 'ir', 'direct'),
        rule('bi-suffix-ir', 'domain-suffix', '.ir', 'direct'),
        rule('bi-final', 'final', '', 'proxy')
    ],

    // Only the local network is direct; everything else is proxied.
    'direct-lan':
    [
        ...privateDirect(),
        rule('dl-final', 'final', '', 'proxy')
    ]
};

export const PRESET_IDS: Exclude<ProfileId, 'custom'>[] = ['rules', 'bypass-iran', 'global', 'direct-lan'];
