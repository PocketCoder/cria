import CriaKit
import SwiftUI

/// The timeline itself: header, grid, today line, arrows and bars on one coordinate space. The chart is at least
/// as tall as the space it is given, so the grid and the today line run to the bottom even with few bars.
struct GanttChart: View {
    let services: AppServices
    let data: GanttData
    let nodes: [GanttNode]
    let range: GanttDayRange
    let dayWidth: Double
    let weekZoom: Bool
    @State private var drag: GanttDrag?
    @State private var dropTargeted = false
    @Environment(NavigationModel.self) private var navigation

    private static let todayId = "gantt-today"

    private var chartWidth: Double { Double(range.totalDays) * dayWidth }

    private var placements: [GanttPlacement] {
        GanttGeometry.placements(visible: nodes, range: range, drag: drag, chartWidth: chartWidth, dayWidth: dayWidth)
    }

    var body: some View {
        GeometryReader { geometry in
            let height = GanttGeometry.chartHeight(rowCount: nodes.count, minimum: geometry.size.height)
            ScrollViewReader { scroller in
                ScrollView([.horizontal, .vertical]) {
                    chart(height: height)
                }
                // Open on today, not the earliest date. Waiting a tick lets the content lay out first.
                .task {
                    await Task.yield()
                    scroller.scrollTo(Self.todayId, anchor: UnitPoint(x: 0.5, y: 0))
                }
                .onChange(of: dayWidth) { _, _ in
                    scroller.scrollTo(Self.todayId, anchor: UnitPoint(x: 0.5, y: 0))
                }
            }
        }
        .overlay {
            if nodes.isEmpty {
                ContentUnavailableView {
                    Label("No tasks with dates yet", systemImage: "calendar.badge.plus")
                } description: {
                    Text("Drag one from below, or tap it to add a start and end date.")
                }
                .allowsHitTesting(false)
            }
        }
    }

    private func chart(height: Double) -> some View {
        ZStack(alignment: .topLeading) {
            Canvas { context, _ in
                drawGrid(&context, height: height)
                drawHeader(&context)
                drawToday(&context, height: height)
                drawArrows(&context)
            }
            .frame(width: chartWidth, height: height)
            .accessibilityHidden(true)
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
        .frame(width: chartWidth, height: height, alignment: .topLeading)
        // The header and rows are drawn at fixed heights, so text stops growing before it would overlap them.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Timeline")
        .background(dropTargeted ? Color(.primary).opacity(0.06) : Color.clear)
        // A task dragged in from the no-dates tray starts on the day it is dropped on.
        .dropDestination(for: String.self) { items, location in
            guard let taskId = items.first.flatMap(KanbanPayload.taskId(from:)) else { return false }
            let start = GanttGeometry.day(atX: location.x, range: range, dayWidth: dayWidth)
            _ = try? services.store.setGanttDates(
                taskLocalId: taskId, start: start, end: start + GanttMetrics.defaultSpanDays - 1
            )
            return true
        } isTargeted: { dropTargeted = $0 }
    }

    /// An invisible one-day marker at today's column. Its layout frame (not an offset) is what `scrollTo` uses.
    private var todayAnchor: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: max(0, Double(range.today - range.low)) * dayWidth, height: 1)
            Color.clear.frame(width: dayWidth, height: 1).id(Self.todayId)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var ticks: [GanttTick] {
        GanttGeometry.dayTicks(
            low: range.low, totalDays: range.totalDays, dayWidth: dayWidth, weekly: weekZoom,
            firstWeekday: Calendar.cria.firstWeekday
        )
    }

    /// Weekend shading at day zoom, a faint line per tick, and a stronger one at each month start.
    private func drawGrid(_ context: inout GraphicsContext, height: Double) {
        let line = Color(.mutedForeground).opacity(0.12)
        for tick in ticks {
            if !weekZoom && tick.isWeekend {
                context.fill(Path(CGRect(x: tick.left, y: 0, width: dayWidth, height: height)), with: .color(Color(.muted).opacity(0.6)))
            }
            context.fill(Path(CGRect(x: tick.left, y: GanttMetrics.headerHeight, width: 0.5, height: height)), with: .color(line))
        }
        for month in GanttGeometry.monthGroups(low: range.low, totalDays: range.totalDays, dayWidth: dayWidth) {
            context.fill(Path(CGRect(x: month.left, y: 0, width: 1, height: height)), with: .color(Color(.mutedForeground).opacity(0.3)))
        }
    }

    /// Month names on the first line, day numbers (or week starts) on the second, a rule under both.
    private func drawHeader(_ context: inout GraphicsContext) {
        for month in GanttGeometry.monthGroups(low: range.low, totalDays: range.totalDays, dayWidth: dayWidth) {
            let label = Text(month.label).font(Theme.caption.weight(.semibold)).foregroundStyle(Color(.foreground))
            context.draw(label, at: CGPoint(x: month.left + 8, y: 14), anchor: .leading)
        }
        for tick in ticks {
            let isToday = tick.day == range.today
            let label = Text(tick.label)
                .font(isToday ? Theme.footnote.weight(.bold) : Theme.footnote)
                .foregroundStyle(isToday ? Color(.primary) : Color(.mutedForeground))
            let centre = weekZoom ? tick.left + 4 : tick.left + dayWidth / 2
            context.draw(label, at: CGPoint(x: centre, y: 38), anchor: weekZoom ? .leading : .center)
        }
        let rule = Path(CGRect(x: 0, y: GanttMetrics.headerHeight - 0.5, width: chartWidth, height: 0.5))
        context.fill(rule, with: .color(Color(.mutedForeground).opacity(0.3)))
    }

    private func drawToday(_ context: inout GraphicsContext, height: Double) {
        // A date range chosen in the filters can leave today out of the chart.
        guard (range.low...range.high).contains(range.today) else { return }
        let todayX = Double(range.today - range.low) * dayWidth + dayWidth / 2
        let marker = Path(CGRect(x: todayX - 1, y: GanttMetrics.headerHeight - 8, width: 2, height: height))
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
