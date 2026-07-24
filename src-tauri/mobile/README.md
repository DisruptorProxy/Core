# Mobile VPN backends (Android + iOS)

The frontend and config already handle mobile (Phase 0 gating; `buildMobileConfig`; the
engine in `tauri.ts` invokes `plugin:disruptor-vpn|start/stop/traffic` on mobile). What's
left is the **native VPN plugin** these two scaffolds become. They were written without an
Android SDK or a Mac, so treat them as a well-structured starting point that needs building
+ on-device iteration, not finished code.

- `android/TunnelService.kt` — the `VpnService` (tun + Xray + tun2socks).
- `ios/PacketTunnelProvider.swift` — the Packet Tunnel `NetworkExtension`.

## The command contract (already wired on the JS side)

The frontend calls one Tauri plugin, `disruptor-vpn`, with three commands:

| Command | Args | Returns |
| --- | --- | --- |
| `start` | `{ config: <Xray JSON from buildMobileConfig> }` | — |
| `stop` | — | — |
| `traffic` | — | `{ uplink: number, downlink: number }` |

## Android

1. **Scaffold** (regenerates `gen/android` under `io.disruptorproxy.client`; the stale
   `io.guardian` is already renamed but a fresh init is cleaner):
   `npm run tauri android init`.
2. **Create the plugin:** `npx tauri plugin new disruptor-vpn --android --ios --no-api`.
   Move `TunnelService.kt` into the plugin's `android/src/main/java/...`, and implement its
   Kotlin plugin's `@Command start/stop/traffic` to drive the service:
   - `start`: `context.startForegroundService(Intent(ctx, TunnelService::class).setAction(ACTION_START).putExtra(EXTRA_CONFIG, config))`, after `VpnService.prepare()` consent.
   - `stop`: send `ACTION_STOP`.
   - `traffic`: return `TunnelService.uplink/downlink`.
3. **Manifest** (`gen/android/app/src/main/AndroidManifest.xml`): add
   `android.permission.FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` (API 34+),
   `POST_NOTIFICATIONS`, and the service:
   `<service android:name="...TunnelService" android:permission="android.permission.BIND_VPN_SERVICE" android:foregroundServiceType="specialUse"><intent-filter><action android:name="android.net.VpnService"/></intent-filter></service>`.
4. **Cores:** `npm run fetch-core:android` drops `libxray.so` per ABI into
   `gen/android/app/src/main/jniLibs/<abi>/` (gitignored). Add a maintained tun2socks
   (hev-socks5-tunnel) as `libtun2socks.so` per ABI - confirm how your build takes the tun
   fd and adjust the `ProcessBuilder` call in `TunnelService`.
5. **Capabilities:** add `src-tauri/capabilities/mobile.json`, `platforms: ["android","iOS"]`,
   granting `disruptor-vpn:allow-start/allow-stop/allow-traffic` (the plugin defines these).
6. **Build:** `npm run android` (dev on a device/emulator) / `npm run android-apk`.

**Verify on device:** VPN-consent dialog → key icon; real traffic routes (check your IP);
`stop` tears down; survives background/rotation; a geo routing rule resolves.

## iOS

1. **Scaffold:** `npm run tauri ios init` (needs a Mac + Xcode). Add a **Packet Tunnel
   Provider** app-extension target with the `com.apple.developer.networking.networkextension`
   = `packet-tunnel-provider` entitlement; move `PacketTunnelProvider.swift` into it.
2. **Embed Xray** as an **xcframework** built with gomobile (e.g. libXray) - iOS forbids
   subprocesses, so the core runs in-process; add an in-extension tun2socks bridging
   `packetFlow` ↔ SOCKS 1080. Share `geoip.dat`/`geosite.dat` via an App Group container and
   set `XRAY_LOCATION_ASSET` to it.
3. **Plugin:** the same `disruptor-vpn` plugin's `ios/` Swift implements `start/stop/traffic`
   by managing an `NETunnelProviderManager` (save the profile with
   `providerConfiguration["config"] = <Xray JSON>`, then `startVPNTunnel()`).
4. **Signing:** needs a paid Apple Developer account + provisioning for the app and the
   extension. **Verify on a real device** (NE doesn't run in the simulator); watch memory.

## Notes

- One config builder, one routing model: mobile uses `buildMobileConfig` (SOCKS inbound, no
  tun) - the OS owns the tunnel. Geo, probes, and stats work as on desktop.
- Loop prevention: Android uses `addDisallowedApplication(packageName)`; iOS routes only via
  the tunnel's included routes and the extension's own sockets bypass it.
