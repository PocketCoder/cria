import CriaKit
import SwiftUI
import WidgetKit

/// Today's open tasks: due today and overdue. Reloaded by the app after every sync and local edit.
struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TaskListEntry {
        .placeholder(.today)
    }

    func getSnapshot(in context: Context, completion: @escaping (TaskListEntry) -> Void) {
        completion(.load(.today))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskListEntry>) -> Void) {
        let entry = TaskListEntry.load(.today)
        completion(Timeline(entries: [entry], policy: .after(entry.nextRefresh)))
    }
}

enum WidgetKinds {
    static let today = "io.cria.widget.today"
    static let list = "io.cria.widget.list"
}

/// The home and desktop sizes every Cria widget offers; the Lock Screen ones are iOS only.
enum WidgetFamilies {
    static var all: [WidgetFamily] {
        #if os(iOS)
        [.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline]
        #else
        [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge]
        #endif
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKinds.today, provider: TodayProvider()) { entry in
            TaskListWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("Tasks due today and overdue. Tick one off, or add a new task.")
        .supportedFamilies(WidgetFamilies.all)
    }
}

@main
struct CriaWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        ListWidget()
        if #available(iOS 18.0, macOS 26.0, *) {
            AddTaskControl()
        }
    }
}
