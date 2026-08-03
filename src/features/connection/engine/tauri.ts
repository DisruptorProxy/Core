import { createSignal } from 'azerothjs';
import type { Getter } from 'azerothjs';

import { invoke } from '@tauri-apps/api/core';

import { getAllConfigs } from '../../../lib/db/repo';
import type { ProxyConfig } from '../../../lib/proxy/types';
import { PROBE_SOCKS_PORT, buildConnectConfig, buildMobileConfig, buildPingConfig, canConnect, probeUser } from '../../../lib/xray/config';
import type { GeoAssets, TunEnvironment } from '../../../lib/xray/config';

import { isMobilePlatform, usePlatform } from '../../../stores/platform';
import { useRouting } from '../../../stores/routing';

import type { ConnectionService, ConnectionStatus, PingResult, TrafficSample } from './port';

/** True inside the Tauri desktop webview; false in a plain browser. */
const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const NOT_DESKTOP = 'Connecting is only available in the Disruptor Proxy desktop app.';

/**
 * The real engine. Generates an Xray config from the server + active routing
 * profile, then drives the bundled Xray core through the Rust commands
 * (create_xray_config / run_xray / end_xray / ping_xray). Those commands dispatch to
 * a per-OS backend in Rust, so this frontend is the same on every platform.
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
            const geo = await readGeoStatus();
            // Embed every known server as a tagged probe outbound, so a test run while
            // connected reuses this one running core instead of spawning a second one.
            const allConfigs = await getAllConfigs();

            if (isMobilePlatform())
            {
                // Mobile: the OS owns the tunnel. Hand the SOCKS-inbound config to the
                // native VPN plugin, which raises the VpnService / PacketTunnelProvider,
                // runs the core, and bridges the OS tun fd into it.
                const xrayConfig = buildMobileConfig(config, useRouting().rules(), allConfigs, geo);

                await invoke('plugin:disruptor-vpn|start', { config: xrayConfig });
            }
            else
            {
                // Xray's tun inbound needs shaping per OS: macOS only accepts a utunN
                // interface name, and Linux has to be pinned to a physical interface or
                // it can lose the one it auto-detected moments after connecting. A failed
                // lookup is harmless - the core just falls back to its own detection.
                const tun: TunEnvironment =
                {
                    os: usePlatform().os(),
                    outboundInterface: await invoke<string | null>('tun_outbound_interface').catch(() => null)
                };

                const xrayConfig = buildConnectConfig(config, useRouting().rules(), allConfigs, tun, geo);
                const configPath = await invoke<string>('create_xray_config', { config: xrayConfig });

                await invoke<string>('run_xray', { configPath });
            }

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
            await invoke(isMobilePlatform() ? 'plugin:disruptor-vpn|stop' : 'end_xray');
        }
        catch (error)
        {
            // The engine treats "already stopped" as success, so a rejection means the
            // core is verifiably STILL running and traffic is still tunnelled. Showing
            // a clean "Not connected" here would be a lie the user would act on.
            this.setStatus({ phase: 'error', config: current.config, since: 0, error: messageOf(error) });

            return;
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
            const latencyMs = await invoke<number>('ping_xray', { configPath });

            return { ok: true, latencyMs };
        }
        catch (error)
        {
            return { ok: false, error: messageOf(error) };
        }
    }

    public async traffic(): Promise<TrafficSample>
    {
        if (!isTauri())
        {
            return { uplink: 0, downlink: 0 };
        }

        try
        {
            return await invoke<TrafficSample>(isMobilePlatform() ? 'plugin:disruptor-vpn|traffic' : 'xray_traffic');
        }
        catch
        {
            // xray not running or the stats API is unreachable - nothing has moved.
            return { uplink: 0, downlink: 0 };
        }
    }

    /**
     * Asked of the RUNNING core over its probe SOCKS port rather than fetched from the
     * webview. A webview request would be right on desktop, where the tun captures the
     * whole device - but wrong on Android, where TunnelService excludes this app's uid
     * from the VPN, so the page would report the device's real address while connected.
     * Authenticating as this server's probe user routes the lookup out its outbound.
     */
    public async exitIp(config: ProxyConfig): Promise<string>
    {
        if (!isTauri())
        {
            throw new Error(NOT_DESKTOP);
        }

        return await invoke<string>('exit_ip', { user: probeUser(config), port: PROBE_SOCKS_PORT });
    }
}

/**
 * Which geo databases xray can actually load right now. A `geosite:`/`geoip:` rule
 * pointing at a missing `.dat` makes the core reject the whole config, so the
 * builder drops those rules. If the probe itself fails, assume neither is present -
 * skipping a geo rule only loses that rule, whereas keeping it kills the connection.
 */
const readGeoStatus = async (): Promise<GeoAssets> =>
{
    try
    {
        return await invoke<GeoAssets>('geo_files_status');
    }
    catch
    {
        return { geoip: false, geosite: false };
    }
};

/** Tauri rejects invoke with a string or an Error; normalise to a string for the humanizer. */
const messageOf = (error: unknown): string =>
{
    if (typeof error === 'string')
    {
        return error;
    }

    return error instanceof Error ? error.message : 'The connection failed';
};
