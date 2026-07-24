import { createSignal, createStore } from 'azerothjs';

/**
 * Which subscription groups are collapsed on the merged server list. Persisted, so a
 * user who closes a noisy source keeps it closed across navigation and restart.
 *
 * The store holds only the user's MANUAL choice. Search-driven auto-expansion is layered
 * on top in `useServerQuery` without touching this set, so clearing the search restores
 * exactly what the user had collapsed - no state to save and restore.
 *
 * Keys are subscription ids, plus the one sentinel below for the standalone group.
 */

const STORAGE_KEY = 'disruptor-proxy.collapsed-groups';

/** The group of servers that belong to no subscription (manually imported). */
export const STANDALONE_KEY = '__standalone__';

const read = (): Set<string> =>
{
    try
    {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (raw === null)
        {
            return new Set();
        }

        const parsed: unknown = JSON.parse(raw);

        return Array.isArray(parsed)
            ? new Set(parsed.filter((value): value is string => typeof value === 'string'))
            : new Set();
    }
    catch
    {
        // A corrupt value must not break the list; default to everything expanded.
        return new Set();
    }
};

const write = (keys: Set<string>): void =>
{
    try
    {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
    }
    catch
    {
        // Private-mode / quota failures are non-fatal - collapse state is a convenience.
    }
};

export const useGroups = createStore(() =>
{
    const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(read());

    const persist = (next: Set<string>): void =>
    {
        write(next);
        setCollapsed(next);
    };

    const isCollapsed = (key: string): boolean => collapsed().has(key);

    const toggle = (key: string): void =>
    {
        const next = new Set(collapsed());

        if (next.has(key))
        {
            next.delete(key);
        }
        else
        {
            next.add(key);
        }

        persist(next);
    };

    /** Collapse exactly `keys` (the current group set); anything else is dropped. */
    const collapseAll = (keys: string[]): void => persist(new Set(keys));

    const expandAll = (): void => persist(new Set());

    return { collapsed, isCollapsed, toggle, collapseAll, expandAll };
});
