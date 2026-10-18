import CriaKit
import SwiftUI

extension TableGridView {
    /// The title cell: the title, a parent's subtask ring, and a subtask's parent caption.
    func titleCell(_ task: TaskRecord) -> some View {
        NavigationLink(value: Route.task(task.localId)) {
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
                if let parent = parentTitles[task.localId] {
                    Text("Subtask of ‘\(parent)’")
                        .font(Theme.caption)
                        .foregroundStyle(Color(.mutedForeground))
                        .lineLimit(1)
                }
            }
        }
        .buttonStyle(.plain)
    }
}
