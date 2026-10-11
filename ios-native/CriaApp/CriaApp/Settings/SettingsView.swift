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
                appearanceSection
                quickAddSection
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
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                await model.load()
                name = model.general.name
                overdueTime = Self.time(model.general.overdueRemindersTime)
            }
        }
    }

    private var profileSection: some View {
        Section("Profile") {
            LabeledContent("Username", value: model.username)
            TextField("Name", text: $name)
                .onSubmit { Task { await model.save(GeneralSettings.changeName(name)) { $0.name = name } } }
        }
    }

    private var appearanceSection: some View {
        Section("Appearance") {
            Picker("Theme", selection: Binding(
                get: { preferences.colorScheme },
                set: { choice in
                    preferences.colorScheme = choice
                    PreferencesStore().save(preferences)
                    NotificationCenter.default.post(name: .criaPreferencesChanged, object: nil)
                }
            )) {
                ForEach(ColorSchemePreference.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
            }
        }
    }

    private var quickAddSection: some View {
        Section("Quick Add Magic") {
            Picker("Mode", selection: Binding(
                get: { model.general.quickAddMagicMode },
                set: { mode in Task { await model.setQuickAddMode(mode) } }
            )) {
                Text("Vikunja (*label +project !priority)").tag("vikunja")
                Text("Todoist (@label #project p1)").tag("todoist")
                Text("Off").tag("disabled")
            }
        }
    }

    private var remindersSection: some View {
        Section("Reminders") {
            Toggle("Email reminders", isOn: Binding(
                get: { model.general.emailRemindersEnabled },
                set: { value in setEmailReminders(value) }
            ))
            Toggle("Overdue task digest", isOn: Binding(
                get: { model.general.overdueRemindersEnabled },
                set: { value in setOverdueReminders(value) }
            ))
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
            NavigationLink("Notifications") { NotificationsView(services: services) }
            NavigationLink("Teams") { TeamsView(services: services) }
        }
    }

    private var accountSection: some View {
        Section("Account") {
            NavigationLink("Change password") { ChangePasswordView(services: services) }
            NavigationLink("API tokens") { ApiTokensView(services: services) }
            Button("Sign out", role: .destructive) { onSignOut(false) }
            Button("Sign out and delete local data", role: .destructive) { confirmingWipe = true }
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

extension Notification.Name {
    /// Posted after the local preferences change so the root view re-reads them.
    static let criaPreferencesChanged = Notification.Name("cria.preferencesChanged")
}
