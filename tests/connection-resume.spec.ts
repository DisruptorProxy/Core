import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProxyConfig } from '../src/lib/proxy/types';

import { row } from './fixtures/data';

// A reload tears the webview down while the Rust side keeps owning the running core, so a
// fresh frontend that assumes `idle` paints "Not connected" over a tunnel that is still
// carrying the user's traffic. These pin the re-sync, including the two ways it must
// REFUSE to restore - because a false "connected" is worse than the amnesia it replaces.

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    getConfig: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

vi.mock('../src/lib/db/repo', () => ({
    getConfig: mocks.getConfig,
    getAllConfigs: vi.fn(async () => [])
}));

const { TauriConnectionService } = await import('../src/features/connection/engine/tauri');

const ACTIVE_KEY = 'connection.active';
const SERVER: ProxyConfig = row('srv-1');

beforeEach(() =>
{
    mocks.invoke.mockReset();
    mocks.getConfig.mockReset();
    localStorage.clear();

    // `isTauri()` gates every path; without this the service degrades to the browser stub.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

describe('resuming a connection the webview forgot', () =>
{
    it('restores the server and its original start time', async () =>
    {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'srv-1', since: 1_000 }));
        mocks.invoke.mockResolvedValue(true);
        mocks.getConfig.mockResolvedValue(SERVER);

        const service = new TauriConnectionService();

        await service.resume();

        const status = service.status()();

        expect(status.phase).toBe('connected');
        expect(status.config?.id).toBe('srv-1');

        // The elapsed clock has to survive the reload; re-stamping it would reset the
        // duration to zero and tell the user the session just started.
        expect(status.since).toBe(1_000);
    });

    it('stays idle when nothing is remembered, without asking Rust', async () =>
    {
        const service = new TauriConnectionService();

        await service.resume();

        expect(service.status()().phase).toBe('idle');
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it('refuses to restore when the core died while the page was gone', async () =>
    {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'srv-1', since: 1_000 }));
        mocks.invoke.mockResolvedValue(false);

        const service = new TauriConnectionService();

        await service.resume();

        expect(service.status()().phase).toBe('idle');
        expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
    });

    it('treats an unreachable status command as not running', async () =>
    {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'srv-1', since: 1_000 }));
        mocks.invoke.mockRejectedValue(new Error('command not found'));

        const service = new TauriConnectionService();

        await service.resume();

        expect(service.status()().phase).toBe('idle');
    });

    it('ignores a corrupt note rather than throwing on boot', async () =>
    {
        localStorage.setItem(ACTIVE_KEY, '{ not json');

        const service = new TauriConnectionService();

        await expect(service.resume()).resolves.toBeUndefined();
        expect(service.status()().phase).toBe('idle');
    });

    it('tears down a core whose server has left the catalogue', async () =>
    {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'gone', since: 1_000 }));
        mocks.invoke.mockResolvedValue(true);
        mocks.getConfig.mockResolvedValue(undefined);

        const service = new TauriConnectionService();

        await service.resume();

        // Nothing could name the server, so no UI could offer a disconnect. Leaving it up
        // would strand a tunnel the user cannot see or stop.
        expect(mocks.invoke).toHaveBeenCalledWith('end_xray');
        expect(service.status()().phase).toBe('idle');
        expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
    });

    it('does nothing outside the desktop shell', async () =>
    {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'srv-1', since: 1_000 }));

        const service = new TauriConnectionService();

        await service.resume();

        expect(mocks.invoke).not.toHaveBeenCalled();
        expect(service.status()().phase).toBe('idle');
    });
});

describe('the note that survives the reload', () =>
{
    it('is cleared by a clean disconnect', async () =>
    {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'srv-1', since: 1_000 }));
        mocks.invoke.mockResolvedValue(undefined);

        const service = new TauriConnectionService();

        await service.disconnect();

        expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
    });

    it('survives a FAILED disconnect, because the core is still up', async () =>
    {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: 'srv-1', since: 1_000 }));
        mocks.invoke.mockRejectedValue(new Error('still running'));

        const service = new TauriConnectionService();

        await service.disconnect();

        // The engine treats "already stopped" as success, so a rejection means traffic is
        // verifiably still tunnelled. Dropping the note here would lose it on the next
        // reload and strand exactly the connection this whole path exists to recover.
        expect(localStorage.getItem(ACTIVE_KEY)).not.toBeNull();
        expect(service.status()().phase).toBe('error');
    });
});
