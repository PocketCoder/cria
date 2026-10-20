import CriaKit
import SwiftUI

// MARK: Header

extension KanbanColumnView {
    var header: some View {
        HStack(spacing: 6) {
            if !compact { collapseButton }
            // Title, count and role badges read as one heading, e.g. "To do, 3 of 5 tasks, full, Done column".
            HStack(spacing: 6) {
                Text(column.bucket.title)
                    .font(Self.titleFont)
                    .foregroundStyle(Color(.foreground))
                    .lineLimit(2)
                Text(countText)
                    .font(Theme.caption)
                    .monospacedDigit()
                    .foregroundStyle(column.atLimit ? Color(.destructive) : Self.countColour)
                    .accessibilityLabel(spokenCount)
                roleBadge
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            if !readOnly && !compact { columnMenu }
        }
        .padding(.leading, 4)
        .frame(minHeight: Self.headerHeight)
    }

    /// Folds the column into a strip (remembered for this view on this device).
    var collapseButton: some View {
        Button(action: onToggleCollapse) {
            Image(systemName: "chevron.down")
                .font(Theme.caption.weight(.semibold))
                .foregroundStyle(Color(.mutedForeground))
                .frame(width: 24, height: Self.headerHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Collapse \(column.bucket.title)")
    }

    var columnMenu: some View {
        let roles = Kanban.roles(of: column.bucket, in: view)
        return Menu {
            #if os(macOS)
            macColumnMenu(isDone: roles.isDone)
            #else
            Button("Edit column", systemImage: "pencil") { onEdit() }
            // The roles are stored by server id, so a column that has not synced yet cannot take one.
            if column.bucket.serverId != nil {
                Button(roles.isDone ? "Stop using as done column" : "Set as done column", systemImage: "checkmark.circle") {
                    onSetRole(.done)
                }
                Button(roles.isDefault ? "Stop using as default column" : "Set as default column", systemImage: "flag") {
                    onSetRole(.defaultColumn)
                }
            }
            #endif
        } label: {
            Image(systemName: "ellipsis")
                .font(Theme.rowSubtitle.weight(.semibold))
                .foregroundStyle(Color(.mutedForeground))
                .frame(width: 36, height: Self.headerHeight)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("Options for \(column.bucket.title)")
    }

    @ViewBuilder var roleBadge: some View {
        let roles = Kanban.roles(of: column.bucket, in: view)
        if roles.isDone {
            Image(systemName: "checkmark.circle.fill")
                .font(Theme.caption)
                .foregroundStyle(Color(.success))
                .accessibilityLabel("Done column")
        }
        if roles.isDefault {
            Image(systemName: "flag.fill")
                .font(Theme.caption)
                .foregroundStyle(Color(.primary))
                .accessibilityLabel("Default column")
        }
    }

    var spokenCount: String {
        let count = column.tasks.count
        guard column.bucket.limit > 0 else { return SpokenText.tasks(count) }
        return "\(count) of \(column.bucket.limit) tasks" + (column.atLimit ? ", full" : "")
    }

    var countText: String {
        column.bucket.limit > 0 ? "\(column.tasks.count)/\(column.bucket.limit)" : "\(column.tasks.count)"
    }
}
