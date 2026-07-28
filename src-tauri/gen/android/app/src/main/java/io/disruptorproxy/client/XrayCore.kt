package io.disruptorproxy.client

// The Xray core, run as a child process.
//
// Everything here is implemented in src-tauri/src/android_core.rs. It has to be: the core
// needs the VpnService tun fd, and Java's ProcessBuilder closes every descriptor above
// stderr before exec, so a core started from Kotlin could never receive it. The Rust side
// spawns natively and passes the fd through as XRAY_TUN_FD.
//
// The library is the app's own Tauri lib, already loaded by the time the UI runs;
// loadLibrary here covers the case where the system restarts TunnelService on its own.

object XrayCore {
    init {
        System.loadLibrary("disruptor_proxy_lib")
    }

    /**
     * Starts `binary` on the config at `configPath`, with `assetDir` holding geoip/geosite
     * and `tunFd` the descriptor from VpnService.establish(). The fd is only duplicated,
     * so the caller keeps ownership of it.
     *
     * Returns false if the core failed to start or exited straight away on a bad config.
     * Blocks for a moment to find that out, so call it off the main thread.
     */
    @JvmStatic
    external fun start(binary: String, configPath: String, assetDir: String, tunFd: Int): Boolean

    /** Stops the core if one is running; a no-op otherwise. */
    @JvmStatic
    external fun stop()
}
