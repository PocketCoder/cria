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
    @State private var notes = ""
    @State private var didLoad = false
    @State private var showLabels = false
    @FocusState private var focus: Field?
    @Environment(\.dismiss) private var dismiss

    private enum Field: Hashable { case title, notes }

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
        .onDisappear(perform: saveText)
        .sheet(isPresented: $showLabels) {
            LabelPickerSheet(services: services, taskLocalId: taskLocalId, selected: live.value.labels, all: live.value.allLabels)
        }
    }

    private func form(_ task: TaskRecord) -> some View {
        Form {
            Section {
                HStack {
                    CheckCircle(isDone: task.done) { apply(TaskPatch(done: !task.done)) }
                    TextField("Title", text: $title, axis: .vertical)
                        .font(Theme.title)
                        .focused($focus, equals: .title)
                        .submitLabel(.done)
                        .onSubmit(saveText)
                }
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(3...12)
                    .focused($focus, equals: .notes)
            }
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
                    Slider(value: Binding(get: { task.percentDone }, set: { setPercent($0) }), in: 0...1, step: 0.1)
                }
            }
            Section("Labels") {
                FlowLabels(labels: live.value.labels)
                Button("Edit labels", systemImage: "tag") { showLabels = true }
            }
            Section {
                Button("Delete task", systemImage: "trash", role: .destructive) {
                    try? services.store.deleteTask(localId: task.localId)
                    dismiss()
                }
            }
        }
    }

    private func loadDrafts() {
        guard let task = live.value.task, !didLoad else { return }
        title = task.title
        notes = task.description ?? ""
        didLoad = true
    }

    private func saveText() {
        guard let task = live.value.task, didLoad else { return }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        var patch = TaskPatch()
        if !name.isEmpty, name != task.title { patch.title = name }
        if notes != (task.description ?? "") { patch.description = notes }
        if patch.title != nil || patch.description != nil { apply(patch) }
    }

    private func apply(_ patch: TaskPatch) {
        _ = try? services.store.updateTask(localId: taskLocalId, patch: patch)
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
                            try? services.store.toggleTaskLabel(taskLocalId: taskLocalId, labelLocalId: label.localId)
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
            .navigationTitle("Labels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func create() {
        let name = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        try? services.store.applyLabels(byTitle: [name], toTask: taskLocalId)
        newTitle = ""
    }
}
