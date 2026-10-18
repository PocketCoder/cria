import CriaKit
import SwiftUI

/// A smart view (Today, Upcoming, Inbox or a saved filter): sections of tasks that update from the database. The
/// Display sheet filters and sorts them (Inbox and saved filters can also be grouped), and Select starts multi-select.
struct SmartViewScreen: View {
    let services: AppServices
    let title: String
    let view: SmartView
    @State var live: LiveValue<SmartViewData>
    @State var display: DisplayModel
    @State private var selection = TaskSelection()
    /// Settings > General > Show completed: what a view does until its Display sheet says otherwise.
    @AppStorage("cria.taskList.showDone") private var showDone = true
    @State var selectedDay = Calendar.cria.startOfDay(for: Date())
    @State var addPresented = false
    /// The day a Mac group's New Task row asked for; the selected day otherwise.
    @State var addDay: Date?
    /// The project a Mac group's New Task row asked for (Inbox's); then no day is filled in.
    @State var addProject: String?
    @State var rescheduling: DisplaySection?
    #if os(macOS)
    /// Rows completed here, kept struck through until the screen goes.
    @State var recent = RecentlyCompleted()
    @AppStorage(GeneralSettings.weekStartDefaultsKey) var weekStart = GeneralSettings.defaultWeekStart
    #endif
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
                var groups = try reading.smartGroups(view, includeDone: true)
                #if os(macOS)
                // The Mac's Upcoming opens with Overdue while today is the selected day.
                if view == .upcoming,
                   let overdue = try reading.smartGroups(.today, includeDone: true).first(where: { $0.key == "overdue" }) {
                    groups.insert(overdue, at: 0)
                }
                #endif
                let items = groups.flatMap(\.items)
                let parents = try TaskListNesting.parentTitles(reading, for: items)
                var data = SmartViewData(
                    groups: groups, parentTitles: parents, nesting: try SmartNestingData.read(reading, items: items),
                    assignees: try reading.assigneeMap(), loaded: true
                )
                #if os(macOS)
                if case .inbox(let serverId?) = view {
                    data.inboxLocalId = try reading.projects().first { $0.serverId == serverId }?.localId
                }
                #endif
                return data
            }
        })
    }

    private var hasAnyTasks: Bool { live.value.groups.contains { !$0.items.isEmpty } }

    /// Open tasks in the view, before any Display filter: what "left today" means.
    var openCount: Int {
        live.value.groups.reduce(0) { total, group in total + group.items.filter { !$0.task.done }.count }
    }

    /// The groups after the Display options: filtered and sorted inside each day (or Today's overdue and due), or
    /// regrouped when the sheet groups an Inbox or a saved filter.
    private var allDisplayed: [DisplaySection] {
        let raw = live.value.groups.map { DisplaySection(key: $0.key, label: $0.label, items: $0.items) }
        let showCompleted = display.showsCompleted(default: showDone)
        let context = display.context(assignees: live.value.assignees)
        #if os(macOS)
        let keepsDone = showCompleted || !recent.isEmpty
        #else
        let keepsDone = showCompleted
        #endif
        let sections: [DisplaySection]
        if display.config.groupBy != .none && !display.sections.groupings.isEmpty {
            sections = DisplayEngine.sections(raw.flatMap(\.items), config: display.config, showCompleted: keepsDone, context: context)
        } else {
            sections = DisplayEngine.refined(raw, config: display.config, showCompleted: keepsDone, context: context)
        }
        #if os(macOS)
        return macArranged(recent.merged(sections, showsCompleted: showCompleted))
        #else
        return sections
        #endif
    }

    /// The sections shown: Upcoming starts at the selected day.
    private func visible(_ displayed: [DisplaySection]) -> [DisplaySection] {
        guard view == .upcoming else { return displayed }
        let from = Self.dayKey(selectedDay)
        #if os(macOS)
        let todaySelected = Calendar.cria.isDateInToday(selectedDay)
        return displayed.filter { $0.key == "overdue" ? todaySelected : $0.key >= from }
        #else
        return displayed.filter { $0.key >= from }
        #endif
    }

    static func dayKey(_ date: Date) -> String {
        DueDates.dayKey(DueDates.allDayISO(for: date)) ?? ""
    }

    var subtitle: String? {
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
        // Filtering, sorting and regrouping run once per pass, not once per place that needs the result.
        let displayed = allDisplayed
        List {
            #if os(macOS)
            MacSmartHeader(
                title: title, subtitle: macSubtitle, isUpcoming: view == .upcoming,
                selectedDay: $selectedDay, busyDays: Set(displayed.filter { !$0.items.isEmpty }.map(\.key))
            )
            #else
            header(displayed)
            #endif
            if showsTodayEmpty { TodayEmptyView(services: services) }
            // Every group shown is on or after the selected day, so an empty selected day comes first. The Mac lists
            // every day of the week instead, each with its New Task row.
            #if !os(macOS)
            nothingPlanned(displayed)
            #endif
            ForEach(visible(displayed)) { group in
                groupSection(group)
            }
            if hasAnyTasks && displayed.isEmpty && display.hasFilters {
                Section {
                    DisplayNoMatchesRow(
                        hasFilters: true, onReset: { display.update { $0.filters = DisplayFilters() } }, onShowCompleted: {}
                    )
                }
            }
        }
        #if os(macOS)
        // Built once the first read is in, so rows do not draw title-high and then grow (see TaskListView).
        .id(live.value.loaded)
        #endif
        .publishesTaskOrder(visible(displayed).flatMap { live.value.nesting.rows(for: $0.items, expanded: expanded).map(\.id) })
        .criaSurface()
        // The default top margin and section gaps left a band of empty space under the title.
        .contentMargins(.top, 0, for: .scrollContent)
        #if os(macOS)
        .environment(\.recentlyCompleted, recent)
        #endif
        .listSectionSpacing(.compact)
        .overlay {
            if live.value.loaded && !hasAnyTasks && view != .upcoming && view != .today {
                ContentUnavailableView("Nothing here", systemImage: "checkmark.circle")
            }
        }
        .navigationTitle(title)
        #if os(macOS)
        .macHidesWindowTitle()
        #endif
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
        .sheet(isPresented: $addPresented, onDismiss: { addDay = nil; addProject = nil }, content: {
            QuickAddSheet(
                services: services, contextProjectId: addProject, initialDueDate: addProject == nil ? addDay ?? selectedDay : nil
            )
        })
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

}

