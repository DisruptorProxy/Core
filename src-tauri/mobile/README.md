# Mobile VPN backends

## Android — implemented and verified on a device

The Android tunnel is wired end to end and has run on hardware: consent dialog → foreground
service → in-process Xray (`core: Xray … started`) → the native `tun` inbound accepting the
VpnService fd's packets (`[tun-in -> proxy]`) with real traffic flowing.

| Piece | Where |
| --- | --- |
| Plugin commands (Rust) | `src-tauri/src/vpn.rs` — inline plugin, registered in `lib.rs` |
| Permission declaration | `src-tauri/build.rs` (`InlinedPlugin`) → `disruptor-vpn:*` |
| ACL grant | `src-tauri/capabilities/mobile.json` |
| Plugin bridge (Kotlin) | `gen/android/app/src/main/java/io/disruptorproxy/client/VpnPlugin.kt` |
| The tunnel (Kotlin) | `…/TunnelService.kt` |
| Manifest service + permissions | `gen/android/app/src/main/AndroidManifest.xml` |
| Release signing | `gen/android/app/build.gradle.kts` (`keystore.properties` or env) |
| Core (libXray AAR) | `npm run fetch-core:android` → `gen/android/app/libs/libXray.aar` |

### The command contract (unchanged, already wired on the JS side)

| Command | Args | Returns |
| --- | --- | --- |
| `start` | `{ config: <Xray JSON from buildMobileConfig> }` | — |
| `stop` | — | — |
| `traffic` | — | `{ uplink: number, downlink: number }` |

### How the packets actually flow

```
VpnService.establish() → tun fd → config env xray.tun.fd → in-process Xray `tun` inbound → server
```

Xray runs **in this app's process**, via [libXray](https://github.com/XTLS/libXray)'s
gomobile AAR. That is forced, not chosen: the tun fd from `VpnService.establish()` is only
valid inside our own process, and Android's `ProcessBuilder` closes every fd ≥ 3 across
`exec` (verified on-device — even with `FD_CLOEXEC` cleared), so a *spawned* `libxray.so`
could never receive it through `XRAY_TUN_FD`. In-process, Xray's own `tun` inbound reads the
fd (from the config root `env` that `TunnelService` injects) and does the layer-3 work
itself — so there is **no tun2socks bridge** anymore.

Xray's outbound sockets (its connection to the server) must stay out of the tunnel they
serve. libXray calls back through a `DialerController` for every outbound socket; the
callback runs `VpnService.protect()` on it. Stats can't use the desktop `xray api
statsquery` path (no binary to exec), so `buildMobileConfig` adds a loopback `metrics`
listener and `TunnelService` polls its `/debug/vars` expvar for `outbound>>>proxy>>>traffic`.

The AAR is libXray's prebuilt, self-contained gomobile binding (`libgojni.so` per ABI, Xray
statically linked). `npm run fetch-core:android` downloads and unpacks it into `app/libs`
(gitignored); no NDK and no per-ABI native build are involved.

### What to expect on first run

Verify, in order: the VPN consent dialog appears → key icon in the status bar → your public
IP changes → traffic counters move → `stop` tears the tunnel down → it survives backgrounding
and rotation. Watch `adb`/`npm run android-log` for `RustStdoutStderr`: a bad config or
missing geo data surfaces as a libXray `invoke` returning `success:false` with the Xray error.

### Signing

Release APKs must be signed or Android refuses to install them. Locally, drop a
`keystore.properties` next to `app/build.gradle.kts` (gitignored):

```properties
storeFile=/absolute/path/release.jks
storePassword=…
keyAlias=…
keyPassword=…
```

In CI, set the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
and `ANDROID_KEY_PASSWORD` secrets. With none present the release build stays **unsigned**
rather than failing, so the job still proves the APK assembles — it just cannot be installed.

## iOS — scaffold only

`ios/PacketTunnelProvider.swift` is a structured starting point, nothing more. It needs a
Mac for `tauri ios init`, a Packet Tunnel extension target with the `packet-tunnel-provider`
entitlement, Xray embedded as a gomobile **xcframework** (iOS forbids subprocesses, so the
core must run in-process — which does mean `XRAY_TUN_FD` works there), and a paid Apple
Developer account to sign. NetworkExtension does not run in the simulator, so a real device
is required.
