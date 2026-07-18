import { createEffect, createSignal, createStore, onCleanup } from 'azerothjs';

import {
    clearSubscriptionId,
    configsForSubscription,
    deleteConfigs,
    deleteSubscription,
    idsForSubscription,
    loadSubscriptions,
    putSubscription
} from '../lib/db/repo';
import type { SubscriptionRecord, SubscriptionUserinfo } from '../lib/db/schema';
import type { UpdateDiff } from '../lib/subs/diff';
import { fetchSubscription } from '../lib/subs/fetch';
import { parseSubscriptionUserinfo } from '../lib/subs/userinfo';

import type { UpdateRequest, WorkerResponse } from '../workers/parse-worker';

import { useConfigs } from './configs';

import { dueForUpdate } from '../components/relative-time';

/** How often the scheduler wakes to check for due subscriptions. */
const SCHEDULER_TICK_MS = 60_000;

/** A stable id for a new subscription without pulling in a uuid dependency. */
const newId = (): string => `sub_${ Date.now().toString(36) }${ Math.random().toString(36).slice(2, 8) }`;

export interface UpdateOutcome
{
    subId: string;
    diff: UpdateDiff;
}

/**
 * Subscriptions: the sources servers come from. Owns their records and the
 * update lifecycle; composes the configs store so a successful update refreshes
 * the visible list. The heavy fetch + parse + diff runs in the worker.
 */
export const useSubscriptions = createStore(() =>
{
    const configs = useConfigs();

    const [subs, setSubs] = createSignal<SubscriptionRecord[]>([]);
    // Which subs are mid-update, so each card shows its own spinner.
    const [updating, setUpdating] = createSignal<ReadonlySet<string>>(new Set());
    const [lastOutcome, setLastOutcome] = createSignal<UpdateOutcome | null>(null);
    const [error, setError] = createSignal<string | null>(null);

    const refresh = async (): Promise<void> => setSubs(await loadSubscriptions());

    const markUpdating = (id: string, active: boolean): void =>
    {
        const next = new Set(updating());

        if (active)
        {
            next.add(id);
        }
        else
        {
            next.delete(id);
        }

        setUpdating(next);
    };

    const isUpdating = (id: string): boolean => updating().has(id);

    /** Creates a subscription record (not yet fetched) and returns its id. */
    const add = async (url: string, name: string, intervalMin: number): Promise<string> =>
    {
        const record: SubscriptionRecord =
        {
            id: newId(),
            url: url.trim(),
            name: name.trim() === '' ? hostOf(url) : name.trim(),
            status: 'never',
            intervalMin,
            configCount: 0
        };

        await putSubscription(record);
        await refresh();

        return record.id;
    };

    const edit = async (record: SubscriptionRecord): Promise<void> =>
    {
        await putSubscription(record);
        await refresh();
    };

    /** Fetches, diffs, and applies an update through the worker. */
    const update = (id: string): Promise<UpdateOutcome> =>
        new Promise((resolve, reject) =>
        {
            const record = subs().find((sub) => sub.id === id);

            if (record === undefined)
            {
                reject(new Error('Subscription not found'));

                return;
            }

            setError(null);
            markUpdating(id, true);

            const runWorker = (text: string, userinfo?: SubscriptionUserinfo): void =>
            {
                const worker = new Worker(new URL('../workers/parse-worker.ts', import.meta.url), { type: 'module' });

                worker.onmessage = async (event: MessageEvent<WorkerResponse>): Promise<void> =>
                {
                    const message = event.data;

                    markUpdating(id, false);
                    worker.terminate();

                    if (message.kind === 'failed')
                    {
                        await putSubscription({ ...record, status: 'failed', lastError: message.reason });
                        await refresh();
                        setError(message.reason);
                        reject(new Error(message.reason));

                        return;
                    }

                    if (message.kind !== 'updated')
                    {
                        return;
                    }

                    const count = await idsForSubscription(id).then((ids) => ids.length);

                    await putSubscription({
                        ...record,
                        status: 'ok',
                        lastUpdatedAt: Date.now(),
                        configCount: count,
                        lastError: undefined,
                        // Keep the previous usage when this fetch carried no header,
                        // so a provider that reports it only sometimes never blanks out.
                        userinfo: userinfo ?? record.userinfo
                    });

                    await refresh();
                    await configs.refresh();

                    const outcome: UpdateOutcome = { subId: id, diff: message.diff };

                    setLastOutcome(outcome);
                    resolve(outcome);
                };

                worker.onerror = (event): void =>
                {
                    markUpdating(id, false);
                    worker.terminate();
                    setError(event.message);
                    reject(new Error(event.message));
                };

                const request: UpdateRequest = { kind: 'update', subId: id, text };

                worker.postMessage(request);
            };

            // Fetch on the main thread - native and CORS-free in the desktop app; a
            // worker cannot reach Tauri's invoke, so it only parses what it is handed.
            void fetchSubscription(record.url)
                .then((result) => runWorker(result.body, parseSubscriptionUserinfo(result.userinfo)))
                .catch(async (fetchError: unknown) =>
                {
                    const reason = fetchError instanceof Error ? fetchError.message : 'Could not reach the subscription URL';

                    markUpdating(id, false);
                    await putSubscription({ ...record, status: 'failed', lastError: reason });
                    await refresh();
                    setError(reason);
                    reject(new Error(reason));
                });
        });

    /**
     * Removes a subscription. `keepConfigs` decides its servers' fate:
     *   true  - detach them (they become unmanaged), never lost;
     *   false - delete them, but favorites are always preserved and detached.
     */
    const remove = async (id: string, keepConfigs: boolean): Promise<void> =>
    {
        const owned = await configsForSubscription(id);

        if (keepConfigs)
        {
            await clearSubscriptionId(owned.map((config) => config.id));
        }
        else
        {
            const favorites = owned.filter((config) => config.favorite).map((config) => config.id);
            const disposable = owned.filter((config) => !config.favorite).map((config) => config.id);

            await clearSubscriptionId(favorites);
            await deleteConfigs(disposable);
        }

        await deleteSubscription(id);
        await refresh();
        await configs.refresh();
    };

    // The auto-update scheduler. Each tick refreshes every subscription whose
    // interval has elapsed, sequentially - a subscription with 3000 entries and a
    // network fetch should not run alongside five others and stampede the worker or
    // the connection. A tick that is still working when the next fires is skipped.
    let ticking = false;

    const runDue = async (): Promise<void> =>
    {
        if (ticking)
        {
            return;
        }

        ticking = true;

        try
        {
            const now = Date.now();

            for (const sub of subs())
            {
                if (dueForUpdate(sub.lastUpdatedAt, sub.intervalMin, now) && !isUpdating(sub.id))
                {
                    // A failed fetch must not stop the other subscriptions.
                    await update(sub.id).catch(() => undefined);
                }
            }
        }
        finally
        {
            ticking = false;
        }
    };

    createEffect(() =>
    {
        const timer = window.setInterval(() => void runDue(), SCHEDULER_TICK_MS);

        onCleanup(() => window.clearInterval(timer));
    }, { name: 'subscription-scheduler' });

    // Load, then immediately catch up anything that went stale while the app was
    // closed - the moment a user reopens Guardian, overdue sources refresh.
    void refresh().then(() => runDue());

    return {
        subs,
        isUpdating,
        lastOutcome,
        error,
        refresh,
        add,
        edit,
        update,
        remove
    };
});

const hostOf = (url: string): string =>
{
    try
    {
        return new URL(url).host;
    }
    catch
    {
        return 'Subscription';
    }
};
