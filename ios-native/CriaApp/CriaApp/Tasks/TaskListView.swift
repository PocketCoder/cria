import CriaKit
import SwiftUI

/// A live task list for favourites or a label. Rows update from database changes. The Display sheet sets the grouping,
/// sort, filters and whether completed tasks show, per list. Subtasks sit under their parent when both are in the same
/// section, and a parent's children can be collapsed.
struct TaskListView: View {
    let services: AppServices
    let source: TaskListSource
    let title: String
    @State private var live: LiveValue<TaskListSnapshot>
    @State private var display: DisplayModel
    @State private var selection = TaskSelection()
    /// Settings > General > Show completed: what a list does until its Display sheet says otherwise.
    @AppStorage("cria.taskList.showDone") private var showDone = true
    @State private var failure: String?
    /// Parents whose subtasks are hidden, for this screen only.
    @State private var collapsed: Set<String> = []
    /// The label being edited from the toolbar, and its new title once saved (the route passes the old one).
    @State private var labelEditor: LabelEditTarget?
    @State private var renamedTitle: String?

    init(services: AppServices, source: TaskListSource, title: String) {
        self.services = services
        self.source = source
        self.title = title
        _display = State(initialValue: DisplayModel(key: .taskList(source)))
        let store = services.store
        _live = State(initialValue: LiveValue(initial: TaskListSnapshot()) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                try TaskListNesting.snapshot(reading, items: reading.taskItems(source, includeDone: true))
            }
        })
    }

    private var sections: [DisplaySection] {
        DisplayEngine.sections(
            live.value.items, config: display.config, showCompleted: display.showsCompleted(default: showDone),
            context: display.context(assignees: live.value.assignees)
        )
    }

    var body: some View {
        let shown = sections
        List {
            ForEach(shown) { section in
                Section {
                    ForEach(TaskListNesting.rows(section.items, children: live.value.children, collapsed: collapsed)) { row in
                        TaskRowLink(
                            services: services, item: row.item, showProject: showsProject,
                            tree: TaskListNesting.tree(for: row, progress: live.value.progress, collapsed: $collapsed)
                        )
                    }
                } header: {
                    if !section.label.isEmpty {
                        Text(section.label).font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
                            .accessibilityAddTraits(.isHeader)
                    }
                }
            }
            if shown.isEmpty && !live.value.items.isEmpty {
                Section {
                    DisplayNoMatchesRow(
                        hasFilters: display.hasFilters,
                        onReset: { display.update { $0.filters = DisplayFilters() } },
                        onShowCompleted: { display.update { $0.showCompleted = true } }
                    )
                }
            }
        }
        .criaSurface()
        .overlay {
            if live.value.items.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "checklist", description: Text(emptyMessage))
            }
        }
        .navigationTitle(renamedTitle ?? title)
        .refreshable { await services.refresh() }
        .toolbar {
            DisplaySelectToolbar(
                isCustomised: display.isCustomised, isSelecting: selection.isActive,
                onDisplay: { display.sheetPresented = true }, onSelect: { selection.start() }, onDone: { selection.stop() }
            )
            if let labelLocalId, !selection.isActive {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("Options", systemImage: "ellipsis.circle") {
                        Button("Edit label", systemImage: "pencil") { editLabel(labelLocalId) }
                    }
                }
            }
        }
        .sheet(item: $labelEditor) { target in
            LabelEditorSheet(services: services, label: target.label) { renamedTitle = $0.title }
        }
        .quickAdd(services: services, contextProjectId: contextProjectId)
        .displayOptions(display, services: services)
        .taskSelection(selection, services: services)
        .errorHaptic(failure)
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task { await live.run() }
    }

    private var labelLocalId: String? {
        if case .label(let localId) = source { return localId }
        return nil
    }

    private func editLabel(_ localId: String) {
        do {
            guard let label = try services.store.labels().first(where: { $0.localId == localId }) else { return }
            labelEditor = LabelEditTarget(label: label)
        } catch {
            failure = String(describing: error)
        }
    }

    private var contextProjectId: String? {
        if case .project(let localId) = source { return localId }
        return nil
    }

    private var emptyMessage: String {
        switch source {
        case .favorites: return "Star a task to see it here."
        case .label: return "No tasks carry this label."
        case .project: return "Nothing here yet."
        }
    }

    /// The project chip is redundant inside a project.
    private var showsProject: Bool {
        if case .project = source { return false }
        return true
    }
}
