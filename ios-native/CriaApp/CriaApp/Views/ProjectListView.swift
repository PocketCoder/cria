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
    @State private var live: LiveValue<ProjectListData>
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
    #if os(macOS)
    /// The label chosen in the project info rail; nil shows every task.
    @State private var railLabel: String?
    /// The Completed group starts collapsed at the bottom on the Mac.
    @State private var completedOpen = false
    #endif

    init(services: AppServices, projectLocalId: String, header: ProjectHeader) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.header = header
        _display = State(initialValue: DisplayModel(key: .project(projectLocalId)))
        let store = services.store
        _live = State(initialValue: LiveValue(initial: ProjectListData()) {
            // The Mac also reads the board's columns (views) and the rail's figures here, so the rail has no read.
            observeStore(store, kinds: [.tasks, .labels, .projects, .views]) { reading in
                try ProjectListData.read(reading, projectLocalId: projectLocalId)
            }
        })
    }

    private var showCompleted: Bool { display.showsCompleted(default: showDone) }

    private var filtered: [TaskListItem] {
        let shown = DisplayEngine.filtered(
            live.value.snapshot.items, display.config.filters, display.context(assignees: live.value.snapshot.assignees)
        )
        #if os(macOS)
        guard let railLabel else { return shown }
        return shown.filter { item in item.labels.contains { $0.localId == railLabel } }
        #else
        return shown
        #endif
    }

    /// Manual order: rows can be dragged, and the stored order is the display order.
    private var isManual: Bool {
        #if os(macOS)
        // A rail label filter hides rows, as the Display filters do.
        if railLabel != nil { return false }
        #endif
        return display.config.sort.isManual && display.config.groupBy == .none && !display.hasFilters
    }

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
        #if os(macOS)
        // Ungrouped on the Mac means grouped by the board's columns ("To do", "Doing"), as the design has it.
        if display.config.groupBy == .none, !live.value.columns.isEmpty {
            return ProjectListGrouping.byColumn(openItems, columns: live.value.columns, columnOf: live.value.columnOf)
        }
        #endif
        return DisplayEngine.grouped(
            openItems, by: display.config.groupBy, context: display.context(assignees: live.value.snapshot.assignees)
        )
    }

    private func rows(_ items: [TaskListItem]) -> [NestedTaskItem] {
        TaskListNesting.rows(items, children: live.value.snapshot.children, collapsed: collapsed)
    }

    var body: some View {
        List {
            Section {} header: { header }
            ForEach(openSections) { section in
                Section {
                    ForEach(rows(section.items)) { row in
                        taskRow(row).moveDisabled(row.depth > 0)
                    }
                    .onMove(perform: isManual ? { move($0, $1, in: section.items) } : nil)
                    #if os(macOS)
                    if let column = ProjectListGrouping.column(of: section, in: live.value.columns), column.acceptsTasks {
                        ProjectListAddRow(services: services, projectLocalId: projectLocalId, column: column)
                    }
                    #endif
                } header: {
                    groupHeader(section.label)
                }
            }
            if !doneItems.isEmpty {
                Section {
                    if completedShown { ForEach(rows(doneItems)) { row in taskRow(row) } }
                } header: {
                    completedHeader
                }
            }
            if display.hasFilters && !live.value.snapshot.items.isEmpty && openItems.isEmpty && doneItems.isEmpty {
                Section {
                    DisplayNoMatchesRow(
                        hasFilters: true,
                        onReset: { display.update { $0.filters = DisplayFilters() } },
                        onShowCompleted: {}
                    )
                }
            }
        }
        #if os(macOS)
        // Built once the first read is in, so rows do not draw title-high and then grow (see TaskListView).
        .id(live.value.snapshot.loaded)
        #endif
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
        #if os(macOS)
        .modifier(MacProjectRailHost(
            services: services, projectLocalId: projectLocalId, summary: live.value.rail, labelFilter: $railLabel
        ))
        #endif
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
            tree: TaskListNesting.tree(
                for: row, progress: live.value.snapshot.progress, collapsed: $collapsed,
                parentTitles: live.value.snapshot.parentTitles
            )
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
        if live.value.snapshot.loaded && live.value.snapshot.items.isEmpty {
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
}

// MARK: Completed group and reordering

extension ProjectListView {
    #if os(macOS)
    private var completedShown: Bool { completedOpen }

    /// "Completed" with its count, collapsed until clicked.
    private var completedHeader: some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy) { completedOpen.toggle() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .rotationEffect(.degrees(completedOpen ? 90 : 0))
                Text("Completed").font(Theme.headline)
                Text("\(doneItems.count)").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
            .foregroundStyle(Color(.foreground))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .textCase(nil)
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(completedOpen ? "Expanded" : "Collapsed")
    }
    #else
    private var completedShown: Bool { true }

    private var completedHeader: some View {
        Text("Completed").font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
    }
    #endif

    /// Moves an open top-level row, then writes the positions. Subtasks always follow their parent, so only the
    /// top-level order is written; a row dropped inside another's subtasks lands after that parent. Completed tasks
    /// are not part of the manual order.
    /// `sectionItems` is the group the drag happened in (all open tasks when ungrouped); its new order replaces the
    /// same tasks' slots in the whole list.
    private func move(_ indices: IndexSet, _ destination: Int, in sectionItems: [TaskListItem]) {
        var shown = rows(sectionItems)
        guard let first = indices.first, shown.indices.contains(first), shown[first].depth == 0 else { return }
        let moved = shown[first].item.task
        let stored = live.value.snapshot.items.filter { !$0.task.done }.map(\.task.localId)
        let before = Set(shown.filter { $0.depth == 0 }.map(\.id))
        shown.move(fromOffsets: indices, toOffset: destination)
        var reordered = shown.filter { $0.depth == 0 }.map(\.id).makeIterator()
        let roots = rows(openItems).filter { $0.depth == 0 }.map { row in
            before.contains(row.id) ? (reordered.next() ?? row.id) : row.id
        }
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
