import CriaKit
import SwiftUI

private let kindTitles: [String: String] = [
    "subtask": "Subtask", "parenttask": "Parent task", "related": "Related", "blocking": "Blocking",
    "blocked": "Blocked by", "duplicates": "Duplicates", "duplicateof": "Duplicate of", "precedes": "Precedes",
    "follows": "Follows", "copiedfrom": "Copied from", "copiedto": "Copied to"
]

/// Subtasks, parent and other relations of a task. Add and remove write through the store and queue the server call.
/// A related task that exists locally opens on tap, as in the web client.
struct RelationsSection: View {
    let services: AppServices
    let taskLocalId: String
    let relations: [RelationRecord]
    let state: TaskDetailPresentation

    var body: some View {
        Section("Relations") {
            ForEach(relations, id: \.identity) { relation in
                Group {
                    if let otherId = relation.otherTaskLocalId {
                        NavigationLink(value: Route.task(otherId)) { relationLabel(relation) }
                    } else {
                        relationLabel(relation)
                    }
                }
                .swipeActions {
                    Button("Remove", role: .destructive) {
                        state.attempt { try services.store.removeRelation(taskLocalId: taskLocalId, relation: relation) }
                    }
                }
            }
            Button("Add relation", systemImage: "link.badge.plus") { state.addingRelation = true }
        }
    }

    private func relationLabel(_ relation: RelationRecord) -> some View {
        HStack {
            Image(systemName: relation.otherDone ? "checkmark.circle.fill" : "circle")
            VStack(alignment: .leading) {
                Text(relation.otherTitle)
                Text(kindTitles[relation.kind] ?? relation.kind).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
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
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                Picker("Kind", selection: $kind) {
                    ForEach(TaskRelationKind.pickable, id: \.self) { Text(kindTitles[$0.rawValue] ?? $0.rawValue).tag($0) }
                }
                ForEach(filtered, id: \.localId) { task in
                    Button(task.title) { add(task) }
                }
            }
                .criaSurface()
            .searchable(text: $search)
            .navigationTitle("Add relation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { candidates = (try? services.store.tasks(matching: TaskQuery(includeDone: false))) ?? [] }
            .alert("Could not add relation", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
    }

    private func add(_ task: TaskRecord) {
        do {
            try services.store.addRelation(taskLocalId: taskLocalId, otherTaskLocalId: task.localId, kind: kind)
            dismiss()
        } catch {
            failure = String(describing: error)
        }
    }

    private var filtered: [TaskRecord] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return candidates.filter { $0.localId != taskLocalId && (needle.isEmpty || $0.title.lowercased().contains(needle)) }
            .prefix(50).map { $0 }
    }
}
