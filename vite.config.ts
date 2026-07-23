import { readFileSync } from 'node:fs';

import { azeroth } from '@azerothjs/compiler';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// The version `scripts/release.mjs` bumps, baked in at build time. The desktop app asks
// Tauri for the real thing, but this keeps the About screen honest in browser dev - and
// stops a hardcoded literal from silently going stale release after release.
const { version } = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

export default defineConfig(async () => ({
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [azeroth(), tailwindcss()],
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
