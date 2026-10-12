import CriaKit
import SwiftUI

/// A project's List view, laid out like Today: the header (open count and view pills) in the list, open tasks in
/// one inset-grouped section, completed ones in another, the shared rows and the floating add button. Subtasks sit
/// under their parent within a section and can be collapsed; only top-level rows can be dragged.
struct ProjectListView: View {
    let services: AppServices
    let projectLocalId: String
    let header: ProjectHeader
    @State private var live: LiveValue<TaskListSnapshot>
    /// Shared with the other task lists, so the choice follows the user between screens.
    @AppStorage("cria.taskList.showDone") private var showDone = true
    @AppStorage("cria.taskList.sort") private var sortIndex = 0
    @State private var optimistic = OptimisticOrder()
    @State private var editMode: EditMode = .inactive
    @State private var failure: String?
    /// Parents whose subtasks are hidden, for this screen only.
    @State private var collapsed: Set<String> = []

    init(services: AppServices, projectLocalId: String, header: ProjectHeader) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.header = header
        let store = services.store
        _live = State(initialValue: LiveValue(initial: TaskListSnapshot()) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                try TaskListNesting.snapshot(reading, items: reading.taskItems(.project(projectLocalId), includeDone: true))
            }
        })
    }

    private var sortRule: SortRule? {
        TaskSort.options.indices.contains(sortIndex) ? TaskSort.options[sortIndex].rule : nil
    }

    /// Manual order: rows can be dragged, and the stored order is the display order.
    private var isManual: Bool { ListReorder.isEnabled(sort: sortRule, hasFilter: false) }

    private var openItems: [TaskListItem] {
        let open = live.value.items.filter { !$0.task.done }
        guard isManual else { return sorted(open) }
        let byId = Dictionary(open.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return optimistic.resolve(open.map(\.task.localId)).compactMap { byId[$0] }
    }

    private var doneItems: [TaskListItem] {
        guard showDone else { return [] }
        let done = live.value.items.filter(\.task.done)
        return isManual ? done : sorted(done)
    }

    private func sorted(_ items: [TaskListItem]) -> [TaskListItem] {
        let byId = Dictionary(items.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return TaskSort.sorted(items.map(\.task), by: sortRule).compactMap { byId[$0.localId] }
    }

    /// Open rows nested under their parents, with collapsed children left out.
    private var openRows: [NestedTaskItem] {
        TaskListNesting.visible(TaskTree.nest(openItems, children: live.value.children), collapsed: collapsed)
    }

    private var doneRows: [NestedTaskItem] {
        TaskListNesting.visible(TaskTree.nest(doneItems, children: live.value.children), collapsed: collapsed)
    }

    var body: some View {
        List {
            Section {} header: { header }
            if !openItems.isEmpty {
                Section {
                    ForEach(openRows) { row in
                        taskRow(row).moveDisabled(row.depth > 0)
                    }
                    .onMove(perform: isManual ? { move($0, $1) } : nil)
                }
            }
            if !doneItems.isEmpty {
                Section {
                    ForEach(doneRows) { row in taskRow(row) }
                } header: {
                    Text("Completed").font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
                }
            }
        }
        .criaSurface()
        .environment(\.editMode, $editMode)
        .overlay { emptyState.allowsHitTesting(false) }
        .refreshable { await services.refresh() }
        .toolbar { toolbar }
        .quickAdd(services: services, contextProjectId: projectLocalId)
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task { await live.run() }
    }

    private func taskRow(_ row: NestedTaskItem) -> some View {
        TaskRowLink(
            services: services, item: row.item,
            tree: TaskListNesting.tree(for: row, progress: live.value.progress, collapsed: $collapsed)
        )
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if editMode.isEditing {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { withAnimation { editMode = .inactive } }
            }
        } else {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Options", systemImage: "ellipsis.circle") {
                    Toggle("Show completed", isOn: $showDone)
                    Picker("Sort", selection: $sortIndex) {
                        ForEach(TaskSort.options.indices, id: \.self) { Text(TaskSort.options[$0].label).tag($0) }
                    }
                    .pickerStyle(.menu)
                    if isManual && openItems.count > 1 {
                        Button("Reorder tasks", systemImage: "arrow.up.arrow.down") {
                            withAnimation { editMode = .active }
                        }
                    }
                }
            }
        }
    }

    /// Today's empty states: nothing at all, or everything done.
    @ViewBuilder private var emptyState: some View {
        if live.value.items.isEmpty {
            ContentUnavailableView {
                Label("No tasks yet", systemImage: "checklist")
            } description: {
                Text("Tap + to add the first one.")
            }
        } else if openItems.isEmpty && doneItems.isEmpty {
            ContentUnavailableView {
                Label("All clear", systemImage: "party.popper").foregroundStyle(Color(.primary))
            } description: {
                Text("Everything in this project is done.")
            }
        }
    }

    /// Moves an open top-level row, then writes the positions. Subtasks always follow their parent, so only the
    /// top-level order is written; a row dropped inside another's subtasks lands after that parent. Completed tasks
    /// are not part of the manual order.
    private func move(_ indices: IndexSet, _ destination: Int) {
        var rows = openRows
        guard let first = indices.first, rows.indices.contains(first), rows[first].depth == 0 else { return }
        let moved = rows[first].item.task
        let stored = live.value.items.filter { !$0.task.done }.map(\.task.localId)
        rows.move(fromOffsets: indices, toOffset: destination)
        let roots = rows.filter { $0.depth == 0 }.map(\.id)
        let rootSet = Set(roots)
        // Subtasks keep their stored order after the roots: nesting places them under their parent anyway.
        optimistic.set(roots + stored.filter { !rootSet.contains($0) }, over: stored)
        do {
            guard let viewId = try services.store.listViewLocalId(projectLocalId: projectLocalId) else { return }
            try services.store.applyListReorder(orderedIds: roots, movedId: moved.localId, viewLocalId: viewId)
        } catch {
            failure = String(describing: error)
        }
    }
}
