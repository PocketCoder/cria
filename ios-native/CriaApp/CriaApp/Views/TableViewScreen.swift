import CriaKit
import SwiftUI

/// The table view. On iPhone each task is a row with its title and the chosen columns as chips; on wide screens it
/// is a horizontally scrolling grid with sortable headers. Both sort from the same Sort menu, and the column and
/// sort choices persist like the desktop's.
struct TableViewScreen: View {
    let services: AppServices
    let projectLocalId: String
    /// The table view being shown, so comment counts read through it. Nil picks the project's table view.
    let viewLocalId: String?
    let header: ProjectHeader
    @State private var live: LiveValue<[TaskListItem]>
    @State private var currentUserId: Int?
    /// Comment counts by task server id, read from the server while the Comments column is shown. Memory only.
    @State private var commentCounts: [Int: Int] = [:]
    @AppStorage("cria.tableViewColumns") private var columnsText = ""
    @AppStorage("cria.tableViewSortBy") private var sortText = ""
    @State private var pickingColumns = false
    /// Off by default: label, assignee and date cells then open their picker when tapped. Kept on this device.
    @AppStorage("cria.tableViewInlineEdit") private var inlineEdit = false
    @State private var cellEdit: TableCellEdit?
    @State private var editFailure: String?
    @State private var assigneeFeed: LiveValue<[String: [AssigneeRecord]]>
    @Environment(\.horizontalSizeClass) private var sizeClass

