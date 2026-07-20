import { invoke } from '@tauri-apps/api/core';

import type { ProxyConfig } from '../../../lib/proxy/types';

import type { PingResult } from './port';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * A light TCP-connect probe for BULK testing - it reaches the server's port
 * without spawning an xray per probe, so testing hundreds of servers stays civil.
 * The detail sheet still uses the real HTTP-through-proxy ping for a single server.
 *
 * Shaped as a pool `Probe` so it drops straight into `runPool`.
 */
export const tcpProbe = async (config: ProxyConfig, _signal: AbortSignal): Promise<PingResult> =>
{
    if (!isTauri())
    {
        return { ok: false, error: 'Testing is only available in the Disruptor Proxy desktop app.' };
    }

    try
    {
        const latencyMs = await invoke<number>('tcp_ping', { host: config.host, port: config.port });

        return { ok: true, latencyMs };
    }
    catch (error)
    {
        return { ok: false, error: typeof error === 'string' ? error : 'probe failed' };
    }
};
