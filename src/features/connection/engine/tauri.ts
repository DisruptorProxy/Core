import { createSignal } from 'azerothjs';
import type { Getter } from 'azerothjs';
import { invoke } from '@tauri-apps/api/core';

import { buildConnectConfig, buildPingConfig, canConnect } from '../../../lib/xray/config';
import type { ProxyConfig } from '../../../lib/proxy/types';
import { useRouting } from '../../../stores/routing';
import type { ConnectionService, ConnectionStatus, PingResult } from './port';

/** True inside the Tauri desktop webview; false in a plain browser. */
const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const NOT_DESKTOP = 'Connecting is only available in the Guardian desktop app.';

/**
 * The real engine. Generates an Xray config from the server + active routing
 * profile, then drives the bundled xray.exe through the Rust commands
 * (create_xray_config / run_xray_windows / end_xray_windows / ping_xray_windows).
 *
 * The status is a local signal this service owns - Rust pushes nothing, so connect
 * and disconnect move it, and a failure moves it to `error` carrying the core's raw
 * message for the humanizer. Off-Tauri (browser dev) every method degrades to a
 * clear message instead of an uncaught invoke error.
 */
export class TauriConnectionService implements ConnectionService
{
    private readonly statusSignal: Getter<ConnectionStatus>;
    private readonly setStatus: (value: ConnectionStatus) => void;

    constructor()
    {
        const [status, setStatus] = createSignal<ConnectionStatus>({ phase: 'idle', config: null, since: 0 });

        this.statusSignal = status;
        this.setStatus = setStatus;
    }

    public status(): Getter<ConnectionStatus>
    {
        return this.statusSignal;
    }

    public async connect(config: ProxyConfig): Promise<void>
    {
        if (!isTauri())
        {
            this.setStatus({ phase: 'error', config, since: 0, error: NOT_DESKTOP });

            return;
        }

        if (!canConnect(config.protocol))
        {
            this.setStatus({ phase: 'error', config, since: 0, error: `${ config.protocol } is not supported by the current core.` });

            return;
        }

        this.setStatus({ phase: 'connecting', config, since: 0 });

        try
        {
            const xrayConfig = buildConnectConfig(config, useRouting().rules());
            const configPath = await invoke<string>('create_xray_config', { config: xrayConfig });

            await invoke<string>('run_xray_windows', { configPath });

            this.setStatus({ phase: 'connected', config, since: Date.now() });
        }
        catch (error)
        {
            this.setStatus({ phase: 'error', config, since: 0, error: messageOf(error) });
        }
    }

    public async disconnect(): Promise<void>
    {
        const current = this.statusSignal();

        this.setStatus({ phase: 'disconnecting', config: current.config, since: 0 });

        try
        {
            await invoke('end_xray_windows');
        }
        catch
        {
            // Already stopped, or never started - the desired end state is the same.
        }

        this.setStatus({ phase: 'idle', config: null, since: 0 });
    }

    public async ping(config: ProxyConfig, _signal: AbortSignal): Promise<PingResult>
    {
        if (!isTauri())
        {
            return { ok: false, error: NOT_DESKTOP };
        }

        if (!canConnect(config.protocol))
        {
            return { ok: false, error: `${ config.protocol } is not supported by the current core.` };
        }

        try
        {
            const xrayConfig = buildPingConfig(config);
            const configPath = await invoke<string>('create_xray_config', { config: xrayConfig });
            const latencyMs = await invoke<number>('ping_xray_windows', { configPath });

            return { ok: true, latencyMs };
        }
        catch (error)
        {
            return { ok: false, error: messageOf(error) };
        }
    }
}

/** Tauri rejects invoke with a string or an Error; normalise to a string for the humanizer. */
const messageOf = (error: unknown): string =>
{
    if (typeof error === 'string')
    {
        return error;
    }

    return error instanceof Error ? error.message : 'The connection failed';
};
