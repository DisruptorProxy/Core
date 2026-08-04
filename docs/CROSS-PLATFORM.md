# Cross-platform architecture & roadmap

How Disruptor Proxy runs the Xray core on each OS, what's done, and how the remaining
platforms get built. (For *releasing*, see `RELEASING.md`.)

## Status

| Platform | Backend | State |
| --- | --- | --- |
| **Windows** | `platform/windows.rs` | shipping - NSIS installer, signed, auto-updates |
| **Linux** | `platform/unix.rs` (pkexec) | shipping - `.deb` on the release |
| **macOS** | - | not supported - nothing builds or ships it |
| **Android** | `vpn` module + spawned Xray binary | shipping - `.apk` on the release |
| **iOS** | - | not supported |

## How it works

**Rust — one dispatch, one lifecycle contract.** `src-tauri/src/platform/` holds a
platform-dispatched backend (`mod.rs` selects by `#[cfg]`):

- `windows.rs` — elevate via `ShellExecuteExW` "runas" + an elevated PowerShell wrapper.
- `unix.rs` — Linux. It still carries `cfg(target_os = "macos")` branches in
  `elevate_run`/`elevate_kill` (`osascript` instead of `pkexec`), left over from when
  macOS was a target; nothing builds them now.
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
`capabilities/desktop.json` (window/tray/menu/updater, scoped `platforms: [windows,
linux]`).

## Building & verifying

- **Windows:** `npm run desktop-build`.
- **Linux:** `node scripts/fetch-core.mjs` → `sudo apt install libwebkit2gtk-4.1-dev
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev` →
  `npm run tauri build -- --bundles deb`. Needs `pkexec`/polkit at runtime.
- **CI** (`.github/workflows/ci.yml`): a rust matrix (ubuntu + windows) compiles & lints
  on every push; Linux `.deb`, Windows NSIS and Android `.apk` jobs run on pushes to main.
- **On device** (the part CI can't do): connect shows the auth prompt → tun comes up →
  traffic actually routes; disconnect leaves no `app-xray`; ping and geo update work.

### Known runtime risks
- **Linux:** requires `pkexec`/polkit; ship `.deb` + AppImage.

---

## Android (implemented — the stock Xray binary, spawned with the tun fd)

Android can't reuse the desktop model (the OS owns the VPN via `VpnService`, and apps
can't freely exec binaries). See `src-tauri/mobile/README.md` for the implemented design;
this is the architecture rationale.

**Why not the tun2socks split we first planned:** the original plan was a v2rayNG-style
bridge — `VpnService` establishes the tun, a tun2socks lib (loaded in-process via JNI)
forwards the fd into a spawned Xray's SOCKS inbound. Unnecessary: Xray's own `tun` inbound
does the layer-3 work given the fd, which `XRAY_TUN_FD` names.

**Why the spawn is native, not Kotlin:** Java's `ProcessBuilder` closes every fd ≥ 3 across
`exec` (measured on-device, even with `FD_CLOEXEC` cleared), so a core started from Kotlin
would find nothing behind the number. That is a `ProcessBuilder` behaviour, not a kernel one
— a native `fork`/`exec` inherits whatever isn't marked `FD_CLOEXEC`, and `dup()` returns a
copy with that flag cleared. So the spawn lives in Rust, and the app ships the same official
Xray-core binary as every other platform instead of a gomobile binding.

**Architecture (as built):**
- The core is `Xray-android-<abi>` from the official release, installed as
  `gen/android/app/xrayLibs/<abi>/libxray.so` by `fetch-core.mjs --android` (gitignored) and
  packaged with `useLegacyPackaging` so it lands in `nativeLibraryDir` — since API 29 the
  only directory an app may exec from. No tun2socks, no NDK build for the core.
- `TunnelService` (Kotlin): consent → `Builder` (addr/route `0.0.0.0/0`, DNS, MTU) →
  `establish()` → tun fd → `XrayCore.start` → `android_core.rs` dups the fd and execs the
  core with `XRAY_TUN_FD` and `XRAY_LOCATION_ASSET` set. Xray's `tun` inbound reads the fd
  and proxies out.
- The core's own uplink stays out of the tunnel by uid, not by socket: `protect()` can't
  reach another process, so `TunnelService` excludes this package from the VPN and the child
  inherits that exclusion.
- `buildMobileConfig` (`config.ts`) emits the `tun` inbound (not a SOCKS inbound) plus a
  loopback `metrics` listener; `TunnelService` polls `/debug/vars` for traffic counters,
  which works across the process boundary because it is loopback.
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

Confirm the desktop platforms before adding mobile: **push** so the CI matrix + Linux and
Windows build jobs run, then **test connect/disconnect** on a Linux box. Only then start
Android (Option B) with the toolchain + a device in front of you; iOS last.
