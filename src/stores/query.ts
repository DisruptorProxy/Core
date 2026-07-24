import { createDeferred, createMemo, createSignal, createStore } from 'azerothjs';

import type { ConfigRow } from '../lib/db/repo';
import { applyFilters, buildMatcher, collectFacets, comparator } from '../lib/search/filter';
import type { Filters, SortKey } from '../lib/search/filter';

import { useConfigs } from './configs';
import { STANDALONE_KEY, useGroups } from './groups';
import { useHealth } from './health';
import { useSubscriptions } from './subscriptions';

/**
 * One row of the merged server list. The list is a flat stream of these - group headers,
 * an optional quota strip, servers, and an empty-group note - so a SINGLE virtualizer
 * windows the whole thing at 8000 rows, regardless of how they are grouped or collapsed.
 * Collapse is then a pure data change (fewer items emitted), never DOM thrash.
 */
export type ListItem =
    | GroupItem
    | UsageItem
    | EmptyItem
    | ServerItem;

/**
 * A subscription's (or the standalone group's) collapsible header. It carries only stable
 * identity: the virtual list keys by `key` and REUSES a surviving header's DOM without
 * re-running its render, so any value that changes over the header's life (count, collapse
 * state, whether the active server is inside) must be read reactively from the stores, not
 * frozen onto this item. `groupViews` is where that live data lives.
 */
export interface GroupItem
{
    kind: 'group';
    /** Unique key for the virtual list. */
    key: string;
    /** The collapse-state key (subscription id, or STANDALONE_KEY) the header toggles. */
    groupKey: string;
    /** The subscription id, or null for the standalone (manually imported) group. */
    subId: string | null;
}

/** The live, changing data for a group header - read reactively, keyed by group key. */
export interface GroupView
{
    /** Servers in this group across the whole catalogue, ignoring the active filter. */
    total: number;
    /** Servers in this group that match the active filter (equals total when not filtering). */
    matchCount: number;
    /** Whether a search/filter is narrowing the list right now. */
    filtering: boolean;
}

/** The quota / expiry strip, shown under an expanded subscription that reports usage. */
export interface UsageItem
{
    kind: 'usage';
    key: string;
    subId: string;
}

/** A one-line "nothing here yet" for an expanded group with no servers. */
export interface EmptyItem
{
    kind: 'empty';
    key: string;
}

/** One server row, resolved to its full row by id at render time. */
export interface ServerItem
{
    kind: 'server';
    key: string;
    id: string;
}

/**
 * The list's query state, and the memos that turn 8000 rows into what the list shows.
 * `visibleIds` is the flat matching-server id list (ping-all, selection, bulk actions);
 * `visibleItems` is the grouped, collapse-aware stream the merged page renders.
 */
