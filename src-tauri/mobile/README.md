# Mobile VPN backends

## Android — implemented and verified on a device

The Android tunnel is wired end to end: consent dialog → foreground service → the Xray core
as a child process → its native `tun` inbound accepting the VpnService fd's packets
(`[tun-in -> proxy]`) with real traffic flowing.

| Piece | Where |
| --- | --- |
| Plugin commands (Rust) | `src-tauri/src/vpn.rs` — inline plugin, registered in `lib.rs` |
| Core spawner (Rust) | `src-tauri/src/android_core.rs` — JNI, called from `XrayCore.kt` |
| Permission declaration | `src-tauri/build.rs` (`InlinedPlugin`) → `disruptor-vpn:*` |
| ACL grant | `src-tauri/capabilities/mobile.json` |
| Plugin bridge (Kotlin) | `gen/android/app/src/main/java/io/disruptorproxy/client/VpnPlugin.kt` |
| The tunnel (Kotlin) | `…/TunnelService.kt` |
| Manifest service + permissions | `gen/android/app/src/main/AndroidManifest.xml` |
| Release signing | `gen/android/app/build.gradle.kts` (`keystore.properties` or env) |
| Core (per ABI) | `npm run fetch-core:android` → `gen/android/app/xrayLibs/<abi>/libxray.so` |

### The command contract (unchanged, already wired on the JS side)

| Command | Args | Returns |
| --- | --- | --- |
| `start` | `{ config: <Xray JSON from buildMobileConfig> }` | — |
| `stop` | — | — |
| `traffic` | — | `{ uplink: number, downlink: number }` |

### How the packets actually flow

```
VpnService.establish() → tun fd → dup() → exec libxray.so with XRAY_TUN_FD → Xray `tun` inbound → server
```

The core is the **stock Xray-core binary** — the same artifact the desktop builds use,
shipped per ABI as `libxray.so` — run as a child process. Xray's own `tun` inbound reads the
descriptor named by `XRAY_TUN_FD` and does the layer-3 work itself, so there is **no
tun2socks bridge** and no gomobile binding.

Getting a live fd to that child is the whole trick, and it is why the spawn happens in Rust
(`android_core.rs`) rather than Kotlin. Java's `ProcessBuilder` closes every fd ≥ 3 before
`exec`, so a core started from Kotlin would find nothing behind the number no matter what
`XRAY_TUN_FD` says — that much was measured on-device. A native `fork`/`exec` does not close
anything: `dup()` hands back a copy with `FD_CLOEXEC` cleared, the copy survives `exec` under
the same number, and that number is what goes into `XRAY_TUN_FD`.

`libxray.so` is an executable wearing a library's name. Since API 29 the only directory an
app may `exec` from is `nativeLibraryDir`, and the only way into it is the APK's `lib/<abi>/`
— hence the name, plus `useLegacyPackaging = true` so the file is actually extracted at
install instead of being left compressed inside the APK.

Xray's outbound sockets (its connection to the server) must stay out of the tunnel they
serve. `VpnService.protect()` cannot reach another process's sockets, so the exclusion is
done once, by uid: `TunnelService` calls `addDisallowedApplication(packageName)`, and the
core runs under this app's uid. If that call ever fails the tunnel is abandoned rather than
brought up, because the alternative is a routing loop. Stats can't use the desktop `xray api
statsquery` path, so `buildMobileConfig` adds a loopback `metrics` listener and
`TunnelService` polls its `/debug/vars` expvar for `outbound>>>proxy>>>traffic` — loopback,
so the process boundary doesn't matter.

`npm run fetch-core:android` downloads `Xray-android-arm64-v8a.zip` and
`Xray-android-amd64.zip`, verifies each against its published `.dgst`, and installs the
binaries into `app/xrayLibs/<abi>/libxray.so` (gitignored). No NDK, no gomobile, no per-ABI
native build.

### What to expect on first run

Verify, in order: the VPN consent dialog appears → key icon in the status bar → your public
IP changes → traffic counters move → `stop` tears the tunnel down → it survives backgrounding
and rotation. The core's own output goes nowhere (its stdio is `/dev/null`), so a bad config
or missing geo data shows up as the core exiting during its startup grace period —
`XrayCore.start` returns false and the half-open tunnel is torn back down. Watch
`adb`/`npm run android-log` for the service's side of that.

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
