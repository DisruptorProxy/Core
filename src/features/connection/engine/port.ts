import type { Getter } from 'azerothjs';

import type { ProxyConfig } from '../../../lib/proxy/types';

export type ConnectionPhase = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'switching' | 'error';

export interface ConnectionStatus
{
    phase: ConnectionPhase;
    /** The config the engine is (dis)connecting to or connected on. */
    config: ProxyConfig | null;
    /** Wall-clock ms since the connection was established; 0 unless connected. */
    since: number;
    /** Raw engine error from the last failure, for the humanizer to translate. */
    error?: string;
}

export interface PingResult
{
    /** Round-trip latency in ms on success. */
    latencyMs?: number;
    /** True when the probe reached the server. */
    ok: boolean;
    /** Raw engine error code on failure - fed to the humanizer, never shown raw. */
    error?: string;
}

export interface TrafficSample
{
    /** Cumulative bytes sent through the proxy since the connection started. */
    uplink: number;
    /** Cumulative bytes received through the proxy since the connection started. */
    downlink: number;
}

/**
 * The one seam between the UI and a real proxy core.
 *
 * Everything above this line - the connect flow, the latency pool, health scoring,
 * the error humanizer - is real. Only what is BELOW it is currently mocked, so a
 * real Xray/sing-box sidecar drops in by implementing this interface, and no
 * component changes. The mock returns real core error codes precisely so the
 * failure UI is exercised for real from day one.
 */
export interface ConnectionService
{
    connect(config: ProxyConfig): Promise<void>;
    disconnect(): Promise<void>;
    status(): Getter<ConnectionStatus>;
    /**
     * Re-syncs `status` with whatever is ACTUALLY running, for a webview that has just
     * loaded. The tunnel outlives the page - a reload, a renderer crash, a devtools
     * detach - so a fresh frontend cannot assume it starts disconnected without lying
     * about a connection that is still carrying traffic. Safe to call when nothing runs.
     */
    resume(): Promise<void>;
    /**
     * Probes one server with a real HTTP round-trip THROUGH its outbound, so a green
     * result means the server actually proxies rather than merely that its port answers.
     * `signal` aborts an in-flight probe when a test is cancelled.
     */
    ping(config: ProxyConfig, signal: AbortSignal): Promise<PingResult>;
    /** Live cumulative traffic of the active connection; zeros when nothing is running. */
    traffic(): Promise<TrafficSample>;
    /**
     * The public IP the internet currently sees, looked up THROUGH the given server's
     * outbound - so while connected it is the server's address, not the device's. Rejects
     * when nothing is running or the lookup fails.
     */
    exitIp(config: ProxyConfig): Promise<string>;
}
