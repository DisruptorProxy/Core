import { createEffect, createSelector, createSignal, createStore, onCleanup } from 'azerothjs';

import { getConfig, getConfigsByIds } from '../lib/db/repo';
import type { ProxyConfig } from '../lib/proxy/types';
import { canConnect } from '../lib/xray/config';

import { useRouting } from './routing';
import { useHealth } from './health';
import { useLocale } from './locale';
import { useToast } from './toast';

import type { Rule } from '../lib/routing/types';

import type { ConnectionPhase, TrafficSample } from '../features/connection/engine/port';
import { service } from '../features/connection/engine/service';

/** How often the live traffic counters are polled from the core while connected. */
const TRAFFIC_POLL_MS = 2000;

const NO_TRAFFIC: TrafficSample = { uplink: 0, downlink: 0 };

/**
 * The connection state machine and the active-server truth.
 *
 * The phase is read straight from the engine's own status signal, so the UI can
 * never disagree with the engine about whether traffic is flowing - the ambiguity
 * ("am I actually connected?") that plagues other clients. The active-config
 * highlight is a `createSelector`: connecting to a server re-runs only the row it
 * left and the row it joined, not the whole visible list.
 */
export const useConnection = createStore(() =>
{
    const health = useHealth();
    const status = service.status();

    // A ticking clock while connected, so the status card shows a live duration.
    const [now, setNow] = createSignal(Date.now());

    createEffect(() =>
    {
        if (status().phase !== 'connected')
        {
            return;
        }

        // Seed immediately: the first interval tick is 1s away, and until then a
        // stale `now` (from before the connection) would render a negative duration.
        setNow(Date.now());

        const timer = window.setInterval(() => setNow(Date.now()), 1000);

        onCleanup(() => window.clearInterval(timer));
    }, { name: 'connection-clock' });

    // Live traffic counters, polled from the core's stats API while connected. Reset
    // to zero the moment the connection ends, so a stale figure never lingers, and
    // seeded with an immediate read so the readout is not blank for the first tick.
    const [traffic, setTraffic] = createSignal<TrafficSample>(NO_TRAFFIC);

    createEffect(() =>
    {
        if (status().phase !== 'connected')
        {
            setTraffic(NO_TRAFFIC);

            return;
        }

        const poll = (): void => void service.traffic().then(setTraffic);

        poll();

        const timer = window.setInterval(poll, TRAFFIC_POLL_MS);

        onCleanup(() => window.clearInterval(timer));
    }, { name: 'connection-traffic' });

    // The public address the tunnel presents. Unlike traffic this is NOT polled - a
    // lookup is a real request through the proxy, and the answer only changes when the
    // connection does. It is fetched once per connection and otherwise on demand.
    const [exitIp, setExitIp] = createSignal<string | null>(null);
    const [exitIpLoading, setExitIpLoading] = createSignal(false);

    // Guards against a slow lookup from a previous connection landing after a switch and
    // labelling the new server with the old server's address.
    let exitIpToken = 0;

    const refreshExitIp = async (): Promise<void> =>
    {
        const config = status().config;

        if (status().phase !== 'connected' || config === null)
        {
            return;
        }

        const token = ++exitIpToken;

        setExitIpLoading(true);

        try
        {
            const ip = await service.exitIp(config);

            if (token === exitIpToken)
            {
                setExitIp(ip);
            }
        }
        catch
        {
            // Unreachable core, a server that cannot carry the request, or a body that
            // was not an address. The card renders the null as a dash rather than an
            // error - the connection itself is reported by `phase`.
            if (token === exitIpToken)
            {
                setExitIp(null);
            }
        }
        finally
        {
            if (token === exitIpToken)
            {
                setExitIpLoading(false);
            }
        }
    };

    createEffect(() =>
    {
        if (status().phase !== 'connected')
        {
            exitIpToken += 1;
            setExitIp(null);
            setExitIpLoading(false);

            return;
        }

        void refreshExitIp();
    }, { name: 'connection-exit-ip' });

    const phase = (): ConnectionPhase => status().phase;
    const activeConfig = (): ProxyConfig | null => status().config;
    const activeId = (): string | null => status().config?.id ?? null;
    const error = (): string | undefined => status().error;

    /**
     * True during a server-swap: the engine is disconnecting from the old server
     * and about to connect to a new one. The UI shows a brief "Switching…" state
     * so the user sees the transition rather than a flash of idle.
     */
    const [switching, setSwitching] = createSignal(false);

    /** O(1) per-row: only the previously- and newly-active rows re-run on a change. */
    const isActive = createSelector<string | null>(activeId);

    /** Live seconds since the connection was established; 0 unless connected. */
    const duration = (): number =>
    {
        const since = status().since;

        return since === 0 ? 0 : Math.floor((now() - since) / 1000);
    };

    const connect = async (config: ProxyConfig): Promise<void> =>
    {
        // Always kill any lingering app-xray.exe before connecting, even when the
        // engine reports 'idle' — a crashed session can leave an orphaned process
        // that would block the new tunnel's port. The disconnect call is idempotent:
        // if nothing is running the Rust side silently succeeds.
        const currentPhase = status().phase;

        if (currentPhase !== 'idle' && currentPhase !== 'error')
        {
            setSwitching(true);
        }

        try
        {
            await service.disconnect();
        }
        catch
        {
            // Swallow - the disconnect is best-effort. The connect below moves
            // the engine to the new target regardless.
        }

        try
        {
            await service.connect(config);
        }
        catch
        {
            // The engine has already moved the status signal to `error`; the UI
            // reads that. Swallowing keeps a failed connect from surfacing as an
            // unhandled rejection.
        }
        finally
        {
            setSwitching(false);
        }
    };

    const connectToId = async (id: string): Promise<void> =>
    {
        const config = await getConfig(id);

        if (config !== undefined)
        {
            await connect(config);

            return;
        }

        const { t } = useLocale();
        const toast = useToast();

        toast.error(t().common.serverNotFound);
    };

    const disconnect = (): Promise<void> => service.disconnect();

    /**
     * Connects to the healthiest server among `ids` (usually the current filter).
     * "Best" is the reliability-weighted latency score, so a fast-but-flaky server
     * never wins over a steady one. Untested servers cannot be chosen - there is
     * nothing to rank them by.
     */
    const connectFastest = async (ids: string[]): Promise<boolean> =>
    {
        const rank = (): { id: string; score: number }[] =>
            ids
                .map((id) => ({ id, score: health.scoreOf(id) }))
                .filter((entry) => Number.isFinite(entry.score))
                .sort((a, b) => a.score - b.score);

        let ranked = rank();

        // Nothing tested yet: probe a bounded sample so "fastest" has data to rank,
        // rather than silently doing nothing. "Fastest" means the server that actually
        // proxies quickest, so this ranks by the proxy round-trip, not a bare TCP touch.
        if (ranked.length === 0)
        {
            await health.test(ids.slice(0, 80));
            ranked = rank();
        }

        if (ranked.length === 0)
        {
            return false;
        }

        // Load the top candidates and pick the fastest one the core can actually
        // run - a hy2/tuic server may score well but cannot be connected.
        const topIds = ranked.slice(0, 20).map((entry) => entry.id);
        const byId = new Map((await getConfigsByIds(topIds)).map((config) => [config.id, config]));

        const best = ranked
            .map((entry) => byId.get(entry.id))
            .find((config): config is ProxyConfig => config !== undefined && canConnect(config.protocol));

        if (best === undefined)
        {
            return false;
        }

        await connect(best);

        return true;
    };

    /**
     * When the routing profile is edited while a server is active, restart xray so
     * the new rules take effect immediately. The watcher compares the rules array
     * reference — any store mutation (`commit` / `usePreset`) produces a new array,
     * so the effect fires exactly once per edit and skips the status-transition
     * noise that follows as the engine cycles through disconnect → reconnect.
     */
    const routing = useRouting();
    let savedRules: Rule[] = routing.rules();

    createEffect(() =>
    {
        const currentRules = routing.rules();
        const config = status().config;

        if (config !== null && status().phase === 'connected' && currentRules !== savedRules)
        {
            savedRules = currentRules;

            // connect() already handles the full disconnect → connect cycle and
            // manages the switching signal, so all UI layers stay consistent.
            void connect(config);
        }
    }, { name: 'routing-restart' });

    return {
        switching,
        phase,
        activeConfig,
        activeId,
        error,
        isActive,
        duration,
        traffic,
        exitIp,
        exitIpLoading,
        refreshExitIp,
        connect,
        connectToId,
        disconnect,
        connectFastest
    };
});
