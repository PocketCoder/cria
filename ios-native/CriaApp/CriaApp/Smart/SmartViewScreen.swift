import CriaKit
import SwiftUI

/// A smart view (Today, Upcoming, Inbox or a saved filter): sections of tasks that update from the database.
struct SmartViewScreen: View {
    let services: AppServices
    let title: String
    let view: SmartView
    @State private var live: LiveValue<[TaskGroup]>
    @State private var selectedDay = Calendar.current.startOfDay(for: Date())
    @State private var addPresented = false

    init(services: AppServices, view: SmartView, title: String) {
        self.services = services
        self.title = title
        self.view = view
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .labels, .projects, .savedFilters]) { reading in
                try reading.smartGroups(view)
            }
        })
    }

    private var isEmpty: Bool { live.value.allSatisfy { $0.items.isEmpty } }
    private var openCount: Int { live.value.reduce(0) { $0 + $1.items.count } }

    private var groups: [TaskGroup] {
        guard view == .upcoming else { return live.value.filter { !$0.items.isEmpty } }
        let from = Self.dayKey(selectedDay)
        return live.value.filter { $0.key >= from && !$0.items.isEmpty }
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

    var body: some View {
        List {
            header
            ForEach(groups, id: \.key) { group in
                Section {
                    ForEach(group.items, id: \.task.localId) { item in
                        TaskRowLink(services: services, item: item, showProject: true)
                    }
                } header: {
                    groupHeader(group)
                }
            }
            if view == .upcoming && !live.value.contains(where: { $0.key == Self.dayKey(selectedDay) && !$0.items.isEmpty }) {
                Section {
                    Button { addPresented = true } label: {
                        Label("Nothing planned", systemImage: "plus").foregroundStyle(Color(.mutedForeground))
                    }
                } header: {
                    Text(selectedDay.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))
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
        .refreshable { await services.refresh() }
        .quickAdd(services: services)
        .sheet(isPresented: $addPresented) { QuickAddSheet(services: services, contextProjectId: nil, initialDueDate: selectedDay)
        }
        .task { await live.run() }
    }

    @ViewBuilder private var header: some View {
        if view == .upcoming {
            Section {
                WeekStrip(selected: $selectedDay, busyDays: Set(live.value.filter { !$0.items.isEmpty }.map(\.key)))
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

    @ViewBuilder private func groupHeader(_ group: TaskGroup) -> some View {
        if view == .today && group.key == "overdue" {
            HStack {
                Text(group.label).font(Theme.headline).foregroundStyle(Color(.destructive))
                Spacer()
                Button("Reschedule") { rescheduleOverdue(group) }
                    .font(Theme.rowSubtitle)
            }
            .textCase(nil)
        } else {
            Text(group.label).font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
        }
    }

    private func rescheduleOverdue(_ group: TaskGroup) {
        let today = DueDates.allDayISO(for: Date())
        for item in group.items {
            _ = try? services.store.updateTask(localId: item.task.localId, patch: TaskPatch(dueDate: today))
        }
    }
}

/// Seven day buttons for the week of the selected day. A dot marks days with open tasks.
struct WeekStrip: View {
    @Binding var selected: Date
    let busyDays: Set<String>

    @AppStorage(GeneralSettings.weekStartDefaultsKey) private var weekStart = GeneralSettings.defaultWeekStart

    private var days: [Date] {
        var calendar = Calendar.current
        calendar.firstWeekday = weekStart + 1
        let start = calendar.dateInterval(of: .weekOfYear, for: selected)?.start ?? selected
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(days, id: \.self) { day in dayButton(day) }
        }
    }

    private func dayButton(_ day: Date) -> some View {
        let calendar = Calendar.current
        let isSelected = calendar.isDate(day, inSameDayAs: selected)
        let isToday = calendar.isDateInToday(day)
        let busy = busyDays.contains(DueDates.dayKey(DueDates.allDayISO(for: day)) ?? "")
        return Button { selected = calendar.startOfDay(for: day) } label: {
            VStack(spacing: 4) {
                Text(day.formatted(.dateTime.weekday(.narrow))).font(Theme.chip)
                    .foregroundStyle(Color(.mutedForeground))
                Text(day.formatted(.dateTime.day()))
                    .font(.system(size: 18, weight: isSelected || isToday ? .semibold : .regular))
                    .foregroundStyle(isSelected ? Color(.primary) : Color(.foreground))
                Circle().fill(busy ? (isSelected ? Color(.primary) : Color(.mutedForeground)) : .clear)
                    .frame(width: 5, height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(isSelected ? Color(.primarySoft) : .clear, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Inbox needs the default project id from the server, so it is fetched on appear.
struct InboxScreen: View {
    let services: AppServices
    @State private var projectId: Int?
    @State private var didLoad = false

    var body: some View {
        Group {
            if didLoad {
                SmartViewScreen(services: services, view: .inbox(defaultProjectServerId: projectId), title: "Inbox")
            } else {
                ProgressView()
            }
        }
        .task {
            projectId = await services.defaultProjectServerId()
            didLoad = true
        }
    }
}

/// A saved filter's title comes from the local row.
struct SavedFilterScreen: View {
    let services: AppServices
    let serverId: Int

    var body: some View {
        let title = (try? services.store.savedFilter(serverId: serverId))?.title ?? "Filter"
        SmartViewScreen(services: services, view: .savedFilter(serverId: serverId), title: title)
    }
}
