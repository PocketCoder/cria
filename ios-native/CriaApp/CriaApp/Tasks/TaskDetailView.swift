import CriaKit
import SwiftUI

struct TaskDetailData: Equatable, Sendable {
    var task: TaskRecord?
    var labels: [LabelRecord] = []
    var allLabels: [LabelRecord] = []
    var projects: [ProjectRecord] = []
    /// The task's own project, even when archived (the visible list leaves it out).
    var currentProject: ProjectRecord?
}

private let priorityNames = ["None", "Low", "Medium", "High", "Urgent", "Do now"]

/// Task detail. Every control writes through the store, so the change is saved locally at once and queued in the
/// outbox for the server. Text fields save when editing ends.
struct TaskDetailView: View {
    let services: AppServices
    let taskLocalId: String
    @State private var live: LiveValue<TaskDetailData>
    @State private var feeds: TaskDetailFeeds
    @State private var sheets = TaskDetailPresentation()
    @State private var title = ""
    /// The title as last loaded from the store. Only a difference from this is the user's edit, so a title that
    /// changed elsewhere (another device, a pull) is never written back over.
    @State private var loadedTitle = ""
    @State private var percentDraft: Double?
    @State private var didLoad = false
    @State private var showLabels = false
    @FocusState private var focus: Field?
    @Environment(\.dismiss) private var dismiss

    private enum Field: Hashable { case title }

