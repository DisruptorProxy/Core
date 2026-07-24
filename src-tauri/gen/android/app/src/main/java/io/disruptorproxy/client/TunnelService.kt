package io.disruptorproxy.client

// The Android VPN tunnel for The Disruptor Proxy.
//
// NOT YET RUN ON A DEVICE. It is structurally complete and follows the design every
// Android Xray client uses, but the JNI boundary below is the part that always needs
// on-device iteration - treat a first run as a debugging session, not a smoke test.
//
// Why this shape: Xray's own `tun` inbound cannot create the interface on Android (the OS
// owns it), and its documented escape hatch - handing Xray a pre-opened tun fd via
// XRAY_TUN_FD - only works when Xray runs IN-PROCESS as a gomobile library. We ship Xray
// as a spawned executable (libxray.so), and Android's ProcessBuilder closes inherited fds,
// so that fd would be meaningless in the child. Hence the standard split:
//
//     VpnService.establish() -> tun fd -> tun2socks (in-process, JNI) -> SOCKS 1080 -> Xray
//
// tun2socks is hev-socks5-tunnel, loaded into THIS process so the fd stays valid, exposing
// the same three entry points heiher/sockstun uses. Xray itself stays a child process,
// reading the SOCKS-inbound config that buildMobileConfig produces.

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
        const val EXTRA_CONFIG = "config"

        /** Must match CONNECT_SOCKS_PORT in src/lib/xray/config.ts. */
        const val SOCKS_PORT = 1080

        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "vpn"

        @Volatile
        var running: Boolean = false
            private set

        init {
            System.loadLibrary("hev-socks5-tunnel")
        }

        /** Runs tun2socks against an already-open tun fd. Blocks, so it needs its own thread. */
        @JvmStatic
        external fun TProxyStartService(configPath: String, fd: Int)

        @JvmStatic
        external fun TProxyStopService()

        /** [txPackets, txBytes, rxPackets, rxBytes] - or null before the tunnel is up. */
        @JvmStatic
        external fun TProxyGetStats(): LongArray?

        /** Cumulative bytes, read back by the plugin's `traffic` command. */
        fun uplink(): Long = TProxyGetStats()?.getOrNull(1) ?: 0L

        fun downlink(): Long = TProxyGetStats()?.getOrNull(3) ?: 0L
    }

    private var tun: ParcelFileDescriptor? = null
    private var xray: Process? = null

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

        val filesDir = applicationContext.filesDir
        val configFile = File(filesDir, "config.json").apply { writeText(configJson) }

        // Route everything, but exclude ourselves: Xray's own connection to the server must
        // not be pulled back into the tunnel it is serving.
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

        // The core is exec'd from nativeLibraryDir - the only place Android still allows
        // executing from on API 29+, which is why fetch-core installs it as libxray.so.
        val nativeDir = applicationInfo.nativeLibraryDir
        xray = ProcessBuilder(
            File(nativeDir, "libxray.so").absolutePath,
            "run",
            "-c",
            configFile.absolutePath
        )
            .directory(filesDir)
            .apply { environment()["XRAY_LOCATION_ASSET"] = filesDir.absolutePath }
            .redirectErrorStream(true)
            .start()

        // hev-socks5-tunnel reads a small YAML; the tun fd is handed over separately so it
        // never has to open an interface itself.
        val tunnelConfig = File(filesDir, "tun2socks.yml").apply {
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

        running = true

        // TProxyStartService blocks for the tunnel's lifetime, so it cannot run on the
        // service's main thread.
        Thread({ TProxyStartService(tunnelConfig.absolutePath, descriptor.fd) }, "tun2socks").start()

        startForeground(NOTIFICATION_ID, notification())
    }

    private fun stopTunnel() {
        if (running) {
            TProxyStopService()
        }
        running = false

        xray?.destroy()
        xray = null

        try {
            tun?.close()
        } catch (_: Exception) {
            // Already closed by the system (revoke); nothing to do.
        }
        tun = null

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        }
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
