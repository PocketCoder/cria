import CriaKit
import SwiftUI

/// The Gantt view: a scrolling timeline with day and week zoom, task bars you drag to change dates, a today
/// marker and dependency arrows. Tasks with no dates wait in a tray: tap one to open it, or drag it onto the chart.
struct GanttScreen: View {
    let services: AppServices
    let projectLocalId: String
    @State private var live: LiveValue<GanttData>
    @AppStorage("cria.gantt.weekZoom") private var weekZoom = false
    /// Off by default, as in the web app: finished tasks clutter the timeline.
    @AppStorage("cria.gantt.showDone") private var showDone = false
    /// Date range and the no-dates tray, kept on this device (see `GanttFilters`).
    @AppStorage(GanttFilters.storageKey) private var filtersText = ""
    @State private var filtering = false

    init(services: AppServices, projectLocalId: String) {
        self.services = services
        self.projectLocalId = projectLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: GanttData(nodes: [], edges: [])) {
            observeStore(store, kinds: [.tasks, .projects]) { reading in
                try reading.ganttData(projectLocalId: projectLocalId, includeDone: true)
            }
        })
    }

    private var dayWidth: Double { weekZoom ? GanttMetrics.weekZoomDayWidth : GanttMetrics.dayWidth }
    private var today: Int { GanttTree.localDay(of: Date()) }
    /// The loaded data without finished tasks unless "Show done" is on. The range and arrows follow what is shown.
    private var shown: GanttData {
        showDone ? live.value : GanttData(nodes: live.value.nodes.filter { !$0.done }, edges: live.value.edges)
    }
    private var filters: GanttFilters { GanttFilters.from(stored: filtersText) }
    /// The range the tasks alone would give. A date range chosen in the filters replaces it.
    private var automaticRange: GanttDayRange { shown.dayRange(today: today) }
    private var range: GanttDayRange { filters.range(automatic: automaticRange) }
    private var datedNodes: [GanttNode] {
        filters.visible(GanttTree.visible(shown.nodes, collapsed: [], showDateless: false), in: range)
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
                    dayWidth: dayWidth, weekZoom: weekZoom
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
                    Button("Filters", systemImage: "line.3.horizontal.decrease.circle") { filtering = true }
                }
            }
        }
        .sheet(isPresented: $filtering) {
            GanttFilterSheet(filters: Binding(get: { filters }, set: { filtersText = $0.stored }), automatic: automaticRange)
        }
        .task { await live.run() }
    }
}

/// Tasks with no dates. Tapping one opens it to set dates; dragging one onto the chart schedules it from the day it
/// lands on.
struct GanttTray: View {
    let services: AppServices
    let nodes: [GanttNode]
    let today: Int

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
        _ = try? services.store.setGanttDates(
            taskLocalId: node.taskLocalId, start: today, end: today + GanttMetrics.defaultSpanDays - 1
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
    let onOpen: () -> Void
    let onCommit: (Int, Int) -> Void
    /// When a gesture last moved the bar. A tap within `tapSuppression` of it is the lift of that drag, not a tap.
    /// A time stamp rather than a flag, so a gesture that is cancelled (no `onEnded`) cannot block taps for good.
    @State private var lastDragAt: Date?
    /// Counts drags that changed the dates, for the drop haptic.
    @State private var commits = 0
    private static let tapSuppression: TimeInterval = 0.5

    var body: some View {
        let fill = Color(hexString: place.color) ?? Color(.primary)
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 6).fill(fill.opacity(place.isPlaceholder ? 0.35 : 0.9))
            Text(node.title)
                .font(Theme.caption)
                .foregroundStyle(textColor)
                .lineLimit(1)
                .padding(.horizontal, 10)
                // Rows are a fixed height, so very large text would spill out of the bar; the label caps instead.
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        }
        .frame(width: place.width, height: place.height)
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
                .onEnded { _ in finish() }
        )
        .overlay(alignment: .leading) { handle(.resizeStart) }
        .overlay(alignment: .trailing) { handle(.resizeEnd) }
        // A tick as this bar's dates move by a whole day while it is dragged, a light impact when it is let go.
        .sensoryFeedback(trigger: movingDays) { old, new in old != nil && new != nil ? SensoryFeedback.selection : nil }
        .sensoryFeedback(.impact(weight: .light), trigger: commits)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onOpen() }
        // Dragging is not available to VoiceOver, so moving by a day is an action on the bar.
        .accessibilityActions {
            if !place.resolved.dateless {
                Button("Move a day earlier") { shift(-1) }
                Button("Move a day later") { shift(1) }
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

    /// White or black, whichever reads on the bar. A placeholder bar is a pale wash, so it takes the text colour.
    private var textColor: Color {
        if place.isPlaceholder { return Color(.foreground) }
        return place.color == nil ? Color(.primaryForeground) : LegibleTint.onFill(place.color)
    }

    private func shift(_ days: Int) {
        onCommit(place.resolved.start + days, place.resolved.end + days)
    }

    /// The resize handle, shown only when the bar is wide enough that it does not cover the whole bar.
    @ViewBuilder private func handle(_ mode: GanttDragMode) -> some View {
        if place.width > Self.minimumWidthForHandles {
            Color.clear.frame(width: 16, height: place.height).contentShape(Rectangle()).gesture(dragGesture(mode))
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
