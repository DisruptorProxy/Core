import { defineConfig } from 'vite';
import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
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
