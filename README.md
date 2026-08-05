<p align="center">
  <img src="src/assets/logo-square.png" alt="Disruptor Proxy" width="120" />
</p>

<h1 align="center">DisruptorProxy/Core</h1>

<p align="center">
  Source of <strong>Disruptor Proxy</strong>, a proxy client for Windows, Linux, and Android built on
  <a href="https://github.com/XTLS/Xray-core">Xray-core</a>.
</p>

<p align="center">
  <a href="https://github.com/DisruptorProxy/Core/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DisruptorProxy/Core/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20Android-0078D6" />
  <a href="https://github.com/AzerothJS/AzerothJS"><img alt="Built with AzerothJS" src="https://img.shields.io/badge/built%20with-AzerothJS-5fb3e8" /></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
</p>

<p align="center">
  <a href="https://github.com/DisruptorProxy/Core/releases"><strong>Download a build</strong></a> &nbsp;&middot;&nbsp;
  <a href="https://github.com/DisruptorProxy/Wiki">Guides</a> &nbsp;&middot;&nbsp;
  <a href="#local-development">Build it yourself</a>
</p>

<p align="center">
  <img src="docs/screenshots/home-expanded-dark.png" alt="The Connect screen in the expanded window" width="820" />
</p>

<p align="center">
  <img src="docs/screenshots/home-compact-dark.png" alt="The Connect screen at the default 400x720 window" width="240" />
  &nbsp;
  <img src="docs/screenshots/servers-expanded-light.png" alt="The server list in the light theme" width="380" />
  &nbsp;
  <img src="docs/screenshots/routing-expanded-fa.png" alt="Routing in Persian with the Iran bypass active, fully mirrored" width="380" />
</p>

<p align="center">
  <em>Default window is 400x720; it expands to 960x680, where the tab bar becomes a side rail.<br />
  Same components, both layouts. Persian and Arabic mirror from logical CSS alone.</em>
</p>

## Stack

