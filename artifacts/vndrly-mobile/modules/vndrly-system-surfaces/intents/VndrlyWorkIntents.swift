import AppIntents
import UIKit

@available(iOS 16.0, *)
enum VndrlyWorkDestination: String, AppEnum {
  case workday, assignments, gate, messages
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Work destination"
  static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .workday: "My Workday", .assignments: "Assignments", .gate: "Gate", .messages: "Messages"
  ]
}

@available(iOS 16.0, *)
struct OpenVndrlyWorkIntent: AppIntent {
  static var title: LocalizedStringResource = "Open VNDRLY work"
  static var description = IntentDescription("Open an authenticated workflow. Review and save work inside VNDRLY.")
  static var openAppWhenRun = true
  @Parameter(title: "Destination") var destination: VndrlyWorkDestination
  init() { destination = .workday }
  init(destination: VndrlyWorkDestination) { self.destination = destination }
  @MainActor func perform() async throws -> some IntentResult {
    // OpenURLIntent is for universal links. This foreground handoff uses the app's registered scheme.
    let url = URL(string: "vndrly-mobile://work-hub/native-entry?action=\(destination.rawValue)")!
    let opened = await withCheckedContinuation { continuation in
      UIApplication.shared.open(url, options: [:]) { continuation.resume(returning: $0) }
    }
    if !opened { throw VndrlyIntentError.unavailable }
    return .result()
  }
}
private enum VndrlyIntentError: Error { case unavailable }

@available(iOS 16.0, *)
struct VndrlyWorkShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .workday), phrases: ["Open my workday in \(.applicationName)"], shortTitle: "My Workday", systemImageName: "calendar")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .assignments), phrases: ["Open my assignments in \(.applicationName)"], shortTitle: "Assignments", systemImageName: "list.bullet")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .gate), phrases: ["Open Gate in \(.applicationName)"], shortTitle: "Gate", systemImageName: "door.left.hand.open")
    AppShortcut(intent: OpenVndrlyWorkIntent(destination: .messages), phrases: ["Open messages in \(.applicationName)"], shortTitle: "Messages", systemImageName: "bubble.left.and.bubble.right")
  }
}