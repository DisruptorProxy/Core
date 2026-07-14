/**
 * Parser gate. Runs the real parse pipeline over the 8000-config fixture and
 * prints what it made of it - counts, timing, and a sample of normalized names.
 *
 *   npx esbuild scripts/check-parsers.ts --bundle --format=esm --platform=node --outfile=<tmp>.mjs
 *   node <tmp>.mjs
 */
import { readFileSync } from 'node:fs';

import { parseList } from '../src/lib/proxy/parse';
import { decodeSubscription } from '../src/lib/subs/decode';

const raw = readFileSync('fixtures/subscription.b64', 'utf8');

const decodeStarted = performance.now();
const decoded = decodeSubscription(raw);
const decodeMs = performance.now() - decodeStarted;

console.log(`format:        ${ decoded.format } (decoded in ${ decodeMs.toFixed(0) }ms)`);

const parseStarted = performance.now();
const { configs, errors, duplicates } = parseList(decoded.body, 'fixture');
const parseMs = performance.now() - parseStarted;

console.log(`parsed:        ${ configs.length } configs in ${ parseMs.toFixed(0) }ms`);
console.log(`duplicates:    ${ duplicates } collapsed by fingerprint`);
console.log(`errors:        ${ errors.length }`);

const byProtocol = new Map<string, number>();

for (const config of configs)
{
    byProtocol.set(config.protocol, (byProtocol.get(config.protocol) ?? 0) + 1);
}

console.log(`protocols:     ${ [...byProtocol].map(([p, n]) => `${ p }=${ n }`).join(' ') }`);
console.log(`unique ids:    ${ new Set(configs.map((c) => c.id)).size }`);
console.log(`with country:  ${ configs.filter((c) => c.country !== undefined).length }`);
console.log(`with tags:     ${ configs.filter((c) => c.tags.length > 0).length }`);

console.log('\nerrors reported:');

for (const error of errors)
{
    console.log(`  line ${ error.line }: ${ error.reason }  [${ error.snippet }]`);
}

console.log('\nname normalization (raw -> clean + badges):');

for (const config of configs.slice(0, 6))
{
    console.log(`  ${ JSON.stringify(config.rawName) }`);
    console.log(`    -> ${ JSON.stringify(config.name) } country=${ config.country ?? '-' } tags=[${ config.tags.join(',') }]`);
}

console.log('\nreality fields survived:');

const reality = configs.find((config) => config.security === 'reality');

console.log(`  ${ reality?.host }:${ reality?.port } pbk=${ reality?.publicKey } sid=${ reality?.shortId } flow=${ reality?.flow } transport=${ reality?.transport }`);
