import CriaKit
import SwiftUI

/// The table view. On iPhone each task is a row with its title and the chosen columns as chips; on wide screens it
/// is a horizontally scrolling grid with sortable headers. Both sort from the same Sort menu, and the column and
/// sort choices persist like the desktop's.
struct TableViewScreen: View {
    let services: AppServices
    let projectLocalId: String
    let header: ProjectHeader
    @State private var live: LiveValue<[TaskListItem]>
    @AppStorage("cria.tableViewColumns") private var columnsText = ""
    @AppStorage("cria.tableViewSortBy") private var sortText = ""
    @State private var pickingColumns = false
    @Environment(\.horizontalSizeClass) private var sizeClass

    init(services: AppServices, projectLocalId: String, header: ProjectHeader) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.header = header
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                try reading.taskItems(.project(projectLocalId), includeDone: true)
            }
        })
    }

    private var visible: Set<TableViewColumn> { TableConfigCodec.decodeColumns(columnsText) }
    private var sortKeys: [TableSortKey] { TableConfigCodec.decodeSort(sortText) }

    /// Every column the user can show. Assignees are left out until table rows load them.
    private var availableColumns: [TableViewColumn] {
        TableViewColumn.allCases.filter { $0 != .assignees }
    }

    private var shownColumns: [TableViewColumn] {
        availableColumns.filter { visible.contains($0) }
    }

    /// Sorting uses every sortable column, shown or not, so the Sort menu always does something.
    private var rows: [TaskListItem] {
        let byId = Dictionary(live.value.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        let titles = Dictionary(live.value.map { ($0.task.projectLocalId, $0.projectTitle ?? "") }, uniquingKeysWith: { first, _ in first })
        let sorted = TableSort.sorted(
            live.value.map(\.task), keys: sortKeys, visible: Set(TableViewColumn.allCases), projectTitle: { titles[$0] ?? "" }
        )
        return sorted.compactMap { byId[$0.localId] }
    }

    var body: some View {
        Group {
            if sizeClass == .regular {
                PinnedProjectHeader(header: header) {
                    TableGridView(
                        rows: rows, columns: shownColumns, sortKeys: sortKeys,
                        onHeaderTap: { column in
                            sortText = TableConfigCodec.encodeSort(TableSort.cycle(sortKeys, column: column, additive: false))
                        }
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
                }
            }
        }
        .sheet(isPresented: $pickingColumns) { columnPicker }
        .quickAdd(services: services, contextProjectId: projectLocalId)
        .task { await live.run() }
    }

    private var compactList: some View {
        List {
            Section {} header: { header }
            if !rows.isEmpty {
                Section {
                    ForEach(rows, id: \.task.localId) { item in
                        TableCompactRow(services: services, item: item, columns: shownColumns)
                    }
                } header: {
                    sortHeader
                }
            }
        }
        .criaSurface()
        .refreshable { await services.refresh() }
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
