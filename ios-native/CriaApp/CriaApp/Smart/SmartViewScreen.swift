import CriaKit
import SwiftUI

/// A smart view (Today, Upcoming, Inbox or a saved filter): sections of tasks that update from the database.
struct SmartViewScreen: View {
    let services: AppServices
    let title: String
    let view: SmartView
    @State private var live: LiveValue<SmartViewData>
    @State private var selectedDay = Calendar.cria.startOfDay(for: Date())
    @State private var addPresented = false
    @State private var rescheduling: TaskGroup?
    @State private var failure: String?

    init(services: AppServices, view: SmartView, title: String) {
        self.services = services
        self.title = title
        self.view = view
        let store = services.store
        _live = State(initialValue: LiveValue(initial: SmartViewData()) {
            observeStore(store, kinds: [.tasks, .labels, .projects, .savedFilters]) { (reading: CriaStore) throws -> SmartViewData in
                let groups = try reading.smartGroups(view)
                let parents = try TaskListNesting.parentTitles(reading, for: groups.flatMap(\.items))
                return SmartViewData(groups: groups, parentTitles: parents)
            }
        })
    }

    private var isEmpty: Bool { live.value.groups.allSatisfy { $0.items.isEmpty } }
    private var openCount: Int { live.value.groups.reduce(0) { $0 + $1.items.count } }

    private var groups: [TaskGroup] {
        guard view == .upcoming else { return live.value.groups.filter { !$0.items.isEmpty } }
        let from = Self.dayKey(selectedDay)
        return live.value.groups.filter { $0.key >= from && !$0.items.isEmpty }
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

    /// Today and Upcoming are tab roots with no toolbar buttons, so the bar's empty button row sat above the large
    /// title. They hide the bar and draw the title as the first row instead, level with Browse's buttons.
    private var drawsOwnTitle: Bool { view == .today || view == .upcoming }

    var body: some View {
        List {
            if drawsOwnTitle { titleRow }
            header
            // Every group shown is on or after the selected day, so an empty selected day comes first.
            nothingPlanned
            ForEach(groups, id: \.key) { group in
                Section {
                    ForEach(group.items, id: \.task.localId) { item in
                        TaskRowLink(
                            services: services, item: item, showProject: true,
                            tree: TaskRowTree(parentTitle: live.value.parentTitles[item.task.localId])
                        )
                    }
                } header: {
                    groupHeader(group)
                }
            }
        }
        .criaSurface()
        .overlay {
            if isEmpty && view == .today {
                ContentUnavailableView {
                    Label("All clear", systemImage: "party.popper").foregroundStyle(Color(.primary))
                } description: {
                    Text("Nothing left for today.")
                }
            } else if isEmpty && view != .upcoming {
                ContentUnavailableView("Nothing here", systemImage: "checkmark.circle")
            }
        }
        .navigationTitle(title)
        .toolbar(drawsOwnTitle ? .hidden : .automatic, for: .navigationBar)
        .refreshable { await services.refresh() }
        .quickAdd(services: services)
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
        .alert("Could not reschedule", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task { await live.run() }
    }

    private var rescheduleTitle: String {
        let count = rescheduling?.items.count ?? 0
        return count == 1 ? "Move 1 overdue task to today?" : "Move \(count) overdue tasks to today?"
    }

    @ViewBuilder private var nothingPlanned: some View {
        if view == .upcoming && !live.value.groups.contains(where: { $0.key == Self.dayKey(selectedDay) && !$0.items.isEmpty }) {
            Section {
                Button { addPresented = true } label: {
                    Label("Nothing planned", systemImage: "plus").foregroundStyle(Color(.mutedForeground))
                }
            } header: {
                Text(selectedDay.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))
            }
        }
    }

    /// The screen title and its subtitle, aligned with the cards' leading edge.
    private var titleRow: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(Theme.wordmark)
                .foregroundStyle(Color(.foreground))
                .accessibilityAddTraits(.isHeader)
            subtitleText
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 0, trailing: 0))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    @ViewBuilder private var header: some View {
        if view == .upcoming {
            Section {
                WeekStrip(selected: $selectedDay, busyDays: Set(live.value.groups.filter { !$0.items.isEmpty }.map(\.key)))
                    .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
            }
        } else if subtitle != nil && !drawsOwnTitle {
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

    @ViewBuilder private func groupHeader(_ group: TaskGroup) -> some View {
        if view == .today && group.key == "overdue" {
            HStack {
                Text(group.label).font(Theme.headline).foregroundStyle(Color(.destructive))
                Spacer()
                Button("Reschedule") { rescheduling = group }
                    .font(Theme.rowSubtitle)
            }
            .textCase(nil)
        } else {
            Text(group.label).font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
        }
    }

    /// Moves each overdue task to today. A timed due date keeps its time of day; only the day changes.
    private func rescheduleOverdue(_ group: TaskGroup) {
        var failures: [String] = []
        for item in group.items {
            guard let iso = item.task.dueDate else { continue }
            let patch = TaskPatch(dueDate: Self.movedToToday(iso))
            do {
                _ = try services.store.updateTask(localId: item.task.localId, patch: patch)
            } catch {
                failures.append("\(item.task.title): \(error)")
            }
        }
        if !failures.isEmpty { failure = failures.joined(separator: "\n") }
    }

    private static func movedToToday(_ iso: String) -> String {
        let calendar = Calendar.cria
        let now = Date()
        guard DueDates.hasTimeOfDay(iso), let due = DueDates.parse(iso) else { return DueDates.allDayISO(for: now) }
        let time = calendar.dateComponents([.hour, .minute, .second], from: due)
        let moved = calendar.date(
            bySettingHour: time.hour ?? 0, minute: time.minute ?? 0, second: time.second ?? 0, of: now
        ) ?? now
        return DueDates.timedISO(moved)
    }
}

/// A smart view's date groups, plus each shown subtask's parent title for the caption (these lists do not nest).
struct SmartViewData: Sendable {
    var groups: [TaskGroup] = []
    var parentTitles: [String: String] = [:]
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
