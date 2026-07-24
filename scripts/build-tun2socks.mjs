#!/usr/bin/env node
// Builds hev-socks5-tunnel (tun2socks) for Android and installs it into the gradle
// jniLibs, next to the Xray core that fetch-core.mjs puts there.
//
// Why build instead of download: the project publishes NO prebuilt Android artifacts, and
// its prebuilt linux-arm64 binaries explicitly do not work on Android. It ships an
// Android.mk, so ndk-build is the supported path - which is why this needs an NDK.
//
// The output is loaded IN-PROCESS by TunnelService (System.loadLibrary), not exec'd: the
// tun file descriptor from VpnService is only valid inside the app's own process, so a
// spawned tun2socks could never use it. That is also why this lands as a real .so under
// jniLibs rather than as another lib*.so-named executable.
//
// Usage:
//   node scripts/build-tun2socks.mjs                # every shipped ABI
//   node scripts/build-tun2socks.mjs --abi arm64-v8a
//
// Requires: git, and NDK_HOME (or ANDROID_NDK_ROOT/ANDROID_NDK_HOME) pointing at an NDK.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JNILIBS = path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'jniLibs');
const REPO = 'https://github.com/heiher/hev-socks5-tunnel';
const LIB = 'libhev-socks5-tunnel.so';

// Must match the ABIs fetch-core.mjs installs the Xray core for, or a device would get one
// native library without the other.
const ABIS = ['arm64-v8a', 'x86_64'];

// minSdk in gen/android/app/build.gradle.kts.
const PLATFORM = 'android-24';

function fail(message)
{
    console.error('build-tun2socks: ' + message);
    process.exit(1);
}

function arg(name)
{
    const i = process.argv.indexOf(name);

    return i !== -1 ? process.argv[i + 1] : undefined;
}

function run(file, args, cwd)
{
    execFileSync(file, args, { cwd, stdio: 'inherit' });
}

function ndkBuildCommand()
{
    const ndk = process.env.NDK_HOME ?? process.env.ANDROID_NDK_ROOT ?? process.env.ANDROID_NDK_HOME;

    if (!ndk)
    {
        fail('no NDK found - set NDK_HOME (or ANDROID_NDK_ROOT) to an Android NDK');
    }
    if (!existsSync(ndk))
    {
        fail(`NDK_HOME points at a path that does not exist: ${ ndk }`);
    }

    // ndk-build is a shell script everywhere except Windows, where it is a .cmd.
    const name = process.platform === 'win32' ? 'ndk-build.cmd' : 'ndk-build';
    const command = path.join(ndk, name);

    if (!existsSync(command))
    {
        fail(`${ name } not found in ${ ndk } - is that really an NDK root?`);
    }

    return command;
}

const abis = arg('--abi') ? [arg('--abi')] : ABIS;
const ndkBuild = ndkBuildCommand();
const work = mkdtempSync(path.join(tmpdir(), 'hev-tun2socks-'));

try
{
    console.log(`build-tun2socks: cloning ${ REPO }`);
    // --recursive: the third-party lwip/yaml sources are submodules; without them the
    // build fails late and confusingly.
    run('git', ['clone', '--depth', '1', '--recursive', REPO, work]);

    console.log(`build-tun2socks: building ${ abis.join(', ') }`);
    run(
        ndkBuild,
        [
            `NDK_PROJECT_PATH=${ work }`,
            `APP_BUILD_SCRIPT=${ path.join(work, 'Android.mk') }`,
            `APP_ABI=${ abis.join(' ') }`,
            `APP_PLATFORM=${ PLATFORM }`,
            'APP_STL=none'
        ],
        work
    );

    for (const abi of abis)
    {
        const built = path.join(work, 'libs', abi, LIB);

        if (!existsSync(built))
        {
            fail(`ndk-build produced no ${ LIB } for ${ abi } (looked in ${ built })`);
        }

        const dir = path.join(JNILIBS, abi);
        mkdirSync(dir, { recursive: true });
        cpSync(built, path.join(dir, LIB));

        console.log(`build-tun2socks: wrote gen/android/.../jniLibs/${ abi }/${ LIB }`);
    }
}
finally
{
    rmSync(work, { recursive: true, force: true });
}
