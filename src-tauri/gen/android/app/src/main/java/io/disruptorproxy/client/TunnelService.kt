package io.disruptorproxy.client

// The Android VPN tunnel for Disruptor Proxy.
//
// The core is the stock Xray-core binary, shipped as libxray.so and run as a child process
// (see XrayCore / src-tauri/src/android_core.rs). Xray's own `tun` inbound does the layer-3
// work, reading the descriptor VpnService hands us out of XRAY_TUN_FD, so this app needs no
// tun2socks bridge. Passing a live fd to a child is the one thing Kotlin cannot do here -
// ProcessBuilder closes every descriptor above stderr before exec - which is why the spawn
// happens natively on the Rust side.
//
//     VpnService.establish() -> tun fd -> XRAY_TUN_FD -> Xray tun inbound (child process)
//
// Xray's outbound sockets (its connection to the proxy server) must stay OUT of the tunnel
// they serve, or the connection loops back on itself. VpnService.protect() cannot reach
// another process's sockets, so the tunnel excludes this package instead - a uid rule, and
// the core runs under our uid, so it covers the core too. See startTunnel.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.ServiceCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class TunnelService : VpnService() {

    companion object {
        const val ACTION_START = "io.disruptorproxy.client.START"
        const val ACTION_STOP = "io.disruptorproxy.client.STOP"
        const val EXTRA_CONFIG = "config"

        /** Must match METRICS_PORT in src/lib/xray/config.ts. */
        private const val METRICS_PORT = 10086

        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "vpn"

        /** The core, as packaged by scripts/fetch-core.mjs. An `.so` name is what gets it
         *  into nativeLibraryDir, the only directory Android lets an app exec from. */
        private const val CORE_LIB = "libxray.so"

        /** Written under filesDir (app-private) because the core is a separate process and
         *  reads its config from a path, not from memory. It holds server credentials. */
        private const val CONFIG_FILE = "tunnel-config.json"

        @Volatile
        var running: Boolean = false
            private set

        /** Cumulative bytes through the `proxy` outbound since the core started, read from
         *  Xray's metrics expvar. Zero when no connection is up (the endpoint is closed) -
         *  the same "no connection" signal the desktop `xray_traffic` gives by failing. */
        fun uplink(): Long = metric("uplink")

        fun downlink(): Long = metric("downlink")

        private fun metric(direction: String): Long =
            try {
                val connection = (URL("http://127.0.0.1:$METRICS_PORT/debug/vars").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 500
                    readTimeout = 500
                }
                val body = try {
                    connection.inputStream.bufferedReader().use { it.readText() }
                } finally {
                    connection.disconnect()
                }
                // stats: { outbound: { proxy: { uplink, downlink } }, ... } - see xray-core
                // app/metrics. Missing until the first byte flows, hence the null-safe path.
                JSONObject(body)
                    .optJSONObject("stats")
                    ?.optJSONObject("outbound")
                    ?.optJSONObject("proxy")
                    ?.optLong(direction, 0L) ?: 0L
            } catch (_: Exception) {
                0L
            }
    }

    private var tun: ParcelFileDescriptor? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTunnel()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> intent?.getStringExtra(EXTRA_CONFIG)?.let { startTunnel(it) }
        }

        return START_STICKY
    }

    private fun startTunnel(configJson: String) {
        if (running) {
            return
        }

        // Route the whole device, but exclude ourselves: Xray's own connection to the server
        // must not be pulled back into the tunnel it is serving. The exclusion is by uid, so
        // it covers the core's child process as well - which is the only thing keeping that
        // loop from forming, since protect() cannot reach another process's sockets.
        val builder = Builder()
            .setSession("Disruptor Proxy")
            .setMtu(1500)
            .addAddress("172.19.19.1", 30)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("1.1.1.1")

        try {
            builder.addDisallowedApplication(packageName)
        } catch (_: Exception) {
            // Our own package is always installed, so this should not be reachable - but a
            // tunnel without the exclusion would route the core's uplink into itself, so
            // give up rather than bring up something that cannot work.
            stopSelf()
            return
        }

        val descriptor = builder.establish()
        if (descriptor == null) {
            stopSelf()
            return
        }
        tun = descriptor

        // A VpnService started with startForegroundService must call startForeground within a
        // few seconds or the system force-crashes the app - so this happens before the core
        // starts, not after. VPN has no dedicated foreground-service type; API 34+ requires
        // the "special use" one declared (with its subtype) in AndroidManifest.xml.
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)

        val config = File(filesDir, CONFIG_FILE)
        config.writeText(configJson)

        running = true

        // start() blocks long enough to see the core reject its config, and loading geo data
        // can take a moment more, so keep it off the service's main thread. A start failure
        // (bad config, missing geo files) tears the half-open tunnel back down.
        Thread({
            val started = XrayCore.start(
                File(applicationInfo.nativeLibraryDir, CORE_LIB).absolutePath,
                config.absolutePath,
                filesDir.absolutePath,
                descriptor.fd
            )

            if (!started) {
                stopTunnel()
                stopSelf()
            }
        }, "xray").start()
    }

    private fun stopTunnel() {
        if (running) {
            XrayCore.stop()
        }
        running = false

        // The core is gone, so the config has no reader left; it holds server credentials.
        File(filesDir, CONFIG_FILE).delete()

        try {
            tun?.close()
        } catch (_: Exception) {
            // Already closed by the system (revoke) or by the core on shutdown; nothing to do.
        }
        tun = null

        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    }

    /** The system revoked the VPN (another app took it over, or the user disconnected). */
    override fun onRevoke() {
        stopTunnel()
        stopSelf()
    }

    override fun onDestroy() {
        stopTunnel()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "VPN", NotificationManager.IMPORTANCE_LOW)
            )
        }

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Disruptor Proxy")
            .setContentText("Connected")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .build()
    }
}