    init(services: AppServices, projectLocalId: String, viewLocalId: String? = nil, header: ProjectHeader) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.viewLocalId = viewLocalId
        self.header = header
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                try reading.taskItems(.project(projectLocalId), includeDone: true)
            }
        })
        _assigneeFeed = State(initialValue: LiveValue(initial: [:]) {
            observeStore(store, kinds: [.tasks]) { reading in try reading.assigneesByTask(projectLocalId: projectLocalId) }
        })
    }

    private var visible: Set<TableViewColumn> { TableConfigCodec.decodeColumns(columnsText) }
    private var sortKeys: [TableSortKey] { TableConfigCodec.decodeSort(sortText) }
    private var extras: TableExtras { TableExtras(currentUserId: currentUserId, commentCounts: commentCounts) }
    private var showsComments: Bool { visible.contains(.commentCount) }

    /// Every column the user can show.
    private var availableColumns: [TableViewColumn] { TableViewColumn.allCases }

    /// Passed to rows only while "Edit cells" is on.
    private var editAction: ((TableCellEdit) -> Void)? {
        inlineEdit ? { cellEdit = $0 } : nil
    }

    private var shownColumns: [TableViewColumn] {
        availableColumns.filter { visible.contains($0) }
    }

    /// Sorting uses every sortable column, shown or not, so the Sort menu always does something.
    private var rows: [TaskListItem] {
        let byId = Dictionary(live.value.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        let titles = Dictionary(live.value.map { ($0.task.projectLocalId, $0.projectTitle ?? "") }, uniquingKeysWith: { first, _ in first })
        let sorted = TableSort.sorted(
            live.value.map(\.task), keys: sortKeys, visible: Set(TableViewColumn.allCases),
            projectTitle: { titles[$0] ?? "" }, extras: extras
        )
        return sorted.compactMap { byId[$0.localId] }
    }

    var body: some View {
        Group {
            if sizeClass == .regular {
                PinnedProjectHeader(header: header) {
                    TableGridView(
                        rows: rows, columns: shownColumns, sortKeys: sortKeys, extras: extras,
                        onHeaderTap: { column in
                            sortText = TableConfigCodec.encodeSort(TableSort.cycle(sortKeys, column: column, additive: false))
                        },
                        assignees: assigneeFeed.value,
                        onEdit: editAction
                    )
                }
            } else {
                compactList
            }
        }
        .overlay {
            if live.value.isEmpty {
                ContentUnavailableView {
                    Label("No tasks yet", systemImage: "tablecells")
                } description: {
                    Text("Tap + to add the first one.")
                }
                .allowsHitTesting(false)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Table options", systemImage: "ellipsis.circle") {
                    sortControls
                    Button("Columns", systemImage: "tablecells") { pickingColumns = true }
                    Toggle("Edit cells", systemImage: "square.and.pencil", isOn: $inlineEdit)
                }
            }
        }
        .sheet(isPresented: $pickingColumns) { columnPicker }
        .sheet(item: $cellEdit) { edit in
            TableCellEditSheet(services: services, edit: edit) { editFailure = $0 }
        }
        .alert("Could not save", isPresented: Binding(get: { editFailure != nil }, set: { if !$0 { editFailure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(editFailure ?? "")
        }
        .quickAdd(services: services, contextProjectId: projectLocalId)
        .task { await live.run() }
        .task { await assigneeFeed.run() }
        .task { currentUserId = await services.signedInUser()?.id }
        .task(id: showsComments) { await loadCommentCounts() }
    }

    /// Reads comment counts in the background while the Comments column is shown; the table never waits on it.
    private func loadCommentCounts() async {
        guard showsComments else { return }
        let result = await services.tableCommentCounts(projectLocalId: projectLocalId, viewLocalId: viewLocalId)
        guard !Task.isCancelled else { return }
        commentCounts = result.counts
    }

    private var compactList: some View {
        List {
            Section {} header: { header }
            if !rows.isEmpty {
                Section {
                    ForEach(rows, id: \.task.localId) { item in
                        TableCompactRow(
                            services: services, item: item, columns: shownColumns, extras: extras,
                            assignees: assigneeFeed.value[item.task.localId] ?? [], onEdit: editAction
                        )
                    }
                } header: {
                    sortHeader
                } footer: {
                    if inlineEdit && !shownColumns.contains(where: TableEditing.isEditable) {
                        Text("Edit cells is on. Show the Labels, Assignees or a date column to edit it here.")
                    }
                }
            }
        }
        .criaSurface()
        .refreshable {
            await services.refresh()
            await loadCommentCounts()
        }
    }

    /// The sort in force, as a menu that changes it.
    private var sortHeader: some View {
        Menu {
            sortControls
        } label: {
            Label(TableCells.sortSummary(sortKeys) ?? "Not sorted", systemImage: "arrow.up.arrow.down")
                .font(Theme.rowSubtitle)
                .foregroundStyle(Color(.mutedForeground))
        }
        .textCase(nil)
        .accessibilityLabel("Sort")
        .accessibilityValue(TableCells.sortSummary(sortKeys) ?? "Not sorted")
    }

    @ViewBuilder private var sortControls: some View {
        Picker("Sort by", selection: sortColumn) {
            Text("No sort").tag(TableViewColumn?.none)
            ForEach(availableColumns.filter(\.sortable), id: \.self) { column in
                Text(column.label).tag(TableViewColumn?.some(column))
            }
        }
        .pickerStyle(.menu)
        if !sortKeys.isEmpty {
            Picker("Order", selection: sortDirection) {
                Label("Ascending", systemImage: "arrow.up").tag(SortDirection.asc)
                Label("Descending", systemImage: "arrow.down").tag(SortDirection.desc)
            }
        }
    }

    private var sortColumn: Binding<TableViewColumn?> {
        Binding(
            get: { sortKeys.first?.column },
            set: { column in
                let keys = column.map { [TableSortKey(column: $0, direction: TableSort.defaultDirection(for: $0))] } ?? []
                sortText = TableConfigCodec.encodeSort(keys)
            }
        )
    }

    private var sortDirection: Binding<SortDirection> {
        Binding(
            get: { sortKeys.first?.direction ?? .asc },
            set: { direction in
                guard let column = sortKeys.first?.column else { return }
                sortText = TableConfigCodec.encodeSort([TableSortKey(column: column, direction: direction)])
            }
        )
    }

    private var columnPicker: some View {
        NavigationStack {
            List(availableColumns, id: \.self) { column in
                Toggle(column.label, isOn: Binding(
                    get: { visible.contains(column) },
                    set: { isOn in toggle(column, isOn: isOn) }
                ))
            }
            .criaSurface()
            .navigationTitle("Columns")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { pickingColumns = false } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func toggle(_ column: TableViewColumn, isOn: Bool) {
        var next = visible
        if isOn { next.insert(column) } else { next.remove(column) }
        // An empty set would decode back to the defaults, so keep the title at least.
        if next.isEmpty { next.insert(.title) }
        columnsText = TableConfigCodec.encodeColumns(next)
    }
}
