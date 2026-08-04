import { invoke } from '@tauri-apps/api/core';

import type { ProxyConfig } from '../../../lib/proxy/types';
import { PROBER_SOCKS_PORT, PROBE_SOCKS_PORT, buildProbeConfig, canConnect, probeUser } from '../../../lib/xray/config';

import type { PingResult } from './port';
import { engine } from './service';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const NOT_DESKTOP = 'Testing is only available in the Disruptor Proxy desktop app.';

/**
 * A single probe of one server: an HTTP request to google through that server's
 * outbound. `signal` lets a cancelled test skip a probe it hasn't started yet.
 */
type Probe = (config: ProxyConfig, signal: AbortSignal) => Promise<PingResult>;

/**
 * One live bulk-test session: a single persistent prober xray holding every
 * server's outbound, plus the `probe` that reaches each and the `stop` that tears
 * the xray down when the test ends.
 */
export interface ProbeSession
{
    probe: Probe;
    stop: () => Promise<void>;
}

/** Turns a raw invoke rejection into a string the humanizer can translate. */
const messageOf = (error: unknown): string =>
{
    if (typeof error === 'string')
    {
        return error;
    }

    return error instanceof Error ? error.message : 'probe failed';
};

/** A session whose every probe reports the same reason - used when the prober can't run. */
const deadSession = (reason: string): ProbeSession =>
    ({ probe: async (): Promise<PingResult> => ({ ok: false, error: reason }), stop: async (): Promise<void> =>
    {} });

/**
 * Starts a probe session for a set of servers and returns the probe bound to it.
 * Every probe dials google THROUGH the server, so a green result means the server
 * actually proxies traffic, not merely that its port answers.
 *
 * There is only ever ONE core involved, never a second app-xray.exe alongside a live
 * tunnel:
 *
 *  - While CONNECTED, the live core already carries every server's probe user on the
 *    shared SOCKS port (see `buildConnectConfig`), so this starts nothing and stops
 *    nothing - each probe is just a request on that port authenticated as the
 *    server's user, which the running core routes out that server's outbound.
 *
 *  - While IDLE, the sole prober (no TUN, unelevated) is brought up for the servers
 *    under test and torn down when the session ends.
 *
 * The probe user IS the server's id in both cases, so a probe authenticates correctly
 * knowing only the server. Off-Tauri, or if the core fails to start, every probe
 * degrades to a clear failure instead of throwing.
 */
export const startProbeSession = async (configs: ProxyConfig[]): Promise<ProbeSession> =>
{
    if (!isTauri())
    {
        return deadSession(NOT_DESKTOP);
    }

    const unsupported = (config: ProxyConfig): PingResult =>
        ({ ok: false, error: `${ config.protocol } is not supported by the current core.` });

    /**
     * A probe bound to ONE core's SOCKS port. The live core and the idle prober listen
     * on different ports, so the caller picks the one whose core it is actually using -
     * a probe can never be answered by the wrong core.
     */
    const probeVia = (port: number): Probe => async (config, signal): Promise<PingResult> =>
    {
        if (signal.aborted)
        {
            return { ok: false, error: 'cancelled' };
        }

        if (!canConnect(config.protocol))
        {
            return unsupported(config);
        }

        try
        {
            const latencyMs = await invoke<number>('probe_ping', { user: probeUser(config), port });

            return { ok: true, latencyMs };
        }
        catch (error)
        {
            return { ok: false, error: messageOf(error) };
        }
    };

    // Connected: reuse the running tunnel core, which already holds every server's
    // probe user on its own port. Nothing to start, nothing to stop.
    if (engine().status()().phase === 'connected')
    {
        return { probe: probeVia(PROBE_SOCKS_PORT), stop: async (): Promise<void> =>
        {} };
    }

    // Idle: stand up the sole prober for just the servers under test.
    const { config: probeConfig, users } = buildProbeConfig(configs);

    // Nothing in this set can be connected, so there is no prober to run - every
    // probe just reports "unsupported" without ever starting a core.
    if (users.size === 0)
    {
        return { probe: async (config): Promise<PingResult> => unsupported(config), stop: async (): Promise<void> =>
        {} };
    }

    try
    {
        await invoke('start_probe', { config: probeConfig });
    }
    catch (error)
    {
        return deadSession(messageOf(error));
    }

    const stop = async (): Promise<void> =>
    {
        try
        {
            await invoke('stop_probe');
        }
        catch
        {
            // Already gone, or never started - the prober is meant to be down either way.
        }
    };

    return { probe: probeVia(PROBER_SOCKS_PORT), stop };
};
