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
        }
    }

    // Bindings built outside the view builder: a `Binding(get:set:)` inline in a Mac settings body has crashed the
    // compiler (IRGen) before.
    private var defaultProject: Binding<Int> {
        Binding(get: { model.general.defaultProjectId }, set: { id in Task { await model.setDefaultProject(id) } })
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
            Picker("Appearance", selection: $prefs.value.colorScheme) {
                Text("Light").tag(ColorSchemePreference.light)
                Text("Dark").tag(ColorSchemePreference.dark)
                Text("Auto").tag(ColorSchemePreference.system)
            }
            .pickerStyle(.segmented)
        }
    }
}

/// Settings > Notifications: Reminders and Summaries.
struct MacNotificationsPane: View {
    @ObservedObject var prefs: PreferencesModel
    @AppStorage(MacPrefs.defaultReminder) private var defaultReminder = MacDefaultReminder.off.rawValue
    @State private var status = UNAuthorizationStatus.notDetermined

    private var notificationsOn: Bool { prefs.value.notificationsEnabled && status != .denied }

    var body: some View {
        Section("Reminders") {
            Toggle(isOn: notificationsBinding) {
                MacSettingRow(title: "Task reminders", help: "Notifications include Complete and Snooze buttons.")
            }
            Picker(selection: $defaultReminder) {
                ForEach(MacDefaultReminder.allCases, id: \.rawValue) { Text($0.title).tag($0.rawValue) }
            } label: {
                MacSettingRow(title: "Default reminder", help: "Added by quick add when a new task has a due date.")
            }
            .disabled(!notificationsOn)
        }
        Section("Summaries") {
            Toggle("Morning summary", isOn: $prefs.value.morningSummaryEnabled)
                .disabled(!notificationsOn)
        }
        .task { await refreshStatus() }
    }

    private var notificationsBinding: Binding<Bool> {
        Binding(get: { notificationsOn }, set: setNotifications)
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

/// The reminder Mac quick add gives a new task with a due date (Settings > Notifications > Default reminder).
enum MacDefaultReminder: Int, CaseIterable {
    case off = -1, atDue = 0, hourBefore = 3_600, dayBefore = 86_400

    var title: String {
        switch self {
        case .off: return "None"
        case .atDue: return "On the due time"
        case .hourBefore: return "1 hour before"
        case .dayBefore: return "1 day before"
        }
    }

    /// The stored choice as a quick-add reminder; nil for none.
    static var current: QuickAddReminder? {
        let raw = UserDefaults.standard.object(forKey: MacPrefs.defaultReminder) as? Int ?? off.rawValue
        guard let choice = MacDefaultReminder(rawValue: raw), choice != .off else { return nil }
        return .beforeDue(seconds: choice.rawValue)
    }
}
