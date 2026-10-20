import CriaKit
import SwiftUI

/// The Gantt view: a scrolling timeline with day and week zoom, task bars you drag to change dates, a today
/// marker and dependency arrows. Tasks with no dates wait in a tray: tap one to open it, or drag it onto the chart.
struct GanttScreen: View {
    let services: AppServices
    let projectLocalId: String
    /// The project's colour, for bars without one of their own (the Mac's bars).
    var projectColour: String?
    @State private var live: LiveValue<GanttData>
    @AppStorage("cria.gantt.weekZoom") private var weekZoom = false
    /// Off by default, as in the web app: finished tasks clutter the timeline.
    @AppStorage("cria.gantt.showDone") private var showDone = false
    /// Date range and the no-dates tray, kept on this device (see `GanttFilters`).
    @AppStorage(GanttFilters.storageKey) private var filtersText = ""
    @State private var filtering = false
    /// iOS: when on, a long press then vertical drag on a bar reorders its row (among its siblings) instead of moving its dates.
    /// The Mac drags rows in its task column instead.
    @State private var reordering = false
    @State private var optimistic = OptimisticOrder()
    /// The parent whose children `optimistic` orders; nil for the top-level rows.
    @State private var optimisticParent: String?
    @State private var reorders = 0

    init(services: AppServices, projectLocalId: String, projectColour: String? = nil) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.projectColour = projectColour
        let store = services.store
        _live = State(initialValue: LiveValue(initial: GanttData(nodes: [], edges: [])) {
            observeStore(store, kinds: [.tasks, .projects]) { reading in
                try reading.ganttData(projectLocalId: projectLocalId, includeDone: true)
            }
        })
    }

    private var dayWidth: Double {
        #if os(macOS)
        // The Mac design's 56pt day columns.
        weekZoom ? GanttMetrics.weekZoomDayWidth : 56
        #else
        weekZoom ? GanttMetrics.weekZoomDayWidth : GanttMetrics.dayWidth
        #endif
    }
    private var today: Int { GanttTree.localDay(of: Date()) }
    /// The loaded data without finished tasks unless "Show done" is on. The range and arrows follow what is shown.
    private var shown: GanttData {
        showDone ? live.value : GanttData(nodes: live.value.nodes.filter { !$0.done }, edges: live.value.edges)
    }
    private var filters: GanttFilters { GanttFilters.from(stored: filtersText) }
    /// The range the tasks alone would give. A date range chosen in the filters replaces it.
    private var automaticRange: GanttDayRange { shown.dayRange(today: today) }
    private var range: GanttDayRange { filters.range(automatic: automaticRange) }
    private var storedDatedNodes: [GanttNode] {
        filters.visible(GanttTree.visible(shown.nodes, collapsed: [], showDateless: false), in: range)
    }
    /// The rows in stored order with a just-dropped reorder laid over them until the store catches up.
    private var datedNodes: [GanttNode] {
        let stored = storedDatedNodes
        let siblings = GanttTree.siblingIds(of: optimisticParent, in: stored)
        return GanttTree.reorderSiblingBlocks(stored, parent: optimisticParent, order: optimistic.resolve(siblings))
    }
    private var datelessNodes: [GanttNode] {
        guard filters.showUndated else { return [] }
        return shown.nodes.filter { $0.startDay == nil && $0.endDay == nil }
    }

    var body: some View {
        VStack(spacing: 0) {
            if shown.nodes.isEmpty {
                ContentUnavailableView {
                    Label("No tasks yet", systemImage: "chart.bar.doc.horizontal")
                } description: {
                    Text("Tasks with a start and end date or a due date show on the timeline.")
                }
            } else {
                GanttChart(
                    services: services, data: shown, nodes: datedNodes, range: range,
                    dayWidth: dayWidth, weekZoom: weekZoom, projectColour: projectColour, reordering: reordering,
                    onReorder: { id, rows in reorder(id, by: rows) }
                )
                if !datelessNodes.isEmpty {
                    GanttTray(services: services, nodes: datelessNodes, today: today)
                }
            }
        }
        .background(Color(.background))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Gantt options", systemImage: "ellipsis.circle") {
                    Picker("Zoom", selection: $weekZoom) {
                        Label("Days", systemImage: "calendar.day.timeline.left").tag(false)
                        Label("Weeks", systemImage: "calendar").tag(true)
                    }
                    Toggle("Show done", isOn: $showDone)
                    #if os(iOS)
                    Toggle("Reorder rows", systemImage: "arrow.up.arrow.down", isOn: $reordering)
                    #endif
                    Button("Filters", systemImage: "line.3.horizontal.decrease.circle") { filtering = true }
                }
            }
        }
        .sheet(isPresented: $filtering) {
            GanttFilterSheet(filters: Binding(get: { filters }, set: { filtersText = $0.stored }), automatic: automaticRange)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: reorders)
        .task { await live.run() }
    }

    /// Drops a row `rows` places up or down among its siblings (a subtask stays under its parent) and writes the
    /// positions the way the list view does.
    private func reorder(_ movedId: String, by rows: Int) {
        guard let change = GanttTree.siblingOrder(afterMoving: movedId, rowOffset: rows, in: datedNodes) else { return }
        optimisticParent = change.parent
        optimistic.set(change.order, over: GanttTree.siblingIds(of: change.parent, in: storedDatedNodes))
        do {
            guard let viewId = try services.store.listViewLocalId(projectLocalId: projectLocalId) else { return }
            try services.store.applyListReorder(orderedIds: change.order, movedId: movedId, viewLocalId: viewId)
            reorders += 1
        } catch {
            optimistic = OptimisticOrder()
        }
    }
}

