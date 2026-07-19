import { fingerprint } from './fingerprint';
import { parseHysteria2 } from './hysteria';
import { countryFromFlag, extractTagsFromName } from './normalize-name';
import { parseShadowsocks } from './shadowsocks';
import { parseTrojan } from './trojan';
import { parseTuic } from './tuic';
import type { ProxyConfig } from './types';
import { ParseFailure } from './uri';
import type { ProxyDraft } from './uri';
import { parseVless } from './vless';
import { parseVmess } from './vmess';

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

        return {
            ...draft,
            id: fingerprint(draft),
            // Keep the original name exactly as provided — no emoji stripping,
            // no keyword filtering, no tag removal. The raw provider label is
            // the user's name for this server.
            name: draft.rawName,
            // Detect country from the first flag emoji in the original name.
            country: countryFromFlag(draft.rawName),
            // Tags (2.5x, IPv6, VIP, …) are still extracted for badge display.
            tags: extractTagsFromName(draft.rawName),
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