- **Frontend**: [AzerothJS](https://github.com/AzerothJS/AzerothJS) 2.0 (`.azeroth` components, fine-grained reactivity) + Tailwind CSS, bundled with Vite.
- **Shell**: [Tauri 2](https://tauri.app/) - a Rust-backed native window around the web frontend, roughly 10-20x smaller than an Electron equivalent.
- **Proxy core**: bundled `app-xray` ([Xray-core](https://github.com/XTLS/Xray-core)), driven via generated JSON configs and Tauri commands (`src-tauri/src/lib.rs`).
- **Storage**: IndexedDB for the server catalogue (`src/lib/db/`), scales to thousands of rows without a backend.
- **Languages**: 10, including Persian and Arabic. The layout mirrors from logical CSS properties alone, with no RTL overrides.

## Requirements

- **Node.js >= 24**
- The Rust toolchain, for anything that runs the desktop shell

## Local development

```sh
npm install
npm run tauri dev
```

`npm run dev` alone runs just the frontend in a browser on **http://localhost:1420**. Tauri-specific
APIs no-op outside the desktop shell - fine for UI work, not for anything touching the proxy engine,
geo files, the tray, or the updater.

> **On Windows, run that from an elevated terminal.** The app is manifested
> `requireAdministrator` (it opens the WinTUN adapter and rewrites the route table itself), and
> Windows *fails* `CreateProcess` for such an exe from an unelevated parent - error 740 - rather
> than showing a UAC prompt. So `cargo`/`tauri dev` cannot launch it from a normal shell. Compiling
> needs no elevation; only running does.

## Configuration

Copy `.env.example` to `.env`. Every variable the frontend reads is listed there and typed in
`src/vite-env.d.ts`; keep the three in step.

| Key | Default | What it does |
| --- | --- | --- |
| `VITE_DEVTOOLS` | `true` | `'true'` installs the AzerothJS devtools panel in dev. Never in production. Append `?no-devtools` to the URL to skip it for one page load. |

Everything else - servers, routing, theme, language - is app state, not configuration, and lives in
IndexedDB and `localStorage`.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | AzerothJS dev server only (browser, no Tauri shell) |
| `npm run tauri dev` / `npm run desktop` | Full desktop app in dev mode |
| `npm run check` | `azeroth check` - typechecks **and** lints the whole frontend in one pass |
| `npm test` | The vitest suite over the parsers, the routing rules, and the Xray config builder |
| `npm run lint` / `npm run lint:fix` | ESLint on its own (including `.azeroth` files) |
| `npm run build` | Production frontend build |
| `npm run desktop-build` | Full production Tauri build (installer) |
| `npm run android` / `npm run android-apk` | Android dev on a device/emulator / assemble an APK |
| `npm run fetch-core [-- --target linux-64]` | Download + checksum-verify the Xray core for a target |
| `npm run tauri icon <path>` | Regenerate every platform icon from one square source image |
| `npm run release -- <version \| patch \| minor \| major>` | Bump the version, commit, tag, and push - see Releasing below |

## Project structure

```
src/                    frontend (.azeroth components, stores, lib)
  app/                   shell, router, nav, titlebar, tray
  pages/                 one file per route
  features/              feature-grouped components (configs, connection, subscriptions, routing, import)
  components/            shared UI primitives
  stores/                app state (createStore-based, one file per domain)
  lib/                    non-UI logic: db, search/filter, i18n, routing rules, xray config building
  workers/                the import parser, off the main thread
  assets/                 logo source files (see the icon script above)
tests/                  vitest specs over src/lib plus component fixtures
src-tauri/               Rust shell
  src/lib.rs              Tauri commands: xray process lifecycle, geo file downloads, config generation
  tauri.conf.json         app identity, window config, updater endpoint, bundle targets
  icons/                  generated by `tauri icon`; do not hand-edit
scripts/
  fetch-core.mjs          downloads and sha256-verifies the Xray core
  release.mjs             version bump + tag + push, see Releasing below
```

## Testing

```sh
npm test
```

The suite covers the code where being wrong is expensive and silent:

- **`src/lib/proxy/`** - every config link is untrusted input from a subscription URL, a paste, or a
  QR code. A malformed one must become a named failure, never a throw that takes the import down.
- **`src/lib/subs/`** - subscription format detection. Guessing wrong produces a silently empty
  import, the single most common complaint about every client in this category.
- **`src/lib/routing/`** - rule ORDER is the whole semantics. Xray takes the first match, so a
  `final` rule anywhere but last silently swallows everything after it.
- **`src/lib/xray/`** - the JSON the core boots from. A rule pointing at an outbound tag that does
  not exist makes the core reject the entire config, and the user sees "could not connect" with no
  reason given.

Component specs render through the real compiler against happy-dom via `@azerothjs/testing`.

## Production

```sh
npm run desktop-build
```

What that produces and what it depends on:

- **The proxy core is bundled, not downloaded at runtime.** `npm run fetch-core` pulls the official
  Xray-core release for a target and **verifies its sha256 against the release's own `.dgst`**
  before it is ever written into `src-tauri/assets`. The Windows core (`app-xray.exe` + `wintun.dll`)
  is committed; the unix and Android cores are fetched at build time.
- **Updates are signed.** The updater's public key lives in `tauri.conf.json` and the matching
  private key is a GitHub Actions secret (`TAURI_SIGNING_PRIVATE_KEY`), never committed. The client
  polls `latest.json` on this repo's latest release.
- **What is NOT built**: no MSI, no AppImage, and **no macOS build** - signing and notarizing one
  needs a paid Apple Developer account, so it was dropped rather than shipped unsigned. iOS is
  scaffolded but not wired: it needs `tauri ios init`, a Packet Tunnel extension, and an
  xcframework core. See `docs/CROSS-PLATFORM.md`.
- CI proves the Linux and Windows bundles on every push to main, and assembles the Android APK
  best-effort. The signed public release is cut by the tag-triggered `release.yml`.

### Windows: administrator rights, SmartScreen, and antivirus

**The app runs as administrator.** Its manifest requests `requireAdministrator`, so Windows shows
one UAC prompt at launch and the whole process - including the Xray core it spawns - runs elevated.
That is not optional gold-plating: creating the WinTUN adapter and rewriting the system route table
require those rights, so *something* has to be elevated. Two consequences worth knowing: the webview
host process is elevated too (see `SECURITY.md`), and the installer is **per-machine**, into
`Program Files`.

Up to **1.8.2** it worked the other way around - the app ran unelevated and elevated only the core,
via `ShellExecuteExW`'s `runas` verb. Because `runas` cannot redirect a child's stdio, that needed a
PowerShell wrapper written into `%APPDATA%` and launched with `-ExecutionPolicy Bypass
-WindowStyle Hidden`, which then spawned the core hidden. Users on those versions got a UAC prompt
on every connect instead of one at launch.

**Why Defender flagged it.** Builds up to 1.8.2 were detected as `Trojan:Win32/Bearfoos.B!ml`. The
`!ml` suffix means a machine-learning heuristic fired - nothing matched a known signature. It is not
mysterious which behaviour did it: an **unsigned** binary, installed under `%LOCALAPPDATA%`, writing
a `.ps1` into app data and running it elevated with `-ExecutionPolicy Bypass -WindowStyle Hidden`,
which spawns a hidden child, loads a TUN driver (`wintun.dll`), and rewrites the routing table. Read
as a sequence, that *is* the textbook dropper chain, and every classifier in the world is trained on
it. From 1.8.3 the first four are gone: no dropped script, no `powershell.exe`, no `runas`, no
`%LOCALAPPDATA%` install. The core is now spawned directly as a child process.

**Signing is still the durable fix**, and this project does not have a certificate yet. The release
workflow is already wired for one - set the `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`
secrets and every build is signed and timestamped; with them unset it builds unsigned exactly as
before. Note that the minisign key in `tauri.conf.json` signs the *updater manifest*, so a tampered
update is rejected; it does nothing for SmartScreen or Defender, which are a different trust system.
An EV certificate clears SmartScreen immediately, an OV one accumulates reputation over time, and
[SignPath Foundation](https://signpath.org/) grants free certificates to open-source projects.

If a build is still flagged:

- Report it to Microsoft at [the WDSI submission page](https://www.microsoft.com/en-us/wdsi/filesubmission)
  as a **false positive** ("Software developer" → incorrectly detected). Determinations usually come
  back within a day or two, and clear the detection for every user, not just the reporter.
- Verify the download against the checksums on the release, and build from source if you would
  rather not trust a binary at all.

Nothing here is worked around by other means - no instructions to add exclusion folders, and no
attempt to make the app harder for a scanner to inspect.

> **Upgrading from 1.8.2 or earlier:** the install location moves from `%LOCALAPPDATA%` to
> `Program Files`, and the per-machine installer cannot see the old per-user install to replace it -
> so uninstall the old copy from Add/Remove Programs once. Servers and settings are untouched either
> way: they live in app data, not the install folder.

## Releasing

Everything happens in this repo: it builds and signs the installer, and it is where users and the
auto-updater get it from.

```sh
npm run release -- patch     # or: minor, major, or an explicit X.Y.Z
npm run release -- patch --dry-run    # see every step first, changes nothing
```

1. Bumps `package.json`, `src-tauri/Cargo.toml`, and syncs `Cargo.lock`'s own entry; commits and
   tags (`vX.Y.Z`); pushes both.
2. The pushed tag triggers `.github/workflows/release.yml`: builds and signs, then publishes a
   **draft** release - the Windows installer + its `.sig`, the `.deb`, the `.apk`, and the
   `latest.json` the updater polls. Nothing else is bundled (no MSI, no AppImage).
3. Review the draft on GitHub, then publish it manually. A draft is invisible to the updater and to
   anonymous downloads until you do.

## Security

Report a security bug privately rather than in a public issue - see [SECURITY.md](SECURITY.md).

The trust boundary, stated plainly:

- **Server credentials are user secrets held in plaintext.** Subscription URLs, UUIDs, passwords and
  host names live in IndexedDB with **no encryption at rest**. A key kept beside the ciphertext on
  the same disk protects nothing, and implying otherwise would be worse than being clear. Anyone
  with read access to the profile directory has the servers.
- **The proxy core runs as a child process** with a generated config on a loopback SOCKS port. It is
  the official upstream binary, checksum-verified at fetch time, not a fork.
- **Routing decides what leaves directly.** A rule change can send traffic outside the tunnel; that
  is the point of the feature, and it is why the routing screen shows the evaluated order rather
  than a toggle.

## Contributing

Issues and pull requests are welcome. For anything larger than a fix, open an issue first so the
approach can be agreed before you spend the time. See [CONTRIBUTING.md](CONTRIBUTING.md).

Both gates must pass:

```sh
npm run check
npm test
```

House style is enforced by the linter and visible in any neighbouring file: Allman braces, one
import per module, and comments that state a constraint the code cannot show rather than narrating
what changed.

## License

[MIT](LICENSE).
