import CriaKit
import Observation
import SwiftUI

/// One list screen's display options (group, sort, filters, show completed), saved per view on this device. It does
/// not sync: another install keeps its own.
@MainActor @Observable
final class DisplayModel {
    let key: DisplayViewKey
    let sections: DisplaySections
    private(set) var config: DisplayConfig
    /// The signed-in user's server id, for the "Assigned to me" filter. Nil until it has been read.
    var currentUserId: Int?
    var sheetPresented = false

    init(key: DisplayViewKey) {
        self.key = key
        sections = DisplaySections(for: key)
        config = DisplayConfigStore.load(key)
    }

    /// Changes the options and saves them.
    func update(_ change: (inout DisplayConfig) -> Void) {
        var next = config
        change(&next)
        guard next != config else { return }
        config = next
        DisplayConfigStore.save(next, for: key)
    }

    func reset() {
        update { $0 = DisplayConfig.defaults(for: key) }
    }

    /// True when the options differ from the view's defaults, so the toolbar button can show it.
    var isCustomised: Bool { config.isCustomised(for: key) }

    var hasFilters: Bool { config.filters.isActive }

    /// Whether completed tasks show. Until the Display sheet sets it, Settings > General > Show completed decides.
    /// A saved filter always shows what its query matches.
    func showsCompleted(default fallback: Bool) -> Bool {
        sections.completed ? (config.showCompleted ?? fallback) : true
    }

    func context(assignees: [String: Set<Int>]) -> DisplayContext {
        DisplayContext(assigneesByTask: assignees, currentUserId: currentUserId, now: Date(), calendar: .cria)
    }
}

/// The Display and Select buttons, beside a screen's title.
struct DisplaySelectToolbar: ToolbarContent {
    let isCustomised: Bool
    let isSelecting: Bool
    let onDisplay: () -> Void
    let onSelect: () -> Void
    let onDone: () -> Void

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if isSelecting {
                Button("Done", action: onDone)
            } else {
                Button(action: onDisplay) {
                    Label(
                        "Display", systemImage: isCustomised
                            ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
                    )
                }
                .accessibilityValue(isCustomised ? "Customised" : "")
                Button("Select", systemImage: "checkmark.circle", action: onSelect)
            }
        }
    }
}

extension View {
    /// Presents the Display sheet for `display` and reads the signed-in user for the assignee filter.
    func displayOptions(_ display: DisplayModel, services: AppServices) -> some View {
        modifier(DisplayOptionsHost(display: display, services: services))
    }
}

private struct DisplayOptionsHost: ViewModifier {
    let display: DisplayModel
    let services: AppServices

    private var presented: Binding<Bool> {
        Binding(get: { display.sheetPresented }, set: { display.sheetPresented = $0 })
    }

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: presented) { DisplaySheet(display: display, services: services) }
            .task { display.currentUserId = await services.signedInUser()?.id }
    }
}

/// "No tasks match" row for a list whose filters, or hidden completed tasks, leave nothing to show.
struct DisplayNoMatchesRow: View {
    let hasFilters: Bool
    let onReset: () -> Void
    let onShowCompleted: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text(hasFilters ? "No tasks match the filters" : "Everything here is done")
                .font(Theme.headline)
                .foregroundStyle(Color(.foreground))
            if hasFilters {
                Button("Reset filters", action: onReset)
            } else {
                Button("Show completed", action: onShowCompleted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        #if os(macOS)
        // A Mac list row measured this at one line high and cut the button off.
        .padding(.vertical, 6)
        .fixedSize(horizontal: false, vertical: true)
        .listRowSeparator(.hidden)
        #endif
    }
}
