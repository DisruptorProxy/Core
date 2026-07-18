const DB_NAME = 'guardian';
const DB_VERSION = 1;

export const STORE_CONFIGS = 'configs';
export const STORE_HEALTH = 'health';
export const STORE_SUBSCRIPTIONS = 'subscriptions';
export const STORE_SETTINGS = 'settings';

/**
 * Health is its OWN store, keyed by config id, even though it is 1:1 with a config.
 *
 * A latency probe is the highest-frequency write in the app - testing 500 servers
 * writes 500 records - and if health lived on the config row, every probe would
 * rewrite the whole config (name, credentials, tags) and invalidate every index on
 * it. Splitting them keeps a probe a small write against a small store.
 */
export interface HealthRecord
{
    configId: string;
    /** Exponentially-weighted mean latency in ms. Absent until the first success. */
    ewmaMs?: number;
    /** 0..1 over the recent window - a flaky server and a dead one look different. */
    successRate: number;
    attempts: number;
    /** Raw engine error from the last failure, kept for the humanizer to translate. */
    lastError?: string;
    lastCheckedAt?: number;
    /** Recent samples, newest last. Bounded - this is a sparkline, not a time series DB. */
    samples: number[];
}

type SubscriptionStatus = 'ok' | 'stale' | 'failed' | 'never';

/**
 * Quota + expiry a provider reports in the `Subscription-Userinfo` response header.
 * `upload`/`download`/`total` are bytes; `expire` is a unix timestamp in seconds
 * (0 when the provider omits it). The de-facto standard every proxy client reads.
 */
export interface SubscriptionUserinfo
{
    upload: number;
    download: number;
    total: number;
    expire: number;
}

export interface SubscriptionRecord
{
    id: string;
    url: string;
    name: string;
    status: SubscriptionStatus;
    lastUpdatedAt?: number;
    /** Auto-update interval in minutes; 0 disables it. */
    intervalMin: number;
    configCount: number;
    lastError?: string;
    /** Quota + expiry from the last fetch's `Subscription-Userinfo` header, if any. */
    userinfo?: SubscriptionUserinfo;
}

/**
 * Opens (and migrates) the database. Every store is created in one place so a
 * schema change is a single, reviewable diff.
 */
export const openDatabase = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) =>
    {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (): void =>
        {
            const db = request.result;

            if (!db.objectStoreNames.contains(STORE_CONFIGS))
            {
                const configs = db.createObjectStore(STORE_CONFIGS, { keyPath: 'id' });

                // by_sub carries the whole subscription lifecycle: showing a sub's
                // servers, counting them, and removing them when it is deleted.
                configs.createIndex('by_sub', 'subId', { unique: false });
                configs.createIndex('by_protocol', 'protocol', { unique: false });
                configs.createIndex('by_host', 'host', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORE_HEALTH))
            {
                db.createObjectStore(STORE_HEALTH, { keyPath: 'configId' });
            }

            if (!db.objectStoreNames.contains(STORE_SUBSCRIPTIONS))
            {
                db.createObjectStore(STORE_SUBSCRIPTIONS, { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains(STORE_SETTINGS))
            {
                db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
            }
        };

        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error ?? new Error('Could not open the database'));
    });
