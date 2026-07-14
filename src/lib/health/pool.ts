import type { ProxyConfig } from '../proxy/types';
import type { ConnectionService, PingResult } from '../../features/connection/engine/port';

export interface PoolCallbacks
{
    /** A probe finished (success or failure). Fires once per id, in completion order. */
    onResult: (id: string, result: PingResult) => void;
    /** Progress after each completion, for the progress bar. */
    onProgress: (done: number, total: number) => void;
}

/**
 * Tests many servers with BOUNDED concurrency.
 *
 * "Test all" in other clients either blocks the UI or opens thousands of sockets
 * at once and hammers the network into uselessness. This runs a fixed number of
 * probes at a time (default 8), so the test is fast but civil, and it is
 * cancellable mid-flight - the user is never trapped waiting for 8000 pings.
 *
 * The caller decides the SET to test (usually the filtered subset), never blindly
 * all 8000.
 */
export const runPool = async (
    configs: ProxyConfig[],
    service: ConnectionService,
    concurrency: number,
    callbacks: PoolCallbacks,
    signal: AbortSignal
): Promise<void> =>
{
    let next = 0;
    let done = 0;
    const total = configs.length;

    const worker = async (): Promise<void> =>
    {
        while (next < total)
        {
            if (signal.aborted)
            {
                return;
            }

            const index = next++;
            const config = configs[index];

            let result: PingResult;

            try
            {
                result = await service.ping(config, signal);
            }
            catch (error)
            {
                // An abort ends this worker quietly; any other throw is a failed probe.
                if (error instanceof DOMException && error.name === 'AbortError')
                {
                    return;
                }

                result = { ok: false, error: error instanceof Error ? error.message : 'probe failed' };
            }

            callbacks.onResult(config.id, result);
            callbacks.onProgress(++done, total);
        }
    };

    // Launch exactly `concurrency` workers that pull from the shared cursor.
    const lanes = Array.from({ length: Math.min(concurrency, total) }, () => worker());

    await Promise.all(lanes);
};
