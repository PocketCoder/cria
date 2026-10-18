import CriaKit
import SwiftUI

/// The Labels section's content: the task's labels and, on the Mac, the most used labels it does not carry yet as
/// one-click chips, so a common label needs no trip through the picker. iOS shows the labels only, as before.
struct TaskLabelsRows: View {
    let services: AppServices
    let taskLocalId: String
    let labels: [LabelRecord]
    #if os(macOS)
    @State private var popular: LiveValue<[LabelRecord]>
    @State private var failure: String?
    #endif

    init(services: AppServices, taskLocalId: String, labels: [LabelRecord]) {
        self.services = services
        self.taskLocalId = taskLocalId
        self.labels = labels
        #if os(macOS)
        let store = services.store
        _popular = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.labels, .tasks]) { try $0.popularLabels(excludingTask: taskLocalId) }
        })
        #endif
    }

    var body: some View {
        #if os(macOS)
        VStack(alignment: .leading, spacing: 10) {
            FlowLabels(labels: labels)
            if !popular.value.isEmpty { suggestions }
            if let failure {
                Text(failure).font(Theme.caption).foregroundStyle(Color(.destructive))
            }
        }
        .task { await popular.run() }
        #else
        FlowLabels(labels: labels)
        #endif
    }

    #if os(macOS)
    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Popular").font(Theme.caption.weight(.medium)).foregroundStyle(Color(.mutedForeground))
            ChipFlowLayout {
                ForEach(popular.value, id: \.localId) { label in
                    Button { add(label) } label: {
                        CriaChip(text: label.title, systemImage: "plus", tint: Color(hexString: label.hexColor) ?? Color(.info))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .help("Add \(label.title)")
                    .accessibilityLabel("Add label \(label.title)")
                }
            }
        }
    }

    private func add(_ label: LabelRecord) {
        do {
            try services.store.toggleTaskLabel(taskLocalId: taskLocalId, labelLocalId: label.localId)
            failure = nil
        } catch {
            failure = "Could not add the label: \(error)"
        }
    }
    #endif
}
