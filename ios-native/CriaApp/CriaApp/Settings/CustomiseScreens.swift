import CriaKit
import SwiftUI

/// Settings > Customise > Navigation: the tab bar, the home view and task counts. Read by `ShellView`.
struct NavigationSettingsView: View {
    @ObservedObject var prefs: PreferencesModel

    private var custom: Customisation { prefs.value.custom }
    private var available: [AppTab] { Customisation.tabChoices.filter { !custom.tabs.contains($0) } }

    var body: some View {
        List {
            #if os(iOS)
            Section {
                ForEach(custom.tabs, id: \.self) { tab in
                    Label(tab.title, systemImage: tab.symbol)
                }
                .onMove { from, destination in prefs.value.custom.tabs.move(fromOffsets: from, toOffset: destination) }
                .onDelete { prefs.value.custom.tabs.remove(atOffsets: $0) }
            } header: {
                Text("Tab bar")
            } footer: {
                Text("Tap Edit to reorder or remove tabs. Browse and Search follow them: Browse holds your projects and "
                    + "Settings, so it always stays.")
            }
            if !available.isEmpty {
                Section("Add a tab") {
                    ForEach(available, id: \.self) { tab in
                        Button {
                            prefs.value.custom.tabs.append(tab)
                        } label: {
                            Label(tab.title, systemImage: tab.symbol)
                        }
                        .disabled(custom.tabs.count >= Customisation.maxChosenTabs)
                    }
                }
            }
            #endif
            Section {
                Picker("Home view", selection: Binding(get: { custom.launchTab }, set: { prefs.value.custom.homeView = $0 })) {
                    ForEach(custom.barTabs, id: \.self) { Text($0.title).tag($0) }
                }
                Toggle("Sync home view", isOn: $prefs.value.custom.syncHomeView)
            } header: {
                Text("Home")
            } footer: {
                Text("The tab Cria opens on. When sync is on, your home view is the same in Cria on all your devices.")
            }
            Section {
                Toggle("Show task count", isOn: $prefs.value.custom.showTaskCount)
            } footer: {
                Text("Badges Today with what is due or overdue, and Inbox with its open tasks.")
            }
        }
        .criaSurface()
        .toolbar { EditButton() }
        .navigationTitle("Navigation")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Settings > Customise > Quick Add: which chips the row shows, their order, and whether they carry words. Read by
/// `QuickAddSheet`; chips left out move to its ••• menu.
struct QuickAddSettingsView: View {
    @ObservedObject var prefs: PreferencesModel

    private var custom: Customisation { prefs.value.custom }
    private var more: [QuickAddAction] { QuickAddAction.allCases.filter { !custom.quickAddActions.contains($0) } }

    var body: some View {
        List {
            Section {
                Toggle("Show action labels", isOn: $prefs.value.custom.quickAddShowsLabels.animation())
                HStack(spacing: 6) {
                    ForEach(custom.quickAddActions.prefix(3)) { action in
                        CriaChip(text: custom.quickAddShowsLabels ? action.title : "", systemImage: action.symbol, tint: action.tint)
                    }
                }
                .accessibilityHidden(true)
            } footer: {
                Text("Example")
            }
            Section("Included actions") {
                ForEach(custom.quickAddActions) { action in
                    Label(action.title, systemImage: action.symbol)
                }
                .onMove { from, destination in prefs.value.custom.quickAddActions.move(fromOffsets: from, toOffset: destination) }
                .onDelete { prefs.value.custom.quickAddActions.remove(atOffsets: $0) }
            }
            if !more.isEmpty {
                Section {
                    ForEach(more) { action in
                        Button {
                            prefs.value.custom.quickAddActions.append(action)
                        } label: {
                            Label(action.title, systemImage: action.symbol)
                        }
                    }
                } header: {
                    Text("More actions")
                } footer: {
                    Text("Tap to add to the row. Actions not in the row are in quick add’s ••• menu.")
                }
            }
        }
        .criaSurface()
        .environment(\.editMode, .constant(.active))
        .navigationTitle("Quick Add")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Settings > Customise > Dates & tasks: smart date recognition, what "next week" and "weekend" mean, subtasks of
/// repeating tasks and where web links open. Read by `QuickAddSheet`, the date parser (via `CriaRules`), the task
/// repository and `LinkOpener`.
struct DatesAndTasksSettingsView: View {
    @ObservedObject var prefs: PreferencesModel

    var body: some View {
        List {
            Section {
                Toggle("Detect dates in tasks automatically", isOn: $prefs.value.custom.detectDates)
            } header: {
                Text("Smart date recognition")
            } footer: {
                Text("Quick add turns words like “tomorrow 5pm” into the due date. Off, they stay in the title.")
            }
            Section("Date phrases") {
                Picker("Interpret “next week” as", selection: $prefs.value.custom.nextWeekDay) {
                    Text("Same day next week").tag(0)
                    ForEach(Self.weekdays, id: \.number) { Text($0.name).tag($0.number) }
                }
                Picker("Interpret “weekend” as", selection: $prefs.value.custom.weekendDay) {
                    Text("Saturday").tag(7)
                    Text("Sunday").tag(1)
                }
            }
            Section {
                Toggle("Reset subtasks", isOn: $prefs.value.custom.resetSubtasksOnRepeat)
            } header: {
                Text("Subtasks")
            } footer: {
                Text("Completing a repeating task marks its subtasks not done again, ready for the next time.")
            }
            Section("Links") {
                Picker("Open web links in", selection: $prefs.value.custom.openLinksInApp) {
                    Text("Cria").tag(true)
                    Text("Default browser").tag(false)
                }
            }
        }
        .criaSurface()
        .navigationTitle("Dates & tasks")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Monday first; numbers are `Calendar` weekdays (1 is Sunday).
    private static let weekdays: [(number: Int, name: String)] = [
        (2, "Monday"), (3, "Tuesday"), (4, "Wednesday"), (5, "Thursday"), (6, "Friday"), (7, "Saturday"), (1, "Sunday")
    ]
}

extension QuickAddAction {
    var symbol: String {
        switch self {
        case .date: return "calendar"
        case .priority: return "flag"
        case .reminders: return "bell"
        case .labels: return "tag"
        }
    }

    var tint: Color {
        switch self {
        case .date: return Color(.sky700)
        case .priority: return Color(.marigold700)
        case .reminders: return Color(.coral500)
        case .labels: return Color(.meadow700)
        }
    }
}
