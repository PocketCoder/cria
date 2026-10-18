import CriaKit
import SwiftUI

/// One task row: priority ring, title, optional description, then tinted chips for subtasks, due date, project and
/// labels. A nested row is indented under its parent, with a guide line per level.
struct TaskRowView: View {
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: TaskListItem
    var showProject = false
    var tree = TaskRowTree()
    /// Just ticked: shown done and faded while the row waits a beat before it is saved and leaves the list.
    var completing = false
    let onToggle: () -> Void

    private var task: TaskRecord { item.task }

    /// The Mac's smaller ring is centred on the title's line, whatever the text size. iOS keeps the top alignment its
    /// 44pt target and the title's top inset were laid out for.
    private static var ringAlignment: VerticalAlignment {
        #if os(macOS)
        .rowTitleMid
        #else
        .top
        #endif
    }

    var body: some View {
        HStack(alignment: Self.ringAlignment, spacing: Theme.checkGap) {
            PriorityCheck(priority: task.priority, isDone: task.done || completing, action: onToggle)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Text(task.title)
                        .font(Theme.rowTitle)
                        .strikethrough(task.done || completing)
                        .foregroundStyle(task.done || completing ? Color(.mutedForeground) : Color(.foreground))
                        .lineLimit(typeSize.isAccessibilitySize ? 4 : 1)
                    if task.isFavorite {
                        Image(systemName: "star.fill").font(.footnote).foregroundStyle(Color(.warning))
                    }
                }
                .alignmentGuide(.rowTitleMid) { $0[VerticalAlignment.center] }
                .padding(.top, Theme.rowTitleTop)
                if let parent = tree.parentTitle {
                    Text("Subtask of ‘\(parent)’")
                        .font(Theme.caption)
                        .foregroundStyle(Color(.mutedForeground))
                        .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                        .padding(.top, 2)
                }
                metadata
                    .padding(.top, 6)
                    .padding(.bottom, 12)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, CGFloat(tree.depth) * TaskListNesting.indent)
        // Fades once the ring's burst has played.
        .opacity(completing && !task.done ? 0.45 : 1)
        .animation(.easeOut(duration: 0.3).delay(0.35), value: completing)
        .background(alignment: .leading) { guides }
        #if os(macOS)
        // The row's full height from the first layout, chips included.
        .fixedSize(horizontal: false, vertical: true)
        #endif
        .contentShape(Rectangle())
        // One VoiceOver element. The ring and the collapse chevron are not separate stops: TaskRowLink exposes them
        // as actions (the swipe actions and its own accessibility actions).
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spokenSummary))
    }

    /// "Buy milk, due tomorrow, high priority, not done", with the subtask, project and label details the chips show.
    private var spokenSummary: String {
        var parts = [task.title]
        if let parent = tree.parentTitle { parts.append("subtask of \(parent)") }
        if task.isFavorite { parts.append("starred") }
        if !task.done, let due = task.dueDate {
            let label = DueDates.label(due, now: Date(), display: dateDisplay)
            parts.append(DueDates.isOverdue(due, now: Date()) ? "overdue, due \(label)" : "due \(label)")
            if task.repeatAfter > 0 { parts.append("repeats") }
        }
        if task.priority > 0, TableCells.priorityNames.indices.contains(task.priority) {
            parts.append("\(TableCells.priorityNames[task.priority].lowercased()) priority")
        }
        if showProject && !task.done, let project = item.projectTitle { parts.append("in \(project)") }
        if !task.done, !item.labels.isEmpty {
            parts.append("labels \(item.labels.map(\.title).formatted(.list(type: .and)))")
        }
        if let progress = tree.progress {
            parts.append("\(progress.done) of \(progress.total) subtasks done")
            if tree.isCollapsed == true { parts.append("subtasks hidden") }
        }
        if !task.done { parts += signalDetails }
        parts.append(task.done ? "done" : "not done")
        return parts.joined(separator: ", ")
    }

    /// The due chip shows the repeat glyph (and the spoken summary says "repeats") for an interval repeat.
    private var dueChipRepeats: Bool { !task.done && task.dueDate != nil && task.repeatAfter > 0 }

    /// What the signals show, for VoiceOver.
    private var signalDetails: [String] {
        var parts: [String] = []
        if item.hasAttachments { parts.append("has attachments") }
        if item.checklist.total > 0 { parts.append("checklist \(item.checklist.checked) of \(item.checklist.total) done") }
        if tree.progress == nil, task.percentDone > 0, task.percentDone < 1 {
            parts.append("\(Int((task.percentDone * 100).rounded())) percent done")
        }
        if !dueChipRepeats, task.repeatAfter > 0 || task.repeatMode != 0 { parts.append("repeats") }
        return parts
    }

    /// One thin line per level, under each ancestor's ring.
    @ViewBuilder private var guides: some View {
        if tree.depth > 0 {
            ZStack(alignment: .leading) {
                ForEach(0..<tree.depth, id: \.self) { level in
                    Rectangle()
                        .fill(Color(.mutedForeground).opacity(0.25))
                        .frame(width: 1.5)
                        .offset(x: CGFloat(level) * TaskListNesting.indent + Theme.checkTarget / 2 - 1)
                }
            }
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder private var metadata: some View {
        let due = task.done ? nil : task.dueDate
        let others = task.done ? 0 : item.labels.count + (showProject && item.projectTitle != nil ? 1 : 0)
        let signals = !task.done && TaskRowSignals.hasAny(item, hasSubtaskChip: tree.progress != nil, repeatShownByDue: dueChipRepeats)
        if others + (due == nil ? 0 : 1) > 0 || tree.progress != nil || signals {
            // Chips stack at accessibility sizes, where a row of them would truncate.
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 6))
            layout {
                if let progress = tree.progress { subtaskChip(progress) }
                if let due {
                    let overdue = DueDates.isOverdue(due, now: Date())
                    CriaChip(
                        text: DueDates.label(due, now: Date(), display: dateDisplay),
                        systemImage: task.repeatAfter > 0 ? "repeat" : "calendar",
                        tint: overdue ? Color(.destructive) : Color(.mutedForeground)
                    )
                }
                if showProject && !task.done, let title = item.projectTitle {
                    CriaChip(text: title, tint: Color(.mutedForeground))
                }
                if signals {
                    TaskRowSignals(item: item, hasSubtaskChip: tree.progress != nil, repeatShownByDue: dueChipRepeats)
                }
                if !task.done {
                    ForEach(item.labels.prefix(3), id: \.localId) { label in
                        CriaChip(text: label.title, systemImage: "tag", tint: Color(hexString: label.hexColor) ?? Color(.info))
                    }
                }
            }
        }
    }

    /// "2/5" subtasks done. Where the children are nested here it also collapses them, with a chevron showing which
    /// way; the padding widens the tap target without moving the chip.
    @ViewBuilder private func subtaskChip(_ progress: SubtaskProgress) -> some View {
        let tint = progress.done == progress.total ? Color(.success) : Color(.mutedForeground)
        let text = "\(progress.done)/\(progress.total)"
        if let collapsed = tree.isCollapsed {
            Button(action: tree.onToggleCollapsed) {
                CriaChip(text: text, systemImage: collapsed ? "chevron.right" : "chevron.down", tint: tint)
                    .padding(8)
                    .contentShape(Rectangle())
                    .padding(-8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(collapsed ? "Show subtasks" : "Hide subtasks")
        } else {
            CriaChip(text: text, systemImage: "list.bullet.indent", tint: tint)
                .accessibilityLabel("\(progress.done) of \(progress.total) subtasks done")
        }
    }
}

extension VerticalAlignment {
    private enum RowTitleMid: AlignmentID {
        static func defaultValue(in context: ViewDimensions) -> CGFloat { context[VerticalAlignment.center] }
    }

    /// The middle of a task row's title line, which the Mac's ring is centred on.
    static let rowTitleMid = VerticalAlignment(RowTitleMid.self)
}
