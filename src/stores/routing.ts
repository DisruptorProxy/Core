import { createSignal, createStore } from 'azerothjs';

import { getSetting, putSetting } from '../lib/db/repo';
import { PRESET_RULES, countryRules } from '../lib/routing/presets';
import { newRuleId } from '../lib/routing/types';
import type { CountryMode, ProfileId, Rule, RoutingProfile } from '../lib/routing/types';
import { bootstrap } from './bootstrap';

const STORAGE_KEY = 'routing.profile';
// The country-mode toggle (smart / bypass) is a standing user preference, persisted on its
// own rather than buried in whichever profile happens to be active: it must survive
// switching to a non-country profile and back, and be restorable the instant the page reads
// it - a page-local copy seeded once at mount lost the value to the async load() that
// resolved a beat later.
const MODE_KEY = 'routing.countryMode';
// The user's own rules, kept in their OWN slot for the same reason the country mode is:
// there is one active profile, so picking a preset or a country used to overwrite the
// only copy of hand-written rules and destroy them silently, with no undo and no warning.
// Stashing them here makes a mode a VIEW over the rules rather than a shredder.
const CUSTOM_KEY = 'routing.customRules';

const clone = (rules: Rule[]): Rule[] => rules.map((rule) => ({ ...rule }));

/**
 * The routing profile: which mode is active and its ordered rules.
 *
 * Picking a preset loads its rules; editing them switches the profile to `custom`
 * (a preset the user has diverged from is no longer that preset). Order is
 * meaningful - first match wins - so add/reorder operate on position, and the
 * `final` rule is pinned last because nothing may come after the catch-all.
 */
export const useRouting = createStore(() =>
{
    // 'global' - proxy everything - is the safest default under heavy filtering,
    // and the only country-agnostic choice that assumes nothing about where the
    // user actually is. Country-specific defaults (the old Iran-only presets)
    // are now the user's own pick from the country grid.
    const [profileId, setProfileId] = createSignal<ProfileId>('global');
    const [rules, setRules] = createSignal<Rule[]>(clone(PRESET_RULES.global));
    const [country, setCountry] = createSignal<string | null>(null);
    const [countryMode, setCountryMode] = createSignal<CountryMode>('bypass');
    const [customRules, setCustomRules] = createSignal<Rule[] | null>(null);

    // `load` is async and the page is interactive before it resolves. Without this, a tap
    // that lands in that window is undone a beat later by the stored profile arriving on
    // top of it - the edit appears to work and then silently reverts.
    let touched = false;

    const persist = (id: ProfileId, next: Rule[], countryId?: string, mode?: CountryMode): void =>
    {
        void putSetting<RoutingProfile>(STORAGE_KEY, { id, rules: next, country: countryId, countryMode: mode });
    };

    const load = async (): Promise<void> =>
    {
        const [stored, mode, saved] = await Promise.all([
            getSetting<RoutingProfile>(STORAGE_KEY),
            getSetting<CountryMode>(MODE_KEY),
            getSetting<Rule[]>(CUSTOM_KEY)
        ]);

        if (saved !== undefined && saved.length > 0)
        {
            setCustomRules(saved);
        }

        // An older install has custom rules only inside the active profile.
        else if (stored?.id === 'custom')
        {
            setCustomRules(stored.rules);
        }

        if (touched)
        {
            return;
        }

        if (stored !== undefined)
        {
            setProfileId(stored.id);
            setRules(stored.rules);
            setCountry(stored.country ?? null);
        }

        // The saved preference wins; fall back to the active profile's mode (older installs
        // that only ever persisted it inside the profile), then to 'bypass'.
        setCountryMode(mode ?? stored?.countryMode ?? 'bypass');
    };

    /** Loads a preset's rules wholesale. The user's own rules stay stashed, not destroyed. */
    const usePreset = (id: Exclude<ProfileId, 'custom' | 'country'>): void =>
    {
        const next = clone(PRESET_RULES[id]);

        touched = true;
        setProfileId(id);
        setCountry(null);
        setRules(next);
        persist(id, next);
    };

    /** Returns to the rules the user wrote, if there are any. */
    const useCustom = (): void =>
    {
        const saved = customRules();

        if (saved === null || saved.length === 0)
        {
            return;
        }

        const next = clone(saved);

        touched = true;
        setProfileId('custom');
        setCountry(null);
        setRules(next);
        persist('custom', next);
    };

    /** Builds one country's rules under the given mode (smart adds ad-block + LAN-direct). */
    const useCountry = (countryId: string, mode: CountryMode): void =>
    {
        const next = countryRules(countryId, mode);

        touched = true;
        setProfileId('country');
        setCountry(countryId);
        setCountryMode(mode);
        setRules(next);
        persist('country', next, countryId, mode);
    };

    /**
     * Picks the recipe the country grid builds on the next tap, and persists it as a
     * standing preference (independent of the active profile, so it survives switching
     * away and back). If a country is already active, it is re-applied under the new mode
     * at once, so the toggle is a live control rather than a no-op until the next tap.
     */
    const setMode = (mode: CountryMode): void =>
    {
        setCountryMode(mode);
        void putSetting<CountryMode>(MODE_KEY, mode);

        const active = country();

        if (profileId() === 'country' && active !== null)
        {
            useCountry(active, mode);
        }
    };

    // Any edit diverges from the preset, so the active profile becomes `custom`. The result
    // is also written to the custom slot, which is what survives a later mode switch.
    const commit = (next: Rule[]): void =>
    {
        touched = true;
        setProfileId('custom');
        setCountry(null);
        setRules(next);
        setCustomRules(next);
        persist('custom', next);
        void putSetting<Rule[]>(CUSTOM_KEY, next);
    };

    /** Inserts a new rule just above the pinned `final` rule. */
    const addRule = (rule: Omit<Rule, 'id'>): void =>
    {
        const current = rules();
        const finalIndex = current.findIndex((r) => r.type === 'final');
        const insertAt = finalIndex === -1 ? current.length : finalIndex;
        const next = [...current];

        next.splice(insertAt, 0, { ...rule, id: newRuleId() });
        commit(next);
    };

    const updateRule = (id: string, patch: Partial<Omit<Rule, 'id'>>): void =>
    {
        commit(rules().map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
    };

    const removeRule = (id: string): void =>
    {
        commit(rules().filter((rule) => rule.id !== id));
    };

    /** Moves a rule one position, never past the pinned `final` rule. */
    const move = (id: string, direction: -1 | 1): void =>
    {
        const current = rules();
        const index = current.findIndex((rule) => rule.id === id);
        const target = index + direction;

        if (index === -1 || target < 0 || target >= current.length)
        {
            return;
        }

        if (current[index].type === 'final' || current[target].type === 'final')
        {
            return;
        }

        const next = [...current];

        [next[index], next[target]] = [next[target], next[index]];
        commit(next);
    };

    bootstrap('routing', load);

    return {
        profileId,
        rules,
        country,
        countryMode,
        /** The user's stashed rules, or null when they have never written any. */
        customRules,
        setMode,
        usePreset,
        useCustom,
        useCountry,
        addRule,
        updateRule,
        removeRule,
        move
    };
});
