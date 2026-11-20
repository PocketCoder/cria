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
    /// Set while the title is being renamed in place (a double-click on the Mac).
    var rename: RowRename?
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
        #if os(macOS)
        macBody
        #else
        HStack(alignment: Self.ringAlignment, spacing: Theme.checkGap) {
            PriorityCheck(priority: task.priority, isDone: task.done || completing, action: onToggle)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    #if os(macOS)
                    if let rename {
                        RowTitleField(rename: rename)
                    } else {
                        titleText
                    }
                    #else
                    titleText
                    #endif
                    if task.isFavorite {
                        Image(systemName: "star.fill").font(.footnote).foregroundStyle(Color(.warning))
                    }
                }
                .alignmentGuide(.rowTitleMid) { $0[VerticalAlignment.center] }
                .padding(.top, Theme.rowTitleTop)
                #if os(macOS)
                // The description's first words, as the desktop app's rows show them.
                if let summary = item.summary, !task.done {
                    Text(summary)
                        .font(Theme.caption)
                        .foregroundStyle(Color(.mutedForeground))
                        .lineLimit(1)
                        .padding(.top, 2)
                }
                #endif
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
        .accessibilityElement(children: rename == nil ? .ignore : .contain)
        .accessibilityLabel(Text(spokenSummary))
        #endif
    }

    private var titleText: some View {
        Text(task.title)
            .font(Theme.rowTitle)
            .strikethrough(task.done || completing)
            .foregroundStyle(task.done || completing ? Color(.mutedForeground) : Color(.foreground))
            .lineLimit(typeSize.isAccessibilitySize ? 4 : 1)
    }

    /// "Buy milk, due tomorrow, high priority, not done", with the subtask, project and label details the chips show.
    private var spokenSummary: String {
        var parts = [task.title]
        #if os(macOS)
        if let summary = item.summary, !task.done { parts.append(summary) }
        #endif
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
        if let percent = TaskRowSignals.percent(task) { parts.append("\(percent) percent done") }
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
        let signals = !task.done && TaskRowSignals.hasAny(item, repeatShownByDue: dueChipRepeats)
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
                    TaskRowSignals(item: item, repeatShownByDue: dueChipRepeats)
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
            .macPointer()
            .accessibilityLabel(collapsed ? "Show subtasks" : "Hide subtasks")
        } else {
            CriaChip(text: text, systemImage: "list.bullet.indent", tint: tint)
                .accessibilityLabel("\(progress.done) of \(progress.total) subtasks done")
        }
    }
}

#if os(macOS)
/// The Mac row from the macOS design: an 18pt ring, the title in SF 13 and one grey SF 11 meta line (due date, repeat,
/// description, attachments and labels, then the project on the trailing edge). TaskRowLink draws the hover and
/// selected fills. A completed row stays, struck through, until the screen goes (`RecentlyCompleted`).
extension TaskRowView {
    var macBody: some View {
        HStack(alignment: .rowTitleMid, spacing: 7) {
            // A parent's disclosure arrow in a gutter every row of the list keeps, so the rings line up.
            if tree.reservesDisclosure {
                macDisclosure
                    .frame(width: 14, height: 18)
                    .alignmentGuide(.rowTitleMid) { $0[VerticalAlignment.center] }
            }
            // A subtask's ring is a little smaller than its parent's.
            PriorityCheck(
                priority: task.priority, isDone: task.done || completing, size: tree.depth > 0 ? 16 : Theme.checkSize,
                action: onToggle
            )
                // The ring's 24pt target overhangs the 18pt title line; it must not add to the row's height.
                .padding(.vertical, -3)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if let rename {
                        RowTitleField(rename: rename)
                    } else {
                        Text(task.title)
                            .font(.system(size: 13))
                            .strikethrough(task.done || completing)
                            .foregroundStyle(task.done || completing ? MacTheme.label3 : Color(.foreground))
                            .lineLimit(typeSize.isAccessibilitySize ? 4 : 1)
                    }
                    if task.isFavorite {
                        Image(systemName: "star.fill").font(.system(size: 11)).foregroundStyle(MacTheme.marigold)
                    }
                }
                .frame(minHeight: 18)
                .alignmentGuide(.rowTitleMid) { $0[VerticalAlignment.center] }
                // No description excerpt: the meta line's notes glyph says there is one, and the inspector shows it.
                if let parent = tree.parentTitle {
                    Text("Subtask of ‘\(parent)’")
                        .font(.system(size: 11))
                        .foregroundStyle(MacTheme.label3)
                        .lineLimit(1)
                }
                if macHasMeta { macMeta }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        // No indent or guide lines here: TaskRowLink indents a subtask outside its highlight and draws its group.
        .animation(.easeOut(duration: 0.2), value: completing)
        // 8 by 12 around the content; the ring's 24pt target already gives 3 of the leading 12. With the arrow's
        // gutter, 4 keeps the arrow clear of the row's edge.
        .padding(.leading, tree.reservesDisclosure ? 4 : 9)
        .padding(.trailing, 12)
        .fixedSize(horizontal: false, vertical: true)
        .contentShape(Rectangle())
        .accessibilityElement(children: rename == nil ? .ignore : .contain)
        .accessibilityLabel(Text(spokenSummary))
    }

