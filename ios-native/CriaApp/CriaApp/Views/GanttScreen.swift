import CriaKit
import SwiftUI

/// The Gantt view: a scrolling timeline with day and week zoom, task bars you drag to change dates, a today
/// marker and dependency arrows. Tasks with no dates wait in a tray until scheduled.
struct GanttScreen: View {
    let services: AppServices
    let projectLocalId: String
    @State private var live: LiveValue<GanttData>
    @AppStorage("cria.gantt.weekZoom") private var weekZoom = false
    /// Off by default, as in the web app: finished tasks clutter the timeline.
    @AppStorage("cria.gantt.showDone") private var showDone = false

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
    private var datedNodes: [GanttNode] {
        GanttTree.visible(shown.nodes, collapsed: [], showDateless: false)
    }
    private var datelessNodes: [GanttNode] {
        shown.nodes.filter { $0.startDay == nil && $0.endDay == nil }
    }

    var body: some View {
        VStack(spacing: 0) {
            if datedNodes.isEmpty && datelessNodes.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "chart.bar.xaxis", description: Text("Nothing here yet."))
            } else {
                GanttChart(
                    services: services, data: shown, nodes: datedNodes, range: shown.dayRange(today: today),
                    dayWidth: dayWidth
                )
                if !datelessNodes.isEmpty { tray }
            }
        }
        .background(Color(.background))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Gantt options", systemImage: "slider.horizontal.3") {
                    Picker("Zoom", selection: $weekZoom) {
                        Text("Day").tag(false)
                        Text("Week").tag(true)
                    }
                    Toggle("Show done", isOn: $showDone)
                }
            }
        }
        .task { await live.run() }
    }

    private var tray: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("No dates").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            ScrollView(.horizontal) {
                HStack {
                    ForEach(datelessNodes, id: \.taskLocalId) { node in
                        Button(node.title) { schedule(node) }
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
        .padding(12)
        .background(Color(.muted))
    }

    /// Gives a dateless task a default week starting today.
    private func schedule(_ node: GanttNode) {
        let start = today
        _ = try? services.store.setGanttDates(
            taskLocalId: node.taskLocalId, start: start, end: start + GanttMetrics.defaultSpanDays - 1
        )
    }
}

/// The timeline itself: header, grid, today line, arrows and bars on one coordinate space.
struct GanttChart: View {
    let services: AppServices
    let data: GanttData
    let nodes: [GanttNode]
    let range: GanttDayRange
    let dayWidth: Double
    @State private var drag: GanttDrag?
    @Environment(NavigationModel.self) private var navigation

    private static let todayId = "gantt-today"

    private var chartWidth: Double { Double(range.totalDays) * dayWidth }
    private var chartHeight: Double { GanttMetrics.headerHeight + Double(nodes.count) * GanttMetrics.rowHeight }

    private var placements: [GanttPlacement] {
        GanttGeometry.placements(visible: nodes, range: range, drag: drag, chartWidth: chartWidth, dayWidth: dayWidth)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView([.horizontal, .vertical]) {
                ZStack(alignment: .topLeading) {
                    Canvas { context, _ in
                        drawBackground(&context)
                        drawArrows(&context)
                    }
                    .frame(width: chartWidth, height: chartHeight)
                    todayAnchor
                    ForEach(Array(placements.enumerated()), id: \.element.taskLocalId) { index, place in
                        GanttBar(
                            place: place, node: nodes[index], dayWidth: dayWidth, drag: $drag,
                            onOpen: { navigation.state.push(.task(place.taskLocalId)) },
                            onCommit: { start, end in
                                _ = try? services.store.setGanttDates(taskLocalId: place.taskLocalId, start: start, end: end)
                            }
                        )
                        .offset(x: place.left, y: GanttMetrics.headerHeight + place.top)
                    }
                }
                .frame(width: chartWidth, height: chartHeight, alignment: .topLeading)
            }
            // Open on today, not the earliest date. Waiting a tick lets the content lay out first.
            .task {
                await Task.yield()
                proxy.scrollTo(Self.todayId, anchor: UnitPoint(x: 0.5, y: 0))
            }
            .onChange(of: dayWidth) { _, _ in
                proxy.scrollTo(Self.todayId, anchor: UnitPoint(x: 0.5, y: 0))
            }
        }
    }

    /// An invisible one-day marker at today's column. Its layout frame (not an offset) is what `scrollTo` uses.
    private var todayAnchor: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: Double(range.today - range.low) * dayWidth, height: 1)
            Color.clear.frame(width: dayWidth, height: 1).id(Self.todayId)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func drawBackground(_ context: inout GraphicsContext) {
        for month in GanttGeometry.monthGroups(low: range.low, totalDays: range.totalDays, dayWidth: dayWidth) {
            context.draw(Text(month.label).font(Theme.caption), at: CGPoint(x: month.left + 6, y: 12), anchor: .leading)
            let line = Path(CGRect(x: month.left, y: 0, width: 1, height: chartHeight))
            context.fill(line, with: .color(.secondary.opacity(0.3)))
        }
        let todayX = Double(range.today - range.low) * dayWidth + dayWidth / 2
        let marker = Path(CGRect(x: todayX - 1, y: 0, width: 2, height: chartHeight))
        context.fill(marker, with: .color(Color(.primary)))
    }

    private func drawArrows(_ context: inout GraphicsContext) {
        let rows = Dictionary(placements.map { ($0.taskLocalId, $0) }, uniquingKeysWith: { first, _ in first })
        for edge in data.edges {
            guard let from = rows[edge.fromLocalId], let target = rows[edge.toLocalId] else { continue }
            var path = Path()
            let startPoint = CGPoint(x: from.left + from.width, y: GanttMetrics.headerHeight + from.top + from.height / 2)
            let endPoint = CGPoint(x: target.left, y: GanttMetrics.headerHeight + target.top + target.height / 2)
            path.move(to: startPoint)
            path.addCurve(
                to: endPoint,
                control1: CGPoint(x: startPoint.x + 20, y: startPoint.y),
                control2: CGPoint(x: endPoint.x - 20, y: endPoint.y)
            )
            context.stroke(path, with: .color(Color(.mutedForeground)), lineWidth: 1.5)
        }
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
    private static let tapSuppression: TimeInterval = 0.5

    var body: some View {
        let fill = Color(hexString: place.color) ?? Color(.primary)
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 6).fill(fill.opacity(place.isPlaceholder ? 0.35 : 0.9))
            Text(node.title)
                .font(Theme.caption)
                .foregroundStyle(Color(.primaryForeground))
                .lineLimit(1)
                .padding(.horizontal, 10)
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
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(node.title), \(place.label)")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onOpen() }
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
            onCommit(days.start, days.end)
        }
    }
}
