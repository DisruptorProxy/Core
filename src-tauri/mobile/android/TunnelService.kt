package io.disruptorproxy.client

// Android VPN backend for The Disruptor Proxy.
//
// This is a SCAFFOLD - real, structured Kotlin, but it has NOT been built or run (it was
// written on a machine without the Android SDK). It compiles into the app only after
// `tauri android init` regenerates gen/android and this file + the plugin below are wired
// in (see src-tauri/mobile/README.md). Expect on-device iteration, especially around the
// tun2socks fd handoff.
//
// Model (v2rayNG-style): VpnService.establish() gives a tun fd; a tun2socks
// (hev-socks5-tunnel, shipped as jniLibs/<abi>/libtun2socks.so) forwards it to the local
// SOCKS inbound that the Xray core (jniLibs/<abi>/libxray.so) exposes on port 1080 (matches
// buildMobileConfig's CONNECT_SOCKS_PORT). The app's own package is excluded from the tun so
// Xray's outbound to the server doesn't loop back through the tunnel.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import java.io.File

class TunnelService : VpnService() {

    companion object {
        const val ACTION_START = "io.disruptorproxy.client.START"
        const val ACTION_STOP = "io.disruptorproxy.client.STOP"
        const val EXTRA_CONFIG = "config" // the Xray JSON from buildMobileConfig
        const val SOCKS_PORT = 1080 // must match CONNECT_SOCKS_PORT in src/lib/xray/config.ts
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "vpn"

        @Volatile var running: Boolean = false
        // Cumulative bytes, read back by the plugin's `traffic` command. Populate from
        // Xray's stats API (127.0.0.1:10085, matching API_INBOUND) or tun2socks counters.
        @Volatile var uplink: Long = 0
        @Volatile var downlink: Long = 0
    }

    private var tun: ParcelFileDescriptor? = null
    private var xray: Process? = null
    private var tun2socks: Process? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopTunnel(); stopSelf(); return START_NOT_STICKY }
            else -> intent?.getStringExtra(EXTRA_CONFIG)?.let { startTunnel(it) }
        }
        return START_STICKY
    }

    private fun startTunnel(configJson: String) {
        if (running) return

        val filesDir = applicationContext.filesDir
        val configFile = File(filesDir, "config.json").apply { writeText(configJson) }

        // The tun. Route everything; exclude our own app so Xray's outbound isn't tunnelled
        // back into itself (cheaper and simpler than protect()-ing each socket).
        val builder = Builder()
            .setSession("The Disruptor Proxy")
            .setMtu(1500)
            .addAddress("172.19.19.1", 30)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("1.1.1.1")
        try {
            builder.addDisallowedApplication(packageName)
        } catch (_: Exception) { /* ignore - our package is always installed */ }

        tun = builder.establish() ?: run { stopSelf(); return }

        // The core (extracted to the read+exec nativeLibraryDir as libxray.so). Point it at
        // the geo .dat files in app data via XRAY_LOCATION_ASSET.
        val nativeDir = applicationInfo.nativeLibraryDir
        xray = ProcessBuilder(File(nativeDir, "libxray.so").absolutePath, "run", "-c", configFile.absolutePath)
            .directory(filesDir)
            .apply { environment()["XRAY_LOCATION_ASSET"] = filesDir.absolutePath }
            .redirectErrorStream(true)
            .start()

        // tun2socks: bridge the tun fd <-> the local SOCKS inbound. hev-socks5-tunnel reads a
        // small YAML (tunnel fd + socks5 address/port). TODO(on-device): confirm how your
        // tun2socks build takes the fd - a --fd flag, or a config `tunnel: { fd: N }` - and
        // pass tun!!.fd accordingly.
        val t2sConfig = File(filesDir, "tun2socks.yml").apply {
            writeText(
                """
                tunnel:
                  mtu: 1500
                socks5:
                  address: 127.0.0.1
                  port: $SOCKS_PORT
                  udp: udp
                """.trimIndent()
            )
        }
        tun2socks = ProcessBuilder(File(nativeDir, "libtun2socks.so").absolutePath, t2sConfig.absolutePath, tun!!.fd.toString())
            .redirectErrorStream(true)
            .start()

        startForeground(NOTIFICATION_ID, notification())
        running = true
    }

    private fun stopTunnel() {
        running = false
        tun2socks?.destroy(); tun2socks = null
        xray?.destroy(); xray = null
        try { tun?.close() } catch (_: Exception) {}
        tun = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onRevoke() { stopTunnel(); stopSelf() }
    override fun onDestroy() { stopTunnel(); super.onDestroy() }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "VPN", NotificationManager.IMPORTANCE_LOW)
            )
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("The Disruptor Proxy")
            .setContentText("Connected")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .build()
    }
}
