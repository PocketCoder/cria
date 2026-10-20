import CriaKit
import SwiftUI

/// A label waiting for delete confirmation, with how many tasks carry it.
struct LabelDeleteTarget {
    let label: LabelRecord
    let taskCount: Int

    var message: String {
        let name = "\u{201C}\(label.title)\u{201D}"
        switch taskCount {
        case 0: return "No tasks carry \(name). This cannot be undone."
        case 1: return "\(name) will be removed from 1 task. This cannot be undone."
        default: return "\(name) will be removed from \(taskCount) tasks. This cannot be undone."
        }
    }
}

struct FilterEditorTarget: Identifiable {
    let record: SavedFilterRecord?
    var id: Int { record?.serverId ?? 0 }
}

/// A project in the tree. The colour dot sits in the label's icon column, so a root project lines up with Inbox and
/// Favourites; children indent by depth only. The expand chevron sits at the trailing end.
struct ProjectRowView: View {
    let row: ProjectTreeRow
    let openCount: Int
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            NavigationLink(value: Route.project(row.project.localId)) {
                HStack(spacing: 8) {
                    Label {
                        Text(row.project.title).font(Theme.rowTitle)
                    } icon: {
                        Circle()
                            .fill(Color(hexString: row.project.hexColor) ?? Color(.mutedForeground))
                            .frame(width: 12, height: 12)
                    }
                    if row.project.isFavorite {
                        Image(systemName: "star.fill").font(Theme.footnote).foregroundStyle(Color(.warning))
                    }
                    Spacer(minLength: 0)
                    if openCount > 0 {
                        Text("\(openCount)").font(Theme.rowTitle).foregroundStyle(Color(.mutedForeground))
                    }
                }
            }
            if row.hasChildren { toggle }
        }
        .padding(.leading, CGFloat(row.depth) * 22)
    }

    /// Beside the link, not inside it, so a tap here expands or collapses instead of opening the project.
    private var toggle: some View {
        Button(action: onToggle) {
            Image(systemName: "chevron.down")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(.mutedForeground))
                .rotationEffect(.degrees(row.isExpanded ? 180 : 0))
                .animation(.spring(duration: 0.24, bounce: 0.25), value: row.isExpanded)
                .frame(width: 32, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(row.isExpanded ? "Collapse \(row.project.title)" : "Expand \(row.project.title)")
    }
}
