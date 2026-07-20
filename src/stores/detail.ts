import { createEffect, createSignal, createStore } from 'azerothjs';

import { getConfig } from '../lib/db/repo';
import type { ProxyConfig } from '../lib/proxy/types';

import { useConfigs } from './configs';
import { useConnection } from './connection';
import { useHealth } from './health';
import { useLocale } from './locale';
import { useSubscriptions } from './subscriptions';
import { useToast } from './toast';
import { useViewport } from './viewport';

import { service } from '../features/connection/engine/service';

/**
 * The open server's full detail, and every action on it. This is a store rather
 * than component state because the detail is now shown in TWO presentations - a
 * bottom sheet on phones, a side panel on wide windows - and both must read one
 * source: the loaded config, the ping state, and the same connect/copy/delete
 * handlers. Centralizing here also means the record is fetched ONCE no matter how
 * many presentations are mounted. The row that opens it (deep in the virtual
 * list) just calls `open(id)`.
 */
export const useDetail = createStore(() =>
{
    const configs = useConfigs();
    const connection = useConnection();
    const health = useHealth();
    const subscriptions = useSubscriptions();
    const toast = useToast();
    const viewport = useViewport();
    const { t } = useLocale();

    const [openId, setOpenId] = createSignal<string | null>(null);
    const [config, setConfig] = createSignal<ProxyConfig | null>(null);
    const [pinging, setPinging] = createSignal(false);
    const [copied, setCopied] = createSignal(false);

    // Load the full record (credentials, REALITY keys) when a row opens - the list
    // only ever held the light row. Clearing the selection drops the config so the
    // panel returns to its empty state.
    createEffect(() =>
    {
        const id = openId();

        if (id === null)
        {
            setConfig(null);
        }
        else
        {
            void getConfig(id).then((loaded) => setConfig(loaded ?? null));
        }
    }, { name: 'detail-load' });

    const record = (): ReturnType<typeof health.recordOf> =>
    {
        const current = config();

        return current === null ? undefined : health.recordOf(current.id);
    };

    const favorite = (): boolean =>
    {
        const current = config();

        return current === null ? false : (configs.rowById(current.id)?.favorite ?? false);
    };

    const sourceName = (): string =>
    {
        const current = config();

        if (current?.subId === undefined)
        {
            return t().detail.unmanaged;
        }

        return subscriptions.subs().find((sub) => sub.id === current.subId)?.name ?? t().detail.unmanaged;
    };

    const close = (): void => setOpenId(null);

    const connect = async (): Promise<void> =>
    {
        const current = config();

        if (current !== null)
        {
            // Dismiss only the phone sheet. On wide layouts the side panel is a
            // permanent fixture - closing it here emptied the panel at the exact
            // moment the user acted on a server, which read as it vanishing.
            if (!viewport.isWide())
            {
                close();
            }

            await connection.connect(current);
        }
    };

    // A real per-server probe (HTTP through the proxy), folded into this config's
    // health so the latency and sparkline update in place.
    const pingNow = async (): Promise<void> =>
    {
        const current = config();

        if (current === null || pinging())
        {
            return;
        }

        setPinging(true);

        const result = await service.ping(current, new AbortController().signal);

        await health.recordOne(current.id, result);
        setPinging(false);
    };

    const copyLink = async (): Promise<void> =>
    {
        const current = config();

        if (current === null)
        {
            return;
        }

        try
        {
            await navigator.clipboard.writeText(current.rawUri);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
            toast.success(t().detail.copied);
        }
        catch
        {
            // Clipboard denied - nothing to do; the link stays in the detail view.
        }
    };

    const remove = async (): Promise<void> =>
    {
        const current = config();

        if (current !== null)
        {
            const id = current.id;

            close();
            await configs.remove([id]);
        }
    };

    const toggleFavorite = (): void =>
    {
        const current = config();

        if (current !== null)
        {
            void configs.toggleFavorite(current.id);
        }
    };

    return {
        openId,
        config,
        pinging,
        copied,
        open: (id: string): void => setOpenId(id),
        close,
        record,
        favorite,
        sourceName,
        connect,
        pingNow,
        copyLink,
        remove,
        toggleFavorite
    };
});
