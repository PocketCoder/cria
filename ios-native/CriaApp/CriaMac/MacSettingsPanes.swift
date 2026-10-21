import CriaKit
import KeyboardShortcuts
import ServiceManagement
import SwiftUI
import UserNotifications

/// A settings row title with SF 11 `l2` help text under it.
struct MacSettingRow: View {
    let title: String
    var help: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            if let help { Text(help).font(.system(size: 11)).foregroundStyle(MacTheme.label2) }
        }
    }
}

/// Settings > General: Startup, Menu bar and Dock, Quick add.
struct MacGeneralPane: View {
    let model: SettingsModel
    @ObservedObject var prefs: PreferencesModel
    let projects: [ProjectRecord]
    let serverEditable: Bool
    @AppStorage(MacPrefs.menuBar) private var menuBar = true
    @AppStorage(MacPrefs.closeToMenuBar) private var closeToMenuBar = true
    @AppStorage(MacPrefs.hideDock) private var hideDock = false
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?

    private var canSave: Bool { model.loaded && serverEditable }

    /// The places the main window can open on (read by `MacShellView` through `MacSelection(home:)`).
    private static let startTabs: [AppTab] = [.today, .upcoming, .inbox, .favorites, .search]

    var body: some View {
        Section("Startup") {
            Toggle("Open at login", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { _, enabled in setLaunchAtLogin(enabled) }
            if let loginError { Text(loginError).foregroundStyle(Color(.destructive)).font(.system(size: 11)) }
            Picker("Start on", selection: $prefs.value.custom.homeView) {
                ForEach(Self.startTabs, id: \.self) { Text($0.title).tag($0) }
            }
            Toggle("Sync start view across devices", isOn: $prefs.value.custom.syncHomeView)
        }
        Section("Menu bar and Dock") {
            Toggle(isOn: $menuBar) {
                MacSettingRow(title: "Show Cria in the menu bar", help: "Today\u{2019}s tasks and New Task, one click away.")
            }
            Toggle("Keep running when the window closes", isOn: $closeToMenuBar)
            Toggle("Hide Dock icon while the window is closed", isOn: $hideDock)
                .onChange(of: hideDock) { MacActivation.update() }
        }
        Section("Quick add") {
            LabeledContent {
                KeyboardShortcuts.Recorder(for: .quickAdd)
            } label: {
                MacSettingRow(title: "Global shortcut", help: "Opens New Task from any app.")
            }
            Picker("New tasks go to", selection: defaultProject) {
                Text("Inbox").tag(0)
                ForEach(projects.filter { ($0.serverId ?? 0) > 0 }, id: \.localId) { Text($0.title).tag($0.serverId ?? 0) }
            }
            .disabled(!canSave)
            Picker("Week starts on", selection: weekStart) {
                ForEach(Weekdays.names.indices, id: \.self) { Text(Weekdays.names[$0]).tag($0) }
            }
            .disabled(!canSave)
            Picker("Quick Add Magic", selection: magicMode) {
                Text("Vikunja (*label +project !priority)").tag("vikunja")
                Text("Todoist (@label #project !priority)").tag("todoist")
                Text("Off").tag("disabled")
            }
            .disabled(!canSave)
            Toggle(isOn: $prefs.value.custom.expandedQuickAdd) {
                MacSettingRow(
                    title: "Expanded quick-add syntax",
                    help: "Also reads p1 to p4, every! day, {deadline}, 9-10am and for 1h."
                )
            }
            .disabled(model.general.quickAddMagicMode == QuickAddMagicMode.disabled.rawValue)
            QuickAddDefaultsRows(model: model, canSave: canSave, icons: false)
        }
    }

    // Bindings built outside the view builder: a `Binding(get:set:)` inline in a Mac settings body has crashed the
    // compiler (IRGen) before.
    private var defaultProject: Binding<Int> {
        Binding(get: { model.general.defaultProjectId }, set: { id in Task { await model.setDefaultProject(id) } })
    }

    private var magicMode: Binding<String> {
        Binding(get: { model.general.quickAddMagicMode }, set: { mode in Task { await model.setQuickAddMode(mode) } })
    }

    private var weekStart: Binding<Int> {
        Binding(get: { model.general.weekStart }, set: { day in Task { await model.setWeekStart(day) } })
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        // Already what the system has (this also runs after the toggle snaps back from a failure).
        guard enabled != (SMAppService.mainApp.status == .enabled) else { return }
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = nil
        } catch {
            loginError = String(describing: error)
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }
}

/// Settings > Customise: Sidebar and Lists. The iPhone-only rows (haptics, swipe actions, tab bar) are left out.
struct MacCustomisePane: View {
    @ObservedObject var prefs: PreferencesModel
    @AppStorage(MacPrefs.showFavourites) private var showFavourites = true
    /// Read by the task lists (`cria.taskList.showDone`).
    @AppStorage("cria.taskList.showDone") private var showDone = true

