import { createSignal, createStore } from 'azerothjs';

import { getSetting, putSetting } from '../lib/db/repo';
import { PRESET_RULES } from '../lib/routing/presets';
import { newRuleId } from '../lib/routing/types';
import type { ProfileId, Rule, RoutingProfile } from '../lib/routing/types';

const STORAGE_KEY = 'routing.profile';

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
    const [profileId, setProfileId] = createSignal<ProfileId>('rules');
    const [rules, setRules] = createSignal<Rule[]>(clone(PRESET_RULES.rules));

    const persist = (id: ProfileId, next: Rule[]): void =>
    {
        void putSetting<RoutingProfile>(STORAGE_KEY, { id, rules: next });
    };

    const load = async (): Promise<void> =>
    {
        const stored = await getSetting<RoutingProfile>(STORAGE_KEY);

        if (stored !== undefined)
        {
            setProfileId(stored.id);
            setRules(stored.rules);
        }
    };

    /** Loads a preset's rules wholesale. */
    const usePreset = (id: Exclude<ProfileId, 'custom'>): void =>
    {
        const next = clone(PRESET_RULES[id]);

        setProfileId(id);
        setRules(next);
        persist(id, next);
    };

    // Any edit diverges from the preset, so the active profile becomes `custom`.
    const commit = (next: Rule[]): void =>
    {
        setProfileId('custom');
        setRules(next);
        persist('custom', next);
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

    void load();

    return {
        profileId,
        rules,
        usePreset,
        addRule,
        updateRule,
        removeRule,
        move
    };
});
