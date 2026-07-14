import { createStore } from 'azerothjs';
import { createSignal } from 'azerothjs';

import { getConfigsByIds, loadHealth, putHealth } from '../lib/db/repo';
import type { HealthRecord } from '../lib/db/schema';
import { fold, score } from '../lib/health/score';
import { runPool } from '../lib/health/pool';
import type { PingResult } from '../features/connection/engine/port';
import { tcpProbe } from '../features/connection/engine/tcp-ping';

export interface TestState
{
    running: boolean;
    done: number;
    total: number;
}

const IDLE: TestState = { running: false, done: 0, total: 0 };

/** Probes at a time. Fast but civil - never opens thousands of sockets at once. */
const CONCURRENCY = 8;

/**
 * Per-server health: latency and reliability, and the machinery that measures it.
 *
 * Health lives apart from the config (a probe is the highest-frequency write in
 * the app and must not rewrite a config row). The records map is a signal the list
 * reads reactively; because only ~25 rows are mounted, a batch of results re-runs
 * at most those, not 8000.
 */
export const useHealth = createStore(() =>
{
    const [records, setRecords] = createSignal<ReadonlyMap<string, HealthRecord>>(new Map());
    const [testState, setTestState] = createSignal<TestState>(IDLE);

    let controller: AbortController | null = null;

    const load = async (): Promise<void> =>
    {
        const stored = await loadHealth();
        const map = new Map<string, HealthRecord>();

        for (const record of stored)
        {
            map.set(record.configId, record);
        }

        setRecords(map);
    };

    const recordOf = (id: string): HealthRecord | undefined => records().get(id);
    const latencyOf = (id: string): number | undefined => records().get(id)?.ewmaMs;
    const scoreOf = (id: string): number => score(records().get(id));

    /** Folds a single probe into a config's health - the per-config Ping action. */
    const recordOne = async (id: string, result: PingResult): Promise<void> =>
    {
        const folded: HealthRecord = { ...fold(records().get(id), result), configId: id };
        const next = new Map(records());

        next.set(id, folded);
        setRecords(next);

        await putHealth([folded]);
    };

    /**
     * Tests a set of servers by id. Results are folded into health and flushed to
     * the signal in batches, so a 500-server test does a handful of re-renders, not
     * 500. A prior test is cancelled before a new one starts.
     */
    const test = async (ids: string[]): Promise<void> =>
    {
        controller?.abort();
        controller = new AbortController();

        const configs = await getConfigsByIds(ids);

        if (configs.length === 0)
        {
            return;
        }

        setTestState({ running: true, done: 0, total: configs.length });

        // A working copy folded into as results arrive; flushed to the signal on a
        // timer so the UI updates smoothly rather than on every single probe.
        const working = new Map(records());
        let dirty = false;

        const flush = (): void =>
        {
            if (dirty)
            {
                setRecords(new Map(working));
                dirty = false;
            }
        };

        const timer = window.setInterval(flush, 200);

        const onResult = (id: string, result: PingResult): void =>
        {
            const folded = fold(working.get(id), result);

            working.set(id, { ...folded, configId: id });
            dirty = true;
        };

        // Bulk testing uses the light TCP probe - a real handshake to the server's
        // port, without spawning an xray per probe (that is the detail sheet's job).
        await runPool(configs, tcpProbe, CONCURRENCY, {
            onResult,
            onProgress: (done, total) => setTestState({ running: true, done, total })
        }, controller.signal);

        window.clearInterval(timer);
        flush();

        // Persist only the records we touched, in one write.
        await putHealth(configs.map((config) => working.get(config.id)!).filter(Boolean));

        setTestState(IDLE);
    };

    const cancel = (): void =>
    {
        controller?.abort();
        setTestState(IDLE);
    };

    void load();

    return {
        records,
        testState,
        recordOf,
        latencyOf,
        scoreOf,
        recordOne,
        test,
        cancel,
        reload: load
    };
});
