import type { PingResult } from '../../features/connection/engine/port';

import type { LatencyStats } from '../db/schema';

/** How much of the EWMA the newest sample takes. Higher = reacts faster, noisier. */
const ALPHA = 0.4;

/** Recent samples kept for the sparkline. A sparkline, not a time series - bounded. */
const MAX_SAMPLES = 20;

const EMPTY: LatencyStats =
{
    successRate: 0,
    attempts: 0,
    samples: []
};

/**
 * Folds a fresh probe into one mode's running stats for a server.
 *
 * A single ping is a coin flip; what tells a flaky server from a dead one is the
 * TREND. So latency is an exponentially-weighted mean (recent probes matter more)
 * and reliability is a success rate over the window - never a single sample shown
 * as if it were the truth, which is the way other clients mislead. Each mode folds
 * into its OWN stats, so a TCP sample never skews the proxy latency or vice versa.
 */
export const foldStats = (previous: LatencyStats | undefined, result: PingResult, now = Date.now()): LatencyStats =>
{
    const base = previous ?? EMPTY;
    const attempts = base.attempts + 1;

    // Success rate as its own EWMA, so a server that starts failing is reflected
    // quickly without a single failure erasing a good history.
    const successRate = base.attempts === 0
        ? (result.ok ? 1 : 0)
        : base.successRate * (1 - ALPHA) + (result.ok ? 1 : 0) * ALPHA;

    let ewmaMs = base.ewmaMs;
    let samples = base.samples;

    if (result.ok && result.latencyMs !== undefined)
    {
        ewmaMs = base.ewmaMs === undefined
            ? result.latencyMs
            : Math.round(base.ewmaMs * (1 - ALPHA) + result.latencyMs * ALPHA);

        samples = [...base.samples, result.latencyMs].slice(-MAX_SAMPLES);
    }

    return {
        ewmaMs,
        successRate,
        attempts,
        lastError: result.ok ? undefined : result.error,
        lastCheckedAt: now,
        samples
    };
};

type LatencyBucket = 'good' | 'fair' | 'poor' | 'unknown';

/** Latency to a semantic bucket. The row colours by this, never by a raw number. */
export const bucketFor = (ewmaMs: number | undefined): LatencyBucket =>
{
    if (ewmaMs === undefined)
    {
        return 'unknown';
    }

    if (ewmaMs < 150)
    {
        return 'good';
    }

    if (ewmaMs < 400)
    {
        return 'fair';
    }

    return 'poor';
};

/**
 * A single comparable score for "best server": latency penalised by unreliability.
 * A 100ms server that answers half the time is worse than a steady 250ms one, and
 * this ordering says so. Lower is better; unmeasured sorts to the bottom.
 */
export const score = (stats: LatencyStats | undefined): number =>
{
    if (stats?.ewmaMs === undefined || stats.successRate === 0)
    {
        return Number.POSITIVE_INFINITY;
    }

    return stats.ewmaMs / Math.max(0.05, stats.successRate);
};
