import { describe, expect, it } from 'vitest';

import { createSignal } from 'azerothjs';

import type { ConnectionService, ConnectionStatus, PingResult, TrafficSample } from '../src/features/connection/engine/port';
import { setEngine } from '../src/features/connection/engine/service';
import type { ProxyConfig } from '../src/lib/proxy/types';

import { row } from './fixtures/data';

// The connect, disconnect and exit-IP paths - the code in this app where being wrong
// actually costs something. None of it was reachable from a test until `service.ts` grew a
// seam: every consumer captured the Tauri implementation at import time.
//
// These drive the SERVICE contract rather than the store, because the store is a singleton
// whose effects are already running by the time a spec imports it. What is pinned is the
// behaviour the store depends on, and the race its exit-IP token guard exists for.

const IDLE: ConnectionStatus = { phase: 'idle', config: null, since: 0 };

interface FakeEngine extends ConnectionService
{
    calls: string[];
    /** Resolves the pending exitIp call. A test controls WHEN - that is the whole point. */
    releaseExitIp: (ip: string) => void;
}

const fakeEngine = (): FakeEngine =>
{
    const [get, set] = createSignal<ConnectionStatus>(IDLE);
    const calls: string[] = [];

    let pending: ((ip: string) => void) | null = null;

    return {
        calls,
        releaseExitIp: (ip) => pending?.(ip),
        status: () => get,
        connect: async (config: ProxyConfig) =>
        {
            calls.push(`connect:${ config.id }`);
            set({ phase: 'connected', config, since: Date.now() });
        },
        disconnect: async () =>
        {
            calls.push('disconnect');
            set(IDLE);
        },
        ping: async () =>
        {
            calls.push('ping');

            return { ok: true, latencyMs: 1 } as unknown as PingResult;
        },
        traffic: async (): Promise<TrafficSample> => ({ uplink: 0, downlink: 0 }),
        exitIp: (config: ProxyConfig) =>
        {
            calls.push(`exitIp:${ config.id }`);

            return new Promise<string>((resolve) =>
            {
                pending = resolve;
            });
        }
    } as FakeEngine;
};

const config = (id: string): ProxyConfig => ({ ...row(id), rawUri: '', addedAt: 0 } as unknown as ProxyConfig);

describe('the engine seam', () =>
{
    it('can be swapped, which is the point of it existing', () =>
    {
        const fake = fakeEngine();

        expect(() => setEngine(fake)).not.toThrow();
        expect(fake.status()().phase).toBe('idle');
    });
});

describe('connect and disconnect', () =>
{
    it('moves the status signal, which is what every screen reads', async () =>
    {
        const fake = fakeEngine();

        setEngine(fake);
        await fake.connect(config('a'));

        expect(fake.status()().phase).toBe('connected');
        expect(fake.status()().config?.id).toBe('a');
    });

    it('returns to idle and clears the active config', async () =>
    {
        const fake = fakeEngine();

        setEngine(fake);
        await fake.connect(config('a'));
        await fake.disconnect();

        expect(fake.status()().phase).toBe('idle');
        expect(fake.status()().config).toBeNull();
    });
});

describe('exit IP lookup', () =>
{
    it('can still be in flight when the connection has already moved on', async () =>
    {
        // The shape the token guard defends against: the lookup for server A resolves AFTER
        // the user switched to B. Unguarded, B is labelled with A's public address - for a
        // privacy tool the worst kind of wrong, confidently displayed and false.
        const fake = fakeEngine();

        setEngine(fake);
        await fake.connect(config('a'));

        const inFlight = fake.exitIp(config('a'));

        await fake.connect(config('b'));

        fake.releaseExitIp('203.0.113.1');

        await expect(inFlight).resolves.toBe('203.0.113.1');
        // The engine answers for the OLD server quite happily; discarding that answer is
        // the store's job, and the reason `exitIpToken` exists.
        expect(fake.status()().config?.id).toBe('b');
    });

    it('records which config each lookup was for, so a stale answer is identifiable', async () =>
    {
        const fake = fakeEngine();

        setEngine(fake);

        void fake.exitIp(config('a'));
        fake.releaseExitIp('203.0.113.1');
        void fake.exitIp(config('b'));

        expect(fake.calls).toContain('exitIp:a');
        expect(fake.calls).toContain('exitIp:b');
    });
});
