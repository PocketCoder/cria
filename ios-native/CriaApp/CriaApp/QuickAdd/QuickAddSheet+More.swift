import CriaKit
import SwiftUI

/// The "•••" menu holding the quick-add actions the user moved out of the chip row.
extension QuickAddSheet {
    var moreMenu: some View {
        Menu {
            let hidden = QuickAddAction.allCases.filter { !preferences.custom.quickAddActions.contains($0) }
            if !hidden.isEmpty {
                Section {
                    ForEach(hidden) { hiddenAction($0) }
                }
            }
            Toggle("Keep open after adding", isOn: $addAnother)
            if let onPhoto {
                Button("List from photo", systemImage: "camera") { closeSheet(); onPhoto() }
            }
            Section("Type to set") {
                if let hint = syntaxHint { Text(hint) }
                if preferences.custom.detectDates { Text("remind day before at 9am") }
            }
        } label: {
            CriaChip(text: "•••", tint: Color(.mutedForeground))
        }
        .macChipMenu()
        .accessibilityLabel("More options")
    }

    @ViewBuilder
    private func hiddenAction(_ action: QuickAddAction) -> some View {
        switch action {
        case .date:
            Button("Date", systemImage: "calendar") { pickerSheet = .date }
        case .priority:
            Picker(selection: priorityPick) {
                ForEach(0...5, id: \.self) { Text($0 == 0 ? "No priority" : "Priority \($0)").tag($0) }
            } label: {
                Label("Priority", systemImage: "flag")
            }
            .pickerStyle(.menu)
        case .reminders:
            Button("Reminder", systemImage: "bell") { pickerSheet = .reminder }
        case .labels:
            Button("Labels", systemImage: "tag") { pickerSheet = .labels }
        }
    }
}

extension QuickAddSheet {
    /// "+project  *label  @person  !1–5  ·  tomorrow 5pm" with the prefixes of the user's Quick Add Magic mode
    /// (Todoist mode reads "#project  @label  +person"). Nil while the magic is off.
    var syntaxHint: String? {
        guard let prefixes = mode.prefixes else { return nil }
        let symbols = "\(prefixes.project)project  \(prefixes.label)label  \(prefixes.assignee)person  \(prefixes.priority)1–5"
        return preferences.custom.detectDates ? symbols + "  ·  tomorrow 5pm" : symbols
    }
}
