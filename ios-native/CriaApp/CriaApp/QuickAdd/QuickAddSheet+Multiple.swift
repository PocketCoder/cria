import CriaKit
import SwiftUI

/// Adding one task, or several: in multiple mode Return queues the typed task (with its date, labels and reminders)
/// and send adds every queued one, subtasks linked to the task above them.
extension QuickAddSheet {
    /// Whether a queued task can take a subtask.
    var hasQueuedParent: Bool { queue.contains { !$0.item.isSubtask } }

    var canSend: Bool { canSubmit || !queue.isEmpty }

    var sendLabel: String {
        let count = queue.count + (canSubmit ? 1 : 0)
        if count > 1 || multiple { return "Add \(count) task\(count == 1 ? "" : "s")" }
        return addAnother ? "Add and keep open" : "Add task"
    }

    func returnPressed() {
        if multiple {
            queueCurrent()
        } else if queue.isEmpty {
            submit()
        } else {
            submitAll()
        }
    }

    func sendPressed() {
        if multiple || !queue.isEmpty { submitAll() } else { submit() }
    }

    /// The typed task with everything set for it, or nil (with the reason shown) when it has nowhere to go.
    func buildItem(isSubtask: Bool = false) -> QuickAddBatchItem? {
        let result = parsed
        let fields = QuickAddFields(
            dueDate: dueISO.isEmpty ? nil : dueISO, priority: priority,
            repeatAfter: result.repeatAfter, repeatMode: result.repeatMode
        )
        guard var input = buildQuickAddInput(
            title: result.title, projectTitle: typedProjectTitle, projects: projects,
            selectedProjectId: projectId.isEmpty ? nil : projectId, fallbackProjectId: baseProjectId, fields: fields
        ) else {
            errorMessage = "Choose a project first."
            return nil
        }
        let description = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !description.isEmpty { input.description = Self.paragraphHTML(description) }
        return QuickAddBatchItem(
            input: input, labelTitles: labelTitles, assigneeUsernames: result.assigneeUsernames,
            reminders: reminders + result.reminders, isSubtask: isSubtask
        )
    }

    func submit() {
        guard let item = buildItem() else { return }
        do {
            try services.store.persistQuickAdd(
                item.input, labelTitles: item.labelTitles, assigneeUsernames: item.assigneeUsernames, reminders: item.reminders
            )
            if addAnother { startNext(added: "Added ‘\(item.input.title)’") } else { dismiss() }
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// Adds the typed task to the list and clears the form for the next one.
    func queueCurrent() {
        guard canSubmit, let item = buildItem(isSubtask: nextIsSubtask && hasQueuedParent) else { return }
        withAnimation(.snappy) { queue.append(QueuedQuickAdd(item: item)) }
        startNext(added: nil)
    }

    /// Queues what is typed, then adds every queued task.
    func submitAll() {
        if canSubmit {
            errorMessage = nil
            queueCurrent()
            guard errorMessage == nil else { return }
        }
        guard !queue.isEmpty else { return }
        do {
            let created = try services.store.persistQuickAddBatch(queue.map(\.item))
            queue = []
            nextIsSubtask = false
            if addAnother { startNext(added: "Added \(created.count) task\(created.count == 1 ? "" : "s")") } else { dismiss() }
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// Clears the form for the next task, keeping the project, as desktop's add-and-keep-open does.
    func startNext(added message: String?) {
        skipNextFollow = true
        line = ""
        priority = 0
        dueISO = ""
        labelTitles = []
        reminders = []
        picked.subtract([.due, .priority])
        errorMessage = nil
        note = ""
        if let message { addedTitle = message }
        focused = .title
    }

    var multipleToggle: some View {
        Button { multiple.toggle() } label: {
            Image(systemName: "list.bullet")
                .font(.body.weight(.semibold))
                .frame(width: 40, height: 40)
                .foregroundStyle(multiple ? Color(.primaryForeground) : Color(.primary))
                .background(multiple ? Color(.primary) : Color(.primarySoft), in: Circle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: multiple)
        .accessibilityLabel("Add several tasks")
        .accessibilityAddTraits(multiple ? .isSelected : [])
    }

    var subtaskChip: some View {
        Button { nextIsSubtask.toggle() } label: {
            CriaChip(
                text: "Subtask", systemImage: nextIsSubtask ? "checkmark" : "arrow.turn.down.right",
                tint: nextIsSubtask ? Color(.primary) : Color(.mutedForeground)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add as a subtask")
        .accessibilityAddTraits(nextIsSubtask ? .isSelected : [])
    }
}

/// A task waiting in quick add's list.
struct QueuedQuickAdd: Identifiable {
    let id = UUID()
    var item: QuickAddBatchItem
}

/// The queued tasks above the field. Each can be indented under the task above it, or removed.
struct QuickAddQueueList: View {
    @Binding var queue: [QueuedQuickAdd]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(queue.count) to add").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                Spacer()
                Button("Clear", role: .destructive) { withAnimation(.snappy) { queue = [] } }
                    .font(Theme.caption)
                    .buttonStyle(.borderless)
            }
            if queue.count > 4 {
                ScrollView { rows }.frame(height: 150)
            } else {
                rows
            }
        }
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(queue.enumerated()), id: \.element.id) { index, entry in
                row(index, entry)
            }
        }
    }

    private func row(_ index: Int, _ entry: QueuedQuickAdd) -> some View {
        let isSubtask = entry.item.isSubtask
        return HStack(spacing: 8) {
            Image(systemName: isSubtask ? "arrow.turn.down.right" : "circle")
                .font(.caption)
                .foregroundStyle(Color(.mutedForeground))
                .padding(.leading, isSubtask ? 18 : 0)
                .accessibilityHidden(true)
            Text(entry.item.input.title).font(Theme.rowSubtitle).lineLimit(1)
            Spacer(minLength: 4)
            Button {
                withAnimation(.snappy) { queue[index].item.isSubtask.toggle() }
            } label: {
                Image(systemName: isSubtask ? "decrease.indent" : "increase.indent").frame(width: 32, height: 28)
            }
            // The first task has nothing above it to belong to.
            .disabled(index == 0 && !isSubtask)
            .accessibilityLabel(isSubtask ? "Make it a task" : "Make it a subtask")
            Button {
                withAnimation(.snappy) { _ = queue.remove(at: index) }
            } label: {
                Image(systemName: "xmark").frame(width: 28, height: 28)
            }
            .accessibilityLabel("Remove \(entry.item.input.title)")
        }
        .buttonStyle(.borderless)
        .foregroundStyle(Color(.foreground))
    }
}
