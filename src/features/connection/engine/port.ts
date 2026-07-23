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

/**
 * How a server's latency is measured.
 *
 *  - `tcp`   - a raw TCP handshake to the server's own host:port. Fast, needs no
 *              core, and works for every protocol (even ones we cannot proxy); it
 *              proves the endpoint answers and how far away it is, not that it proxies.
 *  - `proxy` - a real HTTP round-trip THROUGH the server's outbound. Slower (a core
 *              carries it) but the honest end-to-end latency: green means it proxies.
 */
export type PingMode = 'tcp' | 'proxy';

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
     * Probes one server in the given mode (`tcp` handshake, or `proxy` round-trip
     * through the server). `signal` aborts an in-flight probe when a test is cancelled.
     */
    ping(config: ProxyConfig, signal: AbortSignal, mode: PingMode): Promise<PingResult>;
    /** Live cumulative traffic of the active connection; zeros when nothing is running. */
    traffic(): Promise<TrafficSample>;
}