extension SmartViewScreen {
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

    @ViewBuilder private func nothingPlanned(_ displayed: [DisplaySection]) -> some View {
        if view == .upcoming && !displayed.contains(where: { $0.key == Self.dayKey(selectedDay) }) {
            Section {
                Button { addPresented = true } label: {
                    Label("Nothing planned", systemImage: "plus").foregroundStyle(Color(.mutedForeground))
                        #if os(macOS)
                        // A proper empty day on the Mac: full width, room to click, a dashed outline.
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(Color(.border), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                        )
                        .contentShape(Rectangle())
                        #endif
                }
                .accessibilityHint("Adds a task on this day")
            } header: {
                Text(selectedDay.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))
            }
        }
    }

    @ViewBuilder private func header(_ displayed: [DisplaySection]) -> some View {
        if view == .upcoming {
            Section {
                WeekStrip(selected: $selectedDay, busyDays: Set(displayed.map(\.key)))
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

    /// On the Mac, Inbox is one project: its tasks need no project chip, and its one group needs no header repeating the title.
    var isInbox: Bool {
        #if os(macOS)
        if case .inbox = view { return true }
        #endif
        return false
    }

    private var showsProject: Bool { !isInbox }

    private func groupSection(_ group: DisplaySection) -> some View {
        Section {
            ForEach(live.value.nesting.rows(for: group.items, expanded: expanded)) { row in
                TaskRowLink(services: services, item: row.item, showProject: showsProject && row.depth == 0, tree: tree(for: row))
            }
            #if os(macOS)
            .environment(\.completionGroup, CompletionGroup(key: group.key, label: group.label))
            #endif
            #if os(macOS)
            macNewTaskRow(group)
            #endif
        } header: {
            groupHeader(group)
        }
    }

    @ViewBuilder private func groupHeader(_ group: DisplaySection) -> some View {
        #if os(macOS)
        macGroupHeader(group)
        #else
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
        } else if !isInbox {
            Text(group.label).font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
                .accessibilityAddTraits(.isHeader)
        }
        #endif
    }
}

extension SmartViewScreen {
    private var rescheduleTitle: String {
        let count = rescheduling?.items.count ?? 0
        return count == 1 ? "Move 1 overdue task to today?" : "Move \(count) overdue tasks to today?"
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
/// Equatable, so a re-read that found nothing new does not re-render the screen (`LiveValue`).
struct SmartViewData: Equatable, Sendable {
    var groups: [TaskGroup] = []
    var parentTitles: [String: String] = [:]
    var nesting = SmartNestingData()
    /// Task local id to the user ids assigned, for the Display sheet's assignee filter.
    var assignees: [String: Set<Int>] = [:]
    /// False until the first read, so an empty state does not flash before the tasks arrive.
    var loaded = false
    /// Inbox's project, for the Mac's New Task row.
    var inboxLocalId: String?
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
