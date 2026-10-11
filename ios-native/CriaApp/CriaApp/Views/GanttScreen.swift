import CriaKit
import SwiftUI

/// The Gantt view: a scrolling timeline with day and week zoom, task bars you drag to change dates, a today
/// marker and dependency arrows. Tasks with no dates wait in a tray until scheduled.
struct GanttScreen: View {
    let services: AppServices
    let projectLocalId: String
    @State private var live: LiveValue<GanttData>
    @AppStorage("cria.gantt.weekZoom") private var weekZoom = false

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
    private var today: Int { Int((Date().timeIntervalSince1970 / 86_400).rounded(.down)) }
    private var datedNodes: [GanttNode] {
        GanttTree.visible(live.value.nodes, collapsed: [], showDateless: false)
    }
    private var datelessNodes: [GanttNode] {
        live.value.nodes.filter { $0.startDay == nil && $0.endDay == nil }
    }

    var body: some View {
        VStack(spacing: 0) {
            if datedNodes.isEmpty && datelessNodes.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "chart.bar.xaxis", description: Text("Nothing here yet."))
            } else {
                GanttChart(
                    services: services, data: live.value, nodes: datedNodes, range: live.value.dayRange(today: today),
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

    private var chartWidth: Double { Double(range.totalDays) * dayWidth }
    private var chartHeight: Double { GanttMetrics.headerHeight + Double(nodes.count) * GanttMetrics.rowHeight }

    private var placements: [GanttPlacement] {
        GanttGeometry.placements(visible: nodes, range: range, drag: drag, chartWidth: chartWidth, dayWidth: dayWidth)
    }

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    drawBackground(&context)
                    drawArrows(&context)
                }
                .frame(width: chartWidth, height: chartHeight)
                ForEach(Array(placements.enumerated()), id: \.element.taskLocalId) { index, place in
                    GanttBar(place: place, node: nodes[index], dayWidth: dayWidth, drag: $drag) { start, end in
                        _ = try? services.store.setGanttDates(taskLocalId: place.taskLocalId, start: start, end: end)
                    }
                    .offset(x: place.left, y: GanttMetrics.headerHeight + place.top)
                }
            }
            .frame(width: chartWidth, height: chartHeight, alignment: .topLeading)
        }
        .defaultScrollAnchor(.leading)
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
    let place: GanttPlacement
    let node: GanttNode
    let dayWidth: Double
    @Binding var drag: GanttDrag?
    let onCommit: (Int, Int) -> Void

    var body: some View {
        let fill = Color(hexString: place.color) ?? Color(.primary)
        NavigationLink(value: Route.task(place.taskLocalId)) {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 6).fill(fill.opacity(place.isPlaceholder ? 0.35 : 0.9))
                Text(node.title)
                    .font(Theme.caption)
                    .foregroundStyle(Color(.primaryForeground))
                    .lineLimit(1)
                    .padding(.horizontal, 10)
            }
            .frame(width: place.width, height: place.height)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(dragGesture(.move))
        .overlay(alignment: .leading) { handle(.resizeStart) }
        .overlay(alignment: .trailing) { handle(.resizeEnd) }
        .accessibilityLabel("\(node.title), \(place.label)")
    }

    private func handle(_ mode: GanttDragMode) -> some View {
        Color.clear.frame(width: 16, height: place.height).contentShape(Rectangle()).gesture(dragGesture(mode))
    }

    private func dragGesture(_ mode: GanttDragMode) -> some Gesture {
        DragGesture(minimumDistance: GanttMetrics.dragThreshold)
            .onChanged { value in
                drag = GanttDrag(
                    taskLocalId: place.taskLocalId, mode: mode, originalStart: place.resolved.start,
                    originalEnd: place.resolved.end, deltaDays: Int((value.translation.width / dayWidth).rounded())
                )
            }
            .onEnded { _ in
                defer { drag = nil }
                guard let finished = drag else { return }
                let days = GanttGeometry.apply(finished)
                if days.start != finished.originalStart || days.end != finished.originalEnd {
                    onCommit(days.start, days.end)
                }
            }
    }
}
