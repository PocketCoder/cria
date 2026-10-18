import SwiftUI

/// The Help > Keyboard Shortcuts sheet: what `MacKeyboard` and the menus answer to. `MacOverlays` drops it from the
/// top of the window (540pt, radius 0 0 18 18, 260ms).
struct ShortcutsHelp: View {
    /// Set when shown by `MacOverlays` rather than as a sheet.
    var onClose: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    private static let groups: [(String, [(String, String)])] = [
        ("General", [("⌘N", "New task"), ("⇧⌘N", "New project"), ("⌘K", "Command palette"), ("⌘E", "Toggle sidebar"),
                     ("⌘F", "Search"), ("⌘R", "Sync now"), ("?", "Keyboard shortcuts")]),
        ("Go to", [("g o", "Today"), ("g u", "Upcoming"), ("⌘1 ⌘2 ⌘3", "Today, Upcoming, Inbox"), ("g a", "Labels"),
                   ("g m", "Teams")]),
        ("Project views", [("g l", "List"), ("g k", "Kanban"), ("g t", "Table"), ("g g", "Gantt")]),
        ("Tasks", [("j k", "Next and previous task"), ("Return", "Open it"), ("t", "Toggle done"), ("d", "Due date"),
                   ("p", "Priority"), ("l", "Labels"), ("m", "Move to project"), ("a", "Assign"), ("c", "Colour"),
                   ("s", "Favourite"), ("u", "Go to its project"), (".", "Copy identifier"), ("..", "Copy identifier and title"),
                   ("...", "Copy identifier, title and link"), ("⌘.", "Copy link"), ("⌫", "Delete")])
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Keyboard Shortcuts")
                .font(.custom(Theme.brandFont, size: 22))
                .tracking(-0.44)
            ScrollView {
                // Two columns: the short groups on the left, the task keys on the right.
                HStack(alignment: .top, spacing: 28) {
                    column(Self.groups.dropLast())
                    column(Self.groups.suffix(1))
                }
            }
            HStack {
                Spacer()
                Button("Done", action: close).keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 540, height: 520)
        .onExitCommand(perform: close)
    }

    private func close() {
        if let onClose { onClose() } else { dismiss() }
    }

    private func column(_ groups: ArraySlice<(String, [(String, String)])>) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(groups, id: \.0) { group in
                VStack(alignment: .leading, spacing: 6) {
                    Text(group.0).font(.system(size: 13, weight: .semibold))
                    ForEach(group.1, id: \.0) { row in
                        HStack {
                            Text(row.1).font(.system(size: 13))
                            Spacer(minLength: 8)
                            Text(row.0).font(.system(size: 12, design: .monospaced)).foregroundStyle(MacTheme.label2)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}
