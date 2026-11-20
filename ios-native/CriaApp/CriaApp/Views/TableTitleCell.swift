import CriaKit
import SwiftUI

extension TableGridView {
    /// The title cell: the title, a parent's subtask ring, and either an indent under a parent shown above it or a
    /// subtask's parent caption.
    func titleCell(_ task: TaskRecord) -> some View {
        let depth = depths[task.localId] ?? 0
        return NavigationLink(value: Route.task(task.localId)) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(task.title)
                        .font(Theme.rowTitle)
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                        .lineLimit(2)
                    if let progress = progress[task.localId] {
                        SubtaskRing(progress: progress).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
                if depth == 0, let parent = parentTitles[task.localId] {
                    Text("Subtask of ‘\(parent)’")
                        .font(Theme.caption)
                        .foregroundStyle(Color(.mutedForeground))
                        .lineLimit(1)
                }
            }
            .padding(.leading, CGFloat(depth) * 18)
        }
        .buttonStyle(.plain)
        .macPointer()
    }
}
