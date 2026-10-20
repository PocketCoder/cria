#if os(macOS)
import CriaKit
import SwiftUI

/// Resting the mouse on a row for a moment shows a small popover with the task's title, dates, project, labels and the
/// start of its description, as `TaskHoverPreview.tsx` does in the desktop app. Mac only: touch has no hover.
struct TaskHoverPreview: ViewModifier {
    static let delay: Duration = .milliseconds(600)

    let item: TaskListItem
    @Environment(\.dateDisplay) private var dateDisplay
    @State private var showing = false
    @State private var pending: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .onHover { inside in
                pending?.cancel()
                pending = nil
                if inside {
                    pending = Task { @MainActor in
                        try? await Task.sleep(for: Self.delay)
                        guard !Task.isCancelled else { return }
                        showing = true
                    }
                } else {
                    showing = false
                }
            }
            .onDisappear {
                pending?.cancel()
                showing = false
            }
            .popover(isPresented: $showing, arrowEdge: .bottom) { preview }
    }

    private var preview: some View {
        let task = item.task
        return VStack(alignment: .leading, spacing: 6) {
            (Text(task.identifier.map { "\($0) " } ?? "").foregroundStyle(MacTheme.label2) + Text(task.title))
                .font(.system(size: 13, weight: .medium))
                .lineLimit(3)
            details
            if !item.labels.isEmpty {
                HStack(spacing: 4) {
                    ForEach(item.labels.prefix(4), id: \.localId) { label in
                        CriaChip(text: label.title, systemImage: "tag", tint: Color(hexString: label.hexColor) ?? Color(.info))
                    }
                }
            }
            if let excerpt = TaskSummary.line(task.description, maxLength: 150) {
                Text(excerpt).font(.system(size: 11)).foregroundStyle(MacTheme.label2).lineLimit(3)
            }
        }
        .padding(12)
        .frame(width: 300, alignment: .leading)
        .allowsHitTesting(false)
    }

    @ViewBuilder private var details: some View {
        let task = item.task
        let parts = detailLines(task)
        if !parts.isEmpty {
            Text(parts.joined(separator: "  ·  ")).font(.system(size: 11)).foregroundStyle(MacTheme.label2)
        }
    }

    private func detailLines(_ task: TaskRecord) -> [String] {
        var parts: [String] = []
        if let due = task.dueDate { parts.append("Due " + DueDates.label(due, now: Date(), display: dateDisplay)) }
        if let start = task.startDate { parts.append("Starts " + DueDates.label(start, now: Date(), display: dateDisplay)) }
        if task.priority > 2, TableCells.priorityNames.indices.contains(task.priority) {
            parts.append(TableCells.priorityNames[task.priority])
        }
        if let project = item.projectTitle { parts.append(project) }
        return parts
    }
}
#endif