    private var macHasMeta: Bool {
        tree.progress != nil || task.dueDate != nil || TaskRowSignals.percent(task) != nil
            || task.repeatAfter > 0 || task.repeatMode != 0 || macHasDescription
            || item.hasAttachments || item.checklist.total > 0 || !item.labels.isEmpty
            || (showProject && item.projectTitle != nil)
    }

    /// A description with any text or image in it; an editor's empty paragraph does not count. The text check uses
    /// the summary the store read already made off the main thread, not a regex per row per render.
    private var macHasDescription: Bool {
        guard let html = task.description, !html.isEmpty else { return false }
        return item.summary != nil || html.contains("<img")
    }

    private var macMeta: some View {
        // The order every Mac row and card uses (`MacSignal`): subtasks, due, repeat, checklist, notes, attachments, labels.
        HStack(spacing: 10) {
            if let progress = tree.progress { MacSignal.subtasks(done: progress.done, total: progress.total) }
            if let due = task.dueDate {
                MacSignal(systemImage: "calendar", text: DueDates.label(due, now: Date(), display: dateDisplay), tint: macDueTint(due))
            }
            if let percent = TaskRowSignals.percent(task) { MacSignal(systemImage: "chart.pie", text: "\(percent)%") }
            if task.repeatAfter > 0 || task.repeatMode != 0 { MacSignal(systemImage: "repeat", spoken: "Repeats") }
            if item.checklist.total > 0 {
                MacSignal(
                    systemImage: "checklist", text: "\(item.checklist.checked)/\(item.checklist.total)",
                    spoken: "Checklist \(item.checklist.checked) of \(item.checklist.total) done"
                )
            }
            if macHasDescription { MacSignal(systemImage: "text.alignleft", spoken: "Has notes") }
            if item.hasAttachments { MacSignal(systemImage: "paperclip", spoken: "Has attachments") }
            ForEach(item.labels.prefix(3), id: \.localId) { label in MacLabelTag(label: label) }
            Spacer(minLength: 0)
            if showProject, let project = item.projectTitle {
                HStack(spacing: 4) {
                    Circle().fill(MacTheme.label3).frame(width: 7, height: 7)
                    Text(project)
                }
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(MacTheme.label2)
        .lineLimit(1)
        .frame(minHeight: 16)
    }

    /// Coral when overdue, otherwise the secondary shade, due today included: the accent is kept for state.
    private func macDueTint(_ due: String) -> Color {
        if task.done || completing { return MacTheme.label2 }
        if DueDates.isOverdue(due, now: Date()) { return MacTheme.coral }
        return MacTheme.label2
    }

    /// A parent's chevron, rotating as its subtasks show and hide. Nothing for a row with no children here.
    @ViewBuilder private var macDisclosure: some View {
        if let collapsed = tree.isCollapsed {
            Button(action: tree.onToggleCollapsed) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(MacTheme.label3)
                    .rotationEffect(.degrees(collapsed ? 0 : 90))
                    .animation(.snappy(duration: 0.2), value: collapsed)
                    .frame(width: 14, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .macHoverable()
            .accessibilityLabel(collapsed ? "Show subtasks" : "Hide subtasks")
        }
    }
}
#endif

extension VerticalAlignment {
    private enum RowTitleMid: AlignmentID {
        static func defaultValue(in context: ViewDimensions) -> CGFloat { context[VerticalAlignment.center] }
    }

    /// The middle of a task row's title line, which the Mac's ring is centred on.
    static let rowTitleMid = VerticalAlignment(RowTitleMid.self)
}
