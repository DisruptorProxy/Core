import type { Strings } from '../i18n/types';

/**
 * A coarse "time ago" for subscription freshness. Buckets rather than exact
 * durations, because the user's question is "is this stale?", not "how many
 * seconds". Numerals come from the locale, so Persian shows Persian digits.
 */
export const relativeTime = (timestamp: number, strings: Strings, now = Date.now()): string =>
{
    const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
    const t = strings.subscriptions;

    if (seconds < 60)
    {
        return t.justNow;
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60)
    {
        return t.minutesAgo(minutes);
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24)
    {
        return t.hoursAgo(hours);
    }

    return t.daysAgo(Math.floor(hours / 24));
};

/** A subscription is considered stale once it is older than twice its interval. */
export const isStale = (lastUpdatedAt: number | undefined, intervalMin: number, now = Date.now()): boolean =>
{
    if (lastUpdatedAt === undefined || intervalMin <= 0)
    {
        return false;
    }

    return now - lastUpdatedAt > intervalMin * 60 * 1000 * 2;
};
