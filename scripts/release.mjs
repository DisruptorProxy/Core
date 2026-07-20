#!/usr/bin/env node
// Release helper for The Disruptor Proxy.
//
// Bumps the version everywhere it is pinned (package.json, src-tauri/Cargo.toml, and
// src-tauri/Cargo.lock's own entry), commits that as one release commit, tags it, and
// pushes both. Pushing the tag is the whole handoff - .github/workflows/release.yml picks
// it up from there: builds, signs with the updater keypair, and publishes DRAFT releases
// to both this repo (ClientCore, private) and DisruptorProxy/Xray-Client (public). This script
// never builds, signs, or publishes anything itself, and never touches GitHub Releases.
//
// Usage:
//   npm run release -- 1.2.0
//   npm run release -- patch | minor | major
//   npm run release -- 1.2.0 --dry-run
//
// After it finishes: review both draft releases on GitHub and publish them manually. A
// draft is invisible to the auto-updater and to anonymous downloads until you do that.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(message)
{
    console.error('release: ' + message);
    process.exit(1);
}

function log(message)
{
    console.log(message);
}

const dryRun = process.argv.includes('--dry-run');

// `file` + an argv array, not one shell string: a value that happens to contain shell
// metacharacters cannot change what command runs, since there is no string for it to break
// out of. NO shell option at all, on any platform: unlike npm/npx, `git` and `cargo` are
// real executables (git.exe, cargo.exe on Windows too - confirmed with `where`), not .cmd
// shims that need a shell interpreter to launch, so execFileSync can spawn them directly.
// That also sidesteps Node's own DEP0190 advisory (`shell: true` + an args array), which
// applies to the .cmd-shim case this script does not have.
function query(file, args)
{
    return execFileSync(file, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Runs a state-changing command, honouring --dry-run and forwarding stdio. */
function act(file, args, extra)
{
    log('  $ ' + [file, ...args].join(' '));
    if (dryRun)
    {
        return;
    }
    execFileSync(file, args, { cwd: ROOT, stdio: 'inherit', ...(extra ?? {}) });
}

/** Resolves a version input - a full X.Y.Z or a patch/minor/major bump keyword. */
function resolveVersion(input, current)
{
    if (VERSION_PATTERN.test(input))
    {
        return input;
    }
    const parts = current.split('.').map(Number);
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    const patch = parts[2] ?? 0;

    if (input === 'patch')
    {
        return `${ major }.${ minor }.${ patch + 1 }`;
    }
    if (input === 'minor')
    {
        return `${ major }.${ minor + 1 }.0`;
    }
    if (input === 'major')
    {
        return `${ major + 1 }.0.0`;
    }
    fail(`"${ input }" is neither a version (X.Y.Z) nor a bump keyword (patch, minor, major)`);
    return ''; // unreachable - fail() exits the process
}

/** Updates package.json + src-tauri/Cargo.toml, then syncs Cargo.lock's own entry. */
function bumpVersion(version)
{
    const pkgPath = path.join(ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

    pkg.version = version;
    if (!dryRun)
    {
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
    }
    log(`  package.json -> ${ version }`);

    const cargoPath = path.join(ROOT, 'src-tauri', 'Cargo.toml');
    const cargoText = readFileSync(cargoPath, 'utf8');
    const cargoNext = cargoText.replace(/^version = "[^"]*"/m, `version = "${ version }"`);

    if (cargoNext === cargoText)
    {
        fail('src-tauri/Cargo.toml: no `version = "..."` line found under [package] - bump it by hand');
    }
    if (!dryRun)
    {
        writeFileSync(cargoPath, cargoNext);
    }
    log(`  src-tauri/Cargo.toml -> ${ version }`);

    // Cargo.lock pins this package's OWN version too; `cargo check` reconciles just that
    // entry against the Cargo.toml bump above without re-resolving unrelated dependencies,
    // so committing the lockfile alongside the bump doesn't surprise the next `cargo build`.
    if (!dryRun && existsSync(path.join(ROOT, 'src-tauri', 'Cargo.lock')))
    {
        act('cargo', ['check', '--quiet'], { cwd: path.join(ROOT, 'src-tauri') });
    }
}

function printHelp()
{
    log(`Release The Disruptor Proxy.

Usage:  npm run release -- <version | patch | minor | major> [options]
        node scripts/release.mjs <version | patch | minor | major> [options]

Bumps package.json + src-tauri/Cargo.toml (+ syncs Cargo.lock's own entry),
commits, tags, and pushes. Pushing the tag is the whole handoff -
.github/workflows/release.yml takes it from there: builds, signs, and
publishes DRAFT releases to both ClientCore and DisruptorProxy/Xray-Client.

Examples:
  npm run release -- 1.2.0
  npm run release -- patch
  npm run release -- minor --dry-run

Options:
  --dry-run    Show every step; change nothing.
  -h, --help   Show this help.`);
}

const argvRaw = process.argv.slice(2);

if (argvRaw.includes('-h') || argvRaw.includes('--help'))
{
    printHelp();
    process.exit(0);
}

const argv = argvRaw.filter(a => a !== '--dry-run');
const versionArg = argv[0];

if (!versionArg)
{
    fail('a version or bump keyword is required, e.g. `npm run release -- patch` or `-- 1.2.0` (try --help)');
}
if (versionArg.startsWith('-'))
{
    fail(`unknown option: ${ versionArg } (try --help)`);
}

const pkgPath = path.join(ROOT, 'package.json');
const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const next = resolveVersion(versionArg, current);

if (!VERSION_PATTERN.test(next))
{
    fail(`"${ next }" is not a valid version (expected MAJOR.MINOR.PATCH)`);
}

const tag = 'v' + next;

log(`\nRelease ${ current } -> ${ next }  (tag ${ tag })`);
if (dryRun)
{
    log('  (dry run: nothing will be changed)');
}

const status = query('git', ['status', '--porcelain']);
if (status && !dryRun)
{
    fail('working tree is not clean; commit or stash first - the release commit must be just the version bump');
}

const existingTag = query('git', ['tag', '-l', tag]);
if (existingTag === tag)
{
    fail(`tag ${ tag } already exists`);
}

log('\nBumping version');
bumpVersion(next);

log('\nCommitting and tagging');
act('git', ['add', 'package.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']);
act('git', ['commit', '-m', `chore(release): ${ tag }`]);
act('git', ['tag', '-a', tag, '-m', tag]);

log('\nPushing to GitHub');
act('git', ['push', 'origin', 'HEAD']);
act('git', ['push', 'origin', tag]);

log(`\nDone: ${ next }`);
log('CI is now building, signing, and publishing draft releases to ClientCore + Client.');
log('Review both drafts on GitHub, then publish each one manually when ready - a draft is');
log('invisible to the updater and to anonymous downloads until you do.');