    var body: some View {
        Section("Sidebar") {
            Toggle("Show task count", isOn: $prefs.value.custom.showTaskCount)
            Toggle("Show favourite projects", isOn: $showFavourites)
        }
        Section("Lists") {
            Toggle("Show completed tasks", isOn: $showDone)
            Toggle("Play a sound on completion", isOn: $prefs.value.playSoundWhenDone)
            if prefs.value.playSoundWhenDone {
                Picker("Task complete tone", selection: $prefs.value.custom.completionTone) {
                    ForEach(CompletionTone.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                // Play the choice, so it can be heard before leaving.
                .onChange(of: prefs.value.custom.completionTone) { _, tone in CompletionSound.play(tone) }
            }
            Picker("Appearance", selection: $prefs.value.colorScheme) {
                Text("Light").tag(ColorSchemePreference.light)
                Text("Dark").tag(ColorSchemePreference.dark)
                Text("Auto").tag(ColorSchemePreference.system)
            }
            .pickerStyle(.segmented)
        }
        Section("Projects") {
            Toggle(isOn: $prefs.value.custom.kanbanSortByDue) {
                MacSettingRow(
                    title: "Sort board cards by due date",
                    help: "Soonest first, undated last. Dragging then only moves a card between columns."
                )
            }
            Toggle(isOn: $prefs.value.custom.syncProjectViews) {
                MacSettingRow(
                    title: "Sync project views",
                    help: "Reopens each project on the view you last used on any device that has this on."
                )
            }
        }
        // The same screens as on iPhone: the shared quick add, task screen and date parser read them.
        Section("Screens") {
            MacSettingsSheetLink("Quick Add") { QuickAddSettingsView(prefs: prefs) }
            MacSettingsSheetLink("Task layout") { TaskLayoutSettingsView(prefs: prefs) }
            MacSettingsSheetLink("Dates & tasks") { DatesAndTasksSettingsView(prefs: prefs) }
        }
    }
}

/// Settings > Notifications: Reminders and Summaries.
struct MacNotificationsPane: View {
    @ObservedObject var prefs: PreferencesModel
    @State private var status = UNAuthorizationStatus.notDetermined

    private var notificationsOn: Bool { prefs.value.notificationsEnabled && status != .denied }

    var body: some View {
        Section("Reminders") {
            Toggle(isOn: notificationsBinding) {
                MacSettingRow(title: "Task reminders", help: "Notifications include Complete and Snooze buttons.")
            }
        }
        Section("Summaries") {
            Toggle("Morning summary", isOn: $prefs.value.morningSummaryEnabled)
                .disabled(!notificationsOn)
        }
        Section("Dock") {
            Toggle(isOn: $prefs.value.appIconBadge) {
                MacSettingRow(title: "Dock badge", help: "Counts open tasks that are overdue or due today.")
            }
        }
        .task { await refreshStatus() }
    }

    private var notificationsBinding: Binding<Bool> {
        // A closure, not the method reference: passing `setNotifications` itself made the compiler emit an
        // isolation-erasing thunk that crashed IRGen on x86_64.
        Binding(get: { notificationsOn }, set: { enabled in setNotifications(enabled) })
    }

    private func setNotifications(_ enabled: Bool) {
        guard enabled else {
            prefs.value.notificationsEnabled = false
            return
        }
        Task {
            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            await refreshStatus()
            prefs.value.notificationsEnabled = granted
        }
    }

    private func refreshStatus() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}
