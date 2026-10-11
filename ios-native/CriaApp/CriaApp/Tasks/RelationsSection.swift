import CriaKit
import SwiftUI

private let kindTitles: [String: String] = [
    "subtask": "Subtask", "parenttask": "Parent task", "related": "Related", "blocking": "Blocking",
    "blocked": "Blocked by", "duplicates": "Duplicates", "duplicateof": "Duplicate of", "precedes": "Precedes",
    "follows": "Follows", "copiedfrom": "Copied from", "copiedto": "Copied to"
]

/// Subtasks, parent and other relations of a task. Add and remove write through the store and queue the server call.
struct RelationsSection: View {
    let services: AppServices
    let taskLocalId: String
    @State private var live: LiveValue<[RelationRecord]>
    @State private var showPicker = false

    init(services: AppServices, taskLocalId: String) {
        self.services = services
        self.taskLocalId = taskLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks]) { reading in
                try reading.relations(forTask: taskLocalId)
            }
        })
    }

    var body: some View {
        Section("Relations") {
            ForEach(live.value, id: \.identity) { relation in
                HStack {
                    Image(systemName: relation.otherDone ? "checkmark.circle.fill" : "circle")
                    VStack(alignment: .leading) {
                        Text(relation.otherTitle)
                        Text(kindTitles[relation.kind] ?? relation.kind).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .swipeActions {
                    Button("Remove", role: .destructive) {
                        try? services.store.removeRelation(taskLocalId: taskLocalId, relation: relation)
                    }
                }
            }
            Button("Add relation", systemImage: "link.badge.plus") { showPicker = true }
        }
        .task { await live.run() }
        .sheet(isPresented: $showPicker) {
            RelationPickerSheet(services: services, taskLocalId: taskLocalId)
        }
    }
}

extension RelationRecord {
    /// Stable row identity: a kind can repeat, a peer can repeat, the pair cannot.
    var identity: String { "\(kind):\(otherTaskLocalId ?? String(otherTaskServerId ?? 0))" }
}

/// Pick a relation kind and the other task.
struct RelationPickerSheet: View {
    let services: AppServices
    let taskLocalId: String
    @Environment(\.dismiss) private var dismiss
    @State private var kind = TaskRelationKind.subtask
    @State private var search = ""
    @State private var candidates: [TaskRecord] = []

    var body: some View {
        NavigationStack {
            List {
                Picker("Kind", selection: $kind) {
                    ForEach(TaskRelationKind.pickable, id: \.self) { Text(kindTitles[$0.rawValue] ?? $0.rawValue).tag($0) }
                }
                ForEach(filtered, id: \.localId) { task in
                    Button(task.title) {
                        try? services.store.addRelation(taskLocalId: taskLocalId, otherTaskLocalId: task.localId, kind: kind)
                        dismiss()
                    }
                }
            }
            .searchable(text: $search)
            .navigationTitle("Add relation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { candidates = (try? services.store.tasks(matching: TaskQuery(includeDone: false))) ?? [] }
        }
    }

    private var filtered: [TaskRecord] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return candidates.filter { $0.localId != taskLocalId && (needle.isEmpty || $0.title.lowercased().contains(needle)) }
            .prefix(50).map { $0 }
    }
}
