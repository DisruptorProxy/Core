import type { ProxyConfig } from '../proxy/types';
import { STORE_CONFIGS, STORE_HEALTH, STORE_SETTINGS, STORE_SUBSCRIPTIONS, openDatabase } from './schema';
import type { HealthRecord, SubscriptionRecord } from './schema';

/**
 * The row the list actually renders. Deliberately NOT the full config: 8000
 * configs carry credentials, raw URIs and REALITY keys we never show in a row, and
 * holding all of that in memory to render a 56px line is waste. The full config is
 * read by id only when a detail sheet opens or the engine connects.
 */
export interface ConfigRow
{
    id: string;
    name: string;
    protocol: string;
    host: string;
    port: number;
    security: string;
    transport: string;
    country?: string;
    tags: string[];
    subId?: string;
    favorite: boolean;
    /** Pre-lowercased haystack, built once at load so search never lowercases 8000 strings per keystroke. */
    haystack: string;
}

const toRow = (config: ProxyConfig): ConfigRow =>
    ({
        id: config.id,
        name: config.name,
        protocol: config.protocol,
        host: config.host,
        port: config.port,
        security: config.security,
        transport: config.transport,
        country: config.country,
        tags: config.tags,
        subId: config.subId,
        favorite: config.favorite,
        haystack: `${ config.name } ${ config.host } ${ config.protocol } ${ config.security } ${ config.country ?? '' } ${ config.tags.join(' ') }`.toLowerCase()
    });

const done = <T>(request: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) =>
    {
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error ?? new Error('Database request failed'));
    });

const committed = (tx: IDBTransaction): Promise<void> =>
    new Promise((resolve, reject) =>
    {
        tx.oncomplete = (): void => resolve();
        tx.onabort = (): void => reject(tx.error ?? new Error('Database transaction aborted'));
        tx.onerror = (): void => reject(tx.error ?? new Error('Database transaction failed'));
    });

/**
 * Writes a batch of configs in ONE transaction.
 *
 * `put`, not `add`: the id is a content fingerprint, so re-importing a server the
 * user already has must update it in place (it may now belong to another
 * subscription) instead of throwing a constraint error and killing the import.
 */
export const putConfigs = async (configs: ProxyConfig[]): Promise<void> =>
{
    if (configs.length === 0)
    {
        return;
    }

    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readwrite');
    const store = tx.objectStore(STORE_CONFIGS);

    for (const config of configs)
    {
        store.put(config);
    }

    await committed(tx);

    db.close();
};

/** Loads every config as a light row, via a cursor - never 8000 full objects at once. */
export const loadRows = async (): Promise<ConfigRow[]> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readonly');
    const store = tx.objectStore(STORE_CONFIGS);

    const rows: ConfigRow[] = [];

    await new Promise<void>((resolve, reject) =>
    {
        const request = store.openCursor();

        request.onsuccess = (): void =>
        {
            const cursor = request.result;

            if (cursor === null)
            {
                resolve();

                return;
            }

            rows.push(toRow(cursor.value as ProxyConfig));
            cursor.continue();
        };

        request.onerror = (): void => reject(request.error ?? new Error('Could not read configs'));
    });

    db.close();

    return rows;
};

/** Toggles a config's favorite flag in place. Favorites are never touched by sub updates. */
export const setFavorite = async (id: string, favorite: boolean): Promise<void> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readwrite');
    const store = tx.objectStore(STORE_CONFIGS);
    const config = await done(store.get(id) as IDBRequest<ProxyConfig | undefined>);

    if (config !== undefined)
    {
        config.favorite = favorite;
        store.put(config);
    }

    await committed(tx);

    db.close();
};

/** The full config, read only when something actually needs the credentials. */
export const getConfig = async (id: string): Promise<ProxyConfig | undefined> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readonly');
    const config = await done(tx.objectStore(STORE_CONFIGS).get(id) as IDBRequest<ProxyConfig | undefined>);

    db.close();

    return config;
};

/** Full configs for an id list, in one transaction - the latency pool needs them to probe. */
export const getConfigsByIds = async (ids: string[]): Promise<ProxyConfig[]> =>
{
    if (ids.length === 0)
    {
        return [];
    }

    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readonly');
    const store = tx.objectStore(STORE_CONFIGS);

    const configs = await Promise.all(ids.map((id) =>
        done(store.get(id) as IDBRequest<ProxyConfig | undefined>)));

    db.close();

    return configs.filter((config): config is ProxyConfig => config !== undefined);
};

