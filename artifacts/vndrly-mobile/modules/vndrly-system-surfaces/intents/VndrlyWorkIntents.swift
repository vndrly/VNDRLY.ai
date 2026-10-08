import AppIntents
import UIKit

@available(iOS 16.0, *)
enum VndrlyWorkDestination: String, AppEnum {
  case workday, assignments, gate, messages
  case currentTask = "current-task"
  case scan
  case startDuty = "start-duty"
  case endDuty = "end-duty"
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Work destination"
  static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .workday: "My Workday", .assignments: "Assignments", .gate: "Gate", .messages: "Messages",
    .currentTask: "Current task", .scan: "Scan", .startDuty: "Start Duty", .endDuty: "End Duty"
  ]
}

@available(iOS 16.0, *)
struct OpenVndrlyWorkIntent: AppIntent {
  static var title: LocalizedStringResource = "Open VNDRLY work"
  static var description = IntentDescription("Open an authenticated workflow. Review and save work inside VNDRLY.")
  static var openAppWhenRun = true
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Destination") var destination: VndrlyWorkDestination
  init() { destination = .workday }
  init(destination: VndrlyWorkDestination) { self.destination = destination }
  @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
    // OpenURLIntent is for universal links. This foreground handoff uses the app's registered scheme.
    let dutyAction = destination == .startDuty || destination == .endDuty
    let requestId = UUID().uuidString
    let url = URL(string: "vndrly-mobile://work-hub/native-entry?action=\(destination.rawValue)\(dutyAction ? "&systemRequestId=\(requestId)" : "")")!
    if dutyAction {
      let saved = await withCheckedContinuation { continuation in
        let result = VndrlyActionResult(continuation)
        result.observer = NotificationCenter.default.addObserver(forName: Notification.Name("VNDRLYSystemActionResult"), object: nil, queue: .main) { event in
          guard event.object as? String == requestId else { return }
          result.finish(event.userInfo?["saved"] as? Bool == true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { result.finish(false) }
        UIApplication.shared.open(url, options: [:]) { opened in if !opened { result.finish(false) } }
      }
      if saved { return .result(dialog: "Duty change was saved in VNDRLY.") }
      return .result(dialog: "Duty change has not been verified as saved. Complete the confirmation or check the result in VNDRLY.")
    }
    let opened = await withCheckedContinuation { continuation in
      UIApplication.shared.open(url, options: [:]) { continuation.resume(returning: $0) }
    }
    if !opened { throw VndrlyIntentError.unavailable }
    return .result(dialog: "VNDRLY is open. Review and save your work there.")
  }
}
private enum VndrlyIntentError: Error { case unavailable }
private final class VndrlyActionResult: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Bool, Never>?
  var observer: NSObjectProtocol?
  init(_ continuation: CheckedContinuation<Bool, Never>) { self.continuation = continuation }
  func finish(_ saved: Bool) {
    lock.lock(); let pending = continuation; continuation = nil; lock.unlock()
    guard let pending else { return }
    if let observer { NotificationCenter.default.removeObserver(observer) }
    pending.resume(returning: saved)
  }
}

@available(iOS 16.0, *)
struct VndrlyWorkShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .workday), phrases: ["Open my workday in \(.applicationName)"], shortTitle: "My Workday", systemImageName: "calendar")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .assignments), phrases: ["Open my assignments in \(.applicationName)"], shortTitle: "Assignments", systemImageName: "list.bullet")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .gate), phrases: ["Open Gate in \(.applicationName)"], shortTitle: "Gate", systemImageName: "door.left.hand.open")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .currentTask), phrases: ["Open my current task in \(.applicationName)"], shortTitle: "Current task", systemImageName: "briefcase")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .scan), phrases: ["Scan with \(.applicationName)"], shortTitle: "Scan", systemImageName: "doc.viewfinder")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .startDuty), phrases: ["Start duty in \(.applicationName)"], shortTitle: "Start Duty", systemImageName: "play.circle")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .endDuty), phrases: ["End duty in \(.applicationName)"], shortTitle: "End Duty", systemImageName: "stop.circle")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .messages), phrases: ["Open messages in \(.applicationName)"], shortTitle: "Messages", systemImageName: "bubble.left.and.bubble.right")
  }
}
