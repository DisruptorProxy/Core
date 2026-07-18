import { createDeferred, createMemo, createSignal, createStore } from 'azerothjs';

import { applyFilters, collectFacets } from '../lib/search/filter';
import type { SortKey } from '../lib/search/filter';

import { useConfigs } from './configs';
import { useHealth } from './health';

/**
 * The list's query state, and the single memo that turns 8000 rows into the ids to
 * show. Kept apart from the configs store so raw data and view state are separate
 * concerns; it composes `useConfigs` to read the rows.
 */
export const useServerQuery = createStore(() =>
{
    const { rows } = useConfigs();
    const health = useHealth();

    const [query, setQuery] = createSignal('');
    const [protocols, setProtocols] = createSignal<ReadonlySet<string>>(new Set());
    const [security, setSecurity] = createSignal<ReadonlySet<string>>(new Set());
    const [subId, setSubId] = createSignal<string | null>(null);
    const [favoritesOnly, setFavoritesOnly] = createSignal(false);
    const [sort, setSort] = createSignal<SortKey>('name');

    // Only the TEXT is debounced. Chips and sort apply instantly - a debounce on a
    // single-click toggle would feel broken. `createDeferred` is the framework's
    // quiet-period debounce, so no hand-rolled timer.
    const deferredQuery = createDeferred(query, { delay: 120 });

    // Live latency from the health store. Read only inside the latency comparator,
    // so a health update re-sorts the list only while sort is 'latency' - the list
    // re-ranks live during a test, and stays still otherwise.
    const latencyOf = (id: string): number | undefined => health.latencyOf(id);

    /** The ids to render, recomputed only when a filter or the row set changes. */
    const visibleIds = createMemo(() =>
        applyFilters(
            rows(),
            {
                query: deferredQuery(),
                protocols: protocols() as Set<string>,
                security: security() as Set<string>,
                subId: subId(),
                favoritesOnly: favoritesOnly(),
                sort: sort()
            },
            latencyOf
        ));

    const facets = createMemo(() => collectFacets(rows()));

    const toggleValue = (
        get: () => ReadonlySet<string>,
        set: (value: ReadonlySet<string>) => void
    ) => (value: string): void =>
    {
        const next = new Set(get());

        if (next.has(value))
        {
            next.delete(value);
        }
        else
        {
            next.add(value);
        }

        set(next);
    };

    return {
        query,
        setQuery,
        protocols,
        toggleProtocol: toggleValue(protocols, setProtocols),
        security,
        toggleSecurity: toggleValue(security, setSecurity),
        subId,
        setSubId,
        favoritesOnly,
        setFavoritesOnly,
        sort,
        setSort,
        visibleIds,
        facets
    };
});
