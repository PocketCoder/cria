import CriaKit
import SwiftUI

/// Settings > Customise: screens that arrange Cria itself. These are Cria's own settings, kept in
/// `frontend_settings.cria`, so they follow the account to other Cria installs but not to Vikunja-web.
struct CustomiseSettingsSection: View {
    @ObservedObject var prefs: PreferencesModel

    var body: some View {
        Section {
            NavigationLink { NavigationSettingsView(prefs: prefs) } label: {
                SettingsLabel("Navigation", symbol: "dock.rectangle", token: .sky500)
            }
            NavigationLink { QuickAddSettingsView(prefs: prefs) } label: {
                SettingsLabel("Quick Add", symbol: "plus.circle", token: .coral500)
            }
            NavigationLink { TaskLayoutSettingsView(prefs: prefs) } label: {
                SettingsLabel("Task layout", symbol: "rectangle.grid.1x2", token: .llama500)
            }
            NavigationLink { DatesAndTasksSettingsView(prefs: prefs) } label: {
                SettingsLabel("Dates & tasks", symbol: "calendar.badge.checkmark", token: .meadow500)
            }
            Picker(selection: $prefs.value.custom.swipeRight) {
                ForEach(SwipeAction.allCases, id: \.self) { Text($0.title).tag($0) }
            } label: {
                SettingsLabel("Swipe right", symbol: "hand.point.right", token: .plum500)
            }
            Picker(selection: $prefs.value.custom.swipeLeft) {
                ForEach(SwipeAction.allCases, id: \.self) { Text($0.title).tag($0) }
            } label: {
                SettingsLabel("Swipe left", symbol: "hand.point.left", token: .plum500)
            }
        } header: {
            Text("Customise")
        } footer: {
            Text("Cria-only settings. They follow your account to Cria on your other devices.")
        }
    }
}

/// The order of the task screen's sections, by drag. The title and description always come first and Delete last.
/// Read by `TaskDetailView`.
struct TaskLayoutSettingsView: View {
    @ObservedObject var prefs: PreferencesModel

    var body: some View {
        List {
            Section {
                ForEach(prefs.value.taskDetailOrder) { section in
                    Label(section.title, systemImage: section.symbol)
                }
                .onMove { from, destination in prefs.value.taskDetailOrder.move(fromOffsets: from, toOffset: destination) }
            } footer: {
                Text("Drag to reorder. The title and description stay at the top.")
            }
            Section {
                Button("Reset to default") { prefs.value.taskDetailOrder = TaskDetailSection.defaultOrder }
                    .disabled(prefs.value.taskDetailOrder == TaskDetailSection.defaultOrder)
            }
        }
        .criaSurface()
        .environment(\.editMode, .constant(.active))
        .navigationTitle("Task layout")
        .navigationBarTitleDisplayMode(.inline)
    }
}

extension TaskDetailSection {
    var symbol: String {
        switch self {
        case .details: return "slider.horizontal.3"
        case .when: return "calendar"
        case .schedule: return "calendar.badge.clock"
        case .subtasks: return "list.bullet.indent"
        case .labels: return "tag"
        case .assignees: return "person.2"
        case .attachments: return "paperclip"
        case .comments: return "bubble.left.and.bubble.right"
        }
    }
}
