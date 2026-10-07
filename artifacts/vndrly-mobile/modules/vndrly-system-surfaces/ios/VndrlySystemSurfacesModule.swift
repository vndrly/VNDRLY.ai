import ExpoModulesCore
import ActivityKit
import UIKit
import CryptoKit

private enum SurfaceError: Error { case unavailable, invalidInput, contextChanged }
struct WorkActivityInput: Record {
  @Field var contextBinding: String = ""
  @Field var subjectKind: String = ""
  @Field var subjectId: String = ""
  @Field var phase: String = ""
  @Field var recordedAt: Double = 0
  @Field var expiresAt: Double = 0
}

public final class VndrlySystemSurfacesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VndrlySystemSurfaces")
    AsyncFunction("getCapabilities") { () -> [String: Any] in
      let configured = Bundle.main.object(forInfoDictionaryKey: "VNDRLYSystemSurfacesConfigured") as? Bool == true
      if #available(iOS 16.2, *) {
        return ["liveActivities": configured && ActivityAuthorizationInfo().areActivitiesEnabled, "remoteUpdates": false, "appIntents": configured]
      }
      if #available(iOS 16.0, *) { return ["liveActivities": false, "remoteUpdates": false, "appIntents": configured] }
      return ["liveActivities": false, "remoteUpdates": false, "appIntents": false]
    }
    AsyncFunction("setContext") { (binding: String?) async throws in
      if #available(iOS 16.2, *) { try await WorkActivityController.shared.setContext(binding) }
    }
    AsyncFunction("updateWorkActivity") { (input: WorkActivityInput) async throws -> String in
      guard #available(iOS 16.2, *) else { throw SurfaceError.unavailable }
      return try await WorkActivityController.shared.update(input)
    }
    AsyncFunction("endWorkActivities") { () async in
      if #available(iOS 16.2, *) { try? await WorkActivityController.shared.setContext(nil) }
    }
    OnCreate {
      // A cold launch never restores an old account's work as current authority.
      if #available(iOS 16.2, *) { Task { await WorkActivityController.shared.resetOnLaunch() } }
    }
  }
}

@available(iOS 16.2, *)
private actor WorkActivityController {
  static let shared = WorkActivityController()
  private var contextHash: String?
  private var revision = 0
  private var updating = false
  private var expiry: Task<Void, Never>?
  private let phases = Set(["assigned", "en_route", "on_location", "on_site", "on_duty", "paused", "in_progress"])
  private func hash(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  func resetOnLaunch() async {
    // Do not let the asynchronous launch cleanup invalidate a newly bound session.
    if contextHash == nil { await endAll() }
  }
  func setContext(_ binding: String?) async throws {
    if let value = binding, value.count < 16 || value.count > 512 {
      contextHash = nil
      revision += 1
      await endAll()
      throw SurfaceError.invalidInput
    }
    let next = binding.map(hash)
    if next == contextHash && next != nil { return }
    contextHash = next
    revision += 1
    await endAll()
  }
  func endAll() async {
    expiry?.cancel()
    expiry = nil
    for activity in Activity<VndrlyWorkAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
  func update(_ input: WorkActivityInput) async throws -> String {
    guard !updating else { throw SurfaceError.unavailable }
    updating = true
    defer { updating = false }
    let now = Date()
    let recorded = Date(timeIntervalSince1970: input.recordedAt)
    let expires = Date(timeIntervalSince1970: input.expiresAt)
    guard input.recordedAt.isFinite, input.expiresAt.isFinite,
      input.contextBinding.count >= 16, input.contextBinding.count <= 512,
      contextHash == hash(input.contextBinding),
      ["ticket", "shift", "fleet"].contains(input.subjectKind),
      input.subjectId.range(of: "^[A-Za-z0-9-]{1,64}$", options: .regularExpression) != nil,
      phases.contains(input.phase), recorded <= now.addingTimeInterval(30),
      recorded >= now.addingTimeInterval(-300), expires > now,
      expires <= recorded.addingTimeInterval(300) else { throw SurfaceError.invalidInput }
    let expected = revision
    let foreground = await MainActor.run { UIApplication.shared.applicationState == .active }
    guard foreground, Bundle.main.object(forInfoDictionaryKey: "VNDRLYSystemSurfacesConfigured") as? Bool == true,
      ActivityAuthorizationInfo().areActivitiesEnabled else { throw SurfaceError.unavailable }
    guard expected == revision, contextHash == hash(input.contextBinding) else { throw SurfaceError.contextChanged }
    let attributes = VndrlyWorkAttributes(contextHash: hash(input.contextBinding), subjectKind: input.subjectKind, subjectId: input.subjectId)
    let content = ActivityContent(state: VndrlyWorkAttributes.ContentState(phase: input.phase, recordedAt: recorded, expiresAt: expires), staleDate: expires)
    var current: Activity<VndrlyWorkAttributes>?
    for activity in Activity<VndrlyWorkAttributes>.activities {
      if activity.attributes == attributes { current = activity }
      else { await activity.end(nil, dismissalPolicy: .immediate) }
    }
    guard expected == revision else { throw SurfaceError.contextChanged }
    if let existing = current {
      guard recorded >= existing.content.state.recordedAt else { throw SurfaceError.invalidInput }
      await existing.update(content)
    } else {
      current = try Activity.request(attributes: attributes, content: content, pushType: nil)
    }
    guard expected == revision else {
      await current?.end(nil, dismissalPolicy: .immediate)
      throw SurfaceError.contextChanged
    }
    expiry?.cancel()
    expiry = Task {
      try? await Task.sleep(nanoseconds: UInt64(max(0, expires.timeIntervalSinceNow) * 1_000_000_000))
      if !Task.isCancelled { await self.expire(expected) }
    }
    return current!.id
  }
  private func expire(_ expected: Int) async {
    if expected == revision { revision += 1; await endAll() }
  }
}
