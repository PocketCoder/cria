import CriaKit
import SwiftUI

/// The dates a table cell can edit in place.
enum TableDateField: String {
    case due, start, end

    var title: String {
        switch self {
        case .due: return "Due date"
        case .start: return "Start date"
        case .end: return "End date"
        }
    }
}

/// Which cell is being edited in place, so the screen can present the right picker.
enum TableCellEdit: Identifiable, Equatable {
    case labels(String)
    case assignees(String)
    case date(String, TableDateField)

    var id: String {
        switch self {
        case .labels(let task): return "labels-\(task)"
        case .assignees(let task): return "assignees-\(task)"
        case .date(let task, let field): return "\(field.rawValue)-\(task)"
        }
    }
}

enum TableEditing {
    /// The columns that can be edited in place when "Edit cells" is on.
    static func isEditable(_ column: TableViewColumn) -> Bool {
        switch column {
        case .labels, .assignees, .dueDate, .startDate, .endDate: return true
        default: return false
        }
    }

    static func edit(_ column: TableViewColumn, task taskLocalId: String) -> TableCellEdit? {
        switch column {
        case .labels: return .labels(taskLocalId)
        case .assignees: return .assignees(taskLocalId)
        case .dueDate: return .date(taskLocalId, .due)
        case .startDate: return .date(taskLocalId, .start)
        case .endDate: return .date(taskLocalId, .end)
        default: return nil
        }
    }
}

/// A label, assignee or date cell that opens its picker when tapped. In the iPhone rows it is a chip (an empty one
/// names what it would add); in the wide grid it is the cell's text.
struct TableEditCell: View {
    let column: TableViewColumn
    let item: TaskListItem
    let assignees: [AssigneeRecord]
    let compact: Bool
    let onEdit: (TableCellEdit) -> Void
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.colorScheme) private var colorScheme

    private var task: TaskRecord { item.task }

    /// The cell's current value as text, or nil when it is empty.
    private var value: String? {
        switch column {
        case .labels:
            return item.labels.isEmpty ? nil : item.labels.map(\.title).joined(separator: ", ")
        case .assignees:
            return assignees.isEmpty ? nil : assignees.map(AssigneesSection.name).joined(separator: ", ")
        default:
            return TableCells.text(task, column, projectTitle: item.projectTitle, now: Date(), display: dateDisplay)
        }
    }

    private var placeholder: String {
        switch column {
        case .labels: return "Labels"
        case .assignees: return "Assignees"
        case .dueDate: return "Due"
        case .startDate: return "Start"
        default: return "End"
        }
    }

    private var icon: String {
        switch column {
        case .labels: return "tag"
        case .assignees: return "person"
        default: return "calendar"
        }
    }

    private var tint: Color {
        guard value != nil else { return Color(.mutedForeground) }
        switch column {
        case .labels: return item.labels.first.flatMap { LegibleTint.chip($0.hexColor, scheme: colorScheme) } ?? Color(.info)
        case .dueDate:
            if let due = task.dueDate, !task.done, DueDates.isOverdue(due, now: Date()) { return Color(.destructive) }
            return Color(.mutedForeground)
        default: return Color(.mutedForeground)
        }
    }

    var body: some View {
        if let edit = TableEditing.edit(column, task: task.localId) {
            Button { onEdit(edit) } label: { content }
                .buttonStyle(.plain)
                .accessibilityLabel("\(column.label): \(value ?? "none")")
                .accessibilityHint("Edits this cell")
        }
    }

    @ViewBuilder private var content: some View {
        if compact {
            CriaChip(text: value ?? placeholder, systemImage: icon, tint: tint)
        } else {
            Text(value ?? "–")
                .font(Theme.caption)
                .lineLimit(1)
                .foregroundStyle(value == nil ? Color(.mutedForeground) : Color(.foreground))
                .frame(minHeight: 28, alignment: .leading)
                .contentShape(Rectangle())
        }
    }
}
