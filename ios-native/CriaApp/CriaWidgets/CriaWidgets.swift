import CriaKit
import SwiftUI
import WidgetKit

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot
    /// False after sign-out: the old account's tasks must not stay on the Home Screen.
    var signedIn = true
}

/// Reads today's open tasks from the shared database. Reloaded by the app after every sync and local edit; a refresh
/// every 30 minutes, and at midnight, covers the day rolling over.
struct TodayProvider: TimelineProvider {
    /// The most any family shows (large); smaller ones take a prefix.
    static let limit = 10

    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), snapshot: TodaySnapshot(entries: [], total: 0))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(load())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let now = Date()
        let calendar = Calendar.cria
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now.addingTimeInterval(30 * 60)
        let refresh = min(now.addingTimeInterval(30 * 60), midnight)
        completion(Timeline(entries: [load()], policy: .after(refresh)))
    }

    private func load() -> TodayEntry {
        let now = Date()
        guard SignedInFlag.isSignedIn() else {
            return TodayEntry(date: now, snapshot: TodaySnapshot(entries: [], total: 0), signedIn: false)
        }
        guard let database = try? CriaPaths.openDatabase(readOnly: true),
              let snapshot = try? TodaySnapshot.load(store: CriaStore(database: database), limit: Self.limit, now: now) else {
            return TodayEntry(date: now, snapshot: TodaySnapshot(entries: [], total: 0))
        }
        return TodayEntry(date: now, snapshot: snapshot)
    }
}

enum TodayWidgetKind {
    static let id = "io.cria.widget.today"
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: TodayWidgetKind.id, provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("Tasks due today and overdue. Tick one off, or add a new task.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryRectangular, .accessoryCircular, .accessoryInline
        ])
    }
}

@main
struct CriaWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        if #available(iOS 18.0, *) {
            AddTaskControl()
        }
    }
}
