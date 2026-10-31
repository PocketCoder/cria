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
            #if os(iOS)
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
            #endif
        } header: {
            Text("Customise")
        } footer: {
            Text("Cria-only settings. They follow your account to Cria on your other devices.")
        }
        Section {
            Toggle(isOn: $prefs.value.custom.kanbanSortByDue) {
                SettingsLabel("Sort board cards by due date", symbol: "calendar.badge.clock", token: .coral500)
            }
            Toggle(isOn: $prefs.value.custom.syncProjectViews) {
                SettingsLabel("Sync project views", symbol: "arrow.triangle.2.circlepath", token: .sky500)
            }
        } header: {
            Text("Projects")
        } footer: {
            Text(
                "Sort puts each column's cards in due-date order, soonest first and undated last; dragging then only moves "
                + "a card between columns. Sync reopens each project on the view you last used on any device that has this "
                + "on; turned off, this device keeps its own. Vikunja-web does neither."
            )
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
                #if os(macOS)
                ForEach(macOrder) { section in
                    Label(section.title, systemImage: section.symbol)
                }
                .onMove(perform: moveMac)
                #else
                ForEach(prefs.value.taskDetailOrder) { section in
                    Label(section.title, systemImage: section.symbol)
                }
                .onMove { from, destination in prefs.value.taskDetailOrder.move(fromOffsets: from, toOffset: destination) }
                #endif
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

#if os(macOS)
extension TaskLayoutSettingsView {
    /// The sections the Mac inspector lays out in order. The field boxes hold the details, dates, reminders and
    /// labels, so those are left out here rather than listed with no effect.
    private static let macSections: Set<TaskDetailSection> = [.subtasks, .assignees, .attachments, .comments]

    private var macOrder: [TaskDetailSection] {
        prefs.value.taskDetailOrder.filter { Self.macSections.contains($0) }
    }

    /// Moves within the Mac's sections, keeping the others where they are in the stored order.
    private func moveMac(from source: IndexSet, to destination: Int) {
        var moved = macOrder
        moved.move(fromOffsets: source, toOffset: destination)
        var next = moved.makeIterator()
        prefs.value.taskDetailOrder = prefs.value.taskDetailOrder.map { section in
            Self.macSections.contains(section) ? (next.next() ?? section) : section
        }
    }
}
#endif
