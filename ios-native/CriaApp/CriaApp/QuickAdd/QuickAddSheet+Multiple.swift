import CriaKit
import SwiftUI

/// Adding one task, or several: in multiple mode Return queues the typed task (with its date, labels and reminders)
/// and send adds every queued one, subtasks linked to the task above them.
extension QuickAddSheet {
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
    func buildItem() -> QuickAddBatchItem? {
        let result = parsed
        // A due date picked by hand wins over the one a typed time range or duration came with.
        let typedSpan = !(picked.contains(.due) && result.startDate != nil)
        let fields = QuickAddFields(
            dueDate: dueISO.isEmpty ? nil : dueISO, priority: priority,
            repeatAfter: result.repeatAfter, repeatMode: result.repeatMode,
            startDate: typedSpan ? result.startDate : nil, endDate: typedSpan ? result.endDate : nil
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
            reminders: reminders + result.reminders, subtaskTitles: subtasks + [subtaskLine]
        )
    }

    func submit() {
        guard let item = buildItem() else { return }
        do {
            try services.store.persistQuickAddBatch([item])
            if addAnother { startNext(added: "Added ‘\(item.input.title)’") } else { closeSheet() }
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// Adds the typed task to the list and clears the form for the next one.
    func queueCurrent() {
        guard canSubmit, let item = buildItem() else { return }
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
            if addAnother { startNext(added: "Added \(created.count) task\(created.count == 1 ? "" : "s")") } else { closeSheet() }
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
        subtasks = []
        subtaskLine = ""
        addingSubtask = false
        if let message { addedTitle = message }
        focused = .title
    }

    var multipleToggle: some View {
        Button { multiple.toggle() } label: {
            Image(systemName: "list.bullet")
                .font(.body.weight(.semibold))
                .frame(width: Theme.roundButton, height: Theme.roundButton)
                .foregroundStyle(multiple ? Color(.primaryForeground) : Color(.primary))
                .background(multiple ? Color(.primary) : Color(.primarySoft), in: Circle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: multiple)
        .accessibilityLabel("Add several tasks")
        .accessibilityAddTraits(multiple ? .isSelected : [])
    }

    /// The subtasks typed for this task, then a field for the next one: Return adds it and keeps the field open.
    @ViewBuilder var subtaskSection: some View {
        ForEach(Array(subtasks.enumerated()), id: \.offset) { index, title in
            HStack(spacing: 8) {
                Image(systemName: "arrow.turn.down.right").font(.caption).foregroundStyle(Color(.mutedForeground))
                    .accessibilityHidden(true)
                Text(title).font(Theme.rowSubtitle).lineLimit(1)
                Spacer(minLength: 4)
                Button {
                    withAnimation(.snappy) { _ = subtasks.remove(at: index) }
                } label: {
                    Image(systemName: "xmark").frame(width: 28, height: 28)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(Color(.mutedForeground))
                .accessibilityLabel("Remove subtask \(title)")
            }
        }
        if addingSubtask {
            HStack(spacing: 8) {
                Image(systemName: "arrow.turn.down.right").font(.caption).foregroundStyle(Color(.mutedForeground))
                    .accessibilityHidden(true)
                TextField("Subtask", text: $subtaskLine)
                    .font(Theme.rowSubtitle)
                    .focused($focused, equals: .subtask)
                    .submitLabel(.next)
                    .onSubmit(addSubtaskLine)
            }
        } else {
            Button {
                addingSubtask = true
                focused = .subtask
            } label: {
                Label("Add subtask", systemImage: "plus").font(Theme.caption)
            }
            .buttonStyle(.borderless)
            .foregroundStyle(Color(.primary))
        }
    }

    /// Return in the subtask field: keeps the title and stays in the field for the next; an empty Return goes back
    /// to the task name.
    func addSubtaskLine() {
        let title = subtaskLine.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            addingSubtask = false
            focused = .title
            return
        }
        withAnimation(.snappy) { subtasks.append(title) }
        subtaskLine = ""
        // Return ends editing; take the focus back for the next subtask.
        Task { @MainActor in focused = .subtask }
    }
}

/// A task waiting in quick add's list.
struct QueuedQuickAdd: Identifiable {
    let id = UUID()
    var item: QuickAddBatchItem
}

/// The queued tasks above the field, each with its subtask count. Any can be removed.
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
        HStack(spacing: 8) {
            Image(systemName: "circle")
                .font(.caption)
                .foregroundStyle(Color(.mutedForeground))
                .accessibilityHidden(true)
            Text(entry.item.input.title).font(Theme.rowSubtitle).lineLimit(1)
            let subtaskCount = entry.item.subtaskTitles.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count
            if subtaskCount > 0 {
                Text("\(subtaskCount) subtask\(subtaskCount == 1 ? "" : "s")").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
            Spacer(minLength: 4)
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
