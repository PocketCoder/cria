import CriaKit
import SwiftUI

/// What the label picker reads: the task's labels and every label.
private struct TableLabelData: Equatable, Sendable {
    var selected: [LabelRecord] = []
    var all: [LabelRecord] = []
}

/// Presents the picker for a cell edited in place: the labels sheet, the people on a task, or the date sheet.
struct TableCellEditSheet: View {
    let services: AppServices
    let edit: TableCellEdit
    let onFailure: (String) -> Void

    var body: some View {
        switch edit {
        case .labels(let taskId): TableLabelsEditor(services: services, taskLocalId: taskId)
        case .assignees(let taskId): TableAssigneesEditor(services: services, taskLocalId: taskId)
        case .date(let taskId, let field): TableDateEditor(services: services, taskLocalId: taskId, field: field, onFailure: onFailure)
        }
    }
}

/// The task's labels as the task screen's label sheet, kept live as labels are toggled.
private struct TableLabelsEditor: View {
    let services: AppServices
    let taskLocalId: String
    @State private var live: LiveValue<TableLabelData>

    init(services: AppServices, taskLocalId: String) {
        self.services = services
        self.taskLocalId = taskLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: TableLabelData()) {
            observeStore(store, kinds: [.tasks, .labels]) { reading in
                TableLabelData(selected: try reading.labels(forTask: taskLocalId), all: try reading.labels())
            }
        })
    }

    var body: some View {
        LabelPickerSheet(services: services, taskLocalId: taskLocalId, selected: live.value.selected, all: live.value.all)
            .task { await live.run() }
    }
}

/// The task's assignees, with swipe to remove and Assign… for the people search.
private struct TableAssigneesEditor: View {
    let services: AppServices
    let taskLocalId: String
    @State private var live: LiveValue<[AssigneeRecord]>
    @State private var picking = false
    @State private var failure: String?
    @Environment(\.dismiss) private var dismiss
    /// A share link cannot search for people, so it cannot add assignees.
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    init(services: AppServices, taskLocalId: String) {
        self.services = services
        self.taskLocalId = taskLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks]) { reading in try reading.assignees(forTask: taskLocalId) }
        })
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(live.value) { assignee in
                    AssigneeRow(name: AssigneesSection.name(assignee), detail: AssigneesSection.handle(assignee))
                        .swipeActions {
                            Button("Remove", systemImage: "person.badge.minus", role: .destructive) { remove(assignee) }
                        }
                        .accessibilityAction(named: "Remove") { remove(assignee) }
                }
                if !isLinkShare {
                    Button("Assign…", systemImage: "person.badge.plus") { picking = true }
                }
            }
            .criaSurface()
            .overlay {
                if live.value.isEmpty && isLinkShare {
                    ContentUnavailableView("No one assigned", systemImage: "person.slash")
                }
            }
            .navigationTitle("Assignees")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $picking) {
                AssigneePickerSheet(services: services, assigned: Set(live.value.map(\.userId))) { user in assign(user) }
            }
            .errorHaptic(failure)
            .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        .presentationDetents([.medium, .large])
        .task { await live.run() }
    }

    private func remove(_ assignee: AssigneeRecord) {
        do {
            try services.store.removeAssignee(taskLocalId: taskLocalId, userId: assignee.userId)
        } catch {
            failure = String(describing: error)
        }
    }

    private func assign(_ user: UserResponse) {
        do {
            try services.store.addAssignee(taskLocalId: taskLocalId, userId: user.id, username: user.username)
        } catch {
            failure = String(describing: error)
        }
    }
}

/// The Todoist-style date sheet for one of a task's dates. A cleared date is saved as an empty string.
private struct TableDateEditor: View {
    let services: AppServices
    let taskLocalId: String
    let field: TableDateField
    let onFailure: (String) -> Void

    private var task: TaskRecord? { try? services.store.task(localId: taskLocalId) }

    private func current(_ task: TaskRecord) -> String? {
        switch field {
        case .due: return task.dueDate
        case .start: return task.startDate
        case .end: return task.endDate
        }
    }

    var body: some View {
        if let task {
            let repeatValue = field == .due ? RepeatValue(after: task.repeatAfter, mode: task.repeatMode) : nil
            DateSheet(title: field.title, iso: current(task), repeatValue: repeatValue) { iso, chosenRepeat in
                var patch = TaskPatch()
                switch field {
                case .due: patch.dueDate = iso
                case .start: patch.startDate = iso
                case .end: patch.endDate = iso
                }
                if let chosenRepeat, chosenRepeat != repeatValue {
                    patch.repeatAfter = chosenRepeat.after
                    patch.repeatMode = chosenRepeat.mode
                }
                do {
                    _ = try services.store.updateTask(localId: taskLocalId, patch: patch)
                } catch {
                    onFailure(String(describing: error))
                }
            }
        }
    }
}