    init(services: AppServices, taskLocalId: String) {
        self.services = services
        self.taskLocalId = taskLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: TaskDetailData()) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                let task = try reading.task(localId: taskLocalId)
                let all = try reading.projects()
                return TaskDetailData(
                    task: task,
                    labels: try reading.labels(forTask: taskLocalId),
                    allLabels: try reading.labels(),
                    projects: ProjectTree.visible(all),
                    currentProject: all.first { $0.localId == task?.projectLocalId }
                )
            }
        })
        _feeds = State(initialValue: TaskDetailFeeds(store: store, taskLocalId: taskLocalId))
    }

    var body: some View {
        Group {
            if let task = live.value.task {
                form(task)
            } else {
                ContentUnavailableView("Task not found", systemImage: "questionmark.circle")
            }
        }
        .navigationTitle(live.value.currentProject?.title ?? "Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let task = live.value.task {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(task.isFavorite ? "Unstar" : "Star", systemImage: task.isFavorite ? "star.fill" : "star") {
                        apply(TaskPatch(isFavorite: !task.isFavorite))
                    }
                    .tint(task.isFavorite ? Color(.warning) : nil)
                }
            }
        }
        // The section feeds run here, not on a Form row, so they keep updating whichever rows are on screen.
        .task { await live.run() }
        .task { await feeds.comments.run() }
        .task { await feeds.attachments.run() }
        .task { await feeds.relations.run() }
        .task { await feeds.reminders.run() }
        .task { await AIStatus.shared.refresh() }
        // The periodic pull does not fetch comments: read this task's thread once when the screen opens.
        .task { await services.refreshTaskDetail(localId: taskLocalId) }
        .onChange(of: live.value.task?.localId, initial: true) { _, _ in loadDrafts() }
        .onChange(of: focus) { _, _ in saveText() }
        .onChange(of: live.value.task?.title) { _, newTitle in followServerTitle(newTitle) }
        .onDisappear(perform: saveText)
        .sheet(isPresented: $showLabels) {
            LabelPickerSheet(services: services, taskLocalId: taskLocalId, selected: live.value.labels, all: live.value.allLabels)
        }
        .modifier(TaskDetailSheets(services: services, taskLocalId: taskLocalId, state: sheets))
        .modifier(TaskDetailDialogs(services: services, taskLocalId: taskLocalId, state: sheets, onDeleteTask: deleteTask))
    }

    private func form(_ task: TaskRecord) -> some View {
        Form {
            Section {
                HStack(alignment: .top) {
                    PriorityCheck(priority: task.priority, isDone: task.done, size: 26) { apply(TaskPatch(done: !task.done)) }
                    TextField("Title", text: $title, axis: .vertical)
                        .font(Theme.title)
                        .focused($focus, equals: .title)
                        .submitLabel(.done)
                        .onSubmit(saveText)
                        // A multi-line field inserts a newline on Return; treat that as "done" instead.
                        .onChange(of: title) { _, text in
                            guard text.contains("\n") else { return }
                            title = text.replacingOccurrences(of: "\n", with: "")
                            saveText()
                            focus = nil
                        }
                }
                descriptionLink(task)
            }
            detailsSection(task)
            datesSection(task)
            Section {
                FlowLabels(labels: live.value.labels)
            } header: {
                HStack {
                    Text("Labels")
                    Spacer()
                    Button("Edit") { showLabels = true }.textCase(nil)
                }
            }
            AttachmentsSection(
                services: services, taskLocalId: taskLocalId, attachments: feeds.attachments.value, state: sheets
            )
            ReminderSection(services: services, task: task, reminders: feeds.reminders.value, state: sheets)
            RelationsSection(services: services, taskLocalId: taskLocalId, relations: feeds.relations.value, state: sheets)
            CommentsSection(services: services, comments: feeds.comments.value, state: sheets)
            Section {
                Button(role: .destructive) { sheets.deletingTask = true } label: {
                    Text("Delete task").frame(maxWidth: .infinity)
                }
            }
        }
            .criaSurface()
    }

    private func deleteTask() {
        // Nothing may be saved onto a task that is going away.
        didLoad = false
        do {
            try services.store.deleteTask(localId: taskLocalId)
            dismiss()
        } catch {
            didLoad = true
            sheets.failure = String(describing: error)
        }
    }

    private func descriptionLink(_ task: TaskRecord) -> some View {
        NavigationLink {
            DescriptionEditorView(
                services: services, taskLocalId: task.localId, initialHTML: task.description ?? ""
            ) { html in
                var patch = TaskPatch()
                patch.description = html
                apply(patch)
            }
        } label: {
            if (task.description ?? "").isEmpty {
                Text("Add description").font(Theme.rowSubtitle).foregroundStyle(Color(.mutedForeground))
            } else {
                RichTextView(html: task.description ?? "", services: services).frame(minHeight: 44, maxHeight: 140)
            }
        }
    }

    private func datesSection(_ task: TaskRecord) -> some View {
        Section("Schedule") {
            DateFieldRow(title: "Start", iso: task.startDate) { value in
                var patch = TaskPatch()
                patch.startDate = value
                apply(patch)
            }
            DateFieldRow(title: "End", iso: task.endDate) { value in
                var patch = TaskPatch()
                patch.endDate = value
                apply(patch)
            }
        }
    }

    private func detailsSection(_ task: TaskRecord) -> some View {
        Section {
            Picker(selection: Binding(get: { task.projectLocalId }, set: { moveTask(to: $0) })) {
                ForEach(moveChoices, id: \.localId) { Text($0.title).tag($0.localId) }
            } label: {
                Label("Project", systemImage: "folder")
            }
            DateFieldRow(title: "Due", iso: task.dueDate) { value in
                apply(TaskPatch(dueDate: value))
            }
            Picker(selection: Binding(get: { task.priority }, set: { apply(TaskPatch(priority: $0)) })) {
                ForEach(priorityNames.indices, id: \.self) { Text(priorityNames[$0]).tag($0) }
            } label: {
                Label { Text("Priority") } icon: {
                    Image(systemName: "flag")
                        .foregroundStyle(ThemeToken.priority(task.priority).map { Color($0) } ?? Color(.mutedForeground))
                }
            }
            RepeatRow(task: task) { apply($0) }
            VStack(alignment: .leading) {
                Text("Done: \(Int((task.percentDone * 100).rounded()))%").font(Theme.caption)
                // One write when the finger lifts, not one (and one outbox op) per 0.1 step while dragging.
                Slider(
                    value: Binding(get: { percentDraft ?? task.percentDone }, set: { percentDraft = $0 }),
                    in: 0...1, step: 0.1,
                    onEditingChanged: { editing in
                        guard !editing, let value = percentDraft else { return }
                        percentDraft = nil
                        setPercent(value)
                    }
                )
            }
        }
    }

    private func loadDrafts() {
        guard let task = live.value.task, !didLoad else { return }
        title = task.title
        loadedTitle = task.title
        didLoad = true
    }

    /// The store's title changed. Follow it unless the user has typed something different.
    private func followServerTitle(_ newTitle: String?) {
        guard didLoad, let newTitle else { return }
        if title == loadedTitle { title = newTitle }
        loadedTitle = newTitle
    }

    private func saveText() {
        guard let task = live.value.task, didLoad else { return }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        var patch = TaskPatch()
        if !name.isEmpty, name != loadedTitle, name != task.title { patch.title = name }
        if patch.title != nil { apply(patch) }
    }

    private func apply(_ patch: TaskPatch) {
        sheets.attempt { _ = try services.store.updateTask(localId: taskLocalId, patch: patch) }
    }

    /// Projects the task can move to, plus its current one when archived, so the picker never shows a blank value.
    private var moveChoices: [ProjectRecord] {
        let visible = live.value.projects
        guard let current = live.value.currentProject, !visible.contains(where: { $0.localId == current.localId }) else {
            return visible
        }
        return visible + [current]
    }

    private func moveTask(to projectLocalId: String) {
        var patch = TaskPatch()
        patch.projectLocalId = projectLocalId
        apply(patch)
    }

    private func setPercent(_ value: Double) {
        var patch = TaskPatch()
        patch.percentDone = value
        apply(patch)
    }
}
