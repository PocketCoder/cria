import CriaKit
import SwiftUI

/// A smart view (Today, Upcoming, Inbox or a saved filter): sections of tasks that update from the database. The
/// Display sheet filters and sorts them (Inbox and saved filters can also be grouped), and Select starts multi-select.
struct SmartViewScreen: View {
    let services: AppServices
    let title: String
    let view: SmartView
    @State private var live: LiveValue<SmartViewData>
    @State private var display: DisplayModel
    @State private var selection = TaskSelection()
    /// Settings > General > Show completed: what a view does until its Display sheet says otherwise.
    @AppStorage("cria.taskList.showDone") private var showDone = true
    @State private var selectedDay = Calendar.cria.startOfDay(for: Date())
    @State private var addPresented = false
    @State private var rescheduling: DisplaySection?
    @State private var failure: String?
    /// Parents whose subtasks are showing, for this screen only.
    @State private var expanded: Set<String> = []

    init(services: AppServices, view: SmartView, title: String) {
        self.services = services
        self.title = title
        self.view = view
        _display = State(initialValue: DisplayModel(key: .smartView(view)))
        let store = services.store
        _live = State(initialValue: LiveValue(initial: SmartViewData()) {
            observeStore(store, kinds: [.tasks, .labels, .projects, .savedFilters]) { (reading: CriaStore) throws -> SmartViewData in
                // Completed tasks come too: the Display sheet decides whether they show.
                let groups = try reading.smartGroups(view, includeDone: true)
                let items = groups.flatMap(\.items)
                let parents = try TaskListNesting.parentTitles(reading, for: items)
                return SmartViewData(
                    groups: groups, parentTitles: parents, nesting: try SmartNestingData.read(reading, items: items),
                    assignees: try reading.assigneeMap(), loaded: true
                )
            }
        })
    }

    private var hasAnyTasks: Bool { live.value.groups.contains { !$0.items.isEmpty } }

    /// Open tasks in the view, before any Display filter: what "left today" means.
    private var openCount: Int {
        live.value.groups.reduce(0) { total, group in total + group.items.filter { !$0.task.done }.count }
    }

    /// The groups after the Display options: filtered and sorted inside each day (or Today's overdue and due), or
    /// regrouped when the sheet groups an Inbox or a saved filter.
    private var allDisplayed: [DisplaySection] {
        let raw = live.value.groups.map { DisplaySection(key: $0.key, label: $0.label, items: $0.items) }
        let showCompleted = display.showsCompleted(default: showDone)
        let context = display.context(assignees: live.value.assignees)
        if display.config.groupBy != .none && !display.sections.groupings.isEmpty {
            return DisplayEngine.sections(raw.flatMap(\.items), config: display.config, showCompleted: showCompleted, context: context)
        }
        return DisplayEngine.refined(raw, config: display.config, showCompleted: showCompleted, context: context)
    }

    private var groups: [DisplaySection] {
        guard view == .upcoming else { return allDisplayed }
        let from = Self.dayKey(selectedDay)
        return allDisplayed.filter { $0.key >= from }
    }

    private static func dayKey(_ date: Date) -> String {
        DueDates.dayKey(DueDates.allDayISO(for: date)) ?? ""
    }

    private var subtitle: String? {
        switch view {
        case .today:
            return Date().formatted(.dateTime.weekday(.wide).day().month(.wide)) + " · \(openCount) open"
        case .upcoming:
            return selectedDay.formatted(.dateTime.month(.wide).year())
        default:
            return nil
        }
    }

    /// Today with nothing open: the empty state takes the place of the rows.
    private var showsTodayEmpty: Bool { view == .today && live.value.loaded && openCount == 0 }

