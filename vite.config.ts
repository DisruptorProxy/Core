import { readFile } from 'node:fs/promises';

import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

/**
 * Serves the generated 8000-config fixture at /__fixture, in dev only.
 *
 * The obvious alternative - `await import('../fixtures/subscription.b64?raw')`
 * behind an `import.meta.env.DEV` guard - does NOT work: the bundler follows the
 * import regardless of the dead branch and emits a 2.4MB chunk into production.
 * A dev middleware leaves no import for it to follow.
 *
 * Generate the fixture with: node scripts/make-fixture.mjs 8000 > fixtures/subscription.b64
 */
const fixtureRoute = (): Plugin =>
    ({
        name: 'guardian:fixture',
        apply: 'serve',
        configureServer(server)
        {
            server.middlewares.use('/__fixture', (_request, response) =>
            {
                readFile('fixtures/subscription.b64', 'utf8')
                    .then((text) =>
                    {
                        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
                        response.end(text);
                    })
                    .catch(() =>
                    {
                        response.statusCode = 404;
                        response.end('No fixture. Run: node scripts/make-fixture.mjs 8000 > fixtures/subscription.b64');
                    });
            });
        }
    });

export default defineConfig(async () => ({
    plugins: [azeroth(), tailwindcss(), fixtureRoute()],
    clearScreen: false,
    server:
    {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? {
                protocol: 'ws',
                host,
                port: 1421
            }
            : undefined,
        watch:
        {
            ignored: ['**/src-tauri/**']
        }
    }
}));
