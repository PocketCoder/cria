import CriaKit
import SwiftUI

/// The board's card filter: text, minimum priority, labels and whether done cards show. It only hides cards on this
/// device, and each board remembers its own. Ported from `KanbanFilterPopup.tsx`.
struct KanbanFilterSheet: View {
    @Binding var filter: BoardFilter
    let labels: [LabelRecord]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Search") {
                    TextField("Title or description", text: $filter.text)
                        .submitLabel(.done)
                        .autocorrectionDisabled()
                }
                Section {
                    Picker("Minimum priority", selection: $filter.minPriority) {
                        Text("Any").tag(0)
                        ForEach(1..<TableCells.priorityNames.count, id: \.self) { Text(TableCells.priorityNames[$0]).tag($0) }
                    }
                }
                if !labels.isEmpty { labelSection }
                Section {
                    Toggle("Show done tasks", isOn: $filter.showDone)
                }
                if filter.isActive {
                    Section {
                        Button("Clear filters", role: .destructive) { filter = .empty }
                    }
                }
            }
            .criaSurface()
            .navigationTitle("Filter cards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    /// A card shows when it carries any of the ticked labels.
    private var labelSection: some View {
        Section {
            ForEach(labels, id: \.localId) { label in
                let ticked = filter.labelLocalIds.contains(label.localId)
                Button {
                    if ticked {
                        filter.labelLocalIds.removeAll { $0 == label.localId }
                    } else {
                        filter.labelLocalIds.append(label.localId)
                    }
                } label: {
                    HStack {
                        Circle()
                            .fill(Color(hexString: label.hexColor) ?? Color(.mutedForeground))
                            .frame(width: 10, height: 10)
                            .accessibilityHidden(true)
                        Text(label.title).foregroundStyle(Color(.foreground))
                        Spacer()
                        if ticked { Image(systemName: "checkmark").foregroundStyle(Color(.primary)).accessibilityHidden(true) }
                    }
                }
                .accessibilityAddTraits(ticked ? .isSelected : [])
            }
        } header: {
            Text("Labels")
        } footer: {
            Text("Shows cards with any of the labels you tick.")
        }
    }
}
