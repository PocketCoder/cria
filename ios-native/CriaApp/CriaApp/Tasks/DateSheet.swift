import CriaKit
import SwiftUI

/// A task's repeat interval and mode, as the date sheet edits them alongside the due date.
struct RepeatValue: Equatable {
    var after: Int
    var mode: Int
}

/// The date sheet, in the Todoist style: type a date, tap a preset day or a calendar day, then set an optional time
/// and (for the due date) the repeat. A preset or a typed date saves at once; a calendar day saves on the tick.
/// `onDone("")` clears the date.
struct DateSheet: View {
    let title: String
    let iso: String?
    /// Nil hides the Repeat row: start and end dates do not repeat.
    var repeatValue: RepeatValue?
    let onDone: (_ iso: String, _ repeatValue: RepeatValue?) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dateDisplay) private var dateDisplay
    @State private var typed = ""
    @State private var day: Date?
    /// Only the hour and minute are read.
    @State private var time: Date?
    @State private var editingTime = false
    @State private var repeatChoice: RepeatValue?
    @State private var didLoad = false

    var body: some View {
        NavigationStack {
            List {
                typeSection
                Section {
                    ForEach(QuickAddDatePreset.allCases, id: \.self) { presetRow($0) }
                    if iso != nil {
                        Button(role: .destructive) { finish("") } label: {
                            Label("No date", systemImage: "calendar.badge.minus")
                        }
                    }
                }
                Section {
                    DatePicker(
                        "Day", selection: Binding(get: { day ?? Calendar.cria.startOfDay(for: Date()) }, set: { day = $0 }),
                        displayedComponents: .date
                    )
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                }
                Section {
                    timeRows
                    if repeatChoice != nil { repeatRow }
                }
            }
            .criaSurface()
            .contentMargins(.top, 8, for: .scrollContent)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", systemImage: "checkmark") { finish(composedISO) }
                        .disabled(day == nil)
                }
            }
        }
        .presentationDetents([.large])
        .onAppear(perform: load)
    }

    @ViewBuilder private var typeSection: some View {
        Section {
            TextField("Type a date", text: $typed)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.done)
                .onSubmit(applyTyped)
            if let typedISO {
                Button(action: applyTyped) {
                    Label(DueDates.label(typedISO, now: Date(), display: dateDisplay), systemImage: "return")
                }
            } else if !typed.trimmingCharacters(in: .whitespaces).isEmpty {
                Text("Try “fri 5pm”, “next week” or “30 May”")
                    .font(Theme.caption)
                    .foregroundStyle(Color(.mutedForeground))
            }
        }
    }

    private func presetRow(_ preset: QuickAddDatePreset) -> some View {
        let presetDay = DueDates.calendarDate(preset.iso(now: Date())) ?? Date()
        return Button {
            day = presetDay
            finish(composedISO)
        } label: {
            HStack {
                Label { Text(preset.title).foregroundStyle(Color(.foreground)) } icon: {
                    Image(systemName: preset.symbol).foregroundStyle(preset.tint)
                }
                Spacer()
                Text(presetDay.formatted(.dateTime.weekday(.abbreviated)))
                    .foregroundStyle(Color(.mutedForeground))
            }
        }
    }

    @ViewBuilder private var timeRows: some View {
        Button {
            withAnimation(.snappy) {
                editingTime.toggle()
                if editingTime && time == nil { time = Self.nine }
            }
        } label: {
            HStack {
                Label("Time", systemImage: "clock").foregroundStyle(Color(.foreground))
                Spacer()
                Text(time.map { DueDates.timeLabel($0, display: dateDisplay) } ?? "None")
                    .foregroundStyle(Color(.mutedForeground))
                Image(systemName: "chevron.right")
                    .font(Theme.caption)
                    .foregroundStyle(Color(.mutedForeground))
                    .rotationEffect(.degrees(editingTime ? 90 : 0))
            }
        }
        if editingTime {
            DatePicker("Time", selection: Binding(get: { time ?? Self.nine }, set: { time = $0 }),
                       displayedComponents: .hourAndMinute)
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(maxWidth: .infinity)
            Button("Remove time", role: .destructive) {
                withAnimation(.snappy) {
                    time = nil
                    editingTime = false
                }
            }
        }
    }

    private var repeatRow: some View {
        let current = repeatChoice.map { RepeatChoice(repeatAfter: $0.after, repeatMode: $0.mode) } ?? .never
        return Picker(selection: Binding<RepeatChoice>(get: { current }, set: { choice in
            guard RepeatChoice.presets.contains(choice) else { return }
            repeatChoice = RepeatValue(after: choice.repeatAfter, mode: choice.repeatMode)
        })) {
            ForEach(RepeatChoice.presets) { Text($0.title).tag($0) }
            if current == .custom, let value = repeatChoice {
                Text(RepeatLabel.label(repeatAfter: value.after, repeatMode: value.mode)).tag(RepeatChoice.custom)
            }
        } label: {
            Label("Repeat", systemImage: "repeat")
        }
    }

    private var typedISO: String? {
        let text = typed.trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : parseDatePhrase(text)
    }

    /// The chosen day, with the time when one is set.
    private var composedISO: String {
        guard let day else { return "" }
        guard let time else { return DueDates.allDayISO(for: day) }
        let calendar = Calendar.cria
        let parts = calendar.dateComponents([.hour, .minute], from: time)
        let timed = calendar.date(bySettingHour: parts.hour ?? 9, minute: parts.minute ?? 0, second: 0, of: day) ?? day
        return DueDates.timedISO(timed)
    }

    /// 09:00 today: where a newly added time starts.
    private static var nine: Date {
        Calendar.cria.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    }

    /// A typed phrase sets the day, and the time when it names one ("fri 5pm"); a phrase with no time keeps the time
    /// already chosen.
    private func applyTyped() {
        guard let parsed = typedISO, let date = DueDates.pickerDate(parsed) else { return }
        day = date
        if DueDates.hasTimeOfDay(parsed) { time = date }
        finish(composedISO)
    }

    private func load() {
        guard !didLoad else { return }
        didLoad = true
        repeatChoice = repeatValue
        guard let iso, let date = DueDates.pickerDate(iso) else { return }
        day = date
        if DueDates.hasTimeOfDay(iso) { time = date }
    }

    private func finish(_ value: String) {
        onDone(value, repeatChoice)
        dismiss()
    }
}

