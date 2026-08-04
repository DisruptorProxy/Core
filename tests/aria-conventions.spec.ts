import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// ARIA state attributes are NOT HTML boolean attributes. `disabled={ true }` correctly
// renders a bare `disabled`, but `aria-pressed={ true }` renders `aria-pressed=""`, and
// `aria-pressed={ false }` omits the attribute entirely - so a toggle button reports its
// state to a screen reader as neither pressed nor unpressed. Four buttons across the
// routing, settings and rule-editor screens shipped that way.
//
// A source scan rather than a render assertion: the mistake is a spelling, it is easy to
// repeat in a new component, and one test covering every file beats one per screen.

// Vite rewrites `import.meta.url` to a non-file scheme in the transformed module, so the
// project root is the reliable anchor - vitest runs with cwd at the config's directory.
const SRC = join(process.cwd(), 'src');

/** ARIA attributes whose value must be the STRING "true" or "false". */
const STATE_ATTRS = ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-expanded', 'aria-multiselectable', 'aria-current'];

const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    {
        const path = join(dir, entry.name);

        if (entry.isDirectory())
        {
            return walk(path);
        }

        return entry.name.endsWith('.azeroth') ? [path] : [];
    });

describe('ARIA state attributes', () =>
{
    it('are always bound to the string "true" or "false", never a raw boolean', () =>
    {
        const offenders: string[] = [];

        for (const file of walk(SRC))
        {
            const source = readFileSync(file, 'utf8');

            source.split(/\r?\n/).forEach((line, index) =>
            {
                for (const attr of STATE_ATTRS)
                {
                    if (!line.includes(`${ attr }={`))
                    {
                        continue;
                    }

                    // A correct binding names one of the two literals somewhere in its value.
                    if (!line.includes("'true'") && !line.includes("'false'"))
                    {
                        offenders.push(`${ file.replace(/.*[/\\]src[/\\]/, 'src/') }:${ index + 1 }  ${ line.trim() }`);
                    }
                }
            });
        }

        expect(offenders, `bind these to 'true' / 'false' strings:\n${ offenders.join('\n') }`).toEqual([]);
    });
});
