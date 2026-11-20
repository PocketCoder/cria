import CriaKit
import SwiftUI

#if os(macOS)
/// The Mac panel's chips row: Project, Date, Priority, Labels and Reminder, 30pt high. Each opens a menu, and a chip
/// is grey until it has a value, then turns the accent: one colour for "set", not one per chip.
extension QuickAddSheet {
    var panelChips: some View {
        HStack(spacing: 6) {
            panelProjectMenu
            panelDateMenu
            panelPriorityMenu
            panelLabelsMenu
            QuickAddReminderMenu(
                reminders: $reminders, hasDueDate: !dueISO.isEmpty, onCustom: { pickerSheet = .reminder },
                unsetTint: Self.unsetTint, emptyTitle: "Reminder", setTint: Color(.primary)
            )
            .frame(height: 30)
            parsedChips
        }
        // The large chip (SF 13, 12pt sides): the regular one read too small in the panel.
        .environment(\.criaChipSize, .large)
    }

    private static var unsetTint: Color { MacTheme.label2 }

    private var panelProjectMenu: some View {
        Menu {
            Picker("Project", selection: projectPick) {
                ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
            }
            .pickerStyle(.inline)
        } label: {
            let chip = resolveProjectChip(parsedProjectTitle: typedProjectTitle, projects: projects, projectLocalId: projectId)
            let set = picked.contains(.project) || typedProjectTitle != nil
            CriaChip(text: chip.title ?? "Project", systemImage: "tray", tint: set ? Color(.primary) : Self.unsetTint)
        }
        .macChipMenu()
        .frame(height: 30)
        .accessibilityLabel("Project")
    }

    private var panelDateMenu: some View {
        Menu {
            Button("Today") { setDue(presetISO(for: Date())) }
            Button("Tomorrow") { setDue(presetISO(for: dayFromToday(1))) }
            Button("Next Week") { setDue(presetISO(for: dayFromToday(7))) }
            Divider()
            Button("Choose Date…") { pickerSheet = .date }
            if !dueISO.isEmpty {
                Button("No Date", role: .destructive) { setDue("") }
            }
        } label: {
            CriaChip(
                text: dueISO.isEmpty ? "Date" : DueDates.label(dueISO, now: Date(), display: dateDisplay),
                systemImage: "calendar", tint: dueISO.isEmpty ? Self.unsetTint : Color(.primary)
            )
        }
        .macChipMenu()
        .frame(height: 30)
        .accessibilityLabel("Date")
    }

    /// The day as a due date, with the account's default due time when it has one (as Vikunja-web's shortcuts do).
    private func presetISO(for day: Date) -> String {
        let iso = DueDates.allDayISO(for: day)
        return QuickAddDefaults.current().dueTime?.applying(to: iso) ?? iso
    }

    private func dayFromToday(_ days: Int) -> Date {
        Calendar.cria.date(byAdding: .day, value: days, to: Date()) ?? Date()
    }

    private var panelPriorityMenu: some View {
        Menu {
            Picker("Priority", selection: priorityPick) {
                ForEach(0...5, id: \.self) { Text($0 == 0 ? "No priority" : "Priority \($0)").tag($0) }
            }
            .pickerStyle(.inline)
        } label: {
            CriaChip(
                text: priority == 0 ? "Priority" : "P\(priority)", systemImage: "flag",
                tint: priority == 0 ? Self.unsetTint : Color(.primary)
            )
        }
        .macChipMenu()
        .frame(height: 30)
        .accessibilityLabel("Priority")
    }

    private var panelLabelsMenu: some View {
        Menu {
            ForEach(allLabelTitles, id: \.self) { title in
                Toggle(title, isOn: labelBinding(title))
            }
            if !allLabelTitles.isEmpty { Divider() }
            Button("More Labels…") { pickerSheet = .labels }
        } label: {
            CriaChip(
                text: labelTitles.isEmpty ? "Labels" : labelTitles.joined(separator: ", "), systemImage: "tag",
                tint: labelTitles.isEmpty ? Self.unsetTint : Color(.primary)
            )
        }
        .macChipMenu()
        .frame(height: 30)
        .accessibilityLabel("Labels")
    }

    private func labelBinding(_ title: String) -> Binding<Bool> {
        Binding(
            get: { labelTitles.contains { $0.caseInsensitiveCompare(title) == .orderedSame } },
            set: { isOn in
                labelTitles.removeAll { $0.caseInsensitiveCompare(title) == .orderedSame }
                if isOn { labelTitles.append(title) }
            }
        )
    }
}
#endif