/// Tasks with no dates. Tapping one opens it to set dates; dragging one onto the chart schedules it from the day it
/// lands on.
struct GanttTray: View {
    let services: AppServices
    let nodes: [GanttNode]
    let today: Int
    @Environment(UndoCenter.self) private var undo: UndoCenter?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No dates · tap to open, or drag onto the timeline")
                .font(Theme.caption)
                .foregroundStyle(Color(.mutedForeground))
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(nodes, id: \.taskLocalId) { node in chip(node) }
                }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.grouped))
        .overlay(alignment: .top) { Divider() }
    }

    private func chip(_ node: GanttNode) -> some View {
        NavigationLink(value: Route.task(node.taskLocalId)) {
            Label(node.title, systemImage: "calendar.badge.plus")
                .font(Theme.rowSubtitle)
                .lineLimit(1)
                .foregroundStyle(Color(.foreground))
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(Color(.cell), in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .draggable(KanbanPayload.make(node.taskLocalId))
        .contextMenu {
            Button("Schedule from today", systemImage: "calendar") { schedule(node) }
        }
        .accessibilityHint("Opens the task so you can set its dates")
        .accessibilityAction(named: "Schedule from today") { schedule(node) }
    }

    /// Gives a dateless task a default span starting today.
    private func schedule(_ node: GanttNode) {
        _ = try? undo.setGanttDates(
            services, taskLocalId: node.taskLocalId, start: today, end: today + GanttMetrics.defaultSpanDays - 1
        )
    }
}

/// One task bar. Dragging the body moves it; the end handles resize. A plain tap opens the task.
struct GanttBar: View {
    /// Handles are 16pt each, so a bar narrower than this has no room for them beside its body.
    private static let minimumWidthForHandles: Double = 48

    let place: GanttPlacement
    let node: GanttNode
    let dayWidth: Double
    @Binding var drag: GanttDrag?
    /// The bar's height, from the chart's layout.
    let height: Double
    /// The project's colour, used when the task has none.
    var fallbackColour: String?
    var reordering = false
    var onReorder: (Int) -> Void = { _ in }
    let onOpen: () -> Void
    let onCommit: (Int, Int) -> Void
    /// When a gesture last moved the bar. A tap within `tapSuppression` of it is the lift of that drag, not a tap.
    /// A time stamp rather than a flag, so a gesture that is cancelled (no `onEnded`) cannot block taps for good.
    @State private var lastDragAt: Date?
    /// Counts drags that changed the dates, for the drop haptic.
    @State private var commits = 0
    /// The vertical drag of this bar's row while reordering, in points.
    @State private var rowDrag: Double = 0
    private static let tapSuppression: TimeInterval = 0.5

    var body: some View {
        ZStack(alignment: .leading) {
            barShape
            Text(node.title)
                .font(Theme.caption)
                .foregroundStyle(textColor)
                .lineLimit(1)
                .padding(.horizontal, 10)
                // Rows are a fixed height, so very large text would spill out of the bar; the label caps instead.
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        }
        .frame(width: place.width, height: height)
        .contentShape(Rectangle())
        .onTapGesture {
            if let lastDragAt, Date().timeIntervalSince(lastDragAt) < Self.tapSuppression { return }
            onOpen()
        }
        // A long press first, so a scroll that starts on a bar scrolls instead of moving it and changing its dates.
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.25)
                .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .global))
                .onChanged { value in
                    if case .second(true, let moving?) = value { update(.move, translation: moving.translation.width) }
                }
                .onEnded { _ in finish() },
            including: canReorder ? .none : .all
        )
        .simultaneousGesture(reorderGesture, including: canReorder ? .all : .none)
        .offset(y: rowDrag)
        .zIndex(rowDrag == 0 ? 0 : 1)
        .overlay(alignment: .leading) { if !reordering { handle(.resizeStart) } }
        .overlay(alignment: .trailing) { if !reordering { handle(.resizeEnd) } }
        // A tick as this bar's dates move by a whole day while it is dragged, a light impact when it is let go.
        .sensoryFeedback(trigger: movingDays) { old, new in old != nil && new != nil ? SensoryFeedback.selection : nil }
        .sensoryFeedback(.impact(weight: .light), trigger: commits)
        .ganttKeyNudge { direction, edge in
            if let next = GanttGeometry.nudge(place.resolved, direction: direction, edge: edge) {
                onCommit(next.start, next.end)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onOpen() }
        // Dragging is not available to VoiceOver, so moving by a day is an action on the bar.
        .accessibilityActions {
            Button("Move row up") { onReorder(-1) }
            Button("Move row down") { onReorder(1) }
            if !place.resolved.dateless {
                Button("Move a day earlier") { shift(-1) }
                Button("Move a day later") { shift(1) }
            }
        }
    }

    /// Any row reorders among its siblings; a parent's subtasks ride along with it.
    private var canReorder: Bool { reordering }

    /// Long press, then drag up or down: the row lands where it is let go (see `GanttTree.siblingOrder`).
    private var reorderGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.25)
            .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .global))
            .onChanged { value in
                if case .second(true, let moving?) = value {
                    lastDragAt = Date()
                    rowDrag = moving.translation.height
                }
            }
            .onEnded { _ in
                let rows = Int((rowDrag / GanttChart.Layout.row).rounded())
                lastDragAt = Date()
                rowDrag = 0
                if rows != 0 {
                    commits += 1
                    onReorder(rows)
                }
            }
    }

    /// How many days this bar is dragged by, nil when it is not the one being dragged.
    private var movingDays: Int? {
        drag?.taskLocalId == place.taskLocalId ? drag?.deltaDays : nil
    }

    /// "Task, 3 to 7 June", noting derived or missing dates and a finished task.
    private var spokenLabel: String {
        var parts = [node.title, SpokenText.dayRange(start: place.resolved.start, end: place.resolved.end)]
        if place.isPlaceholder { parts.append(place.resolved.dateless ? "no dates set" : "estimated dates") }
        if node.done { parts.append("done") }
        return parts.joined(separator: ", ")
    }

    /// The Mac design: radius 7, the task's (else the project's) colour at 26% with a 1pt ring at 55%. iOS: a solid bar.
    @ViewBuilder private var barShape: some View {
        #if os(macOS)
        let tint = Color(hexString: place.color ?? fallbackColour) ?? Color(.primary)
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(tint.opacity(place.isPlaceholder ? 0.12 : 0.26))
            .overlay {
                RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(tint.opacity(0.55), lineWidth: 1)
            }
        #else
        RoundedRectangle(cornerRadius: 6).fill((Color(hexString: place.color) ?? Color(.primary)).opacity(place.isPlaceholder ? 0.35 : 0.9))
        #endif
    }

    /// White or black, whichever reads on the bar. A placeholder bar is a pale wash, so it takes the text colour, as
    /// does every Mac bar (a 26% tint).
    private var textColor: Color {
        #if os(macOS)
        return Color(.foreground)
        #else
        if place.isPlaceholder { return Color(.foreground) }
        return place.color == nil ? Color(.primaryForeground) : LegibleTint.onFill(place.color)
        #endif
    }

    private func shift(_ days: Int) {
        onCommit(place.resolved.start + days, place.resolved.end + days)
    }

    /// The resize handle, shown only when the bar is wide enough that it does not cover the whole bar.
    @ViewBuilder private func handle(_ mode: GanttDragMode) -> some View {
        if place.width > Self.minimumWidthForHandles {
            Color.clear.frame(width: 16, height: height).contentShape(Rectangle()).gesture(dragGesture(mode))
        }
    }

    /// Global space: the bar follows the finger, so a gesture measured in the bar's own space would see its
    /// translation shrink as the bar moves and jitter.
    private func dragGesture(_ mode: GanttDragMode) -> some Gesture {
        DragGesture(minimumDistance: GanttMetrics.dragThreshold, coordinateSpace: .global)
            .onChanged { value in update(mode, translation: value.translation.width) }
            .onEnded { _ in finish() }
    }

    private func update(_ mode: GanttDragMode, translation: Double) {
        lastDragAt = Date()
        drag = GanttDrag(
            taskLocalId: place.taskLocalId, mode: mode, originalStart: place.resolved.start,
            originalEnd: place.resolved.end, deltaDays: Int((translation / dayWidth).rounded())
        )
    }

    private func finish() {
        defer { drag = nil }
        guard let finished = drag else { return }
        lastDragAt = Date()
        let days = GanttGeometry.apply(finished)
        if days.start != finished.originalStart || days.end != finished.originalEnd {
            commits += 1
            onCommit(days.start, days.end)
        }
    }
}
