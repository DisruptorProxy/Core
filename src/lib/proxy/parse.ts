import { fingerprint } from './fingerprint';
import { parseHysteria2 } from './hysteria';
import { normalizeName } from './normalize-name';
import { parseShadowsocks } from './shadowsocks';
import { parseTrojan } from './trojan';
import { parseTuic } from './tuic';
import { ParseFailure } from './uri';
import type { ProxyDraft } from './uri';
import { parseVless } from './vless';
import { parseVmess } from './vmess';
import type { ParseError, ProxyConfig } from './types';

type Parser = (uri: string) => ProxyDraft;

const PARSERS: [string, Parser][] =
[
    ['vmess://', parseVmess],
    ['vless://', parseVless],
    ['trojan://', parseTrojan],
    ['ss://', parseShadowsocks],
    ['hysteria2://', parseHysteria2],
    ['hy2://', parseHysteria2],
    ['tuic://', parseTuic]
];

/** Credentials live in these URIs, so an error excerpt shows the scheme and host only. */
const safeSnippet = (line: string): string =>
{
    const scheme = line.slice(0, Math.min(line.indexOf('://') + 3, 16));
    const rest = line.slice(scheme.length);

    return scheme + rest.slice(0, 24) + (rest.length > 24 ? '…' : '');
};

/** Turns one URI into a config, or explains why it could not. */
export const parseUri = (uri: string, subId?: string): ProxyConfig | ParseFailure =>
{
    const line = uri.trim();
    const entry = PARSERS.find(([scheme]) => line.toLowerCase().startsWith(scheme));

    if (entry === undefined)
    {
        const scheme = line.slice(0, line.indexOf('://'));

        return new ParseFailure(scheme === '' || scheme.length > 12
            ? 'Not a config link'
            : `Unsupported protocol "${ scheme }"`);
    }

    try
    {
        const draft = entry[1](line);
        const { name, country, tags } = normalizeName(draft.rawName, `${ draft.host }:${ draft.port }`);

        return {
            ...draft,
            id: fingerprint(draft),
            name,
            country,
            tags,
            subId,
            favorite: false,
            addedAt: Date.now()
        };
    }
    catch (error)
    {
        return error instanceof ParseFailure
            ? error
            : new ParseFailure(error instanceof Error ? error.message : 'Could not read this link');
    }
};

export interface ParseListResult
{
    configs: ProxyConfig[];
    errors: ParseError[];
    /** Lines that named a server we had already seen in THIS list. */
    duplicates: number;
}

/**
 * Parses a whole subscription body. Every line is accounted for: it becomes a
 * config, a duplicate, or an error with its line number - which is what makes an
 * honest import report possible. No line is ever silently dropped.
 */
export const parseList = (text: string, subId?: string): ParseListResult =>
{
    const configs: ProxyConfig[] = [];
    const errors: ParseError[] = [];
    const seen = new Set<string>();

    let duplicates = 0;
    let lineNumber = 0;

    for (const raw of text.split(/\r?\n/))
    {
        lineNumber++;

        const line = raw.trim();

        // Blank lines and comments are not errors - providers pad both freely.
        if (line === '' || line.startsWith('#') || line.startsWith('//'))
        {
            continue;
        }

        const result = parseUri(line, subId);

        if (result instanceof ParseFailure)
        {
            errors.push({ line: lineNumber, reason: result.message, snippet: safeSnippet(line) });

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

    return { configs, errors, duplicates };
};
