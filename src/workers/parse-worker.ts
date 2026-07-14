import { clearSubscriptionId, configsForSubscription, deleteConfigs, putConfigs } from '../lib/db/repo';
import { parseUri } from '../lib/proxy/parse';
import { ParseFailure } from '../lib/proxy/uri';
import type { ParseError, ProxyConfig } from '../lib/proxy/types';
import { decodeSubscription } from '../lib/subs/decode';
import { planUpdate } from '../lib/subs/diff';
import type { UpdateDiff } from '../lib/subs/diff';

/**
 * All heavy config work runs here, off the main thread: parsing 8000 URIs is
 * seconds of base64 decodes and regex passes that would freeze the UI on the main
 * thread - the single most visible failure of every existing client at this scale.
 * The worker writes to IndexedDB itself, so the main thread never handles 8000
 * objects it would only write back out.
 */

export interface ImportRequest
{
    kind: 'import';
    /** Raw subscription body: URI list, base64 blob, or sing-box JSON. */
    text: string;
    subId?: string;
}

export interface UpdateRequest
{
    kind: 'update';
    subId: string;
    /** The already-fetched body. The fetch runs on the main thread (native, CORS-free);
     *  a worker cannot reach Tauri's invoke, so it only parses and diffs. */
    text: string;
}

export type WorkerRequest = ImportRequest | UpdateRequest;

export interface ImportProgress
{
    kind: 'progress';
    parsed: number;
    total: number;
}

/** The honest accounting every other client refuses to give the user. */
export interface ImportReport
{
    kind: 'done';
    format: string;
    added: number;
    duplicates: number;
    errors: ParseError[];
    elapsedMs: number;
}

export interface UpdateDone
{
    kind: 'updated';
    diff: UpdateDiff;
    format: string;
    elapsedMs: number;
}

export interface WorkerFailed
{
    kind: 'failed';
    reason: string;
}

export type WorkerResponse = ImportProgress | ImportReport | UpdateDone | WorkerFailed;

/** Batch size: big enough that IndexedDB is not the bottleneck, small enough that
 *  progress moves visibly and memory stays flat. */
const BATCH = 500;

const post = (message: WorkerResponse): void => self.postMessage(message);

/** Parses a decoded body to configs, counting duplicates and invalid lines. */
const parseBody = (body: string, subId?: string): { configs: ProxyConfig[]; duplicates: number; errors: ParseError[] } =>
{
    const configs: ProxyConfig[] = [];
    const errors: ParseError[] = [];
    const seen = new Set<string>();

    let duplicates = 0;
    let lineNumber = 0;

    for (const raw of body.split(/\r?\n/))
    {
        lineNumber++;

        const line = raw.trim();

        if (line === '' || line.startsWith('#') || line.startsWith('//'))
        {
            continue;
        }

        const result = parseUri(line, subId);

        if (result instanceof ParseFailure)
        {
            errors.push({
                line: lineNumber,
                reason: result.message,
                snippet: line.slice(0, 32) + (line.length > 32 ? '…' : '')
            });

            continue;
        }

        if (seen.has(result.id))
        {
            duplicates++;

            continue;
        }

        seen.add(result.id);
        configs.push(result);
    }

    return { configs, duplicates, errors };
};

const runImport = async (request: ImportRequest): Promise<void> =>
{
    const started = performance.now();
    const decoded = decodeSubscription(request.text);

    if (decoded.unsupported !== undefined && decoded.body === '')
    {
        post({ kind: 'failed', reason: decoded.unsupported });

        return;
    }

    const lines = decoded.body.split(/\r?\n/);
    const errors: ParseError[] = [];
    const seen = new Set<string>();

    let batch: ProxyConfig[] = [];
    let added = 0;
    let duplicates = 0;
    let parsed = 0;

    for (const [index, raw] of lines.entries())
    {
        const line = raw.trim();

        parsed++;

        if (line === '' || line.startsWith('#') || line.startsWith('//'))
        {
            continue;
        }

        const result = parseUri(line, request.subId);

        if (result instanceof ParseFailure)
        {
            errors.push({
                line: index + 1,
                reason: result.message,
                snippet: line.slice(0, 32) + (line.length > 32 ? '…' : '')
            });

            continue;
        }

        if (seen.has(result.id))
        {
            duplicates++;

            continue;
        }

        seen.add(result.id);
        batch.push(result);

        if (batch.length >= BATCH)
        {
            await putConfigs(batch);

            added += batch.length;
            batch = [];

            post({ kind: 'progress', parsed, total: lines.length });
        }
    }

    await putConfigs(batch);

    added += batch.length;

    post({
        kind: 'done',
        format: decoded.format,
        added,
        duplicates,
        errors,
        elapsedMs: Math.round(performance.now() - started)
    });
};

const runUpdate = async (request: UpdateRequest): Promise<void> =>
{
    const started = performance.now();

    const decoded = decodeSubscription(request.text);

    if (decoded.unsupported !== undefined && decoded.body === '')
    {
        post({ kind: 'failed', reason: decoded.unsupported });

        return;
    }

    const { configs, duplicates, errors } = parseBody(decoded.body, request.subId);
    const existing = await configsForSubscription(request.subId);

    const plan = planUpdate(configs, existing, duplicates, errors.length);

    // Apply in dependency order: write the fresh set (overwrites unchanged, adds
    // new), delete the dropped non-favorites, detach the dropped favorites.
    await putConfigs(plan.toPut);
    await deleteConfigs(plan.toDelete);
    await clearSubscriptionId(plan.toOrphan);

    post({
        kind: 'updated',
        diff: plan.diff,
        format: decoded.format,
        elapsedMs: Math.round(performance.now() - started)
    });
};

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> =>
{
    try
    {
        if (event.data.kind === 'import')
        {
            await runImport(event.data);
        }
        else
        {
            await runUpdate(event.data);
        }
    }
    catch (error)
    {
        post({ kind: 'failed', reason: error instanceof Error ? error.message : 'The operation could not be completed' });
    }
};
