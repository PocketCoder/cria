import CriaKit
import SwiftUI
import WidgetKit

/// What every Cria widget draws: a titled list of open tasks with a tick button on each row. The Today widget and the
/// configurable list widget (`ListWidget`) both fill one in.
struct TaskListEntry: TimelineEntry {
    let date: Date
    let source: WidgetListSource
    let snapshot: WidgetListSnapshot
    /// False after sign-out: the old account's tasks must not stay on the Home Screen or desktop.
    var signedIn = true

    /// Reads the list from the shared database. Never throws: a database the app has not created yet shows empty.
    static func load(_ source: WidgetListSource, limit: Int = 12) -> TaskListEntry {
        let now = Date()
        guard SignedInFlag.isSignedIn() else {
            return TaskListEntry(date: now, source: source, snapshot: empty(source), signedIn: false)
        }
        guard let database = try? CriaPaths.openDatabase(readOnly: true),
              let snapshot = try? WidgetListSnapshot.load(store: CriaStore(database: database), source: source, limit: limit, now: now)
        else {
            return TaskListEntry(date: now, source: source, snapshot: empty(source))
        }
        return TaskListEntry(date: now, source: source, snapshot: snapshot)
    }

    static func placeholder(_ source: WidgetListSource) -> TaskListEntry {
        TaskListEntry(date: Date(), source: source, snapshot: empty(source))
    }

    private static func empty(_ source: WidgetListSource) -> WidgetListSnapshot {
        let title: String
        switch source {
        case .today: title = "Today"
        case .upcoming: title = "Upcoming"
        case .inbox: title = "Inbox"
        default: title = "Cria"
        }
        return WidgetListSnapshot(title: title, entries: [], total: 0)
    }

    /// Refresh every 30 minutes, and at midnight so the day rolls over. The app also reloads after every sync and edit.
    var nextRefresh: Date {
        let calendar = Calendar.cria
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date)) ?? date.addingTimeInterval(30 * 60)
        return min(date.addingTimeInterval(30 * 60), midnight)
    }
}

struct TaskListWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TaskListEntry

    private var snapshot: WidgetListSnapshot { entry.snapshot }

    var body: some View {
        switch family {
        #if os(iOS)
        case .accessoryRectangular: rectangular
        case .accessoryCircular: circular
        case .accessoryInline: inline
        #endif
        default: home
        }
    }

    // MARK: Home Screen and desktop

    private var rowLimit: Int {
        switch family {
        case .systemSmall: return 3
        case .systemLarge: return 10
        case .systemExtraLarge: return 12
        default: return 4
        }
    }

    private var home: some View {
        let shown = Array(snapshot.entries.prefix(rowLimit))
        return VStack(alignment: .leading, spacing: 6) {
            header
            if let message {
                Text(message).font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(shown) { item in row(item) }
            if snapshot.total > shown.count {
                Text("+\(snapshot.total - shown.count) more").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(entry.source.url)
    }

    /// Why the list is empty, or nil when it has rows.
    private var message: String? {
        if !entry.signedIn { return "Sign in to Cria to see your tasks." }
        if snapshot.isMissing {
            return entry.source == .inbox ? "Open Cria once to find your inbox." : "This list is no longer in Cria. Edit the widget to choose another."
        }
        return snapshot.entries.isEmpty ? entry.source.emptyText : nil
    }

    private var header: some View {
        HStack {
            Text(snapshot.title).font(.headline).lineLimit(1)
            if family != .systemSmall, snapshot.total > 0 {
                Text("\(snapshot.total)").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            // A Link works only in the medium and larger sizes; the small one has the whole-widget link.
            if family != .systemSmall, entry.signedIn, let url = DeepLink.addURL {
                Link(destination: url) {
                    Image(systemName: "plus.circle.fill").font(.title3).accessibilityLabel("Add task")
                }
            }
        }
    }

    private func row(_ item: WidgetListSnapshot.Entry) -> some View {
        HStack(spacing: 8) {
            Button(intent: CompleteTaskIntent(taskLocalId: item.id)) {
                Image(systemName: "circle")
                    .foregroundStyle(item.isOverdue ? Color.red : Color.secondary)
                    .accessibilityLabel("Complete \(item.title)")
            }
            .buttonStyle(.plain)
            title(item)
            if family != .systemSmall, let due = item.due {
                Spacer(minLength: 4)
                Text(due)
                    .font(.caption)
                    .foregroundStyle(item.isOverdue ? Color.red : Color.secondary)
                    .lineLimit(1)
                    .layoutPriority(1)
            }
        }
    }

    @ViewBuilder
    private func title(_ item: WidgetListSnapshot.Entry) -> some View {
        let text = Text(item.title)
            .font(.subheadline)
            .lineLimit(1)
            .foregroundStyle(item.isOverdue ? Color.red : Color.primary)
        if family != .systemSmall, let url = DeepLink.taskURL(localId: item.id) {
            Link(destination: url) { text }
        } else {
            text
        }
    }

    // MARK: Lock Screen

    #if os(iOS)
    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(snapshot.title).font(.headline).lineLimit(1)
            if !entry.signedIn {
                Text("Sign in to Cria").font(.caption)
            } else if snapshot.entries.isEmpty {
                Text(entry.source.emptyText).font(.caption)
            }
            ForEach(snapshot.entries.prefix(3)) { item in
                Text(item.title).font(.caption).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(entry.source.url)
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text(entry.signedIn ? "\(snapshot.total)" : "-").font(.title2.bold())
                Text(entry.source == .today ? "due" : "open").font(.caption2)
            }
        }
        .widgetURL(entry.source.url)
    }

    private var inline: some View {
        Group {
            if !entry.signedIn {
                Text("Sign in to Cria")
            } else if let first = snapshot.entries.first {
                Text("\(snapshot.total) \(entry.source == .today ? "due" : "open"): \(first.title)")
            } else {
                Text(entry.source.emptyText)
            }
        }
        .widgetURL(entry.source.url)
    }
    #endif
}
