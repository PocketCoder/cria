import CriaKit
import SwiftUI

/// Settings > General, after `MacGeneralPane`: the rest of the iPhone's General and Photo capture rows (timezone, date
/// and time style, default view, photo defaults, discoverability), so each setting appears once on the Mac. Server-backed
/// rows save through `SettingsModel`; the rest are device or account preferences in `PreferencesModel`.
struct MacGeneralMoreSections: View {
    let model: SettingsModel
    @ObservedObject var prefs: PreferencesModel
    let projects: [ProjectRecord]
    let serverEditable: Bool

    private var canSave: Bool { model.loaded && serverEditable }

    var body: some View {
        Section("Date and time") {
            LabeledContent("Timezone") {
                MacSettingsSheetLink {
                    TimezonePickerView(model: model)
                } label: {
                    Text(model.general.timezone.replacingOccurrences(of: "_", with: " "))
                }
            }
            .disabled(!canSave)
            Picker("Date format", selection: $prefs.value.dateFormat) {
                Text("Automatic").tag(DateFormatPreference.automatic)
                Text("2026-12-31").tag(DateFormatPreference.iso)
                Text("12/31/2026").tag(DateFormatPreference.american)
                Text("31/12/2026").tag(DateFormatPreference.european)
            }
            Picker("Time format", selection: $prefs.value.timeFormat) {
                Text("24-hour").tag(TimeFormatPreference.h24)
                Text("12-hour").tag(TimeFormatPreference.h12)
            }
        }
        Section("Projects") {
            // Vikunja's "Default view": what a project opens on until a view has been chosen in it.
            Picker(selection: defaultView) {
                Text("First view").tag("first")
                Text("List").tag("list")
                Text("Gantt").tag("gantt")
                Text("Table").tag("table")
                Text("Kanban").tag("kanban")
            } label: {
                MacSettingRow(title: "Default view", help: "What a project opens on until you pick a view in it.")
            }
            .disabled(!canSave)
        }
        Section("Photo capture") {
            // Read by the photo import: blank project means ask each time.
            Picker("Default project", selection: photoProject) {
                Text("Ask each time").tag("")
                ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
            }
            LabeledContent("Default label") {
                TextField("Default label", text: $prefs.value.photoLabel, prompt: Text("None"))
                    .labelsHidden()
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 180)
                    .autocorrectionDisabled()
            }
        }
        Section("Privacy") {
            Toggle("Discoverable by email", isOn: discoverableByEmail)
            Toggle("Discoverable by name", isOn: discoverableByName)
        }
        .disabled(!canSave)
    }

    // Bindings built outside the view builder (see `MacGeneralPane`).
    private var defaultView: Binding<String> {
        Binding(get: { model.general.defaultView }, set: { view in Task { await model.setDefaultView(view) } })
    }

    private var photoProject: Binding<String> {
        Binding(get: { prefs.value.photoProjectId ?? "" }, set: { id in prefs.value.photoProjectId = id.isEmpty ? nil : id })
    }

    private var discoverableByEmail: Binding<Bool> {
        Binding(
            get: { model.general.discoverableByEmail },
            set: { value in
                Task { await model.save(GeneralSettings.changeDiscoverableByEmail(value)) { $0.discoverableByEmail = value } }
            }
        )
    }

    private var discoverableByName: Binding<Bool> {
        Binding(
            get: { model.general.discoverableByName },
            set: { value in
                Task { await model.save(GeneralSettings.changeDiscoverableByName(value)) { $0.discoverableByName = value } }
            }
        )
    }
}

/// Settings > Notifications, after `MacNotificationsPane`'s switches: summary times, the weekly round-up, the activity
/// inbox and the server's email settings (hidden for a share link, which has no user of its own).
struct MacNotificationsMoreSections: View {
    let services: AppServices
    let model: SettingsModel
    @ObservedObject var prefs: PreferencesModel
    /// Whether local notifications are on and allowed (from `MacNotificationsPane`).
    let notificationsOn: Bool
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    var body: some View {
        Section("Summaries") {
            Toggle("Morning summary", isOn: $prefs.value.morningSummaryEnabled)
                .disabled(!notificationsOn)
            if prefs.value.morningSummaryEnabled && notificationsOn {
                DatePicker("Morning summary time", selection: morningTime, displayedComponents: .hourAndMinute)
            }
            Toggle(isOn: $prefs.value.weeklyRoundupEnabled) {
                MacSettingRow(
                    title: "Weekly round-up",
                    help: "Arrives on \(Weekdays.name(model.general.weekStart)), the first day of your week."
                )
            }
            .disabled(!notificationsOn)
            if prefs.value.weeklyRoundupEnabled && notificationsOn {
                DatePicker("Weekly round-up time", selection: weeklyTime, displayedComponents: .hourAndMinute)
            }
        }
        if !isLinkShare {
            Section("Email") {
                Toggle("Email reminders", isOn: emailReminders)
                Toggle("Overdue task digest", isOn: overdueReminders)
                if model.general.overdueRemindersEnabled {
                    DatePicker("Digest time", selection: overdueTime, displayedComponents: .hourAndMinute)
                }
            }
            .disabled(!model.loaded)
            Section("Activity") {
                MacSettingsSheetLink("Notification inbox") { NotificationsView(services: services, onClose: {}) }
            }
        }
    }

    // Bindings built outside the view builder (see `MacGeneralPane`).
    private var morningTime: Binding<Date> {
        Binding(
            get: { ClockTime.date(prefs.value.morningSummaryTime) },
            set: { date in prefs.value.morningSummaryTime = ClockTime.text(date) }
        )
    }

    private var weeklyTime: Binding<Date> {
        Binding(
            get: { ClockTime.date(prefs.value.weeklyRoundupTime) },
            set: { date in prefs.value.weeklyRoundupTime = ClockTime.text(date) }
        )
    }

    private var emailReminders: Binding<Bool> {
        Binding(
            get: { model.general.emailRemindersEnabled },
            set: { value in
                Task { await model.save(GeneralSettings.changeEmailReminders(value)) { $0.emailRemindersEnabled = value } }
            }
        )
    }

    private var overdueReminders: Binding<Bool> {
        Binding(
            get: { model.general.overdueRemindersEnabled },
            set: { value in
                Task { await model.save(GeneralSettings.changeOverdueReminders(value)) { $0.overdueRemindersEnabled = value } }
            }
        )
    }

    private var overdueTime: Binding<Date> {
        Binding(
            get: { ClockTime.date(model.general.overdueRemindersTime) },
            set: { date in
                let text = ClockTime.text(date)
                Task { await model.save(GeneralSettings.changeOverdueTime(text)) { $0.overdueRemindersTime = text } }
            }
        )
    }
}
