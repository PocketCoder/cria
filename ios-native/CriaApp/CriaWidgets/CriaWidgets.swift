import CriaKit
import SwiftUI
import WidgetKit

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot
}

/// Reads today's open tasks from the shared database. Reloaded by the app after every sync and local edit; the
/// 30 minute refresh covers the day rolling over.
struct TodayProvider: TimelineProvider {
    private static let limit = 5

    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), snapshot: TodaySnapshot(entries: [], total: 0))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(load())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let refresh = Date().addingTimeInterval(30 * 60)
        completion(Timeline(entries: [load()], policy: .after(refresh)))
    }

    private func load() -> TodayEntry {
        let now = Date()
        guard let database = try? CriaPaths.openDatabase(),
              let snapshot = try? TodaySnapshot.load(store: CriaStore(database: database), limit: Self.limit, now: now) else {
            return TodayEntry(date: now, snapshot: TodaySnapshot(entries: [], total: 0))
        }
        return TodayEntry(date: now, snapshot: snapshot)
    }
}

struct TodayWidgetView: View {
    let entry: TodayEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Today").font(.headline)
            if entry.snapshot.entries.isEmpty {
                Text("Nothing due").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(entry.snapshot.entries) { item in
                Link(destination: DeepLink.taskURL(localId: item.id) ?? URL(fileURLWithPath: "/")) {
                    Text(item.title)
                        .font(.subheadline)
                        .lineLimit(1)
                        .foregroundStyle(item.isOverdue ? Color.red : Color.primary)
                }
            }
            if entry.snapshot.total > entry.snapshot.entries.count {
                Text("+\(entry.snapshot.total - entry.snapshot.entries.count) more").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(URL(string: "cria://today"))
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "io.cria.widget.today", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("Tasks due today and overdue.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct CriaWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
    }
}
