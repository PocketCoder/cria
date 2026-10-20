import CriaKit
import SwiftUI
import WidgetKit

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    var body: some View {
        switch family {
        case .accessoryRectangular: rectangular
        case .accessoryCircular: circular
        case .accessoryInline: inline
        default: home
        }
    }

    // MARK: Home Screen

    private var rowLimit: Int {
        switch family {
        case .systemSmall: return 3
        case .systemLarge: return 10
        default: return 4
        }
    }

    private var home: some View {
        let shown = Array(entry.snapshot.entries.prefix(rowLimit))
        return VStack(alignment: .leading, spacing: 6) {
            header
            if !entry.signedIn {
                Text("Sign in to Cria to see your tasks.").font(.subheadline).foregroundStyle(.secondary)
            } else if shown.isEmpty {
                Text("Nothing due").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(shown) { item in row(item) }
            if entry.snapshot.total > shown.count {
                Text("+\(entry.snapshot.total - shown.count) more").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(DeepLink.todayURL)
    }

    private var header: some View {
        HStack {
            Text("Today").font(.headline)
            Spacer()
            // A Link works only in the medium and large sizes; the small one has the whole-widget link.
            if family != .systemSmall, entry.signedIn, let url = DeepLink.addURL {
                Link(destination: url) {
                    Image(systemName: "plus.circle.fill").font(.title3).accessibilityLabel("Add task")
                }
            }
        }
    }

    private func row(_ item: TodaySnapshot.Entry) -> some View {
        HStack(spacing: 8) {
            Button(intent: CompleteTaskIntent(taskLocalId: item.id)) {
                Image(systemName: "circle")
                    .foregroundStyle(item.isOverdue ? Color.red : Color.secondary)
                    .accessibilityLabel("Complete \(item.title)")
            }
            .buttonStyle(.plain)
            title(item)
        }
    }

    @ViewBuilder
    private func title(_ item: TodaySnapshot.Entry) -> some View {
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

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Today").font(.headline)
            if !entry.signedIn {
                Text("Sign in to Cria").font(.caption)
            } else if entry.snapshot.entries.isEmpty {
                Text("Nothing due").font(.caption)
            }
            ForEach(entry.snapshot.entries.prefix(3)) { item in
                Text(item.title).font(.caption).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(DeepLink.todayURL)
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text(entry.signedIn ? "\(entry.snapshot.total)" : "-").font(.title2.bold())
                Text("due").font(.caption2)
            }
        }
        .widgetURL(DeepLink.todayURL)
    }

    private var inline: some View {
        Group {
            if !entry.signedIn {
                Text("Sign in to Cria")
            } else if let first = entry.snapshot.entries.first {
                Text("\(entry.snapshot.total) due: \(first.title)")
            } else {
                Text("Nothing due")
            }
        }
        .widgetURL(DeepLink.todayURL)
    }
}
