import ActivityKit
import WidgetKit
import SwiftUI

@main
struct VndrlyWorkActivityBundle: WidgetBundle {
  var body: some Widget { VndrlyWorkActivityWidget() }
}

struct VndrlyWorkActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: VndrlyWorkAttributes.self) { context in
      VStack(alignment: .leading, spacing: 6) {
        Text(context.state.company).font(.headline)
        Text(context.state.site).font(.subheadline)
        Text(context.state.identifier + " · " + context.state.phase.replacingOccurrences(of: "_", with: " ")).font(.subheadline)
        if let start = context.state.startedAt { Text(start, style: .timer).font(.caption) }
        if let eta = context.state.eta { Text("ETA: \(eta.formatted(date: .omitted, time: .shortened))").font(.caption) }
        Text(context.isStale ? LocalizedStringKey("Open app to refresh") : LocalizedStringKey("Active work snapshot"))
        Text(context.state.recordedAt, style: .relative).font(.caption)
      }
      .padding()
      .privacySensitive()
      .activityBackgroundTint(Color(red: 0.12, green: 0.20, blue: 0.27))
      .activitySystemActionForegroundColor(.white)
      .widgetURL(URL(string: "vndrly-mobile://work-hub/native-entry?action=workday"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Image(systemName: "briefcase") }
        DynamicIslandExpandedRegion(.trailing) { Text(context.state.company).privacySensitive() }
        DynamicIslandExpandedRegion(.bottom) { VStack { Text(context.state.identifier + " · " + context.state.phase); Text(context.state.site); Text(context.isStale ? LocalizedStringKey("Open app to refresh") : LocalizedStringKey("Active work snapshot")) }.privacySensitive() }
      } compactLeading: { Image(systemName: "briefcase") }
        compactTrailing: { Image(systemName: context.isStale ? "arrow.clockwise" : "clock") }
        minimal: { Image(systemName: "briefcase") }
      .widgetURL(URL(string: "vndrly-mobile://work-hub/native-entry?action=workday"))
    }
  }
}