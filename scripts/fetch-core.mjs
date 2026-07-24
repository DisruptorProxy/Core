#!/usr/bin/env node
// Fetches the Xray core, verified against the release's own .dgst checksum.
//
// Desktop cores are the Xray-core CLI binary and land in src-tauri/assets. Android is
// different: a VpnService tun fd can only reach Xray inside the app's own process (a
// spawned binary never inherits it - Android's ProcessBuilder closes it across exec), so
// Android runs Xray IN-PROCESS via libXray's gomobile AAR instead of a libxray.so binary.
// `--android` fetches that AAR into gen/android/app/libs. The Windows core is committed
// already; everything else is fetched (and gitignored) by CI and a fresh clone before a
// build. iOS uses an xcframework built with gomobile, so it is out of scope here.
//
// Usage:
//   node scripts/fetch-core.mjs                      # the host desktop platform
//   node scripts/fetch-core.mjs --target linux-64
//   node scripts/fetch-core.mjs --android            # libXray AAR -> app/libs
//   node scripts/fetch-core.mjs --target linux-64 --version v1.8.4
//   node scripts/fetch-core.mjs --android --libxray-version v26.7.11

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'src-tauri', 'assets');
const LIBS = path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'libs');
const RELEASES = 'https://github.com/XTLS/Xray-core/releases';

// libXray ships Xray-core as a prebuilt gomobile AAR. Pinned rather than "latest" so a
// build is reproducible and an upstream change can't silently alter the bundled core;
// bump deliberately (and re-test the tunnel on a device - the tun/fd path is version-
// sensitive). Overridable with --libxray-version.
const LIBXRAY_RELEASES = 'https://github.com/XTLS/libXray/releases';
const LIBXRAY_VERSION = 'v26.7.11';

function fail(message)
{
    console.error('fetch-core: ' + message);
    process.exit(1);
}

function arg(name)
{
    const i = process.argv.indexOf(name);
    return i !== -1 ? process.argv[i + 1] : undefined;
}

/** Maps the host to Xray's `<os>-<arch>` desktop asset suffix (Android is opt-in via --target/--android). */
function hostTarget()
{
    const os = { win32: 'windows', linux: 'linux', darwin: 'macos' }[process.platform];
    const arch = { x64: '64', arm64: 'arm64-v8a', ia32: '32' }[process.arch];

    if (!os || !arch)
    {
        fail(`unsupported host ${ process.platform }/${ process.arch } - pass --target explicitly`);
    }

    return `${ os }-${ arch }`;
}

async function download(url)
{
    const res = await fetch(url, { redirect: 'follow' });

    if (!res.ok)
    {
        fail(`GET ${ url } -> ${ res.status } ${ res.statusText }`);
    }

    return Buffer.from(await res.arrayBuffer());
}

/** Extracts a zip into `destDir`, cross-platform. */
function unzip(zipPath, destDir)
{
    if (process.platform === 'win32')
    {
        execFileSync('powershell', [
            '-NoProfile', '-NonInteractive', '-Command',
            `Expand-Archive -Path '${ zipPath }' -DestinationPath '${ destDir }' -Force`
        ], { stdio: 'inherit' });
    }
    else
    {
        execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
    }
}

/** Downloads Xray-<target>.zip, verifies its sha256 against the sibling .dgst, and returns
 *  the path to the extracted core binary inside a temp dir the caller must clean up. */
async function fetchAndVerify(target, version, work)
{
    const base = version ? `${ RELEASES }/download/${ version }` : `${ RELEASES }/latest/download`;
    const zipName = `Xray-${ target }.zip`;
    const coreInZip = target.startsWith('windows') ? 'xray.exe' : 'xray';

    console.log(`fetch-core: ${ zipName } (${ version ?? 'latest' })`);

    const [zip, dgst] = await Promise.all([
        download(`${ base }/${ zipName }`),
        download(`${ base }/${ zipName }.dgst`).then((b) => b.toString('utf8'))
    ]);

    // The sha256 is the only 64-hex token in the .dgst (md5=32, sha1=40, sha512=128).
    const match = dgst.match(/\b([0-9a-f]{64})\b/i);

    if (!match)
    {
        fail(`no sha256 found in ${ zipName }.dgst`);
    }

    const expected = match[1].toLowerCase();
    const actual = createHash('sha256').update(zip).digest('hex');

    if (actual !== expected)
    {
        fail(`sha256 mismatch for ${ zipName }\n  expected ${ expected }\n  actual   ${ actual }`);
    }

    console.log(`fetch-core: sha256 verified (${ expected })`);

    const zipPath = path.join(work, zipName);
    writeFileSync(zipPath, zip);
    unzip(zipPath, work);

    return path.join(work, coreInZip);
}

/** Fetches one desktop target and installs the core into src-tauri/assets. */
async function install(target, version)
{
    const work = mkdtempSync(path.join(tmpdir(), 'xray-core-'));

    try
    {
        const core = await fetchAndVerify(target, version, work);
        const outName = target.startsWith('windows') ? 'app-xray.exe' : 'app-xray';
        mkdirSync(ASSETS, { recursive: true });
        const dest = path.join(ASSETS, outName);
        copyFileSync(core, dest);

        // The binary must be executable where it will actually run (not on a Windows
        // host fetching a Linux core just to test this script).
        if (process.platform !== 'win32' && !target.startsWith('windows'))
        {
            chmodSync(dest, 0o755);
        }

        console.log(`fetch-core: wrote src-tauri/assets/${ outName }`);
    }
    finally
    {
        rmSync(work, { recursive: true, force: true });
    }
}

/** Fetches the libXray gomobile AAR and installs it into gen/android/app/libs. Unlike the
 *  desktop cores, libXray publishes no .dgst, so this pins the version and records the
 *  sha256 of what it fetched over HTTPS rather than verifying against a published digest. */
async function installAndroidAar(version)
{
    const tag = version ?? LIBXRAY_VERSION;
    const zipName = 'libxray-android.zip';

    console.log(`fetch-core: ${ zipName } (${ tag })`);

    const zip = await download(`${ LIBXRAY_RELEASES }/download/${ tag }/${ zipName }`);
    console.log(`fetch-core: sha256 ${ createHash('sha256').update(zip).digest('hex') }`);

    const work = mkdtempSync(path.join(tmpdir(), 'libxray-'));

    try
    {
        const zipPath = path.join(work, zipName);
        writeFileSync(zipPath, zip);
        unzip(zipPath, work);

        // The archive nests the AAR one directory down (libxray-android/libXray.aar).
        const aar = path.join(work, 'libxray-android', 'libXray.aar');
        mkdirSync(LIBS, { recursive: true });
        copyFileSync(aar, path.join(LIBS, 'libXray.aar'));

        console.log('fetch-core: wrote gen/android/.../app/libs/libXray.aar');
    }
    finally
    {
        rmSync(work, { recursive: true, force: true });
    }
}

async function main()
{
    if (process.argv.includes('--android'))
    {
        await installAndroidAar(arg('--libxray-version'));
        return;
    }

    await install(arg('--target') ?? hostTarget(), arg('--version'));
}

await main();
