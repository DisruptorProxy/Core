import type { ProxyConfig } from '../proxy/types';

/**
 * What changed when a subscription updated - the answer to "I updated and now I
 * have fewer servers, did it break?" that every other client refuses to give.
 */
export interface UpdateDiff
{
    /** Servers in the new fetch that were not in this subscription before. */
    added: number;
    /** Servers that were in this subscription and are now gone from the provider. */
    removed: number;
    /** Servers present in both fetches, unchanged. */
    unchanged: number;
    /** Removed servers kept anyway because they are favorited (never deleted). */
    keptFavorites: number;
    /** Lines that duplicated another server within the SAME fetch. */
    duplicates: number;
    /** Lines that could not be parsed. */
    invalid: number;
}

interface UpdatePlan
{
    diff: UpdateDiff;
    /** New and unchanged configs to write (put overwrites unchanged in place). */
    toPut: ProxyConfig[];
    /** Ids to delete outright - removed and not favorited. */
    toDelete: string[];
    /** Ids to keep but detach from the subscription - removed but favorited. */
    toOrphan: string[];
}

/**
 * Reconciles a fresh fetch against what the subscription held before.
 *
 * The identity is the content fingerprint, so a server that merely got RENAMED by
 * the provider is `unchanged`, not remove-then-add. Favorited servers the provider
 * dropped are never deleted - they are detached from the subscription and kept, so
 * an update can never silently take away a server the user starred.
 */
export const planUpdate = (
    fresh: ProxyConfig[],
    existing: ProxyConfig[],
    duplicates: number,
    invalid: number
): UpdatePlan =>
{
    const freshIds = new Set(fresh.map((config) => config.id));
    const existingById = new Map(existing.map((config) => [config.id, config]));

    let added = 0;
    let unchanged = 0;

    for (const config of fresh)
    {
        if (existingById.has(config.id))
        {
            unchanged++;
        }
        else
        {
            added++;
        }
    }

    const toDelete: string[] = [];
    const toOrphan: string[] = [];

    for (const config of existing)
    {
        if (freshIds.has(config.id))
        {
            continue;
        }

        if (config.favorite)
        {
            toOrphan.push(config.id);
        }
        else
        {
            toDelete.push(config.id);
        }
    }

    return {
        diff: {
            added,
            removed: toDelete.length + toOrphan.length,
            unchanged,
            keptFavorites: toOrphan.length,
            duplicates,
            invalid
        },
        toPut: fresh,
        toDelete,
        toOrphan
    };
};
