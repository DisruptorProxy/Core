package io.disruptorproxy.client

// The Android half of the `disruptor-vpn` plugin the frontend invokes.
//
// The Rust side (src-tauri/src/vpn.rs) forwards `start` / `stop` / `traffic` here through
// Tauri's mobile plugin bridge; this class turns them into VpnService lifecycle calls.
//
// `start` is the interesting one: Android will not let an app become a VPN until the user
// approves it in a system dialog, so the first call may have to route through
// VpnService.prepare() and resolve only once the consent activity comes back.

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class StartArgs {
    /** The Xray JSON from buildMobileConfig, already serialised by the Rust side. */
    lateinit var config: String
}

@TauriPlugin
class VpnPlugin(private val activity: Activity) : Plugin(activity) {

    /** Held across the consent dialog, which is why start() cannot just be synchronous. */
    private var pendingConfig: String? = null

    @Command
    fun start(invoke: Invoke) {
        val args = invoke.parseArgs(StartArgs::class.java)
        pendingConfig = args.config

        // Non-null means the user has not approved this app as a VPN yet (or approval was
        // revoked); the returned Intent is the system consent dialog.
        val consent = VpnService.prepare(activity)
        if (consent != null) {
            startActivityForResult(invoke, consent, "onConsentResult")
            return
        }

        launchTunnel(invoke)
    }

    @ActivityCallback
    fun onConsentResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            pendingConfig = null
            invoke.reject("VPN permission was denied")
            return
        }

        launchTunnel(invoke)
    }

    private fun launchTunnel(invoke: Invoke) {
        val config = pendingConfig
        if (config == null) {
            invoke.reject("No configuration to start")
            return
        }
        pendingConfig = null

        val intent = Intent(activity, TunnelService::class.java)
            .setAction(TunnelService.ACTION_START)
            .putExtra(TunnelService.EXTRA_CONFIG, config)

        // A VPN must be a foreground service, and on API 26+ it has to be started as one.
        ContextCompat.startForegroundService(activity, intent)

        invoke.resolve()
    }

    @Command
    fun stop(invoke: Invoke) {
        val intent = Intent(activity, TunnelService::class.java)
            .setAction(TunnelService.ACTION_STOP)

        activity.startService(intent)

        invoke.resolve()
    }

    @Command
    fun traffic(invoke: Invoke) {
        val sample = JSObject()
        sample.put("uplink", TunnelService.uplink())
        sample.put("downlink", TunnelService.downlink())

        invoke.resolve(sample)
    }
}