export const useServerQuery = createStore(() =>
{
    const { rows } = useConfigs();
    const health = useHealth();
    const subscriptions = useSubscriptions();
    const groups = useGroups();

    const [query, setQuery] = createSignal('');
    const [protocols, setProtocols] = createSignal<ReadonlySet<string>>(new Set());
    const [security, setSecurity] = createSignal<ReadonlySet<string>>(new Set());
    const [subId, setSubId] = createSignal<string | null>(null);
    const [favoritesOnly, setFavoritesOnly] = createSignal(false);
    // Grouped-by-subscription is the default: a flat name/latency/country sort
    // interleaves servers from different sources, which reads as clutter once more
    // than one subscription is added.
    const [sort, setSort] = createSignal<SortKey>('subscription');

    // Only the TEXT is debounced. Chips and sort apply instantly - a debounce on a
    // single-click toggle would feel broken. `createDeferred` is the framework's
    // quiet-period debounce, so no hand-rolled timer.
    const deferredQuery = createDeferred(query, { delay: 120 });

    // Live latency from the health store. Read only inside the latency comparator,
    // so a health update re-sorts the list only while sort is 'latency' - the list
    // re-ranks live during a test, and stays still otherwise.
    const latencyOf = (id: string): number | undefined => health.latencyOf(id);

    // Subscription id -> name, rebuilt only when the subscription list itself
    // changes (add/remove/rename) - not on every filter/sort change.
    const subNames = createMemo(() => new Map(subscriptions.subs().map((sub) => [sub.id, sub.name])));
    const subNameOf = (subId: string | undefined): string | undefined =>
        subId === undefined ? undefined : subNames().get(subId);

    const currentFilters = (): Filters => ({
        query: deferredQuery(),
        protocols: protocols() as Set<string>,
        security: security() as Set<string>,
        subId: subId(),
        favoritesOnly: favoritesOnly(),
        sort: sort()
    });

    /** The flat matching-server ids - the set ping-all, selection, and bulk act on. */
    const visibleIds = createMemo(() => applyFilters(rows(), currentFilters(), latencyOf, subNameOf));

    /** Whether any filter is narrowing the list - drives search-time auto-expansion. */
    const isFiltering = (): boolean =>
        deferredQuery().trim() !== ''
        || protocols().size > 0
        || security().size > 0
        || favoritesOnly()
        || subId() !== null;

    /** Unfiltered server count per group key, so a header can show "matching / total". */
    const groupTotals = createMemo(() =>
    {
        const totals = new Map<string, number>();

        for (const row of rows())
        {
            const key = row.subId ?? STANDALONE_KEY;

            totals.set(key, (totals.get(key) ?? 0) + 1);
        }

        return totals;
    });

    /** Every group key currently on screen - what collapse-all operates over. */
    const groupKeys = createMemo(() =>
    {
        const keys = subscriptions.subs().map((sub) => sub.id);

        if ((groupTotals().get(STANDALONE_KEY) ?? 0) > 0)
        {
            keys.push(STANDALONE_KEY);
        }

        return keys;
    });

    /**
     * The grouped item stream AND the per-group live views, built in one pass so they never
     * disagree. The stream's STRUCTURE (which groups are expanded, which empties are hidden
     * during a search) is reactive here; the header's DISPLAY reads `views` reactively,
     * since the list reuses header DOM across rebuilds. Deliberately independent of the
     * connection: whether a group holds the active server is derived in the header, so
     * connecting never rebuilds the 8000-row stream.
     */
    const built = createMemo(() =>
    {
        const matcher = buildMatcher(currentFilters());
        const filtering = isFiltering();
        // Within a group the subscription sort is meaningless (one source), so it falls
        // back to name; every other sort applies inside each group as chosen.
        const withinSort = sort() === 'subscription' ? 'name' : sort();
        const cmp = comparator(withinSort, latencyOf, subNameOf);

        const totals = groupTotals();

        // Partition the matching rows once.
        const bySub = new Map<string, ConfigRow[]>();
        const standalone: ConfigRow[] = [];

        for (const row of rows())
        {
            if (!matcher(row))
            {
                continue;
            }

            if (row.subId === undefined)
            {
                standalone.push(row);
            }
            else
            {
                const bucket = bySub.get(row.subId);

                if (bucket === undefined)
                {
                    bySub.set(row.subId, [row]);
                }
                else
                {
                    bucket.push(row);
                }
            }
        }

        const items: ListItem[] = [];
        const views = new Map<string, GroupView>();

        const emit = (key: string, groupSubId: string | null, groupRows: ConfigRow[], hasUsage: boolean): void =>
        {
            const matchCount = groupRows.length;

            views.set(key, { total: totals.get(key) ?? matchCount, matchCount, filtering });

            // Empty groups are noise during a search; keep them when browsing so a source
            // stays visible even with nothing (yet) under it.
            if (filtering && matchCount === 0)
            {
                return;
            }

            const collapsed = filtering ? false : groups.isCollapsed(key);

            items.push({ kind: 'group', key: `g:${ key }`, groupKey: key, subId: groupSubId });

            if (collapsed)
            {
                return;
            }

            if (hasUsage && groupSubId !== null)
            {
                items.push({ kind: 'usage', key: `u:${ key }`, subId: groupSubId });
            }

            if (groupRows.length === 0)
            {
                items.push({ kind: 'empty', key: `e:${ key }` });

                return;
            }

            groupRows.sort(cmp);

            for (const row of groupRows)
            {
                items.push({ kind: 'server', key: `s:${ row.id }`, id: row.id });
            }
        };

        for (const sub of subscriptions.subs())
        {
            const usage = sub.userinfo;
            const hasUsage = usage !== undefined && (usage.total > 0 || usage.expire > 0);

            emit(sub.id, sub.id, bySub.get(sub.id) ?? [], hasUsage);
        }

        // The standalone group only exists when there are manual servers at all.
        if ((totals.get(STANDALONE_KEY) ?? 0) > 0)
        {
            emit(STANDALONE_KEY, null, standalone, false);
        }

        return { items, views };
    });

    const visibleItems = (): ListItem[] => built().items;

    /** Live per-group counts, keyed by group key - what a header reads for its badge. */
    const groupViews = (): Map<string, GroupView> => built().views;

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
        visibleItems,
        groupViews,
        groupKeys,
        isFiltering,
        facets
    };
});
