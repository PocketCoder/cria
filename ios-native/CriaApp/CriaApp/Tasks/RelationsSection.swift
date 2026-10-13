import CriaKit
import SwiftUI

private let kindTitles: [String: String] = [
    "subtask": "Subtask", "parenttask": "Parent task", "related": "Related", "blocking": "Blocking",
    "blocked": "Blocked by", "duplicates": "Duplicates", "duplicateof": "Duplicate of", "precedes": "Precedes",
    "follows": "Follows", "copiedfrom": "Copied from", "copiedto": "Copied to"
]

/// Subtasks, parent and other relations of a task. Add and remove write through the store and queue the server call.
/// A related task that exists locally opens on tap, as in the web client. Subtasks come first, each with its own
/// done toggle, and "Add subtask" creates one in place.
struct RelationsSection: View {
    let services: AppServices
    let taskLocalId: String
    let relations: [RelationRecord]
    let state: TaskDetailPresentation
    @State private var addingSubtask = false
    @State private var subtaskTitle = ""
    @State private var subtaskError: String?
    /// Completions per subtask row, so only the row that was completed plays the haptic.
    @State private var completions: [String: Int] = [:]
    @FocusState private var subtaskFocused: Bool

    var body: some View {
        Section {
            ForEach(ordered, id: \.identity) { relation in
                Group {
                    if let otherId = relation.otherTaskLocalId {
                        NavigationLink(value: Route.task(otherId)) { relationLabel(relation) }
                    } else {
                        relationLabel(relation)
                    }
                }
                .sensoryFeedback(.success, trigger: completions[relation.identity] ?? 0)
                .accessibilityActions {
                    // The tick inside a row that opens the task is not its own VoiceOver stop.
                    if relation.kind == "subtask", relation.otherTaskLocalId != nil {
                        Button(relation.otherDone ? "Mark not done" : "Complete") { toggleSubtask(relation) }
                    }
                }
                .swipeActions {
                    Button("Remove", role: .destructive) {
                        state.attempt { try services.store.removeRelation(taskLocalId: taskLocalId, relation: relation) }
                    }
                }
                .contextMenu { relationMenu(relation) }
            }
            if addingSubtask {
                subtaskField
            } else {
                Button("Add subtask", systemImage: "plus.circle") { addingSubtask = true }
            }
            suggestButton
            Button("Add relation", systemImage: "link.badge.plus") { state.addingRelation = true }
        } header: {
            Text("Relations")
        } footer: {
            if !relations.isEmpty { Text("Press and hold a relation to change its type or remove it.") }
        }
    }

    /// Change the type (Vikunja has no edit, so the store swaps the old relation for a new one) or remove it.
    @ViewBuilder
    private func relationMenu(_ relation: RelationRecord) -> some View {
        if relation.otherTaskLocalId != nil {
            Menu("Change type", systemImage: "arrow.triangle.swap") {
                ForEach(TaskRelationKind.pickable.filter { $0.rawValue != relation.kind }, id: \.self) { kind in
                    Button(kindTitles[kind.rawValue] ?? kind.rawValue) {
                        state.attempt { try services.store.changeRelationKind(taskLocalId: taskLocalId, relation: relation, to: kind) }
                    }
                }
            }
        }
        Button("Remove", systemImage: "trash", role: .destructive) {
            state.attempt { try services.store.removeRelation(taskLocalId: taskLocalId, relation: relation) }
        }
    }

    /// "Suggest subtasks" from the on-device model. Hidden where the device cannot run it; disabled, with the reason,
    /// while Apple Intelligence is off or still getting ready.
    @ViewBuilder
    private var suggestButton: some View {
        if AIStatus.shared.isOfferable {
            // Presented by the screen (TaskDetailSheets), not this lazily created row.
            Button("Suggest subtasks", systemImage: "sparkles") {
                state.existingSubtasks = relations.filter { $0.kind == "subtask" }.map(\.otherTitle)
                state.suggestingSubtasks = true
            }
            .disabled(AIStatus.shared.notReadyMessage != nil)
            if let reason = AIStatus.shared.notReadyMessage {
                Text(reason).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
        }
    }

    /// Subtasks first, then the other kinds in the store's order.
    private var ordered: [RelationRecord] {
        relations.filter { $0.kind == "subtask" } + relations.filter { $0.kind != "subtask" }
    }

    @ViewBuilder
    private var subtaskField: some View {
        HStack {
            Image(systemName: "circle").foregroundStyle(Color(.mutedForeground))
                .accessibilityHidden(true)
            TextField("Subtask title", text: $subtaskTitle)
                .focused($subtaskFocused)
                .submitLabel(.next)
                .onAppear { subtaskFocused = true }
                .onSubmit(createSubtask)
                // The separator starts under the text, not under the trailing button.
                .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            // Saves what was typed, then closes; it used to throw the title away.
            Button("Done") { finishSubtaskField() }
                .buttonStyle(.borderless)
        }
        if let subtaskError {
            Text(subtaskError).font(Theme.caption).foregroundStyle(Color(.destructive))
        }
    }

    /// Creates the subtask and keeps the field open for the next one. Return on an empty field closes it.
    private func createSubtask() {
        let title = subtaskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            closeSubtaskField()
            return
        }
        do {
            try services.store.createSubtask(parentLocalId: taskLocalId, title: title)
            subtaskTitle = ""
            subtaskError = nil
        } catch {
            subtaskError = "Could not add the subtask: \(error)"
        }
        // Return ends editing; take the focus back for the next title.
        Task { @MainActor in subtaskFocused = true }
    }

    private func finishSubtaskField() {
        let title = subtaskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty {
            do {
                try services.store.createSubtask(parentLocalId: taskLocalId, title: title)
            } catch {
                subtaskError = "Could not add the subtask: \(error)"
                return
            }
        }
        closeSubtaskField()
    }

    private func closeSubtaskField() {
        addingSubtask = false
        subtaskTitle = ""
        subtaskError = nil
        subtaskFocused = false
    }

    private func relationLabel(_ relation: RelationRecord) -> some View {
        HStack {
            doneMark(relation)
            VStack(alignment: .leading) {
                Text(relation.otherTitle)
                    .strikethrough(relation.kind == "subtask" && relation.otherDone)
                Text(kindTitles[relation.kind] ?? relation.kind).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(relation.otherTitle), \(kindTitles[relation.kind] ?? relation.kind)\(relation.otherDone ? ", done" : "")"
        )
    }

    private func toggleSubtask(_ relation: RelationRecord) {
        guard let otherId = relation.otherTaskLocalId else { return }
        if !relation.otherDone { completions[relation.identity, default: 0] += 1 }
        state.attempt { _ = try services.store.updateTask(localId: otherId, patch: TaskPatch(done: !relation.otherDone)) }
    }

    /// A subtask that exists locally gets a tappable done toggle; anything else only shows its state.
    @ViewBuilder
    private func doneMark(_ relation: RelationRecord) -> some View {
        let symbol = relation.otherDone ? "checkmark.circle.fill" : "circle"
        if relation.kind == "subtask", relation.otherTaskLocalId != nil {
            Button {
                toggleSubtask(relation)
            } label: {
                Image(systemName: symbol)
                    .foregroundStyle(relation.otherDone ? Color(.primary) : Color(.mutedForeground))
                    .frame(minWidth: 28, minHeight: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
        } else {
            Image(systemName: symbol)
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

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
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
