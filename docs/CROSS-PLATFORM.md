# Cross-platform architecture & roadmap

How The Disruptor Proxy runs the Xray core on each OS, what's done, and how the remaining
platforms get built. (For *releasing*, see `RELEASING.md`.)

## Status

| Platform | Backend | State |
| --- | --- | --- |
| **Windows** | `platform/windows.rs` | ✅ shipping |
| **Linux** | `platform/unix.rs` (pkexec) | code + CI (compile & `.deb`); runtime = on-device |
| **macOS** | `platform/unix.rs` (osascript) | code + CI (compile & unsigned `.app`); runtime = on-device |
| **Android** | — | planned (see below) |
| **iOS** | — | planned (see below) |

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

## Android (planned)

Android can't reuse the desktop model (the OS owns the VPN via `VpnService`, and apps
can't freely exec binaries). It's a from-scratch native integration; needs the Android
SDK/NDK + a device/emulator to build and verify.

**Architecture — recommend Option B, note A:**
- **B (v2rayNG-style, recommended):** a Kotlin `VpnService` establishes the tun and hands
  its fd to **tun2socks** (hev-socks5-tunnel), which forwards to Xray's local SOCKS
  inbound; Xray proxies out with its outbound socket `protect()`-ed. Package the Android
  Xray ELF and tun2socks as jniLibs `lib*.so` (Android extracts those to the read+exec
  nativeLibraryDir — the only place you may exec on API 29+). Reuses the config builder
  almost verbatim (SOCKS inbound instead of the tun inbound).
- **A (fallback):** embed Xray as a gomobile AAR (libXray), run in-process — avoids the
  exec restriction but adds a Go/gomobile+NDK build. Choose only if B's exec path fails.

**Steps:**
1. `npm run tauri android init` — regenerates `src-tauri/gen/android` from
   `io.disruptorproxy.client`, replacing the stale `io.guardian` scaffold. Commit it.
2. Extend `fetch-core.mjs` to place per-ABI Xray as `jniLibs/<abi>/libxray.so`; add a
   maintained tun2socks as `libtun2socks.so` per ABI.
3. AndroidManifest: `BIND_VPN_SERVICE`, `FOREGROUND_SERVICE` (+ VPN type on API 34+),
   `POST_NOTIFICATIONS`, and the `<service>` with the `android.net.VpnService` filter.
4. Kotlin `TunnelService`: consent → `Builder` (addr/route 0.0.0.0/0, DNS, MTU) →
   `establish()` → tun fd; exec `libxray.so` (SOCKS config + `XRAY_LOCATION_ASSET`) and
   `libtun2socks.so` bridging the fd → SOCKS; `protect()` the Xray socket; foreground
   service + notification; a stop that tears down both and verifies (mirror the desktop
   contract).
5. A Tauri Android plugin (Kotlin) exposing `connect/disconnect/status/traffic`; add
   `capabilities/android.json`. TCP ping stays a pure socket connect.
6. Frontend: an Android `ConnectionService` (invokes the plugin), selected by
   `usePlatform().isMobile()` in `service.ts`; add `buildAndroidConfig()` in `config.ts`
   (SOCKS inbound, no tun inbound). The Phase-0 chrome gating already hides the titlebar/
   tray on mobile — verify the bottom-TabBar layout and safe-area insets on a phone.
7. Lifecycle: `onRevoke`, Always-on VPN, reconnect, background/rotation, API 13+
   notification permission; optional per-app routing.
8. Build/CI: `npm run tauri android build --apk`/`--aab`, sign with an upload keystore;
   an Actions job (android-actions/setup-android) that assembles the APK.

**Verify on device:** VPN-consent dialog → key icon; traffic routes (check your IP);
disconnect leaves no tunnel/orphan; survives background + rotation; a geo rule resolves.

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
