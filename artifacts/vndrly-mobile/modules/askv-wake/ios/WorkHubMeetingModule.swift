import AVFoundation
import ExpoModulesCore
import UIKit

private struct WorkHubCreateOptions: Record {
  @Field var occurrenceId: String = ""
  @Field var generation: UInt64 = 0
  @Field var sourceId: String = ""
  @Field var iceServers: [[String: Any]] = []
}
private struct WorkHubGenerationOptions: Record { @Field var generation: UInt64 = 0 }
private struct WorkHubMuteOptions: Record { @Field var generation: UInt64 = 0; @Field var muted: Bool = true }
private struct WorkHubTranscriptionOptions: Record {
  @Field var generation: UInt64 = 0; @Field var enabled: Bool = false; @Field var policyRevision: UInt64 = 0
}
private struct WorkHubPeerOptions: Record { @Field var generation: UInt64 = 0; @Field var peerUserId: Int = 0 }
private struct WorkHubSignalOptions: Record {
  @Field var generation: UInt64 = 0; @Field var peerUserId: Int = 0; @Field var kind: String = ""; @Field var payload: [String: Any] = [:]
}
private struct WorkHubAckOptions: Record { @Field var generation: UInt64 = 0; @Field var sequence: UInt64 = 0 }

public final class WorkHubMeetingModule: Module, WorkHubMeetingSessionDelegate {
  private var session: WorkHubMeetingSession?
  private var generation: UInt64?
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("WorkHubMeeting")
    Events("onMeetingSignal", "onMeetingPCMFrame", "onMeetingError")
    OnCreate { self.observeLifecycle() }
    AsyncFunction("createSession") { (options: WorkHubCreateOptions) in
      self.invalidate()
      guard UIApplication.shared.applicationState == .active else { throw NSError(domain: "WorkHubMeeting", code: 1) }
      self.generation = options.generation
      self.session = WorkHubMeetingSession(occurrenceId: options.occurrenceId, generation: options.generation,
        sourceId: options.sourceId, iceServers: options.iceServers, delegate: self)
    }.runOnQueue(.main)
    AsyncFunction("setMuted") { (options: WorkHubMuteOptions) in if self.generation == options.generation { self.session?.setMuted(options.muted) } }.runOnQueue(.main)
    AsyncFunction("setTranscription") { (options: WorkHubTranscriptionOptions) in
      if self.generation == options.generation { self.session?.setTranscriptionEnabled(options.enabled, policyRevision: options.policyRevision) }
    }.runOnQueue(.main)
    AsyncFunction("acknowledgeFrame") { (options: WorkHubAckOptions) in if self.generation == options.generation { self.session?.acknowledgeSequence(options.sequence) } }
    AsyncFunction("createOffer") { (options: WorkHubPeerOptions) in if self.generation == options.generation { self.session?.createOffer(forPeerUserId: options.peerUserId) } }
    AsyncFunction("applySignal") { (options: WorkHubSignalOptions) in
      if self.generation == options.generation { self.session?.applySignal(forPeerUserId: options.peerUserId, kind: options.kind, payload: options.payload) }
    }
    AsyncFunction("removePeer") { (options: WorkHubPeerOptions) in if self.generation == options.generation { self.session?.removePeerUserId(options.peerUserId) } }
    Function("invalidateSession") { (options: WorkHubGenerationOptions) in
      self.onMain {
        if self.generation == options.generation { self.invalidate() }
      }
    }
    OnDestroy { self.teardown() }
    OnAppContextDestroys { self.teardown() }
  }

  private func onMain(_ body: () -> Void) {
    if Thread.isMainThread { body() } else { DispatchQueue.main.sync(execute: body) }
  }

  private func observeLifecycle() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification,
                 AVAudioSession.interruptionNotification, AVAudioSession.mediaServicesWereResetNotification,
                 AVAudioSession.routeChangeNotification] {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.invalidate(code: "AUDIO_INTERRUPTED") })
    }
  }
  private func invalidate(expectedGeneration: UInt64? = nil, code: String? = nil) {
    if let expectedGeneration, generation != expectedGeneration { return }
    let old = generation; session?.invalidate(); session = nil; generation = nil
    if let old, let code { sendEvent("onMeetingError", ["generation": old, "code": code]) }
  }
  private func teardown() { invalidate(); observers.forEach(NotificationCenter.default.removeObserver); observers.removeAll() }
  public func meetingSessionDidEmitSignal(_ signal: [String : Any]) { sendEvent("onMeetingSignal", signal) }
  public func meetingSessionDidEmitPCMFrame(_ frame: [String : Any]) { sendEvent("onMeetingPCMFrame", frame) }
  public func meetingSessionDidFail(_ code: String, generation: UInt64) {
    guard self.generation == generation else { return }
    sendEvent("onMeetingError", ["generation": generation, "code": code])
    invalidate(expectedGeneration: generation)
  }
}
