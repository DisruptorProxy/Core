# Cross-platform architecture & roadmap

How Disruptor Proxy runs the Xray core on each OS, what's done, and how the remaining
platforms get built. (For *releasing*, see `RELEASING.md`.)

## Status

| Platform | Backend | State |
| --- | --- | --- |
| **Windows** | `platform/windows.rs` | shipping - NSIS installer, signed, auto-updates |
| **Linux** | `platform/unix.rs` (pkexec) | shipping - `.deb` on the release |
| **macOS** | `platform/unix.rs` (osascript) | supported, but no release artifact yet - the release workflow has no macOS job, because an unsigned, un-notarized `.app` is Gatekeeper-blocked. Build from source until an Apple Developer account is in place. |
| **Android** | `vpn` module + libXray AAR | shipping - `.apk` on the release |
| **iOS** | - | not supported |

## How it works

**Rust — one dispatch, one lifecycle contract.** `src-tauri/src/platform/` holds a
platform-dispatched backend (`mod.rs` selects by `#[cfg]`):

- `windows.rs` — elevate via `ShellExecuteExW` "runas" + an elevated PowerShell wrapper.
- `unix.rs` — Linux + macOS; the same bash wrapper + lifecycle, differing only in the
  elevation call (`pkexec` on Linux, `osascript ... with administrator privileges` on
  macOS), isolated to `elevate_run`/`elevate_kill`.
- `unsupported.rs` — honest stubs so the crate compiles on every target.

All portable commands (probes, subscription fetch, geo download, config writing) stay in
`lib.rs`. Every real backend honours the same **stop-file + bounded-wait + verified-kill**
contract: signal the elevated wrapper, wait ≤ `STOP_TIMEOUT`, then force-kill and *verify*
nothing survives — so disconnect never hangs and never lies about being disconnected.

**Frontend — one seam, platform-gated chrome.** `src/features/connection/engine/port.ts`
(`ConnectionService`) is the single seam; `src/stores/platform.ts` (backed by the Rust
`platform_kind` command) exposes `isDesktop()`/`isMobile()`. Window chrome (titlebar,
tray, compact/expanded window modes) is desktop-only; mobile has none and uses the bottom
`TabBar`. The Xray config builder (`src/lib/xray/config.ts`) is pure and shared.

**Core binaries.** Windows' `app-xray.exe` + `wintun.dll` are committed. Every other
platform's core is fetched by `scripts/fetch-core.mjs` (downloads the official Xray-core
zip, verifies sha256 against its `.dgst`, extracts to `src-tauri/assets/app-xray`), which
is gitignored. Geo `.dat` files live in app data, found via `XRAY_LOCATION_ASSET`.

**Capabilities.** `capabilities/default.json` (all platforms: version + events) +
`capabilities/desktop.json` (window/tray/menu/updater, scoped `platforms: [windows, linux,
macOS]`).

## Building & verifying

- **Windows:** `npm run desktop-build`.
- **Linux:** `node scripts/fetch-core.mjs` → `sudo apt install libwebkit2gtk-4.1-dev
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev` →
  `npm run tauri build -- --bundles deb`. Needs `pkexec`/polkit at runtime.
- **macOS:** `node scripts/fetch-core.mjs` → `npm run tauri build -- --bundles app`
  (unsigned; sign + notarize for release — needs a paid Apple Developer account).
- **CI** (`.github/workflows/ci.yml`): a rust matrix (ubuntu + macos + windows) compiles &
  lints on every push; Linux `.deb` and macOS `.app` build jobs run on pushes to main.
- **On device** (the part CI can't do): connect shows the auth prompt → tun comes up →
  traffic actually routes; disconnect leaves no `app-xray`; TCP + Proxy ping and geo update
  work.

### Known runtime risks
- **macOS `utun`:** whether Xray-core's `tun` inbound supports macOS utun is the open
  question — if not, macOS needs a tun2socks bridge (like the Android plan below).
- **Linux:** requires `pkexec`/polkit; ship `.deb` + AppImage.

---

## Android (implemented — in-process libXray)

Android can't reuse the desktop model (the OS owns the VPN via `VpnService`, and apps
can't freely exec binaries). See `src-tauri/mobile/README.md` for the implemented design;
this is the architecture rationale.

**Why in-process, not the tun2socks split we first planned:** the original plan was a
v2rayNG-style bridge — `VpnService` establishes the tun, a tun2socks lib (loaded in-process
via JNI) forwards the fd into a spawned Xray's SOCKS inbound. It was abandoned once the real
constraint was measured: a spawned Xray can't receive the tun fd at all. Android's
`ProcessBuilder` closes every fd ≥ 3 across `exec` (verified on-device, even with
`FD_CLOEXEC` cleared), so `XRAY_TUN_FD` is meaningless to a child process. That left two
in-process options, and running Xray itself in-process (via libXray) is strictly simpler
than keeping a spawned Xray plus an in-process tun2socks — and lets Xray's own `tun` inbound
do the layer-3 work, so no tun2socks at all.

**Architecture (as built):**
- Xray runs in-process through [libXray](https://github.com/XTLS/libXray)'s gomobile AAR
  (`fetch-core.mjs --android` → `gen/android/app/libs/libXray.aar`, gitignored). No jniLibs
  Xray binary, no tun2socks, no NDK build for the core.
- `TunnelService` (Kotlin): consent → `Builder` (addr/route `0.0.0.0/0`, DNS, MTU) →
  `establish()` → tun fd → injected into the config root `env` as `xray.tun.fd` →
  `LibXray.invoke(runXrayFromJson)`. Xray's `tun` inbound reads the fd and proxies out;
  its outbound sockets are `protect()`-ed via libXray's `DialerController` callback.
- `buildMobileConfig` (`config.ts`) emits the `tun` inbound (not a SOCKS inbound) plus a
  loopback `metrics` listener; `TunnelService` polls `/debug/vars` for traffic counters,
  since there's no binary to run `xray api statsquery` against.
- Plugin `disruptor-vpn` (`vpn.rs` inline plugin + `VpnPlugin.kt`) exposes
  `start/stop/traffic`; `capabilities/mobile.json` grants it. TCP ping stays a socket connect.

**Still open:** geo-data provisioning on mobile (routing rules that reference
`geoip:`/`geosite:` need the `.dat` files under the app's asset dir); Always-on VPN and
reconnect polish; per-app routing.

## iOS (planned — the biggest lift)

Needs a Mac, a **paid Apple Developer account**, and a physical device (a Packet Tunnel
NetworkExtension doesn't run in the simulator).

- **Packet Tunnel Provider** app extension (Swift) with Xray built as an **xcframework**
  (gomobile) + in-extension tun2socks. Mind the NE memory ceiling (~15–50 MB).
- Scaffold `gen/apple`, add the NE target + `packet-tunnel-provider` entitlement,
  provisioning, and signing. Wire the same `ConnectionService` seam and a
  `buildIosConfig()` (SOCKS inbound).
- **Verify on a real device** (not the simulator); memory stays in budget; disconnect is
  clean; an archive builds.

---

## Recommended sequence

Confirm the desktop platforms before adding mobile: **push** so the CI matrix + Linux/macOS
build jobs run, then **test connect/disconnect** on a Linux box and a Mac. Only then start
Android (Option B) with the toolchain + a device in front of you; iOS last.
