import CriaKit
import SwiftUI

/// One task on the iPhone table: completion ring, title, then the shown columns as chips.
struct TableCompactRow: View {
    let services: AppServices
    let item: TaskListItem
    let columns: [TableViewColumn]
    let extras: TableExtras
    /// The task's assignees, shown as a chip when the Assignees column is on.
    var assignees: [AssigneeRecord] = []
    /// Set while "Edit cells" is on: label, assignee and date chips then open their picker.
    var onEdit: ((TableCellEdit) -> Void)?
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.colorScheme) private var colorScheme
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    @State private var failure: String?
    /// Counts completions from the swipe; the ring plays its own haptic for a tap.
    @State private var completions = 0

    private var task: TaskRecord { item.task }

    var body: some View {
        NavigationLink(value: Route.task(task.localId)) {
            HStack(alignment: .top, spacing: 0) {
                PriorityCheck(priority: task.priority, isDone: task.done) { toggle() }
                VStack(alignment: .leading, spacing: 6) {
                    Text(task.title)
                        .font(Theme.rowTitle)
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                        .lineLimit(2)
                    if hasChips {
                        ChipFlowLayout { chips }
                    }
                }
                .padding(.vertical, 10)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            // Spoken text instead of combining the children, which would read each chip's icon name.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spokenLabel)
            .accessibilityValue(task.done ? "Done" : "")
        }
        .accessibilityAction(named: task.done ? "Mark not done" : "Mark done") { toggle() }
        .accessibilityActions {
            if let onEdit {
                ForEach(columns.filter(TableEditing.isEditable), id: \.self) { column in
                    Button("Edit \(column.label)") {
                        if let edit = TableEditing.edit(column, task: task.localId) { onEdit(edit) }
                    }
                }
            }
        }
        .swipeActions(edge: .leading) {
            Button(task.done ? "Reopen" : "Done", systemImage: "checkmark") {
                if !task.done { completions += 1 }
                toggle()
            }
            .tint(Color(.meadow500))
        }
        .sensoryFeedback(.success, trigger: completions)
        .errorHaptic(failure)
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    private var chipColumns: [TableViewColumn] {
        columns.filter { column in
            switch column {
            case .title, .done: return false
            case .assignees: return !assignees.isEmpty
            case .labels: return !item.labels.isEmpty
            // No chip for a task with no comments.
            case .commentCount: return (extras.commentCount(task) ?? 0) > 0
            default: return cellText(column) != nil
            }
        }
    }

    /// The chips drawn: the filled ones, plus every editable column (empty or not) while cells are editable.
    private var displayColumns: [TableViewColumn] {
        columns.filter { chipColumns.contains($0) || (onEdit != nil && TableEditing.isEditable($0)) }
    }

    private var hasChips: Bool { !displayColumns.isEmpty }

    @ViewBuilder private var chips: some View {
        ForEach(displayColumns, id: \.self) { column in
            if let onEdit, TableEditing.isEditable(column) {
                TableEditCell(column: column, item: item, assignees: assignees, compact: true, onEdit: onEdit)
            } else if column == .assignees {
                CriaChip(text: assigneeNames, systemImage: "person", tint: Color(.mutedForeground))
            } else if column == .labels {
                ForEach(item.labels.prefix(3), id: \.localId) { label in
                    CriaChip(
                        text: label.title, systemImage: "tag",
                        tint: LegibleTint.chip(label.hexColor, scheme: colorScheme) ?? Color(.info)
                    )
                }
            } else if let text = cellText(column) {
                CriaChip(text: chipText(column, text), systemImage: Self.icon(column), tint: tint(column))
            }
        }
    }

    /// Title, then each shown column named, e.g. "Buy milk, due Tomorrow, High priority, labels Home, Errands".
    private var spokenLabel: String {
        let parts = chipColumns.compactMap { column -> String? in
            if column == .labels { return "labels " + item.labels.map(\.title).joined(separator: ", ") }
            if column == .assignees { return "assigned to " + assigneeNames }
            guard let text = cellText(column) else { return nil }
            switch column {
            case .dueDate: return "due \(text)"
            case .priority: return "\(text) priority"
            case .startDate, .endDate, .updated, .created, .doneAt, .createdBy, .commentCount: return chipText(column, text)
            default: return "\(column.label) \(text)"
            }
        }
        return ([task.title] + parts).joined(separator: ", ")
    }

    private var assigneeNames: String { assignees.map(AssigneesSection.name).joined(separator: ", ") }

    private func cellText(_ column: TableViewColumn) -> String? {
        TableCells.text(task, column, projectTitle: item.projectTitle, now: Date(), display: dateDisplay, extras: extras)
    }

    /// Dates other than the due date say which date they are; the creator and comment count say what they are.
    private func chipText(_ column: TableViewColumn, _ text: String) -> String {
        switch column {
        case .startDate: return "Starts \(text)"
        case .endDate: return "Ends \(text)"
        case .updated: return "Updated \(text)"
        case .created: return "Created \(text)"
        case .doneAt: return "Done \(text)"
        case .createdBy: return "By \(text)"
        case .commentCount: return extras.commentCount(task) == 1 ? "1 comment" : "\(text) comments"
        default: return text
        }
    }

    private func tint(_ column: TableViewColumn) -> Color {
        switch column {
        case .dueDate:
            if let due = task.dueDate, !task.done, DueDates.isOverdue(due, now: Date()) { return Color(.destructive) }
            return Color(.mutedForeground)
        case .priority:
            return ThemeToken.priority(task.priority).map { Color($0) } ?? Color(.mutedForeground)
        default:
            return Color(.mutedForeground)
        }
    }

    static func icon(_ column: TableViewColumn) -> String? {
        switch column {
        case .index: return "number"
        case .project: return "folder"
        case .priority: return "flag"
        case .percentDone: return "chart.pie"
        case .dueDate, .startDate, .endDate: return "calendar"
        case .updated, .created: return "clock"
        case .doneAt: return "checkmark"
        case .createdBy: return "person"
        case .commentCount: return "bubble.left"
        case .title, .done, .labels, .assignees: return nil
        }
    }

    private func toggle() {
        do {
            try undo.updateTask(services, localId: task.localId, patch: TaskPatch(done: !task.done))
        } catch {
            failure = String(describing: error)
        }
    }
}

/// The wide-screen table: a grid with a header row whose titles sort, scrolling both ways.
struct TableGridView: View {
    let rows: [TaskListItem]
    let columns: [TableViewColumn]
    let sortKeys: [TableSortKey]
    let extras: TableExtras
    let onHeaderTap: (TableViewColumn) -> Void
    var assignees: [String: [AssigneeRecord]] = [:]
    /// A subtask's parent title, shown under its title.
    var parentTitles: [String: String] = [:]
    /// A parent's subtask progress, shown as a ring after its title.
    var progress: [String: SubtaskProgress] = [:]
    /// Set while "Edit cells" is on: label, assignee and date cells then open their picker.
    var onEdit: ((TableCellEdit) -> Void)?
    /// Called when a row is dragged onto another: the dragged task, then the one it landed on.
    var onMove: ((String, String) -> Void)?
    @Environment(\.dateDisplay) private var dateDisplay

    var body: some View {
        GeometryReader { proxy in
            scroller(minSize: proxy.size)
        }
    }

    #if os(macOS)
    private static let columnSpacing: CGFloat = 0
    // The Mac design: a 30pt header in SF 11 Semibold `l2`, 32pt rows, empty cells as "—" in `l3`.
    private static let headerFont = Font.system(size: 11, weight: .semibold)
    private static let headerColour = MacTheme.label2
    private static let headerHeight: CGFloat? = 30
    private static let rowPadding: CGFloat = 0
    private static let rowHeight: CGFloat? = 32
    private static let emptyText = "—"
    private static let emptyColour = MacTheme.label3
    private static let unknownColour = MacTheme.label3
    /// The task open in the inspector, whose row is tinted.
    @Environment(\.openTaskState) private var openTaskState
    private func isSelected(_ item: TaskListItem) -> Bool { openTaskState?.id == item.task.localId }
    #else
    private static let columnSpacing: CGFloat = 16
    private static let headerFont = Theme.caption.weight(.semibold)
    private static let headerColour = Color(.mutedForeground)
    private static let headerHeight: CGFloat? = nil
    private static let rowPadding: CGFloat = 10
    private static let rowHeight: CGFloat? = nil
    private static let emptyText = ""
    private static let emptyColour = Color(.foreground)
    private static let unknownColour = Color(.mutedForeground)
    private func isSelected(_ item: TaskListItem) -> Bool { false }
    #endif

    /// The card sits at the top left and is at least as big as the screen; a two-way scroll view would otherwise centre
    /// a short table, leaving its top cut off.
    private func scroller(minSize: CGSize) -> some View {
        ScrollView([.horizontal, .vertical]) {
            Grid(alignment: .leading, horizontalSpacing: Self.columnSpacing, verticalSpacing: 0) {
                // Padding goes on the cells: a modified GridRow would become one cell spanning the grid.
                GridRow {
                    ForEach(columns, id: \.self) { column in
                        header(column).padding(.vertical, Self.headerHeight == nil ? 10 : 0)
                            .frame(height: Self.headerHeight)
                            #if os(macOS)
                            .padding(.horizontal, 8)
                            #endif
                    }
                }
                Divider()
                ForEach(rows, id: \.task.localId) { item in
                    GridRow {
                        ForEach(columns, id: \.self) { column in
                            cell(item, column)
                                .modifier(TableReorderHandle(id: item.task.localId, isFirst: column == columns.first, onMove: onMove))
                                .frame(minWidth: width(column), minHeight: Self.rowHeight, alignment: .leading)
                                .padding(.vertical, Self.rowPadding)
                                #if os(macOS)
                                // No alternating stripes: a Grid can only paint them per cell, which broke into a
                                // checkerboard, and stretching every cell to fill its row made each layout pass slow.
                                // The dividers separate the rows. Only the selected row's cells stretch to fill it, so
                                // its 13% primary band is one piece and the cost is one row.
                                .padding(.horizontal, 8)
                                .modifier(TableSelectedBand(selected: isSelected(item)))
                                #endif
                        }
                    }
                    Divider()
                }
            }
            .padding(.horizontal, 16)
            .background(Color(.cell), in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .padding(16)
            .frame(minWidth: minSize.width, minHeight: minSize.height, alignment: .topLeading)
        }
    }

    private func width(_ column: TableViewColumn) -> CGFloat {
        switch column {
        case .title: return 260
        case .index, .done: return 44
        case .priority, .percentDone, .commentCount: return 80
        case .createdBy: return 130
        default: return 110
        }
    }

    private func header(_ column: TableViewColumn) -> some View {
        let key = sortKeys.first { $0.column == column }
        return Button {
            onHeaderTap(column)
        } label: {
            HStack(spacing: 4) {
                Text(column.label).font(Self.headerFont).foregroundStyle(Self.headerColour)
                if let key {
                    Image(systemName: Self.sortSymbol(key.direction == .asc))
                        .font(Theme.footnote)
                        .foregroundStyle(Color(.primary))
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!column.sortable)
        .frame(minWidth: width(column), alignment: .leading)
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(key.map { $0.direction == .asc ? "Sorted ascending" : "Sorted descending" } ?? "")
        .accessibilityHint(column.sortable ? "Changes the sort order" : "")
    }

    @ViewBuilder private func cell(_ item: TaskListItem, _ column: TableViewColumn) -> some View {
        let task = item.task
        if let onEdit, TableEditing.isEditable(column) {
            TableEditCell(column: column, item: item, assignees: assignees[task.localId] ?? [], compact: false, onEdit: onEdit)
        } else {
            readCell(item, column)
        }
    }

    @ViewBuilder private func readCell(_ item: TaskListItem, _ column: TableViewColumn) -> some View {
        let task = item.task
        switch column {
        case .assignees:
            let names = (assignees[task.localId] ?? []).map(AssigneesSection.name).joined(separator: ", ")
            Text(names.isEmpty ? Self.emptyText : names).font(Theme.caption).lineLimit(1)
                .foregroundStyle(names.isEmpty ? Self.emptyColour : Color(.foreground))
                .accessibilityLabel(names.isEmpty ? "No assignees" : "Assignees: \(names)")
        case .title:
            titleCell(task)
        case .labels:
            Text(item.labels.isEmpty ? Self.emptyText : item.labels.map(\.title).joined(separator: ", "))
                .font(Theme.caption).lineLimit(1)
                .foregroundStyle(item.labels.isEmpty ? Self.emptyColour : Color(.foreground))
                .accessibilityLabel(item.labels.isEmpty ? "No labels" : "Labels: " + item.labels.map(\.title).joined(separator: ", "))
        case .done:
            Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.done ? Color(.success) : Color(.mutedForeground))
                .accessibilityLabel(task.done ? "Done" : "Not done")
        case .createdBy, .commentCount:
            // Unknown (not yet read from the server) shows a dash rather than a blank that reads as none.
            let text = TableCells.text(task, column, projectTitle: item.projectTitle, now: Date(), display: dateDisplay, extras: extras)
            Text(text ?? (Self.emptyText.isEmpty ? "–" : Self.emptyText))
                .font(Theme.caption)
                .foregroundStyle(text == nil ? Self.unknownColour : Color(.foreground))
                .accessibilityLabel("\(column.label): \(text ?? "unknown")")
        default:
            let text = TableCells.text(task, column, projectTitle: item.projectTitle, now: Date(), display: dateDisplay)
            Text(text ?? Self.emptyText)
                .font(Theme.caption)
                .foregroundStyle(text == nil ? Self.emptyColour : Color(.foreground))
                // Named per cell, so a row read cell by cell still says which column each value is.
                .accessibilityLabel(text.map { "\(column.label): \($0)" } ?? "")
                .accessibilityHidden(text == nil)
        }
    }
}

extension TableGridView {
    /// The sort indicator: a chevron on the Mac, an arrow on iPad.
    fileprivate static func sortSymbol(_ ascending: Bool) -> String {
        #if os(macOS)
        ascending ? "chevron.up" : "chevron.down"
        #else
        ascending ? "arrow.up" : "arrow.down"
        #endif
    }
}

#if os(macOS)
/// The selected row's 13% primary band: its cells fill the row's height and their column's width, so the tint has no
/// gaps. Unselected cells keep their own size (see the stripes note in `TableGridView`).
private struct TableSelectedBand: ViewModifier {
    let selected: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if selected {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .background(Color(.primary).opacity(0.13))
        } else {
            content
        }
    }
}
#endif
