import CriaKit
import SwiftUI

/// Settings sheet: profile, appearance, Quick Add, reminders, account and storage.
struct SettingsView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var model: SettingsModel
    @State private var name = ""
    @State private var overdueTime = Date()
    @State private var confirmingWipe = false
    @State private var preferences = PreferencesStore().load()
    @State private var projects: [ProjectRecord] = []
    @AppStorage("cria.taskList.showDone") private var showDone = true
    @Environment(\.dismiss) private var dismiss

    init(services: AppServices, onSignOut: @escaping (_ wipeLocalData: Bool) -> Void) {
        self.services = services
        self.onSignOut = onSignOut
        _model = State(initialValue: SettingsModel(services: services))
    }

    var body: some View {
        NavigationStack {
            Form {
                profileSection
                generalSection
                appearanceSection
                remindersSection
                collaborationSection
                accountSection
                storageSection
                if let message = model.errorMessage {
                    Section { Text(message).foregroundStyle(Color(.destructive)) }
                }
            }
            .criaSurface()
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }.modifier(CriaProminentToolbarButton())
                }
            }
            .task {
                projects = ProjectTree.visible((try? services.store.projects()) ?? [])
                await model.load()
                name = model.general.name
                overdueTime = Self.time(model.general.overdueRemindersTime)
            }
        }
    }

    private var profileSection: some View {
        Section("Profile") {
            HStack(spacing: 14) {
                Text(initials)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color(.primary))
                    .frame(width: 48, height: 48)
                    .background(Color(.primarySoft), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(name.isEmpty ? model.username : name).font(Theme.rowTitle)
                    Text("@\(model.username)").font(Theme.rowSubtitle).foregroundStyle(Color(.mutedForeground))
                }
            }
            .frame(minHeight: 72)
            .accessibilityElement(children: .combine)
            TextField("Name", text: $name)
                .onSubmit { Task { await model.save(GeneralSettings.changeName(name)) { $0.name = name } } }
        }
    }

    private var initials: String {
        let source = name.isEmpty ? model.username : name
        let letters = source.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    private var appearanceSection: some View {
        Section("Appearance") {
            Picker(selection: Binding(
                get: { preferences.colorScheme },
                set: { choice in
                    preferences.colorScheme = choice
                    PreferencesStore().save(preferences)
                    NotificationCenter.default.post(name: .criaPreferencesChanged, object: nil)
                }
            )) {
                ForEach(ColorSchemePreference.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
            } label: {
                SettingsLabel("Theme", symbol: "moon", token: .llama800)
            }
        }
    }

    private static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    private var generalSection: some View {
        Section("General") {
            Picker(selection: Binding(
                get: { model.general.defaultProjectId },
                set: { id in Task { await model.setDefaultProject(id) } }
            )) {
                Text("Inbox").tag(0)
                ForEach(projects.filter { $0.serverId != 0 }, id: \.localId) { Text($0.title).tag($0.serverId) }
            } label: {
                SettingsLabel("Default project", symbol: "tray", token: .sky500)
            }
            Picker(selection: Binding(
                get: { model.general.weekStart },
                set: { day in Task { await model.setWeekStart(day) } }
            )) {
                ForEach(Self.weekdays.indices, id: \.self) { Text(Self.weekdays[$0]).tag($0) }
            } label: {
                SettingsLabel("Week starts on", symbol: "calendar", token: .coral500)
            }
            Picker(selection: Binding(
                get: { model.general.quickAddMagicMode },
                set: { mode in Task { await model.setQuickAddMode(mode) } }
            )) {
                Text("Vikunja (*label +project !priority)").tag("vikunja")
                Text("Todoist (@label #project p1)").tag("todoist")
                Text("Off").tag("disabled")
            } label: {
                SettingsLabel("Quick Add Magic", symbol: "sparkles", token: .llama500)
            }
            Toggle(isOn: $showDone) {
                SettingsLabel("Show completed", symbol: "checkmark.circle", token: .meadow500)
            }
            Toggle(isOn: Binding(
                get: { model.general.discoverableByEmail },
                set: { value in Task { await model.save(GeneralSettings.changeDiscoverableByEmail(value)) { $0.discoverableByEmail = value } } }
            )) {
                SettingsLabel("Discoverable by email", symbol: "envelope", token: .sky700)
            }
            Toggle(isOn: Binding(
                get: { model.general.discoverableByName },
                set: { value in Task { await model.save(GeneralSettings.changeDiscoverableByName(value)) { $0.discoverableByName = value } } }
            )) {
                SettingsLabel("Discoverable by name", symbol: "person.text.rectangle", token: .sky700)
            }
        }
    }

    private var remindersSection: some View {
        Section("Reminders") {
            Toggle(isOn: Binding(
                get: { model.general.emailRemindersEnabled },
                set: { value in setEmailReminders(value) }
            )) {
                SettingsLabel("Email reminders", symbol: "bell", token: .coral500)
            }
            Toggle(isOn: Binding(
                get: { model.general.overdueRemindersEnabled },
                set: { value in setOverdueReminders(value) }
            )) {
                SettingsLabel("Overdue task digest", symbol: "sun.max", token: .marigold500)
            }
            if model.general.overdueRemindersEnabled {
                DatePicker("Digest time", selection: $overdueTime, displayedComponents: .hourAndMinute)
                    .onChange(of: overdueTime) { _, value in
                        let text = Self.hourMinute(value)
                        Task { await model.save(GeneralSettings.changeOverdueTime(text)) { $0.overdueRemindersTime = text } }
                    }
            }
        }
    }

    private func setEmailReminders(_ value: Bool) {
        Task { await model.save(GeneralSettings.changeEmailReminders(value)) { $0.emailRemindersEnabled = value } }
    }

    private func setOverdueReminders(_ value: Bool) {
        Task { await model.save(GeneralSettings.changeOverdueReminders(value)) { $0.overdueRemindersEnabled = value } }
    }

    private var collaborationSection: some View {
        Section("Collaboration") {
            NavigationLink { NotificationsView(services: services) } label: {
                SettingsLabel("Notifications", symbol: "bell.badge", token: .coral500)
            }
            NavigationLink { TeamsView(services: services) } label: {
                SettingsLabel("Teams", symbol: "person.2", token: .sky700)
            }
        }
    }

    private var accountSection: some View {
        Section("Account") {
            NavigationLink { ApiTokensView(services: services) } label: {
                SettingsLabel("API tokens", symbol: "key", token: .fleece500)
            }
            NavigationLink { ChangePasswordView(services: services) } label: {
                SettingsLabel("Change password", symbol: "lock", token: .fleece500)
            }
            Button(role: .destructive) { onSignOut(false) } label: {
                Text("Sign out").frame(maxWidth: .infinity)
            }
            Button(role: .destructive) { confirmingWipe = true } label: {
                Text("Sign out and delete local data").frame(maxWidth: .infinity)
            }
                .confirmationDialog("Delete the local database and caches?", isPresented: $confirmingWipe, titleVisibility: .visible) {
                    Button("Sign out and delete", role: .destructive) { onSignOut(true) }
                } message: {
                    Text("Unsynced changes on this device are lost.")
                }
        }
    }

    private var storageSection: some View {
        Section("Storage") {
            LabeledContent("Cached backgrounds", value: "\(model.backgroundCount)")
            Button("Clear cached backgrounds") { model.clearBackgrounds() }
                .disabled(model.backgroundCount == 0)
        }
    }

    private static func time(_ text: String) -> Date {
        let parts = text.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return Date() }
        return Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date()) ?? Date()
    }

    private static func hourMinute(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}

/// Settings-app row label: 30pt rounded square in an accent colour with a white glyph.
struct SettingsLabel: View {
    let title: String
    let symbol: String
    let token: ThemeToken

    init(_ title: String, symbol: String, token: ThemeToken) {
        self.title = title
        self.symbol = symbol
        self.token = token
    }

    var body: some View {
        Label {
            Text(title)
        } icon: {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Color(token), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}

extension Notification.Name {
    /// Posted after the local preferences change so the root view re-reads them.
    static let criaPreferencesChanged = Notification.Name("cria.preferencesChanged")
}
