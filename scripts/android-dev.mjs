#!/usr/bin/env node
// Runs `tauri android dev` against the device's own loopback instead of a LAN address.
//
// Left alone, the Tauri CLI picks a host IP off the machine's interface list and rewrites
// `build.devUrl` to it. On a dev box that has ever run this app's desktop build that list
// includes `xray_tun` (172.18.0.1) - and Windows also contributes the Hyper-V and WSL
// switches - so the CLI regularly hands the phone an address it cannot route to. The
// webview then fails to load and shows a white screen with nothing in the log to say why.
//
// `adb reverse` sidesteps the guessing: the device dials its own 127.0.0.1 and adb tunnels
// it back over USB to the vite server here. That address is the same on every machine and
// every network, and it keeps working when the Wi-Fi IP changes mid-session.
//
// Ports must match vite.config.ts: 1420 for the dev server, 1421 for its HMR socket.
//
// Usage: npm run android [-- <device>]

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORTS = [1420, 1421];

const adb = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb')
    : 'adb';

function fail(message)
{
    console.error('android-dev: ' + message);
    process.exit(1);
}

// One reverse per port. An existing mapping is simply overwritten, so this is safe to
// re-run, and adb tears them all down when the device disconnects.
for (const port of PORTS)
{
    const result = spawnSync(adb, ['reverse', `tcp:${ port }`, `tcp:${ port }`], { encoding: 'utf8' });

    if (result.error)
    {
        fail(`could not run adb (${ adb }). Is the Android SDK's platform-tools on PATH?`);
    }

    if (result.status !== 0)
    {
        fail(`adb reverse tcp:${ port } failed - is a device connected and authorized?\n` +
            (result.stderr || result.stdout || '').trim());
    }
}

console.log(`android-dev: forwarding device ${ PORTS.map((p) => `127.0.0.1:${ p }`).join(' and ') } to this machine`);

// The CLI's own entry point, run under this node - not `npx`, whose Windows form is a .cmd
// shim that spawn refuses to launch without a shell (EINVAL).
const cli = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

// `--host` is the only way in: TAURI_DEV_HOST is a variable the CLI *sets* for the
// beforeDevCommand (vite.config.ts reads it from there), not one it reads, so exporting it
// ourselves is silently overwritten. Given an explicit address the CLI skips the interface
// scan entirely - which is the whole point, since that scan is what picks xray_tun.
const child = spawn(
    process.execPath,
    [cli, 'android', 'dev', '--host', HOST, ...process.argv.slice(2)],
    { cwd: ROOT, stdio: 'inherit', env: process.env }
);

child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
