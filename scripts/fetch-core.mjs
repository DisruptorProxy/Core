#!/usr/bin/env node
// Fetches the Xray core, verified against the release's own .dgst checksum.
//
// Desktop cores are the Xray-core CLI binary and land in src-tauri/assets. Android gets the
// same official binary, one per shipped ABI, installed as `libxray.so` into a jniLibs source
// dir so the APK carries it into nativeLibraryDir - the only place Android lets an app exec a
// file. `--android` does that for both ABIs at once. The Windows core is committed already;
// everything else is fetched (and gitignored) by CI and a fresh clone before a build. iOS
// uses an xcframework built with gomobile, so it is out of scope here.
//
// Usage:
//   node scripts/fetch-core.mjs                      # the host desktop platform
//   node scripts/fetch-core.mjs --target linux-64
//   node scripts/fetch-core.mjs --android            # both Android ABIs -> app/xrayLibs
//   node scripts/fetch-core.mjs --target linux-64 --version v1.8.4
//   node scripts/fetch-core.mjs --android --version v26.3.27

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'src-tauri', 'assets');
const XRAY_LIBS = path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'xrayLibs');
const RELEASES = 'https://github.com/XTLS/Xray-core/releases';

// The ABIs the APK ships, and the release asset that carries the core for each. Kept in
// step with `abiFilters` in gen/android/app/build.gradle.kts: an ABI with no core here
// would install fine and then fail to start the tunnel.
const ANDROID_ABIS = [
    { abi: 'arm64-v8a', target: 'android-arm64-v8a' },
    { abi: 'x86_64', target: 'android-amd64' }
];

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

/** Installs the Android core for every shipped ABI into app/xrayLibs, named `libxray.so`.
 *  The `.so` name is not a library - it is the plain Xray-core executable wearing the only
 *  extension Android's packager will carry into nativeLibraryDir, which since API 29 is the
 *  one directory an app is allowed to exec from. */
async function installAndroid(version)
{
    for (const { abi, target } of ANDROID_ABIS)
    {
        const work = mkdtempSync(path.join(tmpdir(), 'xray-core-'));

        try
        {
            const core = await fetchAndVerify(target, version, work);
            const dir = path.join(XRAY_LIBS, abi);
            mkdirSync(dir, { recursive: true });
            const dest = path.join(dir, 'libxray.so');
            copyFileSync(core, dest);

            if (process.platform !== 'win32')
            {
                chmodSync(dest, 0o755);
            }

            console.log(`fetch-core: wrote gen/android/.../app/xrayLibs/${ abi }/libxray.so`);
        }
        finally
        {
            rmSync(work, { recursive: true, force: true });
        }
    }
}

async function main()
{
    if (process.argv.includes('--android'))
    {
        await installAndroid(arg('--version'));
        return;
    }

    await install(arg('--target') ?? hostTarget(), arg('--version'));
}

await main();
