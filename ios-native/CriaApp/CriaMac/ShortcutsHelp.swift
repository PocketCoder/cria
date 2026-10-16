import SwiftUI

/// The Help > Keyboard Shortcuts sheet: what `MacKeyboard` and the menus answer to.
struct ShortcutsHelp: View {
    @Environment(\.dismiss) private var dismiss

    private static let groups: [(String, [(String, String)])] = [
        ("General", [("⌘N", "New task"), ("⇧⌘N", "New project"), ("⌘K", "Command palette"), ("⌘E", "Toggle sidebar"),
                     ("⌘F", "Search"), ("⌘R", "Sync now")]),
        ("Go to", [("g o", "Today"), ("g u", "Upcoming"), ("⌘1 ⌘2 ⌘3", "Today, Upcoming, Inbox")]),
        ("Project views", [("g l", "List"), ("g k", "Kanban"), ("g t", "Table"), ("g g", "Gantt")]),
        ("Open task", [("t", "Toggle done"), ("d", "Due date"), ("p", "Priority"), ("l", "Labels"), ("m", "Move to project"),
                       ("s", "Favourite"), ("⌘.", "Copy link"), ("⌫", "Delete")])
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Keyboard shortcuts").font(.title2.weight(.semibold))
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(Self.groups, id: \.0) { group in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(group.0).font(.headline)
                            ForEach(group.1, id: \.0) { row in
                                HStack {
                                    Text(row.1)
                                    Spacer()
                                    Text(row.0).font(.body.monospaced()).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            HStack {
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 420, height: 520)
    }
}
