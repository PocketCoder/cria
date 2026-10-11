import CriaKit
import SwiftUI

/// Settings > General: language, timezone, date and time style, default project, week start, Quick Add, completed
/// tasks and discoverability. Server-backed rows save through `SettingsModel`; date and time style are device-local.
struct GeneralSettingsSection: View {
    let model: SettingsModel
    @ObservedObject var prefs: PreferencesModel
    let projects: [ProjectRecord]
    @AppStorage("cria.taskList.showDone") private var showDone = true

    var body: some View {
        Section("General") {
            localeRows
            formatRows
            taskRows
            discoverabilityRows
        }
    }

    private var localeRows: some View {
        Group {
            Picker(selection: Binding(
                get: { model.general.language },
                set: { code in Task { await model.setLanguage(code) } }
            )) {
                ForEach(SettingsOptions.languages(including: model.general.language)) { Text($0.label).tag($0.code) }
            } label: {
                SettingsLabel("Language", symbol: "character.bubble", token: .plum500)
            }
            NavigationLink {
                TimezonePickerView(model: model)
            } label: {
                LabeledContent {
                    Text(model.general.timezone.replacingOccurrences(of: "_", with: " "))
                } label: {
                    SettingsLabel("Timezone", symbol: "globe", token: .sky500)
                }
            }
        }
    }

    private var formatRows: some View {
        Group {
            Picker(selection: $prefs.value.dateFormat) {
                Text("Automatic").tag(DateFormatPreference.automatic)
                Text("2026-12-31").tag(DateFormatPreference.iso)
                Text("12/31/2026").tag(DateFormatPreference.american)
                Text("31/12/2026").tag(DateFormatPreference.european)
            } label: {
                SettingsLabel("Date format", symbol: "calendar.badge.clock", token: .coral500)
            }
            Picker(selection: $prefs.value.timeFormat) {
                Text("24-hour").tag(TimeFormatPreference.h24)
                Text("12-hour").tag(TimeFormatPreference.h12)
            } label: {
                SettingsLabel("Time format", symbol: "clock", token: .coral500)
            }
        }
    }

    private var taskRows: some View {
        Group {
            Picker(selection: Binding(
                get: { model.general.defaultProjectId },
                set: { id in Task { await model.setDefaultProject(id) } }
            )) {
                Text("Inbox").tag(0)
                ForEach(projects.filter { ($0.serverId ?? 0) > 0 }, id: \.localId) { Text($0.title).tag($0.serverId ?? 0) }
            } label: {
                SettingsLabel("Default project", symbol: "tray", token: .sky500)
            }
            Picker(selection: Binding(
                get: { model.general.weekStart },
                set: { day in Task { await model.setWeekStart(day) } }
            )) {
                ForEach(Weekdays.names.indices, id: \.self) { Text(Weekdays.names[$0]).tag($0) }
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
        }
    }

    private var discoverabilityRows: some View {
        Group {
            Toggle(isOn: Binding(
                get: { model.general.discoverableByEmail },
                set: { value in
                    Task { await model.save(GeneralSettings.changeDiscoverableByEmail(value)) { $0.discoverableByEmail = value } }
                }
            )) {
                SettingsLabel("Discoverable by email", symbol: "envelope", token: .sky700)
            }
            Toggle(isOn: Binding(
                get: { model.general.discoverableByName },
                set: { value in
                    Task { await model.save(GeneralSettings.changeDiscoverableByName(value)) { $0.discoverableByName = value } }
                }
            )) {
                SettingsLabel("Discoverable by name", symbol: "person.text.rectangle", token: .sky700)
            }
        }
    }
}

/// Timezone list grouped by region, searchable, with the current choice ticked.
struct TimezonePickerView: View {
    let model: SettingsModel
    @State private var groups: [TimezoneGroup] = []
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(filtered) { group in
                Section(group.label) {
                    ForEach(group.items) { item in
                        Button {
                            Task { await model.setTimezone(item.value) }
                            dismiss()
                        } label: {
                            HStack {
                                Text(item.label).foregroundStyle(Color(.foreground))
                                Spacer()
                                if item.value == model.general.timezone {
                                    Image(systemName: "checkmark").foregroundStyle(Color(.primary))
                                }
                            }
                        }
                    }
                }
            }
        }
        .criaSurface()
        .searchable(text: $query, prompt: "Search timezones")
        .navigationTitle("Timezone")
        .navigationBarTitleDisplayMode(.inline)
        .task { groups = SettingsOptions.groupTimezones(await model.timezones()) }
    }

    private var filtered: [TimezoneGroup] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return groups }
        return groups.compactMap { group in
            let items = group.items.filter {
                $0.value.localizedCaseInsensitiveContains(needle) || $0.label.localizedCaseInsensitiveContains(needle)
            }
            return items.isEmpty ? nil : TimezoneGroup(label: group.label, items: items)
        }
    }
}
