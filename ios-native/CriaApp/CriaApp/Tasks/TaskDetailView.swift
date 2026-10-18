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

/// Task detail. Every control writes through the store, so the change is saved locally at once and queued in the
/// outbox for the server. Text fields, the description included, save when editing ends.
struct TaskDetailView: View {
    let services: AppServices
    let taskLocalId: String
    @State var live: LiveValue<TaskDetailData>
    @State var feeds: TaskDetailFeeds
    @State var sheets: TaskDetailPresentation
    @State private var descriptionDraft: DescriptionDraft
    @State private var title = ""
    /// The title as last loaded from the store. Only a difference from this is the user's edit, so a title that
    /// changed elsewhere (another device, a pull) is never written back over.
    @State private var loadedTitle = ""
    @State private var didLoad = false
    @State var showLabels = false
    @State var editingRepeat = false
    @State var editingDate: TaskDateField?
    @State private var expandingDescription = false
    @State private var choosingPriority = false
    @State private var choosingMove = false
    #if os(macOS)
    @State private var sectionsReady = false
    #else
    private let sectionsReady = true
    #endif
    /// The copy just made by Duplicate, pushed once it exists.
    @State private var openedCopy: String?
    @FocusState private var focus: Field?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.taskCloser) private var closeTask
    /// Nil when shown inside a sheet, outside the shell's environment: the delete then goes ahead without Undo.
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.preferences) private var preferences

    private enum Field: Hashable { case title }

    init(services: AppServices, taskLocalId: String) {
        self.services = services
        self.taskLocalId = taskLocalId
        let store = services.store
        #if os(macOS)
        TaskOpenSignposts.event("detail init", taskLocalId)
        // The Mac shows the task the moment it is clicked, so the first frame already has it (iOS pushes, unchanged).
        let initial = TaskOpenSignposts.seed(store, taskLocalId: taskLocalId)
        if let seeded = initial.task {
            _title = State(initialValue: seeded.title)
            _loadedTitle = State(initialValue: seeded.title)
            _didLoad = State(initialValue: true)
        }
        #else
        let initial = TaskDetailData()
        #endif
        _live = State(initialValue: LiveValue(initial: initial) {
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
        let presentation = TaskDetailPresentation()
        _sheets = State(initialValue: presentation)
        _descriptionDraft = State(initialValue: DescriptionDraft { html in
            var patch = TaskPatch()
            patch.description = html
            presentation.attempt { _ = try store.updateTask(localId: taskLocalId, patch: patch) }
        })
    }

    var body: some View {
        Group {
            if let task = live.value.task {
                // Grouped on the Mac too (its default Form style is a two-column label layout, not the iOS cards).
                form(task).formStyle(.grouped)
                    #if os(macOS)
                    .buttonStyle(FormRowButtonStyle())
                    #endif
            } else {
                ContentUnavailableView("Task not found", systemImage: "questionmark.circle")
            }
        }
        #if os(macOS)
        // A header in the panel, not a `.toolbar`: that one lands in the window toolbar, which re-tiled per task switch.
        .safeAreaInset(edge: .top, spacing: 0) {
            TaskPanelHeader(project: live.value.currentProject, projects: live.value.projects) { headerButtons }
        }
        #else
        .navigationTitle(projectTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItemGroup(placement: .topBarTrailing) { headerButtons } }
        #endif
        // The section feeds run here, not on a Form row, so they keep updating whichever rows are on screen.
        .task { await live.run() }
        .task { await feeds.comments.run() }
        .task { await feeds.attachments.run() }
        .task { await feeds.relations.run() }
        .task { await feeds.reminders.run() }
        .task { await feeds.assignees.run() }
        .task { await AIStatus.shared.refresh() }
        // So Copy link and Share link know the server address.
        .task { await services.rememberServerBase() }
        // The periodic pull does not fetch comments: read this task's thread once when the screen opens.
        .task { await services.refreshTaskDetail(localId: taskLocalId) }
        .onChange(of: live.value.task?.localId, initial: true) { _, _ in loadDrafts() }
        .onChange(of: focus) { _, _ in saveText() }
        .onChange(of: live.value.task?.title) { _, newTitle in followServerTitle(newTitle) }
        .onChange(of: live.value.task?.description, initial: true) { _, html in descriptionDraft.follow(html ?? "") }
        // An app suspended mid-edit can be killed without ever calling onDisappear.
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { descriptionDraft.save() }
        }
        #if os(macOS)
        .onAppear { TaskOpenSignposts.event("detail first body", taskLocalId) }
        .task {
            await Task.yield()
            sectionsReady = true
        }
        #endif
        .onDisappear {
            saveText()
            descriptionDraft.save()
        }
        .sheet(isPresented: $showLabels) {
            LabelPickerSheet(services: services, taskLocalId: taskLocalId, selected: live.value.labels, all: live.value.allLabels)
        }
        .sheet(isPresented: $editingRepeat) {
            if let task = live.value.task {
                RepeatEditorSheet(repeatAfter: task.repeatAfter, repeatMode: task.repeatMode) { after, mode in
                    var patch = TaskPatch()
                    patch.repeatAfter = after
                    patch.repeatMode = mode
                    apply(patch)
                }
            }
        }
        .sheet(item: $editingDate) { field in
            if let task = live.value.task { dateSheet(field, task: task) }
        }
        .navigationDestination(isPresented: $expandingDescription) {
            DescriptionEditorView(
                services: services, taskLocalId: taskLocalId, initialHTML: descriptionDraft.baselineHTML
            ) { html in
                var patch = TaskPatch()
                patch.description = html
                apply(patch)
            }
        }
        .navigationDestination(item: $openedCopy) { copyId in
            TaskDetailView(services: services, taskLocalId: copyId)
        }
        .transientNotice(Binding(get: { sheets.notice }, set: { sheets.notice = $0 }))
        .modifier(TaskDetailSheets(
            services: services, taskLocalId: taskLocalId, state: sheets, assigned: Set(feeds.assignees.value.map(\.userId))
        ))
        .modifier(TaskDetailDialogs(services: services, taskLocalId: taskLocalId, state: sheets))
        .modifier(TaskCommandHandler(
            taskLocalId: taskLocalId, choosingPriority: $choosingPriority, choosingMove: $choosingMove,
            projects: moveChoices, perform: perform, task: live.value.task, services: services, sheets: sheets,
            onPriority: { value in apply(TaskPatch(priority: value)) },
            onMove: { id in
                var patch = TaskPatch()
                patch.projectLocalId = id
                apply(patch)
            }
        ))
    }

    private var projectTitle: String { live.value.currentProject?.title ?? "Task" }
    private var headerButtons: some View {
        TaskDetailHeaderButtons(
            services: services, task: live.value.task, state: sheets, onClose: closeTask, onDuplicate: duplicateTask,
            onToggleStar: { if let task = live.value.task { _ = apply(TaskPatch(isFavorite: !task.isFavorite)) } }
        )
    }

    /// A menu-bar or keyboard command from the Mac shell, for the task on screen.
    private func perform(_ command: TaskCommand) {
        guard let task = live.value.task else { return }
        switch command {
        case .done: apply(TaskPatch(done: !task.done))
        case .due: editingDate = .due
        case .labels: showLabels = true
        case .favourite: apply(TaskPatch(isFavorite: !task.isFavorite))
        case .copyLink: if let url = services.taskWebURL(task) { sheets.copyLink(url) }
        case .priority: choosingPriority = true
        case .move: choosingMove = true
        case .delete: deleteTask()
        }
    }

    private func form(_ task: TaskRecord) -> some View {
        Form {
            Section {
                // Centred on the check's 44pt tap area, which keeps its size but no longer pads the row below the title.
                HStack(alignment: .center, spacing: 8) {
                    PriorityCheck(priority: task.priority, isDone: task.done, size: TaskInspectorStyle.ringSize) {
                        _ = apply(TaskPatch(done: !task.done))
                    }
                        .padding(.vertical, -6)
                    TextField("", text: $title, prompt: Text("Title"), axis: .vertical)
                        .labelsHidden()
                        .accessibilityLabel("Title")
                        .font(TaskInspectorStyle.titleFont)
                        // Unfocused, a vertical field on the Mac drew only its first line; give it room for the rest.
                        .lineLimit(1...8)
                        .fixedSize(horizontal: false, vertical: true)
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
                #if !os(macOS)
                descriptionField(task)
                #endif
            }
            #if os(macOS)
            inspectorFields(task)
            #endif
            // The order is the user's (Settings > Task layout); the title stays first and Delete last.
            // On the Mac the sections wait for the first frame: the title and description show at once, and the rest of
            // the form (a lot of rows to measure) fills in right after, so a click opens the task without a pause.
            if sectionsReady {
                ForEach(preferences.taskDetailOrder) { kind in
                    section(kind, task: task)
                }
            }
            #if os(macOS)
            Section { TaskInspectorFooter(task: task) }.listRowBackground(Color.clear)
            #endif
            Section {
                // No confirmation: the Undo toast takes the delete back.
                Button(role: .destructive, action: deleteTask) {
                    Text("Delete task").frame(maxWidth: .infinity)
                }
            }
        }
            .criaSurface()
            // Dragging the form down puts the keyboard away, as in Notes.
            .scrollDismissesKeyboard(.interactively)
            // A grouped form starts ~35pt below the bar; the task title belongs right under it.
            .contentMargins(.top, 8, for: .scrollContent)
            #if os(macOS)
            .scrollContentBackground(.hidden)
            .background(MacTheme.inspector)
            #endif
    }

    private func saveText() {
        guard let task = live.value.task, didLoad else { return }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        var patch = TaskPatch()
        if !name.isEmpty, name != loadedTitle, name != task.title { patch.title = name }
        if patch.title != nil { apply(patch) }
    }

    /// Saves a patch; false (with the error shown) when that failed.
    @discardableResult
    func apply(_ patch: TaskPatch) -> Bool {
        do {
            _ = try services.store.updateTask(localId: taskLocalId, patch: patch)
            return true
        } catch {
            sheets.failure = String(describing: error)
            return false
        }
    }
}

// Draft loading and the move choices, kept out of the struct body (SwiftLint's type body length).
extension TaskDetailView {
    private func descriptionField(_ task: TaskRecord) -> some View {
        DescriptionField(
            services: services, taskLocalId: taskLocalId, html: task.description ?? "", draft: descriptionDraft
        ) {
            descriptionDraft.finishEditing()
            expandingDescription = true
        }
    }

    #if os(macOS)
    /// The inspector: the field box, then the description under its own title.
    @ViewBuilder
    private func inspectorFields(_ task: TaskRecord) -> some View {
        Section { fieldBox(task) }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        Section("Description") { descriptionField(task) }
    }
    #endif

    /// Saves what is being typed, then copies the task and opens the copy.
    private func duplicateTask() {
        saveText()
        descriptionDraft.save()
        sheets.attempt { openedCopy = try services.store.duplicateTask(localId: taskLocalId).localId }
    }

    private func deleteTask() {
        // Nothing may be saved onto a task that is going away.
        didLoad = false
        descriptionDraft.close()
        do {
            if let undo {
                try undo.deleteTask(localId: taskLocalId, title: live.value.task?.title ?? title)
            } else {
                try services.store.deleteTask(localId: taskLocalId)
            }
            dismiss()
            closeTask?()
        } catch {
            didLoad = true
            descriptionDraft.reopen()
            sheets.failure = String(describing: error)
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

    /// Projects the task can move to, plus its current one when archived, so the picker never shows a blank value.
    var moveChoices: [ProjectRecord] {
        let visible = live.value.projects
        guard let current = live.value.currentProject, !visible.contains(where: { $0.localId == current.localId }) else {
            return visible
        }
        return visible + [current]
    }
}
