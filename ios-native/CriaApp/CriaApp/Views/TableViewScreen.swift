import CriaKit
import SwiftUI

/// The table view: a horizontally scrolling grid with sortable headers on wide screens, and the shared task
/// rows (sorted the same way) on a compact iPhone. Column and sort choices persist like the desktop's.
struct TableViewScreen: View {
    let services: AppServices
    let projectLocalId: String
    @State private var live: LiveValue<[TaskListItem]>
    @AppStorage("cria.tableViewColumns") private var columnsText = ""
    @AppStorage("cria.tableViewSortBy") private var sortText = ""
    @State private var pickingColumns = false
    @Environment(\.horizontalSizeClass) private var sizeClass

    init(services: AppServices, projectLocalId: String) {
        self.services = services
        self.projectLocalId = projectLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                try reading.taskItems(.project(projectLocalId), includeDone: true)
            }
        })
    }

    private var visible: Set<TableViewColumn> { TableConfigCodec.decodeColumns(columnsText) }
    private var sortKeys: [TableSortKey] { TableConfigCodec.decodeSort(sortText) }

    private var rows: [TaskListItem] {
        let byId = Dictionary(live.value.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        let sorted = TableSort.sorted(live.value.map(\.task), keys: sortKeys, visible: visible)
        return sorted.compactMap { byId[$0.localId] }
    }

    var body: some View {
        Group {
            if sizeClass == .compact { compactList } else { grid }
        }
        .overlay {
            if live.value.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "tablecells", description: Text("Nothing here yet."))
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Table options", systemImage: "slider.horizontal.3") {
                    Button("Columns", systemImage: "tablecells") { pickingColumns = true }
                    sortMenu
                }
            }
        }
        .sheet(isPresented: $pickingColumns) { columnPicker }
        .task { await live.run() }
    }

    private var compactList: some View {
        List(rows, id: \.task.localId) { item in
            TaskRowLink(services: services, item: item)
        }
    }

    private var grid: some View {
        ScrollView([.horizontal, .vertical]) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                GridRow {
                    ForEach(shownColumns, id: \.self) { column in header(column) }
                }
                Divider()
                ForEach(rows, id: \.task.localId) { item in
                    GridRow {
                        ForEach(shownColumns, id: \.self) { column in
                            cell(item, column).frame(minWidth: width(column), alignment: .leading)
                        }
                    }
                }
            }
            .padding(16)
        }
    }

    private var shownColumns: [TableViewColumn] {
        TableViewColumn.allCases.filter { visible.contains($0) }
    }

    private func width(_ column: TableViewColumn) -> CGFloat {
        switch column {
        case .title: return 240
        case .index, .done, .priority: return 40
        default: return 100
        }
    }

    private func header(_ column: TableViewColumn) -> some View {
        let key = sortKeys.first { $0.column == column }
        return Button {
            cycle(column)
        } label: {
            HStack(spacing: 4) {
                Text(column.label).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                if let key {
                    Image(systemName: key.direction == .asc ? "arrow.up" : "arrow.down").font(.caption2)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!column.sortable)
        .frame(minWidth: width(column), alignment: .leading)
    }

    @ViewBuilder private func cell(_ item: TaskListItem, _ column: TableViewColumn) -> some View {
        let task = item.task
        switch column {
        case .title:
            NavigationLink(value: Route.task(task.localId)) {
                Text(task.title).font(Theme.rowTitle).strikethrough(task.done).foregroundStyle(Color(.foreground))
            }
            .buttonStyle(.plain)
        case .labels:
            Text(item.labels.map(\.title).joined(separator: ", ")).font(Theme.caption)
        case .done:
            Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
        default:
            Text(text(for: task, column, projectTitle: item.projectTitle)).font(Theme.caption)
        }
    }

    private func text(for task: TaskRecord, _ column: TableViewColumn, projectTitle: String?) -> String {
        switch column {
        case .index: return task.serverId.map { "#\($0)" } ?? "\u{2014}"
        case .project: return projectTitle ?? ""
        case .priority: return task.priority > 0 ? String(task.priority) : ""
        case .percentDone: return "\(Int((task.percentDone * 100).rounded()))%"
        case .dueDate: return dateText(task.dueDate)
        case .startDate: return dateText(task.startDate)
        case .endDate: return dateText(task.endDate)
        case .updated: return dateText(task.updatedAt)
        case .created: return dateText(task.createdAt)
        case .doneAt: return dateText(task.doneAt)
        case .assignees: return ""
        case .title, .labels, .done: return ""
        }
    }

    private func dateText(_ iso: String?) -> String {
        guard let iso else { return "" }
        return DueDates.label(iso, now: Date())
    }

    private func cycle(_ column: TableViewColumn) {
        sortText = TableConfigCodec.encodeSort(TableSort.cycle(sortKeys, column: column, additive: false))
    }

    @ViewBuilder private var sortMenu: some View {
        Menu("Sort by", systemImage: "arrow.up.arrow.down") {
            ForEach(TableViewColumn.allCases.filter(\.sortable), id: \.self) { column in
                Button(column.label) { cycle(column) }
            }
            Button("Clear sort", role: .destructive) { sortText = TableConfigCodec.encodeSort([]) }
        }
    }

    private var columnPicker: some View {
        NavigationStack {
            List(TableViewColumn.allCases, id: \.self) { column in
                Toggle(column.label, isOn: Binding(
                    get: { visible.contains(column) },
                    set: { isOn in toggle(column, isOn: isOn) }
                ))
            }
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
        columnsText = TableConfigCodec.encodeColumns(next)
    }
}
