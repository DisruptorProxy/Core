import type { ConfigRow } from '../db/repo';

export type SortKey = 'name' | 'latency' | 'country';

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
export type LatencyLookup = (id: string) => number | undefined;

/**
 * The one function the list depends on. Every keystroke, chip, and sort change
 * re-runs this over the full 8000-row array and returns the ids to display.
 *
 * It returns ids, not rows: the virtual list slices this array to a ~25-item
 * window and looks each row up by id, so the heavy array is built once per query
 * change, never per scroll.
 */
export const applyFilters = (
    rows: ConfigRow[],
    filters: Filters,
    latencyOf: LatencyLookup
): string[] =>
{
    // Tokenized AND search: "de ws" matches a row whose haystack contains both,
    // in any order. Tokens are pre-lowercased once here, not per row.
    const tokens = filters.query.toLowerCase().split(/\s+/).filter((token) => token !== '');

    const matched = rows.filter((row) =>
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
    });

    matched.sort(comparator(filters.sort, latencyOf));

    return matched.map((row) => row.id);
};

const comparator = (sort: SortKey, latencyOf: LatencyLookup): (a: ConfigRow, b: ConfigRow) => number =>
{
    if (sort === 'latency')
    {
        return (a, b) =>
        {
            // Unmeasured sinks to the bottom regardless of direction.
            const left = latencyOf(a.id) ?? Number.POSITIVE_INFINITY;
            const right = latencyOf(b.id) ?? Number.POSITIVE_INFINITY;

            return left - right || a.name.localeCompare(b.name);
        };
    }

    if (sort === 'country')
    {
        return (a, b) => (a.country ?? 'zz').localeCompare(b.country ?? 'zz') || a.name.localeCompare(b.name);
    }

    return (a, b) => a.name.localeCompare(b.name);
};

/** Distinct facet values present in the data, for building chips that reflect reality. */
export interface Facets
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
