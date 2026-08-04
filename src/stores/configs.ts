import { createMemo, createSignal, createStore } from 'azerothjs';

import { deleteConfigs, loadRows, setFavorite } from '../lib/db/repo';
import type { ConfigRow } from '../lib/db/repo';

import type { ImportReport, ImportRequest, WorkerResponse } from '../workers/parse-worker';
import { bootstrap } from './bootstrap';

interface ImportState
{
    running: boolean;
    parsed: number;
    total: number;
}

const IDLE: ImportState = { running: false, parsed: 0, total: 0 };

/**
 * The server catalogue.
 *
 * `rows` is the light index - one small object per config, never the full record.
 * Everything the list does (search, filter, sort, virtualize) reads this array;
 * credentials and raw URIs are fetched by id only when a detail sheet or the
 * engine needs them.
 */
export const useConfigs = createStore(() =>
{
    const [rows, setRows] = createSignal<ConfigRow[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [importState, setImportState] = createSignal<ImportState>(IDLE);
    const [lastReport, setLastReport] = createSignal<ImportReport | null>(null);
    const [error, setError] = createSignal<string | null>(null);

    // Id -> row, rebuilt only when the row set changes. The virtual list renders a
    // row by looking it up here, so a scroll never touches the 8000-item array.
    const rowsById = createMemo(() =>
    {
        const map = new Map<string, ConfigRow>();

        for (const row of rows())
        {
            map.set(row.id, row);
        }

        return map;
    });

    const rowById = (id: string): ConfigRow | undefined => rowsById().get(id);

    const refresh = async (): Promise<void> =>
    {
        setLoading(true);
        setRows(await loadRows());
        setLoading(false);
    };

    /** Deletes configs (and their health) and reloads the index. */
    const remove = async (ids: string[]): Promise<void> =>
    {
        await deleteConfigs(ids);
        await refresh();
    };

    /** Flips a config's favorite flag and reloads so the row and filter update. */
    const toggleFavorite = async (id: string): Promise<void> =>
    {
        const current = rowById(id);

        await setFavorite(id, !(current?.favorite ?? false));
        await refresh();
    };

    /**
     * Hands a subscription body to the worker and resolves with its report. The
     * worker writes to IndexedDB itself, so the only thing that crosses back is
     * progress and a summary - never 8000 objects.
     */
    const importText = (text: string, subId?: string): Promise<ImportReport> =>
        new Promise((resolve, reject) =>
        {
            const worker = new Worker(new URL('../workers/parse-worker.ts', import.meta.url), { type: 'module' });

            setError(null);
            setImportState({ running: true, parsed: 0, total: 0 });

            worker.onmessage = (event: MessageEvent<WorkerResponse>): void =>
            {
                const message = event.data;

                if (message.kind === 'progress')
                {
                    setImportState({ running: true, parsed: message.parsed, total: message.total });

                    return;
                }

                setImportState(IDLE);
                worker.terminate();

                if (message.kind === 'failed')
                {
                    setError(message.reason);
                    reject(new Error(message.reason));

                    return;
                }

                if (message.kind !== 'done')
                {
                    // An import worker only ever reports progress, done, or failed.
                    return;
                }

                setLastReport(message);

                // The rows only exist once the worker's writes have landed.
                void refresh().then(() => resolve(message));
            };

            worker.onerror = (event): void =>
            {
                setImportState(IDLE);
                worker.terminate();
                setError(event.message);
                reject(new Error(event.message));
            };

            const request: ImportRequest = { kind: 'import', text, subId };

            worker.postMessage(request);
        });

    bootstrap('configs', refresh);

    return {
        rows,
        loading,
        importState,
        lastReport,
        error,
        rowById,
        refresh,
        remove,
        toggleFavorite,
        importText
    };
});
