package io.disruptorproxy.client

// The Android VPN tunnel for The Disruptor Proxy.
//
// Xray runs IN THIS PROCESS, via libXray's gomobile bindings (see app/libs/libXray.aar,
// fetched by scripts/fetch-core.mjs). That is not a preference but a hard constraint: the
// tun fd VpnService hands us is only valid inside our own process, and Android's
// ProcessBuilder closes every fd >= 3 across exec - so a spawned libxray.so binary could
// never receive it, no matter how XRAY_TUN_FD is passed. Running the core in-process lets
// Xray's own `tun` inbound read the fd (from the config's `env`) and do the layer-3 work
// itself, which is why this app no longer needs a tun2socks bridge.
//
//     VpnService.establish() -> tun fd -> config env xray.tun.fd -> in-process Xray tun inbound
//
// Xray's outbound sockets (its connection to the proxy server) must stay OUT of the tunnel
// they serve, or the connection loops back on itself. VpnService.protect() marks a socket to
// bypass the VPN; libXray calls back into `protect()` for every outbound socket through the
// DialerController registered below.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.ServiceCompat
import libXray.DialerController
import libXray.LibXray
import org.json.JSONObject
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

    // Kept as a field so gomobile's Java-side reference survives for the tunnel's lifetime.
    // Returns whether the socket was successfully excluded from the VPN; xray-core logs and
    // proceeds either way, but a false here would mean a routing loop, so it should hold.
    private val dialerController = DialerController { fd -> protect(fd.toInt()) }

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
        // must not be pulled back into the tunnel it is serving (protect() guards the
        // individual sockets; this keeps our other traffic out too).
        val builder = Builder()
            .setSession("The Disruptor Proxy")
            .setMtu(1500)
            .addAddress("172.19.19.1", 30)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("1.1.1.1")

        try {
            builder.addDisallowedApplication(packageName)
        } catch (_: Exception) {
            // Our own package is always installed; ignore.
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

        // libXray asks us to protect each outbound socket it dials, so Xray's uplink bypasses
        // the tunnel. Registered before the core starts so the very first dial is covered.
        LibXray.registerDialerController(dialerController)

        val configWithEnv = injectRuntimeEnv(configJson, descriptor.fd)

        running = true

        // invoke(runXrayFromJson) returns once the core has started, but loading geo data can
        // take a moment, so keep it off the service's main thread. A start failure (bad
        // config, missing geo files) tears the half-open tunnel back down.
        Thread({
            val response = LibXray.invoke(runXrayFromJsonRequest(configWithEnv))
            if (!JSONObject(response).optBoolean("success", false)) {
                stopTunnel()
                stopSelf()
            }
        }, "xray").start()
    }

    /** Adds the two runtime-only values Xray needs into the config root `env` (which
     *  xray-core applies with os.Setenv at load): the tun fd, known only after establish(),
     *  and the asset dir where geoip/geosite live. */
    private fun injectRuntimeEnv(configJson: String, fd: Int): String {
        val config = JSONObject(configJson)
        val env = config.optJSONObject("env") ?: JSONObject()
        env.put("xray.tun.fd", fd.toString())
        env.put("xray.location.asset", applicationContext.filesDir.absolutePath)
        config.put("env", env)
        return config.toString()
    }

    private fun runXrayFromJsonRequest(configJson: String): String =
        JSONObject()
            .put("apiVersion", 1)
            .put("method", "runXrayFromJson")
            .put("payload", JSONObject().put("configJSON", configJson))
            .toString()

    private fun stopXrayRequest(): String =
        JSONObject()
            .put("apiVersion", 1)
            .put("method", "stopXray")
            .toString()

    private fun stopTunnel() {
        if (running) {
            LibXray.invoke(stopXrayRequest())
        }
        running = false

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
            .setContentTitle("The Disruptor Proxy")
            .setContentText("Connected")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .build()
    }
}
