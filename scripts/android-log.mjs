#!/usr/bin/env node
// Tails just this app's Android log, in a terminal of its own.
//
// `tauri android dev` does stream logcat, but unfiltered: the app's own lines arrive buried
// in thousands of lines of vendor chatter from the whole device, which is why a Rust panic
// or a webview error can scroll past unnoticed. The default here is a tag allowlist - the
// four channels anything of ours comes out on, plus the three the system uses to report a
// crash:
//
//   RustStdoutStderr  - anything Rust writes to stdout/stderr, panics included
//   Tauri, Tauri/Console - plugin logs, and console.log/warn/error from the webview
//   RustWebView       - navigation and load failures
//   DEBUG, libc, AndroidRuntime - native crashes (the tombstone) and Java exceptions
//
// Usage:
//   npm run android-log            # the tags above, from now on
//   npm run android-log -- --all   # everything the app's process emits, vendor noise too

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const PACKAGE = 'io.disruptorproxy.client';

// Silencing everything else (`*:S`) is what makes the allowlist an allowlist. The crash
// tags are last because they come from the system's crash_dump process, not from ours -
// a pid filter would drop exactly the lines that explain why the app died.
const TAGS = [
    'RustStdoutStderr:V',
    'Tauri:V',
    'Tauri/Console:V',
    'RustWebView:V',
    'AndroidRuntime:E',
    'DEBUG:V',
    'libc:F',
    '*:S'
];

const adb = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb')
    : 'adb';

const everything = process.argv.slice(2).includes('--all');

function fail(message)
{
    console.error('android-log: ' + message);
    process.exit(1);
}

function pidOf()
{
    // `pidof -s` prints a single pid, or nothing at all when the app is not running.
    const result = spawnSync(adb, ['shell', 'pidof', '-s', PACKAGE], { encoding: 'utf8' });

    if (result.error)
    {
        fail(`could not run adb (${ adb }). Is the Android SDK's platform-tools on PATH?`);
    }

    const pid = (result.stdout || '').trim();

    return (/^\d+$/).test(pid) ? pid : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Follows one process until it exits, so the caller can re-attach to its replacement. */
function follow(pid)
{
    return new Promise((resolve) =>
    {
        const child = spawn(adb, ['logcat', '-v', 'color,brief', '-T', '1', `--pid=${ pid }`], { stdio: 'inherit' });
        // logcat keeps running after the process it was following dies, so poll and stop it.
        const poll = setInterval(() =>
        {
            if (pidOf() !== pid)
            {
                child.kill();
            }
        }, 1000);

        child.on('exit', () =>
        {
            clearInterval(poll);
            resolve();
        });
    });
}

if (everything)
{
    console.log(`android-log: waiting for ${ PACKAGE } (Ctrl+C to stop)`);

    for (;;)
    {
        const pid = pidOf();

        if (pid === null)
        {
            await sleep(1000);
            continue;
        }

        console.log(`android-log: attached to pid ${ pid }`);
        await follow(pid);
        console.log('android-log: process gone, waiting for it to come back');
    }
}

// The tag allowlist needs no pid, so it survives restarts on its own and can be started
// before the app is even installed.
console.log('android-log: following ' + TAGS.slice(0, -1).map((tag) => tag.split(':')[0]).join(', ') + ' (Ctrl+C to stop)');

const child = spawn(adb, ['logcat', '-v', 'color,brief', '-T', '1', ...TAGS], { stdio: 'inherit' });

child.on('error', () => fail(`could not run adb (${ adb }). Is the Android SDK's platform-tools on PATH?`));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
