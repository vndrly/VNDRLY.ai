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
        Text("VNDRLY").font(.headline)
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
        DynamicIslandExpandedRegion(.trailing) { Text("VNDRLY") }
        DynamicIslandExpandedRegion(.bottom) { Text(context.isStale ? LocalizedStringKey("Open app to refresh") : LocalizedStringKey("Active work snapshot")).privacySensitive() }
      } compactLeading: { Image(systemName: "briefcase") }
        compactTrailing: { Image(systemName: context.isStale ? "arrow.clockwise" : "clock") }
        minimal: { Image(systemName: "briefcase") }
      .widgetURL(URL(string: "vndrly-mobile://work-hub/native-entry?action=workday"))
    }
  }
}