extension QuickAddDatePreset {
    var symbol: String {
        switch self {
        case .today: return "star"
        case .tomorrow: return "sun.max"
        case .thisWeekend: return "sofa"
        case .nextWeek: return "arrow.forward.square"
        }
    }

    var tint: Color {
        switch self {
        case .today: return Color(.success)
        case .tomorrow: return Color(.marigold700)
        case .thisWeekend: return Color(.info)
        case .nextWeek: return Color(.primary)
        }
    }
}

/// A compact row for a date field: icon, title, then the value (or "None") in the trailing column. Tapping opens the
/// date sheet. Every date row is this one height.
struct DateValueRow: View {
    let title: String
    let systemImage: String
    let iso: String?
    let action: () -> Void
    @Environment(\.dateDisplay) private var dateDisplay

    var body: some View {
        Button(action: action) {
            HStack {
                Label(title, systemImage: systemImage).foregroundStyle(Color(.foreground))
                Spacer()
                Text(valueText)
                    .foregroundStyle(valueColour)
                    .lineLimit(1)
            }
        }
        .accessibilityValue(valueText)
    }

    private var valueText: String {
        guard let iso, !iso.isEmpty else { return "None" }
        return DueDates.label(iso, now: Date(), display: dateDisplay)
    }

    private var valueColour: Color {
        guard let iso, !iso.isEmpty else { return Color(.mutedForeground) }
        return DueDates.isOverdue(iso, now: Date()) ? Color(.destructive) : Color(.primary)
    }
}
