# Mobile VPN backends

## Android — implemented, not yet run on a device

The Android tunnel is wired end to end. Everything below exists and compiles; **none of it
has been run on hardware**, so treat the first launch as a debugging session.

| Piece | Where |
| --- | --- |
| Plugin commands (Rust) | `src-tauri/src/vpn.rs` — inline plugin, registered in `lib.rs` |
| Permission declaration | `src-tauri/build.rs` (`InlinedPlugin`) → `disruptor-vpn:*` |
| ACL grant | `src-tauri/capabilities/mobile.json` |
| Plugin bridge (Kotlin) | `gen/android/app/src/main/java/io/disruptorproxy/client/VpnPlugin.kt` |
| The tunnel (Kotlin) | `…/TunnelService.kt` |
| Manifest service + permissions | `gen/android/app/src/main/AndroidManifest.xml` |
| Release signing | `gen/android/app/build.gradle.kts` (`keystore.properties` or env) |
| Native libs | `npm run fetch-core:android` + `npm run build-tun2socks` |

### The command contract (unchanged, already wired on the JS side)

| Command | Args | Returns |
| --- | --- | --- |
| `start` | `{ config: <Xray JSON from buildMobileConfig> }` | — |
| `stop` | — | — |
| `traffic` | — | `{ uplink: number, downlink: number }` |

### How the packets actually flow

```
VpnService.establish() → tun fd → tun2socks (in-process, JNI) → SOCKS 1080 → Xray → server
```

Xray's own `tun` inbound **cannot** create the interface on Android — the OS owns it. Its
documented escape hatch (hand Xray a pre-opened fd via `XRAY_TUN_FD`) only works when Xray
runs *in-process* as a gomobile library. We ship Xray as a spawned executable, and Android's
`ProcessBuilder` closes inherited fds, so that fd would be meaningless in the child.

Hence the split: **tun2socks is loaded into the app's own process** (so the fd stays valid)
and bridges the tun into the SOCKS inbound that `buildMobileConfig` produces, while Xray
stays a child process. This is the same shape every Android Xray client uses.

tun2socks is [hev-socks5-tunnel](https://github.com/heiher/hev-socks5-tunnel), **built from
source** — the project publishes no Android artifacts, and its prebuilt linux-arm64 binaries
do not work on Android. `npm run build-tun2socks` runs `ndk-build` against its `Android.mk`
and installs `libhev-socks5-tunnel.so` per ABI. Needs `NDK_HOME`.

### What to expect on first run

The JNI boundary is the unproven part. `TunnelService` declares three externs
(`TProxyStartService` / `TProxyStopService` / `TProxyGetStats`) matching what
[sockstun](https://github.com/heiher/sockstun) exposes. If the build's symbols differ, that
is the first thing to reconcile — an `UnsatisfiedLinkError` on connect is the tell.

Then verify, in order: the VPN consent dialog appears → key icon in the status bar → your
public IP changes → traffic counters move → `stop` tears the tunnel down → it survives
backgrounding and rotation.

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