    var body: some View {
        List {
            header
            if showsTodayEmpty { TodayEmptyView(services: services) }
            // Every group shown is on or after the selected day, so an empty selected day comes first.
            nothingPlanned
            ForEach(groups) { group in
                groupSection(group)
            }
            if hasAnyTasks && allDisplayed.isEmpty && display.hasFilters {
                Section {
                    DisplayNoMatchesRow(
                        hasFilters: true, onReset: { display.update { $0.filters = DisplayFilters() } }, onShowCompleted: {}
                    )
                }
            }
        }
        .criaSurface()
        // The default top margin and section gaps left a band of empty space under the title.
        .contentMargins(.top, 0, for: .scrollContent)
        .listSectionSpacing(.compact)
        .overlay {
            if live.value.loaded && !hasAnyTasks && view != .upcoming && view != .today {
                ContentUnavailableView("Nothing here", systemImage: "checkmark.circle")
            }
        }
        .navigationTitle(title)
        .toolbar {
            DisplaySelectToolbar(
                isCustomised: display.isCustomised, isSelecting: selection.isActive,
                onDisplay: { display.sheetPresented = true }, onSelect: { selection.start() }, onDone: { selection.stop() }
            )
        }
        .refreshable { await services.refresh() }
        .quickAdd(services: services)
        .displayOptions(display, services: services)
        .taskSelection(selection, services: services)
        .sheet(isPresented: $addPresented) {
            QuickAddSheet(services: services, contextProjectId: nil, initialDueDate: selectedDay)
        }
        // An alert, not a confirmation dialog: on iOS 26 that is a popover, anchored away from the header button.
        .alert(
            rescheduleTitle,
            isPresented: Binding(get: { rescheduling != nil }, set: { if !$0 { rescheduling = nil } }),
            presenting: rescheduling
        ) { group in
            Button("Move to today") { rescheduleOverdue(group) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("Tasks with a due time keep it.")
        }
        .errorHaptic(failure)
        .alert("Could not reschedule", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task { await live.run() }
    }

    private func tree(for row: NestedTaskItem) -> TaskRowTree {
        let id = row.id
        return TaskRowTree(
            depth: row.depth,
            progress: live.value.nesting.progress[id],
            isCollapsed: row.hasChildren ? !expanded.contains(id) : nil,
            onToggleCollapsed: {
                withAnimation(.snappy) {
                    if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
                }
            },
            // Under its parent the caption would repeat what the indent already says.
            parentTitle: row.depth == 0 ? live.value.parentTitles[id] : nil
        )
    }

    private var rescheduleTitle: String {
        let count = rescheduling?.items.count ?? 0
        return count == 1 ? "Move 1 overdue task to today?" : "Move \(count) overdue tasks to today?"
    }

    @ViewBuilder private var nothingPlanned: some View {
        if view == .upcoming && !allDisplayed.contains(where: { $0.key == Self.dayKey(selectedDay) }) {
            Section {
                Button { addPresented = true } label: {
                    Label("Nothing planned", systemImage: "plus").foregroundStyle(Color(.mutedForeground))
                }
                .accessibilityHint("Adds a task on this day")
            } header: {
                Text(selectedDay.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))
            }
        }
    }

    @ViewBuilder private var header: some View {
        if view == .upcoming {
            Section {
                WeekStrip(selected: $selectedDay, busyDays: Set(allDisplayed.map(\.key)))
                    .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
            } header: {
                subtitleText
            }
        } else if subtitle != nil {
            Section {} header: { subtitleText }
        }
    }

    @ViewBuilder private var subtitleText: some View {
        if let subtitle {
            Text(subtitle)
                .font(Theme.rowSubtitle)
                .textCase(nil)
                .foregroundStyle(Color(.mutedForeground))
        }
    }

    private func groupSection(_ group: DisplaySection) -> some View {
        Section {
            ForEach(live.value.nesting.rows(for: group.items, expanded: expanded)) { row in
                TaskRowLink(services: services, item: row.item, showProject: row.depth == 0, tree: tree(for: row))
            }
        } header: {
            groupHeader(group)
        }
    }

    @ViewBuilder private func groupHeader(_ group: DisplaySection) -> some View {
        if view == .today && group.key == "overdue" {
            HStack {
                Text(group.label).font(Theme.headline).foregroundStyle(Color(.destructive))
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Reschedule") { rescheduling = group }
                    .font(Theme.rowSubtitle)
                    .accessibilityLabel("Reschedule overdue tasks")
            }
            .textCase(nil)
        } else {
            Text(group.label).font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
                .accessibilityAddTraits(.isHeader)
        }
    }

    /// Moves each overdue task to today. A timed due date keeps its time of day; only the day changes.
    private func rescheduleOverdue(_ group: DisplaySection) {
        var failures: [String] = []
        for item in group.items {
            guard let iso = item.task.dueDate else { continue }
            let patch = TaskPatch(dueDate: TodaySuggestions.pulledForward(iso, now: Date()))
            do {
                _ = try services.store.updateTask(localId: item.task.localId, patch: patch)
            } catch {
                failures.append("\(item.task.title): \(error)")
            }
        }
        if !failures.isEmpty { failure = failures.joined(separator: "\n") }
    }
}

/// A smart view's date groups, plus each shown subtask's parent title for the caption (these lists do not nest).
struct SmartViewData: Sendable {
    var groups: [TaskGroup] = []
    var parentTitles: [String: String] = [:]
    var nesting = SmartNestingData()
    /// Task local id to the user ids assigned, for the Display sheet's assignee filter.
    var assignees: [String: Set<Int>] = [:]
    /// False until the first read, so an empty state does not flash before the tasks arrive.
    var loaded = false
}

/// Inbox needs the default project id from the server. Offline it falls back to the one remembered from the last
/// server read, so the screen opens straight away and switches if the server names another.
struct InboxScreen: View {
    let services: AppServices
    @State private var projectId: Int?
    @State private var didLoad = false

    var body: some View {
        Group {
            if didLoad {
                // A new id must build a new screen: the live query captured the old one.
                SmartViewScreen(services: services, view: .inbox(defaultProjectServerId: projectId), title: "Inbox")
                    .id(projectId)
            } else {
                ProgressView()
            }
        }
        .task {
            projectId = rememberedServerId()
            if projectId != nil { didLoad = true }
            if let fresh = await services.defaultProjectServerId() { projectId = fresh }
            didLoad = true
        }
    }

    private func rememberedServerId() -> Int? {
        guard let localId = services.rememberedDefaultProjectLocalId() else { return nil }
        return (try? services.store.project(localId: localId))?.serverId
    }
}

/// A saved filter's title comes from the local row.
struct SavedFilterScreen: View {
    let services: AppServices
    let serverId: Int

    var body: some View {
        let title = (try? services.store.savedFilter(serverId: serverId))?.title ?? "Filter"
        SmartViewScreen(services: services, view: .savedFilter(serverId: serverId), title: title)
            .id(serverId)
    }
}
