import CriaKit
import SwiftUI

/// The two new-task defaults Vikunja-web keeps in the account's `frontend_settings` (Settings > General there): the
/// time a due date typed without one gets, and the reminders quick add gives a task with a due date. Shared by the
/// iPhone General section and the Mac General pane; see `QuickAddDefaults` in CriaKit for the semantics.
struct QuickAddDefaultsRows: View {
    let model: SettingsModel
    /// Whether the account's settings can be saved (loaded, and not a link-share session).
    let canSave: Bool
    /// The iPhone rows carry a coloured icon; the Mac rows are plain.
    var icons = true

    private var defaults: QuickAddDefaults { model.general.quickAddDefaults }

    var body: some View {
        Group {
            Toggle(isOn: dueTimeOn) { rowLabel("Default due time", symbol: "clock.badge", token: .coral500) }
            if defaults.dueTime != nil {
                DatePicker(selection: dueTimeDate, displayedComponents: .hourAndMinute) { Text("Time") }
            }
            LabeledContent {
                remindersMenu
            } label: {
                rowLabel("Default reminders", symbol: "bell.badge", token: .marigold500)
            }
        }
        .disabled(!canSave)
    }

    @ViewBuilder
    private func rowLabel(_ title: String, symbol: String, token: ThemeToken) -> some View {
        if icons {
            SettingsLabel(title, symbol: symbol, token: token)
        } else {
            Text(title)
        }
    }

    // MARK: Due time

    private var dueTimeOn: Binding<Bool> {
        Binding(
            get: { defaults.dueTime != nil },
            set: { on in
                let time = on ? (defaults.dueTime ?? DefaultDueTime(hour: 9, minute: 0)) : nil
                Task { await model.setDefaultDueTime(time) }
            }
        )
    }

    private var dueTimeDate: Binding<Date> {
        Binding(
            get: { (defaults.dueTime ?? DefaultDueTime(hour: 9, minute: 0))?.date() ?? Date() },
            set: { date in
                let parts = Calendar.cria.dateComponents([.hour, .minute], from: date)
                guard let time = DefaultDueTime(hour: parts.hour ?? 9, minute: parts.minute ?? 0) else { return }
                Task { await model.setDefaultDueTime(time) }
            }
        )
    }

    // MARK: Reminders

    private var remindersMenu: some View {
        Menu {
            ForEach(QuickAddDefaults.options(including: defaults.reminderPeriods), id: \.self) { period in
                Toggle(QuickAddDefaults.title(forPeriod: period), isOn: reminderBinding(period))
            }
        } label: {
            Text(summary)
        }
    }

    private var summary: String {
        let held = defaults.reminderPeriods
        let periods = QuickAddDefaults.options(including: held).filter { held.contains($0) }
        return periods.isEmpty ? "None" : periods.map { QuickAddDefaults.title(forPeriod: $0) }.joined(separator: ", ")
    }

    private func reminderBinding(_ period: Int) -> Binding<Bool> {
        Binding(
            get: { defaults.reminderPeriods.contains(period) },
            set: { on in
                var held = Set(defaults.reminderPeriods)
                if on { held.insert(period) } else { held.remove(period) }
                let next = QuickAddDefaults.options(including: Array(held)).filter { held.contains($0) }
                Task { await model.setDefaultReminders(next) }
            }
        )
    }
}