export const countConfigs = async (): Promise<number> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readonly');
    const count = await done(tx.objectStore(STORE_CONFIGS).count());

    db.close();

    return count;
};

export const deleteConfigs = async (ids: string[]): Promise<void> =>
{
    if (ids.length === 0)
    {
        return;
    }

    const db = await openDatabase();
    const tx = db.transaction([STORE_CONFIGS, STORE_HEALTH], 'readwrite');
    const configs = tx.objectStore(STORE_CONFIGS);
    const health = tx.objectStore(STORE_HEALTH);

    for (const id of ids)
    {
        configs.delete(id);
        // Health is keyed by config id: leaving it behind would resurrect stale
        // latencies if the same server is ever re-imported.
        health.delete(id);
    }

    await committed(tx);

    db.close();
};

export const putHealth = async (records: HealthRecord[]): Promise<void> =>
{
    if (records.length === 0)
    {
        return;
    }

    const db = await openDatabase();
    const tx = db.transaction(STORE_HEALTH, 'readwrite');
    const store = tx.objectStore(STORE_HEALTH);

    for (const record of records)
    {
        store.put(record);
    }

    await committed(tx);

    db.close();
};

export const loadHealth = async (): Promise<HealthRecord[]> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_HEALTH, 'readonly');
    const records = await done(tx.objectStore(STORE_HEALTH).getAll() as IDBRequest<HealthRecord[]>);

    db.close();

    return records;
};

export const putSubscription = async (record: SubscriptionRecord): Promise<void> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_SUBSCRIPTIONS, 'readwrite');

    tx.objectStore(STORE_SUBSCRIPTIONS).put(record);

    await committed(tx);

    db.close();
};

export const loadSubscriptions = async (): Promise<SubscriptionRecord[]> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_SUBSCRIPTIONS, 'readonly');
    const records = await done(tx.objectStore(STORE_SUBSCRIPTIONS).getAll() as IDBRequest<SubscriptionRecord[]>);

    db.close();

    return records;
};

/** Every config id belonging to a subscription - the basis of update diffs and deletes. */
export const idsForSubscription = async (subId: string): Promise<string[]> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readonly');
    const index = tx.objectStore(STORE_CONFIGS).index('by_sub');
    const keys = await done(index.getAllKeys(subId) as IDBRequest<IDBValidKey[]>);

    db.close();

    return keys.map(String);
};

/** Full configs belonging to a subscription - update diffing needs their favorite flags. */
export const configsForSubscription = async (subId: string): Promise<ProxyConfig[]> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readonly');
    const index = tx.objectStore(STORE_CONFIGS).index('by_sub');
    const configs = await done(index.getAll(subId) as IDBRequest<ProxyConfig[]>);

    db.close();

    return configs;
};

/**
 * Detaches configs from their subscription without deleting them - a favorited
 * server the provider dropped becomes unmanaged rather than lost. Also the "keep
 * configs" branch when a whole subscription is deleted.
 */
export const clearSubscriptionId = async (ids: string[]): Promise<void> =>
{
    if (ids.length === 0)
    {
        return;
    }

    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIGS, 'readwrite');
    const store = tx.objectStore(STORE_CONFIGS);

    for (const id of ids)
    {
        const config = await done(store.get(id) as IDBRequest<ProxyConfig | undefined>);

        if (config !== undefined)
        {
            config.subId = undefined;
            store.put(config);
        }
    }

    await committed(tx);

    db.close();
};

/** Reads a JSON-serializable value from the settings kv store. */
export const getSetting = async <T>(key: string): Promise<T | undefined> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const row = await done(tx.objectStore(STORE_SETTINGS).get(key) as IDBRequest<{ key: string; value: T } | undefined>);

    db.close();

    return row?.value;
};

export const putSetting = async <T>(key: string, value: T): Promise<void> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_SETTINGS, 'readwrite');

    tx.objectStore(STORE_SETTINGS).put({ key, value });

    await committed(tx);

    db.close();
};

export const deleteSubscription = async (id: string): Promise<void> =>
{
    const db = await openDatabase();
    const tx = db.transaction(STORE_SUBSCRIPTIONS, 'readwrite');

    tx.objectStore(STORE_SUBSCRIPTIONS).delete(id);

    await committed(tx);

    db.close();
};
