import CriaKit
import SwiftUI

/// A date row: calendar icon, then the date and time as separate pills (a compact picker draws each). "Add" until a
/// date is set; the trailing menu then removes the time or the whole date (`onChange("")` clears it).
struct DateFieldRow: View {
    let title: String
    let iso: String?
    let onChange: (String) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // At accessibility sizes the pills drop under the title instead of squeezing beside it.
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            Label(title, systemImage: "calendar")
            if !stacked { Spacer(minLength: 8) }
            HStack(spacing: 8) { controls }
        }
        .padding(.vertical, stacked ? 8 : 0)
        .frame(minHeight: 56)
    }

    @ViewBuilder private var controls: some View {
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
                    .accessibilityLabel("Add \(title.lowercased()) time")
                    .font(Theme.chip)
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
            }
            removeMenu(current: current, timed: timed)
        } else {
            Button("Add") { onChange(DueDates.allDayISO(for: Date())) }
                .accessibilityLabel("Add \(title.lowercased()) date")
                .font(Theme.chip)
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(Color(.primary))
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
                .accessibilityHidden(true)
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
            // A row while it fits, else one label per line (many labels, or accessibility text sizes).
            ViewThatFits(in: .horizontal) {
                HStack { chips }
                VStack(alignment: .leading, spacing: 6) { chips }
            }
        }
    }

    private var chips: some View {
        ForEach(labels, id: \.localId) { label in
            CriaChip(text: label.title, systemImage: "tag", tint: Color(hexString: label.hexColor) ?? Color(.info))
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
                                        .accessibilityHidden(true)
                                }
                            }
                        }
                        .accessibilityAddTraits(selected.contains(where: { $0.localId == label.localId }) ? .isSelected : [])
                    }
                }
            }
                .criaSurface()
            .navigationTitle("Labels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .errorHaptic(failure)
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
