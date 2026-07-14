import type { Getter } from 'azerothjs';

import type { ProxyConfig } from '../../../lib/proxy/types';

export type ConnectionPhase = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';

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
    /** Probes one server. `signal` aborts an in-flight probe when a test is cancelled. */
    ping(config: ProxyConfig, signal: AbortSignal): Promise<PingResult>;
}
