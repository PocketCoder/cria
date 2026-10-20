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
    /// The project's colour, which the Mac's bars use when a task has none of its own.
    var projectColour: String?
    /// iOS row reorder mode: bars drag up and down instead of changing dates. `onReorder` gets the row offset.
    var reordering = false
    var onReorder: (String, Int) -> Void = { _, _ in }
    @State private var drag: GanttDrag?
    @State private var dropTargeted = false
    /// Counts bars dropped in from the no-dates tray, for the drop haptic.
    @State private var trayDrops = 0
    @Environment(NavigationModel.self) private var navigation

    private static let todayId = "gantt-today"

    /// Row and header sizes. The Mac design: a 200pt task column, a 40pt header, 36pt rows with hairlines and 20pt
    /// bars. iOS keeps CriaKit's metrics (bars inset 8pt in 40pt rows).
    enum Layout {
        #if os(macOS)
        static let header = 40.0
        static let row = 36.0
        static let bar = 20.0
        static let taskColumn = 200.0
        #else
        static let header = GanttMetrics.headerHeight
        static let row = GanttMetrics.rowHeight
        static let bar = GanttMetrics.rowHeight - 16
        #endif

        static func barTop(_ index: Int) -> Double { Double(index) * row + (row - bar) / 2 }

        static func chartHeight(rows: Int, minimum: Double) -> Double { max(header + Double(max(rows, 0)) * row, minimum) }
    }

    private var chartWidth: Double { Double(range.totalDays) * dayWidth }

    private var placements: [GanttPlacement] {
        GanttGeometry.placements(visible: nodes, range: range, drag: drag, chartWidth: chartWidth, dayWidth: dayWidth)
    }

    var body: some View {
        GeometryReader { geometry in
            let height = Layout.chartHeight(rows: nodes.count, minimum: geometry.size.height)
            ScrollViewReader { scroller in
                scrollers(height: height)
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

    @ViewBuilder private func scrollers(height: Double) -> some View {
        #if os(macOS)
        // The task column scrolls up and down with the rows but stays put while the days scroll sideways.
        ScrollView(.vertical) {
            HStack(alignment: .top, spacing: 0) {
                GanttTaskColumn(nodes: nodes, height: height, onOpen: open, onReorder: onReorder)
                Divider()
                ScrollView(.horizontal) { chart(height: height) }
            }
        }
        #else
        ScrollView([.horizontal, .vertical]) {
            chart(height: height)
        }
        #endif
    }

    private func open(_ taskLocalId: String) {
        navigation.state.push(.task(taskLocalId))
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
                    height: Layout.bar, fallbackColour: projectColour,
                    reordering: reordering,
                    onReorder: { rows in onReorder(place.taskLocalId, rows) },
                    onOpen: { open(place.taskLocalId) },
                    onCommit: { start, end in
                        _ = try? services.store.setGanttDates(taskLocalId: place.taskLocalId, start: start, end: end)
                    }
                )
                .offset(x: place.left, y: Layout.header + Layout.barTop(index))
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
            trayDrops += 1
            return true
        } isTargeted: { dropTargeted = $0 }
        .sensoryFeedback(.impact(weight: .light), trigger: trayDrops)
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
            context.fill(Path(CGRect(x: tick.left, y: Layout.header, width: 0.5, height: height)), with: .color(line))
        }
        #if os(macOS)
        // A hairline under each row.
        for index in 1...max(nodes.count, 1) {
            let rowY = Layout.header + Double(index) * Layout.row - 0.5
            context.fill(Path(CGRect(x: 0, y: rowY, width: chartWidth, height: 0.5)), with: .color(line))
        }
        #endif
        for month in GanttGeometry.monthGroups(low: range.low, totalDays: range.totalDays, dayWidth: dayWidth) {
            context.fill(Path(CGRect(x: month.left, y: 0, width: 1, height: height)), with: .color(Color(.mutedForeground).opacity(0.3)))
        }
    }

    /// Month names on the first line, day numbers (or week starts) on the second, a rule under both.
    private func drawHeader(_ context: inout GraphicsContext) {
        #if os(macOS)
        if !weekZoom {
            drawDayHeader(&context)
            return
        }
        #endif
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
        let rule = Path(CGRect(x: 0, y: Layout.header - 0.5, width: chartWidth, height: 0.5))
        context.fill(rule, with: .color(Color(.mutedForeground).opacity(0.3)))
    }

    private func drawToday(_ context: inout GraphicsContext, height: Double) {
        // A date range chosen in the filters can leave today out of the chart.
        guard (range.low...range.high).contains(range.today) else { return }
        let todayX = Double(range.today - range.low) * dayWidth + dayWidth / 2
        let marker = Path(CGRect(x: todayX - 1, y: Layout.header - 8, width: 2, height: height))
        #if os(macOS)
        // The Mac design draws today's line at 60%.
        context.fill(marker, with: .color(Color(.primary).opacity(0.6)))
        #else
        context.fill(marker, with: .color(Color(.primary)))
        #endif
    }

    private func drawArrows(_ context: inout GraphicsContext) {
        let rows = Dictionary(
            placements.enumerated().map { ($0.element.taskLocalId, ($0.element, $0.offset)) }, uniquingKeysWith: { first, _ in first }
        )
        for edge in data.edges {
            guard let from = rows[edge.fromLocalId], let target = rows[edge.toLocalId] else { continue }
            var path = Path()
            let startPoint = CGPoint(x: from.0.left + from.0.width, y: Layout.header + Layout.barTop(from.1) + Layout.bar / 2)
            let endPoint = CGPoint(x: target.0.left, y: Layout.header + Layout.barTop(target.1) + Layout.bar / 2)
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

#if os(macOS)
extension GanttChart {
    /// The Mac's day header: the weekday in SF 10 over the date in SF 13 Semibold, centred in each 56pt day, today in
    /// `primary`. A month's first day shows the month's name in place of its weekday.
    fileprivate func drawDayHeader(_ context: inout GraphicsContext) {
        let weekdays = Calendar.cria.shortWeekdaySymbols
        let months = Calendar.cria.shortMonthSymbols
        // Day numbers count UTC days (as CriaKit's ticks do).
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = .gmt
        for tick in ticks {
            let isToday = tick.day == range.today
            let colour = isToday ? Color(.primary) : MacTheme.label2
            let centre = tick.left + dayWidth / 2
            let weekday = weekdays[GanttGeometry.weekday(of: tick.day) - 1]
            let date = Date(timeIntervalSince1970: Double(tick.day) * 86_400)
            let month = utc.component(.month, from: date)
            let top = tick.label == "1" ? months[month - 1] : weekday
            context.draw(Text(top).font(.system(size: 10)).foregroundStyle(colour), at: CGPoint(x: centre, y: 12))
            let dayText = Text(tick.label).font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isToday ? Color(.primary) : Color(.foreground))
            context.draw(dayText, at: CGPoint(x: centre, y: 27))
        }
        let rule = Path(CGRect(x: 0, y: Layout.header - 0.5, width: chartWidth, height: 0.5))
        context.fill(rule, with: .color(Color(.mutedForeground).opacity(0.3)))
    }
}

/// The 200pt task column beside the timeline: a 40pt header, then one 36pt row per bar with a hairline under it.
private struct GanttTaskColumn: View {
    let nodes: [GanttNode]
    let height: Double
    let onOpen: (String) -> Void
    /// A row dragged onto another: the moved task and how many rows it travelled.
    let onReorder: (String, Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Task")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(MacTheme.label2)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: GanttChart.Layout.header, maxHeight: GanttChart.Layout.header, alignment: .leading)
                .overlay(alignment: .bottom) { Divider() }
            ForEach(Array(nodes.enumerated()), id: \.element.taskLocalId) { index, node in
                Button { onOpen(node.taskLocalId) } label: {
                    Text(node.title)
                        .font(.system(size: 13))
                        .strikethrough(node.done)
                        .foregroundStyle(node.done ? MacTheme.label2 : Color(.foreground))
                        .lineLimit(1)
                        .padding(.leading, 12 + Double(node.indentLevel) * 14)
                        .padding(.trailing, 8)
                        .frame(maxWidth: .infinity, minHeight: GanttChart.Layout.row, maxHeight: GanttChart.Layout.row, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Divider() }
                // Dragging a top-level row onto another moves it there; subtasks ride along with their parent.
                .draggable(KanbanPayload.make(node.taskLocalId))
                .dropDestination(for: String.self) { items, _ in
                    guard let movedId = items.first.flatMap(KanbanPayload.taskId(from:)),
                          let from = nodes.firstIndex(where: { $0.taskLocalId == movedId }), from != index else { return false }
                    onReorder(movedId, index - from)
                    return true
                }
            }
            Spacer(minLength: 0)
        }
        .frame(width: GanttChart.Layout.taskColumn, height: height, alignment: .top)
    }
}
#endif
