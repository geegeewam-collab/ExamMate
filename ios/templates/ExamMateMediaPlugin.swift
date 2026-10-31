import AVFoundation
import Capacitor
import MediaPlayer

@objc(ExamMateMediaPlugin)
public final class ExamMateMediaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ExamMateMediaPlugin"
    public let jsName = "ExamMateMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAudioRoutes", returnType: CAPPluginReturnPromise)
    ]

    private struct Target {
        let command: MPRemoteCommand
        let token: Any
    }

    private var targets: [Target] = []
    private var active = false
    private var installed = false

    @objc public func activate(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("Media controls are unavailable."); return }
            self.installRemoteCommands()
            self.active = true
            self.setCommandsEnabled(true)
            call.resolve()
        }
    }

    @objc public func update(_ call: CAPPluginCall) {
        let title = call.getString("title")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let subtitle = call.getString("subtitle")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let playing = call.getBool("playing") ?? false
        let isActive = call.getBool("active") ?? false

        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("Media controls are unavailable."); return }
            self.active = isActive
            self.setCommandsEnabled(isActive)
            if isActive {
                var info: [String: Any] = [
                    MPMediaItemPropertyTitle: (title?.isEmpty == false ? title! : "Exam Mate"),
                    MPMediaItemPropertyArtist: "Exam Mate"
                ]
                if let subtitle, !subtitle.isEmpty { info[MPMediaItemPropertyAlbumTitle] = subtitle }
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
                if #available(iOS 13.0, *) {
                    MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
                }
            } else {
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
                if #available(iOS 13.0, *) { MPNowPlayingInfoCenter.default().playbackState = .stopped }
            }
            call.resolve()
        }
    }

    @objc public func deactivate(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(); return }
            self.active = false
            self.setCommandsEnabled(false)
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            if #available(iOS 13.0, *) { MPNowPlayingInfoCenter.default().playbackState = .stopped }
            call.resolve()
        }
    }

    @objc public func getAudioRoutes(_ call: CAPPluginCall) {
        let route = AVAudioSession.sharedInstance().currentRoute
        let inputs = route.inputs.map { "\($0.portName) · \($0.portType.rawValue)" }
        let outputs = route.outputs.map { "\($0.portName) · \($0.portType.rawValue)" }
        call.resolve(["inputs": inputs, "outputs": outputs])
    }

    private func installRemoteCommands() {
        guard !installed else { return }
        installed = true
        let center = MPRemoteCommandCenter.shared()
        add(center.playCommand, action: "play")
        add(center.pauseCommand, action: "pause")
        add(center.togglePlayPauseCommand, action: "toggle")
        add(center.nextTrackCommand, action: "next")
        add(center.previousTrackCommand, action: "back")
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.preferredIntervals = [10]
        add(center.skipForwardCommand, action: "fastforward")
        add(center.skipBackwardCommand, action: "repeat")
    }

    private func add(_ command: MPRemoteCommand, action: String) {
        let token = command.addTarget { [weak self] _ in
            guard let self, self.active else { return .noSuchContent }
            DispatchQueue.main.async {
                self.notifyListeners("mediaAction", data: ["action": action])
            }
            return .success
        }
        targets.append(Target(command: command, token: token))
    }

    private func setCommandsEnabled(_ enabled: Bool) {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = enabled
        center.pauseCommand.isEnabled = enabled
        center.togglePlayPauseCommand.isEnabled = enabled
        center.nextTrackCommand.isEnabled = enabled
        center.previousTrackCommand.isEnabled = enabled
        center.skipForwardCommand.isEnabled = enabled
        center.skipBackwardCommand.isEnabled = enabled
    }

    deinit {
        // MPRemoteCommandCenter is process-wide. Remove only our own handlers; do not
        // disable commands that another audio app may have installed after Exam Mate.
        for target in targets { target.command.removeTarget(target.token) }
        targets.removeAll()
    }
}
