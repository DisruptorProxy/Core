import { createSignal } from 'azerothjs';
import type { Getter } from 'azerothjs';

import type { ProxyConfig } from '../../../lib/proxy/types';
import type { ConnectionService, ConnectionStatus, PingResult } from './port';

/** Real Xray/sing-box failure strings - the mock emits these so the humanizer and
 *  the failure UI are exercised against the actual error surface, not placeholders. */
const CORE_ERRORS =
[
    'context deadline exceeded',
    'dial tcp: i/o timeout',
    'connection refused',
    'lookup host: no such host',
    'tls: handshake failure',
    'REALITY: invalid public key',
    'read: connection reset by peer'
];

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) =>
    {
        const timer = setTimeout(resolve, ms);

        signal?.addEventListener('abort', () =>
        {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });

/** A stable pseudo-random base per host, so the same server tends to score alike. */
const hostSeed = (host: string): number =>
{
    let hash = 0;

    for (let i = 0; i < host.length; i++)
    {
        hash = (Math.imul(hash, 31) + host.charCodeAt(i)) | 0;
    }

    return Math.abs(hash);
};

/**
 * A stand-in proxy core. It fakes only the network - timings and failures are
 * modelled to look like the real thing (a stable base latency per host, jitter, a
 * realistic failure rate, and genuine core error strings), so everything built on
 * top of it behaves exactly as it will against a real Xray/sing-box sidecar.
 */
export class MockConnectionService implements ConnectionService
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
        this.setStatus({ phase: 'connecting', config, since: 0 });

        await sleep(500 + Math.random() * 500);

        // A small share of connects fail outright, so the connect-error path is
        // real rather than theoretical.
        if (Math.random() < 0.12)
        {
            const error = CORE_ERRORS[hostSeed(config.host) % CORE_ERRORS.length];

            this.setStatus({ phase: 'error', config, since: 0, error });

            throw new Error(error);
        }

        this.setStatus({ phase: 'connected', config, since: Date.now() });
    }

    public async disconnect(): Promise<void>
    {
        const current = this.statusSignal();

        this.setStatus({ phase: 'disconnecting', config: current.config, since: 0 });

        await sleep(200 + Math.random() * 200);

        this.setStatus({ phase: 'idle', config: null, since: 0 });
    }

    public async ping(config: ProxyConfig, signal: AbortSignal): Promise<PingResult>
    {
        const seed = hostSeed(config.host);

        // Base latency from the host, so "good" and "poor" servers stay consistent
        // across probes; jitter on top of it.
        const base = 40 + (seed % 500);
        const latency = Math.round(base + (Math.random() - 0.3) * 120);

        await sleep(Math.min(latency, 900), signal);

        // ~15% of probes fail, weighted so slow servers fail more often - the
        // pattern a real blocked-server population shows.
        const failChance = 0.08 + Math.min(0.25, base / 2000);

        if (Math.random() < failChance)
        {
            return { ok: false, error: CORE_ERRORS[(seed + Math.floor(Math.random() * 3)) % CORE_ERRORS.length] };
        }

        return { ok: true, latencyMs: Math.max(1, latency) };
    }
}
