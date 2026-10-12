import CriaKit
import SwiftUI

/// A date row: calendar icon, then the date and time as separate pills (a compact picker draws each). "Add" until a
/// date is set; the trailing menu then removes the time or the whole date (`onChange("")` clears it).
struct DateFieldRow: View {
    let title: String
    let iso: String?
    let onChange: (String) -> Void

    var body: some View {
        HStack(spacing: 8) {
            Label(title, systemImage: "calendar")
            Spacer(minLength: 8)
            if let iso, let current = DueDates.pickerDate(iso) {
                let timed = DueDates.hasTimeOfDay(iso)
                DatePicker("\(title) date", selection: Binding(get: { current }, set: { write($0, timed: timed) }),
                           displayedComponents: [.date])
                    .labelsHidden()
                if timed {
                    DatePicker("\(title) time", selection: Binding(get: { current }, set: { write($0, timed: true) }),
                               displayedComponents: [.hourAndMinute])
                        .labelsHidden()
                } else {
                    Button("Add time") { setTimed(current: current) }
                        .font(Theme.chip)
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .controlSize(.small)
                }
                removeMenu(current: current, timed: timed)
            } else {
                Button("Add") { onChange(DueDates.allDayISO(for: Date())) }
                    .font(Theme.chip)
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                    .tint(Color(.primary))
            }
        }
    }

    private func removeMenu(current: Date, timed: Bool) -> some View {
        Menu {
            if timed {
                Button("Remove time", systemImage: "clock.badge.xmark") { write(current, timed: false) }
            }
            Button("Remove date", systemImage: "calendar.badge.minus", role: .destructive) { onChange("") }
        } label: {
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(Color(.mutedForeground))
                .frame(minWidth: 28, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(title.lowercased()) date")
    }

    private func write(_ date: Date, timed: Bool) {
        onChange(timed ? DueDates.timedISO(date) : DueDates.allDayISO(for: date))
    }

    private func setTimed(current: Date) {
        let nine = Calendar.cria.date(bySettingHour: 9, minute: 0, second: 0, of: current) ?? current
        write(nine, timed: true)
    }
}

struct FlowLabels: View {
    let labels: [LabelRecord]

    var body: some View {
        if labels.isEmpty {
            Text("No labels").foregroundStyle(Color(.mutedForeground))
        } else {
            HStack {
                ForEach(labels, id: \.localId) { label in
                    CriaChip(text: label.title, systemImage: "tag", tint: Color(hexString: label.hexColor) ?? Color(.info))
                }
            }
        }
    }
}

/// Toggle existing labels on the task, or create one by typing its name.
struct LabelPickerSheet: View {
    let services: AppServices
    let taskLocalId: String
    let selected: [LabelRecord]
    let all: [LabelRecord]
    @Environment(\.dismiss) private var dismiss
    @State private var newTitle = ""
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("New label", text: $newTitle).submitLabel(.done).onSubmit(create)
                        Button("Add", action: create).disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                Section {
                    ForEach(all, id: \.localId) { label in
                        Button {
                            do {
                                try services.store.toggleTaskLabel(taskLocalId: taskLocalId, labelLocalId: label.localId)
                            } catch {
                                failure = String(describing: error)
                            }
                        } label: {
                            HStack {
                                Text(label.title).foregroundStyle(Color(.foreground))
                                Spacer()
                                if selected.contains(where: { $0.localId == label.localId }) {
                                    Image(systemName: "checkmark").foregroundStyle(Color(.primary))
                                }
                            }
                        }
                    }
                }
            }
                .criaSurface()
            .navigationTitle("Labels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func create() {
        let name = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        do {
            try services.store.applyLabels(byTitle: [name], toTask: taskLocalId)
            newTitle = ""
        } catch {
            failure = String(describing: error)
        }
    }
}
