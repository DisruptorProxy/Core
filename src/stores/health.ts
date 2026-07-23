import { createSignal, createStore } from 'azerothjs';

import { getConfigsByIds, loadHealth, putHealth } from '../lib/db/repo';
import type { HealthRecord, LatencyStats } from '../lib/db/schema';
import { runPool } from '../lib/health/pool';
import { foldStats, score } from '../lib/health/score';

import type { PingMode, PingResult } from '../features/connection/engine/port';
import { startProbeSession } from '../features/connection/engine/probe';

interface TestState
{
    running: boolean;
    done: number;
    total: number;
}

const IDLE: TestState = { running: false, done: 0, total: 0 };

/** Probes at a time. Fast but civil - never opens thousands of sockets at once. */
const CONCURRENCY = 8;

/**
 * The stats a list row and the latency sort read for a server: the mode measured
 * most recently, falling back to whichever mode has any data. Undefined until the
 * server has been tested at all - which the row renders as "untested".
 */
const statsFor = (record: HealthRecord | undefined): LatencyStats | undefined =>
{
    if (record === undefined)
    {
        return undefined;
    }

    const recent = record.lastMode !== undefined ? record[record.lastMode] : undefined;

    // Prefer the freshest mode, but only where it actually measured something. A failed
    // sweep leaves stats with no `ewmaMs` at all, and those must not blank out the other
    // mode's good figure - which would also silently drop the row out of the latency
    // sort. So fall through to whichever mode does have a number.
    if (recent?.ewmaMs !== undefined)
    {
        return recent;
    }

    if (record.proxy?.ewmaMs !== undefined)
    {
        return record.proxy;
    }

    if (record.tcp?.ewmaMs !== undefined)
    {
        return record.tcp;
    }

    // Nothing measured yet: hand back the freshest stats so the row still reads as
    // attempted (success rate, last error) rather than never-tested.
    return recent ?? record.proxy ?? record.tcp;
};

/**
 * Folds a probe result into the record's stats for THAT mode, and marks the mode most
 * recent so the row and sort follow the freshest measurement. The other mode's stats
 * are carried through untouched, so a TCP ping never disturbs the proxy figure.
 */
const applyResult = (record: HealthRecord | undefined, id: string, mode: PingMode, result: PingResult): HealthRecord =>
{
    const base = record ?? { configId: id };
    const stats = foldStats(mode === 'tcp' ? base.tcp : base.proxy, result);

    return mode === 'tcp'
        ? { ...base, configId: id, tcp: stats, lastMode: 'tcp' }
        : { ...base, configId: id, proxy: stats, lastMode: 'proxy' };
};

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

    // The ids with a probe currently in flight. The list reads this reactively so a
    // row shows a "pinging" state while its latency is being (re)measured, then swaps
    // to the fresh value when the probe lands.
    const [pinging, setPinging] = createSignal<ReadonlySet<string>>(new Set());

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
    const latencyOf = (id: string): number | undefined => statsFor(records().get(id))?.ewmaMs;
    const scoreOf = (id: string): number => score(statsFor(records().get(id)));

    /** Whether a probe is currently in flight for this server. */
    const isPinging = (id: string): boolean => pinging().has(id);

    /** Marks a single server as pinging - used by the detail sheet's one-off Ping so
     *  its row shows the same in-flight state a bulk test does. */
    const markPinging = (id: string): void =>
    {
        const next = new Set(pinging());

        next.add(id);
        setPinging(next);
    };

    /** Clears a single server's pinging mark once its one-off probe resolves. */
    const clearPinging = (id: string): void =>
    {
        if (!pinging().has(id))
        {
            return;
        }

        const next = new Set(pinging());

        next.delete(id);
        setPinging(next);
    };

    /** Folds a single probe into a config's health for one mode - the per-config Ping action. */
    const recordOne = async (id: string, mode: PingMode, result: PingResult): Promise<void> =>
    {
        const folded = applyResult(records().get(id), id, mode, result);
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
    const test = async (ids: string[], mode: PingMode): Promise<void> =>
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
        // timer so the UI updates smoothly rather than on every single probe. The
        // in-flight set rides the same flush, so a row's "pinging" state and its new
        // latency appear together on the same tick rather than flickering apart.
        const working = new Map(records());
        const workingPing = new Set<string>();
        let dirty = false;
        let pingDirty = false;

        const flush = (): void =>
        {
            if (dirty)
            {
                setRecords(new Map(working));
                dirty = false;
            }

            if (pingDirty)
            {
                setPinging(new Set(workingPing));
                pingDirty = false;
            }
        };

        const timer = window.setInterval(flush, 200);

        const onStart = (id: string): void =>
        {
            workingPing.add(id);
            pingDirty = true;
        };

        const onResult = (id: string, result: PingResult): void =>
        {
            working.set(id, applyResult(working.get(id), id, mode, result));
            workingPing.delete(id);
            dirty = true;
            pingDirty = true;
        };

        // A proxy test reuses ONE core for the whole set (the live tunnel when
        // connected, or a single throwaway prober when idle - never a core per
        // server); a TCP test needs no core at all, just a handshake per server.
        const session = await startProbeSession(configs, mode);

        try
        {
            await runPool(configs, session.probe, CONCURRENCY, {
                onStart,
                onResult,
                onProgress: (done, total) => setTestState({ running: true, done, total })
            }, controller.signal);
        }
        finally
        {
            await session.stop();
        }

        window.clearInterval(timer);
        flush();

        // Drop any lingering in-flight marks: a cancelled test leaves ids that started
        // but never resulted, and nothing should read as "pinging" once a test ends.
        setPinging(new Set());

        // Persist only the records we touched, in one write.
        await putHealth(configs.map((config) => working.get(config.id)!).filter(Boolean));

        setTestState(IDLE);
    };

    const cancel = (): void =>
    {
        controller?.abort();
        setPinging(new Set());
        setTestState(IDLE);
    };

    void load();

    return {
        records,
        testState,
        recordOf,
        latencyOf,
        scoreOf,
        isPinging,
        markPinging,
        clearPinging,
        recordOne,
        test,
        cancel,
        reload: load
    };
});
