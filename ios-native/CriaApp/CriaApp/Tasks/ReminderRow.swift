import CriaKit
import SwiftUI

/// One reminder on the task screen. Tapping it, the Edit swipe and the context menu all open the editor; Delete stays.
/// The editor's sheet hangs off this row, which is on screen whenever it is used, and holds the reminder as it was
/// tapped, so a pull that changes the list underneath cannot make Save replace a different one.
struct ReminderRow: View {
    @Environment(\.dateDisplay) private var dateDisplay
    let services: AppServices
    let taskLocalId: String
    let reminder: ReminderRecord
    let state: TaskDetailPresentation
    @State private var editTarget: EditTarget?

    private struct EditTarget: Identifiable {
        let id = UUID()
        let reminder: ReminderRecord
    }

    var body: some View {
        Button(action: edit) {
            Label {
                VStack(alignment: .leading, spacing: 1) {
                    Text(reminder.summary(display: dateDisplay)).foregroundStyle(Color(.foreground))
                    // A relative reminder also names the moment it fires, so "1 hour before" is never vague.
                    if let when = reminder.firesAtText(display: dateDisplay) {
                        Text(when).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
            } icon: {
                Image(systemName: "bell").foregroundStyle(Color(.coral500))
            }
        }
        .accessibilityHint("Edits this reminder")
        .swipeActions {
            Button("Delete", role: .destructive, action: delete)
            Button("Edit", action: edit).tint(Color(.sky500))
        }
        .contextMenu {
            Button("Edit", systemImage: "pencil", action: edit)
            Button("Delete", systemImage: "trash", role: .destructive, action: delete)
        }
        .sheet(item: $editTarget) { target in
            if target.reminder.relativeTo != nil {
                RelativeReminderSheet(services: services, taskLocalId: taskLocalId, editing: target.reminder)
            } else {
                FixedReminderSheet(services: services, taskLocalId: taskLocalId, old: target.reminder)
            }
        }
    }

    private func edit() {
        editTarget = EditTarget(reminder: reminder)
    }

    private func delete() {
        state.attempt { try services.store.removeReminder(taskLocalId: taskLocalId, reminder) }
    }
}
