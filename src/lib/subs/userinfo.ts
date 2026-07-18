import type { SubscriptionUserinfo } from '../db/schema';

/**
 * Parses the `Subscription-Userinfo` response header, the de-facto standard for
 * reporting a subscription's usage and expiry:
 *
 *   `upload=455; download=8253388646; total=274877906944; expire=1735689600`
 *
 * upload/download/total are bytes; expire is a unix timestamp in seconds. Keys are
 * matched case-insensitively and any missing one defaults to 0. Returns undefined
 * when the header is absent or carries none of the known keys, so a provider that
 * sends nothing simply leaves the record's usage untouched.
 */
export const parseSubscriptionUserinfo = (header: string | null | undefined): SubscriptionUserinfo | undefined =>
{
    if (header === null || header === undefined || header.trim() === '')
    {
        return undefined;
    }

    const values: Partial<Record<keyof SubscriptionUserinfo, number>> = {};

    for (const part of header.split(';'))
    {
        const [rawKey, rawValue] = part.split('=');
        const key = rawKey?.trim().toLowerCase();
        const value = Number.parseInt(rawValue?.trim() ?? '', 10);

        if ((key === 'upload' || key === 'download' || key === 'total' || key === 'expire') && Number.isFinite(value))
        {
            values[key] = value;
        }
    }

    if (Object.keys(values).length === 0)
    {
        return undefined;
    }

    return {
        upload: values.upload ?? 0,
        download: values.download ?? 0,
        total: values.total ?? 0,
        expire: values.expire ?? 0
    };
};
