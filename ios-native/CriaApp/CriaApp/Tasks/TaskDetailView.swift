import CriaKit
import SwiftUI

struct TaskDetailData: Equatable, Sendable {
    var task: TaskRecord?
    var labels: [LabelRecord] = []
    var allLabels: [LabelRecord] = []
    var projects: [ProjectRecord] = []
}

private let priorityNames = ["None", "Low", "Medium", "High", "Urgent", "Do now"]

/// Task detail. Every control writes through the store, so the change is saved locally at once and queued in the
/// outbox for the server. Text fields save when editing ends.
struct TaskDetailView: View {
    let services: AppServices
    let taskLocalId: String
    @State private var live: LiveValue<TaskDetailData>
    @State private var title = ""
    /// The title as last loaded from the store. Only a difference from this is the user's edit, so a title that
    /// changed elsewhere (another device, a pull) is never written back over.
    @State private var loadedTitle = ""
    @State private var percentDraft: Double?
    @State private var saveError: String?
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
                TaskDetailData(
                    task: try reading.task(localId: taskLocalId),
                    labels: try reading.labels(forTask: taskLocalId),
                    allLabels: try reading.labels(),
                    projects: ProjectTree.visible(try reading.projects())
                )
            }
        })
    }

    var body: some View {
        Group {
            if let task = live.value.task {
                form(task)
            } else {
                ContentUnavailableView("Task not found", systemImage: "questionmark.circle")
            }
        }
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
        .task { await live.run() }
        .onChange(of: live.value.task?.localId, initial: true) { _, _ in loadDrafts() }
        .onChange(of: focus) { _, _ in saveText() }
        .onChange(of: live.value.task?.title) { _, newTitle in followServerTitle(newTitle) }
        .onDisappear(perform: saveText)
        .alert("Could not save", isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(saveError ?? "")
        }
        .sheet(isPresented: $showLabels) {
            LabelPickerSheet(services: services, taskLocalId: taskLocalId, selected: live.value.labels, all: live.value.allLabels)
        }
    }

    private func form(_ task: TaskRecord) -> some View {
        Form {
            Section {
                HStack {
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
            datesSection(task)
            detailsSection(task)
            Section("Labels") {
                FlowLabels(labels: live.value.labels)
                Button("Edit labels", systemImage: "tag") { showLabels = true }
            }
            AttachmentsSection(services: services, taskLocalId: taskLocalId)
            ReminderSection(services: services, task: task)
            RelationsSection(services: services, taskLocalId: taskLocalId)
            CommentsSection(services: services, taskLocalId: taskLocalId)
            Section {
                Button("Delete task", systemImage: "trash", role: .destructive) {
                    // Nothing may be saved onto a task that is going away.
                    didLoad = false
                    do {
                        try services.store.deleteTask(localId: task.localId)
                        dismiss()
                    } catch {
                        didLoad = true
                        saveError = String(describing: error)
                    }
                }
            }
        }
            .criaSurface()
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
                Text("Add description").foregroundStyle(Color(.mutedForeground))
            } else {
                RichTextView(html: task.description ?? "").frame(minHeight: 44, maxHeight: 140)
            }
        }
    }

    private func datesSection(_ task: TaskRecord) -> some View {
        Section("Dates") {
            DateFieldRow(title: "Due", iso: task.dueDate) { value in
                apply(TaskPatch(dueDate: value))
            }
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
        Section("Details") {
            Picker("Priority", selection: Binding(get: { task.priority }, set: { apply(TaskPatch(priority: $0)) })) {
                ForEach(priorityNames.indices, id: \.self) { Text(priorityNames[$0]).tag($0) }
            }
            Picker("Project", selection: Binding(get: { task.projectLocalId }, set: { moveTask(to: $0) })) {
                ForEach(live.value.projects, id: \.localId) { Text($0.title).tag($0.localId) }
            }
            Toggle("Favourite", isOn: Binding(get: { task.isFavorite }, set: { apply(TaskPatch(isFavorite: $0)) }))
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
        do {
            _ = try services.store.updateTask(localId: taskLocalId, patch: patch)
        } catch {
            saveError = String(describing: error)
        }
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

/// A date row: shows "Add" until a date is set, then a picker with an optional time. The server cannot clear a
/// date through the task update (same as the web client), so there is no remove action.
struct DateFieldRow: View {
    let title: String
    let iso: String?
    let onChange: (String) -> Void

    var body: some View {
        if let iso, let current = DueDates.pickerDate(iso) {
            let timed = DueDates.hasTimeOfDay(iso)
            DatePicker(
                title,
                selection: Binding(get: { current }, set: { write($0, timed: timed) }),
                displayedComponents: timed ? [.date, .hourAndMinute] : [.date]
            )
            Toggle("\(title) time", isOn: Binding(get: { timed }, set: { setTimed($0, current: current) }))
        } else {
            Button("Add \(title.lowercased()) date", systemImage: "calendar.badge.plus") {
                onChange(DueDates.allDayISO(for: Date()))
            }
        }
    }

    private func write(_ date: Date, timed: Bool) {
        onChange(timed ? DueDates.timedISO(date) : DueDates.allDayISO(for: date))
    }

    private func setTimed(_ timed: Bool, current: Date) {
        guard timed else { return write(current, timed: false) }
        let nine = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: current) ?? current
        write(nine, timed: true)
    }
}

struct FlowLabels: View {
    let labels: [LabelRecord]

    var body: some View {
        if labels.isEmpty {
            Text("No labels").foregroundStyle(Color(.mutedForeground))
        } else {
            HStack {
                ForEach(labels, id: \.localId) { label in
                    CriaChip(text: label.title, tint: Color(hexString: label.hexColor) ?? Color(.info))
                }
            }
        }
    }
}

/// Toggle existing labels on the task, or create one by typing its name.
struct LabelPickerSheet: View {
    let services: AppServices
    let taskLocalId: String
    let selected: [LabelRecord]
    let all: [LabelRecord]
    @Environment(\.dismiss) private var dismiss
    @State private var newTitle = ""
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("New label", text: $newTitle).submitLabel(.done).onSubmit(create)
                        Button("Add", action: create).disabled(newTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                Section {
                    ForEach(all, id: \.localId) { label in
                        Button {
                            do {
                                try services.store.toggleTaskLabel(taskLocalId: taskLocalId, labelLocalId: label.localId)
                            } catch {
                                failure = String(describing: error)
                            }
                        } label: {
                            HStack {
                                Text(label.title).foregroundStyle(Color(.foreground))
                                Spacer()
                                if selected.contains(where: { $0.localId == label.localId }) {
                                    Image(systemName: "checkmark").foregroundStyle(Color(.primary))
                                }
                            }
                        }
                    }
                }
            }
                .criaSurface()
            .navigationTitle("Labels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func create() {
        let name = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        do {
            try services.store.applyLabels(byTitle: [name], toTask: taskLocalId)
            newTitle = ""
        } catch {
            failure = String(describing: error)
        }
    }
}
