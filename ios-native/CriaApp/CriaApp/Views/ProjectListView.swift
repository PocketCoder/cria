import CriaKit
import SwiftUI

/// A project's List view, laid out like Today: the header (open count and view pills) in the list, open tasks in
/// one inset-grouped section (or one per group when the Display sheet groups them), completed ones in another, the
/// shared rows and the floating add button. Subtasks sit under their parent within a section and can be collapsed;
/// only top-level rows can be dragged, and only in manual order with nothing grouped or filtered.
struct ProjectListView: View {
    let services: AppServices
    let projectLocalId: String
    let header: ProjectHeader
    @State private var live: LiveValue<TaskListSnapshot>
    @State private var display: DisplayModel
    @State private var selection = TaskSelection()
    /// Settings > General > Show completed: what the list does until its Display sheet says otherwise.
    @AppStorage("cria.taskList.showDone") private var showDone = true
    @State private var optimistic = OptimisticOrder()
    @State private var editMode: EditMode = .inactive
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var failure: String?
    /// Counts finished drags, for the drop haptic.
    @State private var reorders = 0
    /// Parents whose subtasks are hidden, for this screen only.
    @State private var collapsed: Set<String> = []

    init(services: AppServices, projectLocalId: String, header: ProjectHeader) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.header = header
        _display = State(initialValue: DisplayModel(key: .project(projectLocalId)))
        let store = services.store
        _live = State(initialValue: LiveValue(initial: TaskListSnapshot()) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                try TaskListNesting.snapshot(reading, items: reading.taskItems(.project(projectLocalId), includeDone: true))
            }
        })
    }

    private var showCompleted: Bool { display.showsCompleted(default: showDone) }

    private var filtered: [TaskListItem] {
        DisplayEngine.filtered(live.value.items, display.config.filters, display.context(assignees: live.value.assignees))
    }

    /// Manual order: rows can be dragged, and the stored order is the display order.
    private var isManual: Bool { display.config.sort.isManual && display.config.groupBy == .none && !display.hasFilters }

    private var openItems: [TaskListItem] {
        let open = filtered.filter { !$0.task.done }
        guard isManual else { return DisplayEngine.sorted(open, by: display.config.sort) }
        let byId = Dictionary(open.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return optimistic.resolve(open.map(\.task.localId)).compactMap { byId[$0] }
    }

    private var doneItems: [TaskListItem] {
        guard showCompleted else { return [] }
        return DisplayEngine.sorted(filtered.filter(\.task.done), by: display.config.sort)
    }

    /// The open tasks, one section each when grouped (a label's tasks may appear under several).
    private var openSections: [DisplaySection] {
        DisplayEngine.grouped(
            openItems, by: display.config.groupBy, context: display.context(assignees: live.value.assignees)
        )
    }

    private func rows(_ items: [TaskListItem]) -> [NestedTaskItem] {
        TaskListNesting.rows(items, children: live.value.children, collapsed: collapsed)
    }

    var body: some View {
        List {
            Section {} header: { header }
            ForEach(openSections) { section in
                Section {
                    ForEach(rows(section.items)) { row in
                        taskRow(row).moveDisabled(row.depth > 0)
                    }
                    .onMove(perform: isManual ? { move($0, $1) } : nil)
                } header: {
                    groupHeader(section.label)
                }
            }
            if !doneItems.isEmpty {
                Section {
                    ForEach(rows(doneItems)) { row in taskRow(row) }
                } header: {
                    Text("Completed").font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
                }
            }
            if display.hasFilters && !live.value.items.isEmpty && openItems.isEmpty && doneItems.isEmpty {
                Section {
                    DisplayNoMatchesRow(
                        hasFilters: true,
                        onReset: { display.update { $0.filters = DisplayFilters() } },
                        onShowCompleted: {}
                    )
                }
            }
        }
        .publishesTaskOrder(openSections.flatMap { rows($0.items).map(\.id) } + rows(doneItems).map(\.id))
        .criaSurface()
        .environment(\.editMode, $editMode)
        .overlay { emptyState.allowsHitTesting(false) }
        .refreshable { await services.refresh() }
        .toolbar { toolbar }
        .quickAdd(services: services, contextProjectId: projectLocalId)
        .displayOptions(display, services: services)
        .taskSelection(selection, services: services)
        .sensoryFeedback(.impact(weight: .light), trigger: reorders)
        .errorHaptic(failure)
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task { await live.run() }
    }

    @ViewBuilder private func groupHeader(_ label: String) -> some View {
        if !label.isEmpty {
            Text(label).font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
                .accessibilityAddTraits(.isHeader)
        }
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
                Button("Done") { withAnimation(reduceMotion ? nil : .default) { editMode = .inactive } }
            }
        } else {
            DisplaySelectToolbar(
                isCustomised: display.isCustomised, isSelecting: selection.isActive,
                onDisplay: { display.sheetPresented = true }, onSelect: { selection.start() }, onDone: { selection.stop() }
            )
            if isManual && openItems.count > 1 && !selection.isActive {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("Options", systemImage: "ellipsis.circle") {
                        Button("Reorder tasks", systemImage: "arrow.up.arrow.down") {
                            withAnimation(reduceMotion ? nil : .default) { editMode = .active }
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
        } else if openItems.isEmpty && doneItems.isEmpty && !display.hasFilters {
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
        var shown = rows(openItems)
        guard let first = indices.first, shown.indices.contains(first), shown[first].depth == 0 else { return }
        let moved = shown[first].item.task
        let stored = live.value.items.filter { !$0.task.done }.map(\.task.localId)
        shown.move(fromOffsets: indices, toOffset: destination)
        let roots = shown.filter { $0.depth == 0 }.map(\.id)
        let rootSet = Set(roots)
        // Subtasks keep their stored order after the roots: nesting places them under their parent anyway.
        optimistic.set(roots + stored.filter { !rootSet.contains($0) }, over: stored)
        do {
            guard let viewId = try services.store.listViewLocalId(projectLocalId: projectLocalId) else { return }
            try services.store.applyListReorder(orderedIds: roots, movedId: moved.localId, viewLocalId: viewId)
            reorders += 1
        } catch {
            failure = String(describing: error)
        }
    }
}
