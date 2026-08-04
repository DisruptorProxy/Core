import { describe, expect, it } from 'vitest';

import { parseUri } from '../src/lib/proxy/parse';
import type { ProxyConfig } from '../src/lib/proxy/types';
import { ParseFailure } from '../src/lib/proxy/uri';
import { countryRules } from '../src/lib/routing/presets';
import type { Rule } from '../src/lib/routing/types';
import { buildConnectConfig, buildPingConfig, buildProbeConfig, canConnect } from '../src/lib/xray/config';
import type { TunEnvironment } from '../src/lib/xray/config';

// This module writes the JSON the proxy core boots from. A malformed config is not a
// visible error - the core refuses it and the user sees "could not connect" with no
// reason - so the properties worth pinning are the ones whose breakage is silent:
// a rule referencing a missing geo database, an outbound tag nothing routes to, and
// the ordering that decides whether traffic is proxied at all.

const TUN: TunEnvironment = { os: 'windows', outboundInterface: 'Ethernet' };

const configFrom = (uri: string): ProxyConfig =>
{
    const parsed = parseUri(uri);

    if (parsed instanceof ParseFailure)
    {
        throw new Error(`fixture URI did not parse: ${ parsed.message }`);
    }

    return parsed;
};

const VLESS = configFrom('vless://00000000-0000-4000-8000-000000000001@a.example.invalid:443?type=tcp&security=tls&sni=a.example.invalid#A');
const WS = configFrom('vless://00000000-0000-4000-8000-000000000002@b.example.invalid:8443?type=ws&security=tls&path=%2Fdemo#B');
const TROJAN = configFrom('trojan://demo-not-a-real-secret@c.example.invalid:443?security=tls#C');

const ALL = [VLESS, WS, TROJAN];
const RULES: Rule[] = countryRules('ir', 'smart');

const tagsOf = (config: { outbounds: { tag?: string }[] }): Set<string> =>
    // `api` is Xray's built-in stats/API handler, declared by the `api` config block
    // rather than as an outbound, so a rule may target it without one existing.
    new Set([...config.outbounds.map((o) => o.tag).filter((t): t is string => t !== undefined), 'api']);

/**
 * A rule with no matcher at all: the catch-all every routing table must end with.
 * `network` is NOT a matcher for this purpose - the catch-all itself carries
 * `network: 'tcp,udp'`, which is a scope, not a condition on the traffic.
 */
const MATCHERS = ['domain', 'ip', 'user', 'inboundTag', 'port', 'protocol', 'source', 'attrs'];

const isCatchAll = (rule: Record<string, unknown>): boolean =>
    MATCHERS.every((key) => rule[key] === undefined);

describe('buildConnectConfig', () =>
{
    it('routes every rule to an outbound that exists', () =>
    {
        // A rule pointing at a tag with no outbound makes the core reject the whole
        // config on startup - the failure mode this test exists for.
        const built = buildConnectConfig(VLESS, RULES, ALL, TUN);
        const tags = tagsOf(built);

        for (const rule of built.routing.rules)
        {
            if (rule.outboundTag !== undefined)
            {
                expect(tags, JSON.stringify(rule)).toContain(rule.outboundTag);
            }
        }
    });

    it('keeps the final catch-all last, so nothing routes past it', () =>
    {
        const built = buildConnectConfig(VLESS, RULES, ALL, TUN);
        const rules = built.routing.rules as unknown as Record<string, unknown>[];
        const catchAlls = rules.map((r, i) => [r, i] as const).filter(([r]) => isCatchAll(r));

        expect(catchAlls, 'exactly one rule may match everything').toHaveLength(1);
        expect(catchAlls[0][1], 'the catch-all must be last, or it swallows the rules after it').toBe(rules.length - 1);
    });

    it('drops geo rules when the .dat files are absent, rather than emitting a config the core refuses', () =>
    {
        const withGeo = buildConnectConfig(VLESS, RULES, ALL, TUN, { geoip: true, geosite: true });
        const without = buildConnectConfig(VLESS, RULES, ALL, TUN, { geoip: false, geosite: false });

        const geoRules = (c: typeof withGeo): number => c.routing.rules
            .filter((r) => JSON.stringify(r).includes('geosite:') || JSON.stringify(r).includes('geoip:')).length;

        expect(geoRules(withGeo)).toBeGreaterThan(0);
        expect(geoRules(without)).toBe(0);
    });

    it('pins the outbound interface on Windows, which is what stops the core dying on tun creation', () =>
    {
        const built = buildConnectConfig(VLESS, RULES, ALL, TUN);

        expect(JSON.stringify(built)).toContain('Ethernet');
    });

    it('leaves detection to the core when no interface is given', () =>
    {
        const built = buildConnectConfig(VLESS, RULES, ALL, { os: 'linux', outboundInterface: null });

        expect(JSON.stringify(built)).not.toContain('"interface"');
    });

    it('gives the probe layer one user per connectable server', () =>
    {
        const built = buildConnectConfig(VLESS, RULES, ALL, TUN);
        const connectable = ALL.filter((c) => canConnect(c.protocol));

        expect(JSON.stringify(built.inbounds)).toContain(connectable[0].id);
    });

    it('emits no duplicate outbound tags', () =>
    {
        const built = buildConnectConfig(VLESS, RULES, ALL, TUN);
        const tags = built.outbounds.map((o) => o.tag);

        expect(new Set(tags).size).toBe(tags.length);
    });

    it('is deterministic for the same inputs', () =>
    {
        expect(buildConnectConfig(VLESS, RULES, ALL, TUN)).toEqual(buildConnectConfig(VLESS, RULES, ALL, TUN));
    });

    it('builds for a ws transport without losing the path', () =>
    {
        const built = buildConnectConfig(WS, RULES, ALL, TUN);

        expect(JSON.stringify(built)).toContain('/demo');
    });

    it('survives an empty rule list', () =>
    {
        expect(() => buildConnectConfig(VLESS, [], ALL, TUN)).not.toThrow();
    });
});

describe('buildPingConfig', () =>
{
    it('carries no tun inbound - a latency test must not touch the system route table', () =>
    {
        const built = buildPingConfig(VLESS);

        expect(built.inbounds.some((i) => i.protocol === 'tun')).toBe(false);
    });
});

describe('buildProbeConfig', () =>
{
    it('maps every connectable server to its own user', () =>
    {
        const plan = buildProbeConfig(ALL);
        const connectable = ALL.filter((c) => canConnect(c.protocol));

        expect(plan.users.size).toBe(connectable.length);

        for (const config of connectable)
        {
            expect(plan.users.has(config.id), config.name).toBe(true);
        }
    });

    it('gives each server a DISTINCT user, or probes would report one server as another', () =>
    {
        const plan = buildProbeConfig(ALL);
        const users = [...plan.users.values()];

        expect(new Set(users).size).toBe(users.length);
    });

    it('routes every probe user to an outbound that exists', () =>
    {
        const plan = buildProbeConfig(ALL);
        const tags = tagsOf(plan.config);

        for (const rule of plan.config.routing.rules)
        {
            if (rule.outboundTag !== undefined)
            {
                expect(tags, JSON.stringify(rule)).toContain(rule.outboundTag);
            }
        }
    });

    it('handles an empty server list', () =>
    {
        const plan = buildProbeConfig([]);

        expect(plan.users.size).toBe(0);
        expect(() => JSON.stringify(plan.config)).not.toThrow();
    });
});
