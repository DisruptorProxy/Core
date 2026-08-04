import { describe, expect, it } from 'vitest';

import { BYPASS_COUNTRIES, PRESET_IDS, PRESET_RULES, countryRules } from '../src/lib/routing/presets';

// Routing rules decide what leaves the machine directly and what goes through the proxy.
// Order is the whole semantics: Xray takes the FIRST match, so a `final` rule anywhere but
// last silently swallows everything after it, and a country's direct rules landing after
// `final` means the bypass never happens.

const isFinal = (match: string): boolean => match === 'final';

describe('countryRules', () =>
{
    it.each(BYPASS_COUNTRIES.map((country) => [country]))('puts final LAST for %s in both modes', (country) =>
    {
        for (const mode of ['smart', 'bypass'] as const)
        {
            const rules = countryRules(country, mode);
            const finals = rules.filter((r) => isFinal(r.type));

            expect(finals, `${ country }/${ mode } needs exactly one final`).toHaveLength(1);
            expect(isFinal(rules[rules.length - 1].type), `${ country }/${ mode } final must be last`).toBe(true);
        }
    });

    it.each(BYPASS_COUNTRIES.map((country) => [country]))('routes %s domestic traffic direct and everything else to the proxy', (country) =>
    {
        const rules = countryRules(country, 'bypass');

        expect(rules.some((r) => r.type === 'geoip' && r.value === country && r.action === 'direct')).toBe(true);
        expect(rules.some((r) => r.type === 'domain-suffix' && r.value === `.${ country }` && r.action === 'direct')).toBe(true);
        expect(rules[rules.length - 1].action).toBe('proxy');
    });

    it('gives every rule a unique id, since ids key the list rendering', () =>
    {
        for (const country of BYPASS_COUNTRIES)
        {
            for (const mode of ['smart', 'bypass'] as const)
            {
                const ids = countryRules(country, mode).map((r) => r.id);

                expect(new Set(ids).size, `${ country }/${ mode }`).toBe(ids.length);
            }
        }
    });

    it('smart mode adds ad-blocking and local-network-direct on top of bypass', () =>
    {
        const smart = countryRules('ir', 'smart');
        const bypass = countryRules('ir', 'bypass');

        expect(smart.length).toBeGreaterThan(bypass.length);
        expect(smart.some((r) => r.action === 'block')).toBe(true);
        expect(bypass.some((r) => r.action === 'block')).toBe(false);
    });

    it('only claims a curated geosite category for the countries that have one', () =>
    {
        // Asserting a geosite rule for a country geosite.dat has no category for would
        // produce a rule Xray drops, and the user would see "bypass on" doing nothing.
        const curated = ['ir', 'cn', 'ru'];

        for (const country of BYPASS_COUNTRIES)
        {
            const hasGeosite = countryRules(country, 'bypass').some((r) => r.type === 'geosite');

            expect(hasGeosite, country).toBe(curated.includes(country));
        }
    });

    it('is stable: the same inputs build the same rules', () =>
    {
        expect(countryRules('cn', 'smart')).toEqual(countryRules('cn', 'smart'));
    });
});

describe('PRESET_RULES', () =>
{
    it.each(PRESET_IDS.map((id) => [id]))('ends %s with exactly one final rule', (id) =>
    {
        const rules = PRESET_RULES[id];
        const finals = rules.filter((r) => isFinal(r.type));

        expect(finals).toHaveLength(1);
        expect(isFinal(rules[rules.length - 1].type)).toBe(true);
    });
});
