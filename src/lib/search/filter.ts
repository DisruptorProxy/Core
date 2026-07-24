import type { ConfigRow } from '../db/repo';

export type SortKey = 'name' | 'latency' | 'country' | 'subscription';

export interface Filters
{
    /** Free text, matched against each row's precomputed haystack. */
    query: string;
    /** Empty means "any". A row must match one value in every non-empty facet. */
    protocols: Set<string>;
    security: Set<string>;
    subId: string | null;
    favoritesOnly: boolean;
    sort: SortKey;
}

/**
 * Latency lives in a separate store keyed by config id (a probe must not rewrite
 * a config row), so sorting by latency needs it passed in rather than read off the
 * row. Unknown latency always sorts last - a server we have not measured is not
 * "fast".
 */
type LatencyLookup = (id: string) => number | undefined;

/**
 * A row only carries its subscription's id, not its name (the name can be renamed
 * or the subscription deleted without touching every row it owns), so grouping by
 * subscription needs the name looked up. A manually-added config (no subId) has no
 * name to look up either way - it sinks to its own group after every subscription.
 */
type SubNameLookup = (subId: string | undefined) => string | undefined;

// One shared collator, reused across the ~100k comparisons a single sort of 8000
// rows makes. `String.prototype.localeCompare` builds a fresh collator per call;
// hoisting one here is several times faster on every keystroke, chip, and sort.
const collator = new Intl.Collator();

/**
 * Builds the row predicate for a set of filters. Tokens are pre-lowercased once here, so
 * the returned closure only does `includes` checks per row. Shared by `applyFilters` (the
 * flat id list) and the grouped list in `useServerQuery`, so the two can never drift.
 */
export const buildMatcher = (filters: Filters): (row: ConfigRow) => boolean =>
{
    // Tokenized AND search: "de ws" matches a row whose haystack contains both,
    // in any order.
    const tokens = filters.query.toLowerCase().split(/\s+/).filter((token) => token !== '');

    return (row) =>
    {
        if (filters.favoritesOnly && !row.favorite)
        {
            return false;
        }

        if (filters.subId !== null && row.subId !== filters.subId)
        {
            return false;
        }

        if (filters.protocols.size > 0 && !filters.protocols.has(row.protocol))
        {
            return false;
        }

        if (filters.security.size > 0 && !filters.security.has(row.security))
        {
            return false;
        }

        return tokens.every((token) => row.haystack.includes(token));
    };
};

/**
 * The one function the flat list depends on. Every keystroke, chip, and sort change
 * re-runs this over the full 8000-row array and returns the ids to display.
 *
 * It returns ids, not rows: the virtual list slices this array to a ~25-item
 * window and looks each row up by id, so the heavy array is built once per query
 * change, never per scroll.
 */
export const applyFilters = (
    rows: ConfigRow[],
    filters: Filters,
    latencyOf: LatencyLookup,
    subNameOf: SubNameLookup
): string[] =>
{
    const matched = rows.filter(buildMatcher(filters));

    matched.sort(comparator(filters.sort, latencyOf, subNameOf));

    return matched.map((row) => row.id);
};

export const comparator = (
    sort: SortKey,
    latencyOf: LatencyLookup,
    subNameOf: SubNameLookup
): (a: ConfigRow, b: ConfigRow) => number =>
{
    if (sort === 'latency')
    {
        return (a, b) =>
        {
            // Unmeasured sinks to the bottom regardless of direction.
            const left = latencyOf(a.id) ?? Number.POSITIVE_INFINITY;
            const right = latencyOf(b.id) ?? Number.POSITIVE_INFINITY;

            return left - right || collator.compare(a.name, b.name);
        };
    }

    if (sort === 'country')
    {
        return (a, b) => collator.compare(a.country ?? 'zz', b.country ?? 'zz') || collator.compare(a.name, b.name);
    }

    if (sort === 'subscription')
    {
        // A manually-added row (no subId, so no name) sorts after every named
        // subscription - '￿' collates after any real name in every locale.
        return (a, b) =>
            collator.compare(subNameOf(a.subId) ?? '￿', subNameOf(b.subId) ?? '￿')
            || collator.compare(a.name, b.name);
    }

    return (a, b) => collator.compare(a.name, b.name);
};

/** Distinct facet values present in the data, for building chips that reflect reality. */
interface Facets
{
    protocols: string[];
    security: string[];
}

export const collectFacets = (rows: ConfigRow[]): Facets =>
{
    const protocols = new Set<string>();
    const security = new Set<string>();

    for (const row of rows)
    {
        protocols.add(row.protocol);
        security.add(row.security);
    }

    return {
        protocols: [...protocols].sort(),
        security: [...security].sort()
    };
};
