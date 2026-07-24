import NetworkExtension

// iOS VPN backend for The Disruptor Proxy - a Packet Tunnel Provider NetworkExtension.
//
// This is a SCAFFOLD - real, structured Swift, but NOT built or run (written without a Mac /
// Xcode). It becomes live only after `tauri ios init`, adding a Packet Tunnel app-extension
// target with the `packet-tunnel-provider` entitlement, and embedding Xray as an xcframework
// (see src-tauri/mobile/README.md). Expect on-device iteration - NE won't run in the
// simulator, and the extension has a hard memory ceiling (~15-50 MB).
//
// Unlike Android, iOS forbids subprocesses: Xray must run IN-PROCESS as an xcframework built
// with gomobile (e.g. libXray), and a tun2socks runs in the extension too, bridging
// `packetFlow` to Xray's local SOCKS inbound on 1080 (matches buildMobileConfig).

class PacketTunnelProvider: NEPacketTunnelProvider {

    // The SOCKS port Xray listens on (must match CONNECT_SOCKS_PORT in config.ts).
    private let socksPort = 1080

    override func startTunnel(options: [String: NSObject]?,
                              completionHandler: @escaping (Error?) -> Void) {
        // The Xray JSON (from buildMobileConfig) is passed through the tunnel provider
        // configuration (providerConfiguration["config"]) when the app saves the profile.
        guard let proto = protocolConfiguration as? NETunnelProviderProtocol,
              let configJSON = proto.providerConfiguration?["config"] as? String else {
            completionHandler(NSError(domain: "vpn", code: 1))
            return
        }

        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "172.19.19.1")
        settings.ipv4Settings = NEIPv4Settings(addresses: ["172.19.19.2"], subnetMasks: ["255.255.255.252"])
        settings.ipv4Settings?.includedRoutes = [NEIPv4Route.default()]
        settings.dnsSettings = NEDNSSettings(servers: ["1.1.1.1"])
        settings.mtu = 1500

        setTunnelNetworkSettings(settings) { [weak self] error in
            if let error = error { completionHandler(error); return }
            guard let self = self else { return }

            // TODO(on-device): start the embedded core + tun2socks.
            //  1. Write configJSON to a temp file; set XRAY_LOCATION_ASSET to the app-group
            //     container holding geoip.dat/geosite.dat; call the xcframework's start
            //     (e.g. LibXrayRunXray(configPath)) - NOT a subprocess.
            //  2. Run an in-process tun2socks bridging self.packetFlow <-> 127.0.0.1:socksPort.
            //  3. Pump packets: readPackets(completionHandler:) -> tun2socks -> writePackets.
            _ = configJSON
            _ = self.socksPort
            completionHandler(nil)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        // TODO(on-device): stop tun2socks + the embedded core, then complete.
        completionHandler()
    }

    // Optional: cumulative counters the app reads back for the traffic readout.
    override func handleAppMessage(_ messageData: Data,
                                   completionHandler: ((Data?) -> Void)?) {
        completionHandler?(nil)
    }
}
