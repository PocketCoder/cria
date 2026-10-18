import CriaKit
import SwiftUI

/// The in-content header on the Mac: colour dot and Onest title, the subtitle, then Share, the info toggle (List view
/// only) and the project menu.
struct MacProjectHeader: View {
    let title: String
    let colour: Color?
    let subtitle: String
    let project: ProjectRecord?
    let projectLocalId: String
    let services: AppServices?
    let showsInfoToggle: Bool
    let canManage: Bool
    let onManage: () -> Void
    @Environment(\.macSidebarActions) private var sheets
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 10) {
                    if let colour {
                        Circle().fill(colour).frame(width: 14, height: 14).accessibilityHidden(true)
                    }
                    Text(title)
                        .font(MacTheme.largeTitle.weight(.bold))
                        .tracking(MacTheme.largeTitleTracking)
                        .foregroundStyle(Color(.foreground))
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                }
                Text(subtitle).font(.system(size: 13)).foregroundStyle(MacTheme.label2)
            }
            Spacer(minLength: 12)
            if let project, let sheets, !isLinkShare {
                Button {
                    sheets.sharing = ProjectShareTarget(project: project)
                } label: {
                    Label("Share", systemImage: "person.badge.plus")
                }
                .buttonStyle(.bordered)
            }
            if showsInfoToggle {
                MacProjectInfoToggle(projectLocalId: projectLocalId)
            }
            if let project, let sheets, let services {
                Menu {
                    MacProjectMenu(project: project, services: services, sheets: sheets)
                    if canManage {
                        Divider()
                        Button("Manage Views…", systemImage: "square.grid.2x2") { onManage() }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel("Project options")
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 18)
    }
}

/// ⓘ in the header: shows or hides the project info rail, accent coloured while it is on.
private struct MacProjectInfoToggle: View {
    @AppStorage private var showInfo: Bool

    init(projectLocalId: String) {
        _showInfo = AppStorage(wrappedValue: true, MacProjectChrome.infoKey(projectLocalId))
    }

    var body: some View {
        Button {
            showInfo.toggle()
        } label: {
            Image(systemName: showInfo ? "info.circle.fill" : "info.circle")
                .foregroundStyle(showInfo ? Color(.primary) : MacTheme.label2)
        }
        .buttonStyle(.borderless)
        .help(showInfo ? "Hide Project Info ⌥⌘I" : "Show Project Info ⌥⌘I")
        .accessibilityLabel(showInfo ? "Hide project info" : "Show project info")
    }
}

/// Puts the info rail beside a project's List view, with the "Showing label · Clear" bar above the list while a
/// label chip filters it. The rail hides when switched off for the project or while a task is open in the inspector.
struct MacProjectRailHost: ViewModifier {
    let services: AppServices
    let projectLocalId: String
    @Binding var labelFilter: String?
    @AppStorage private var showInfo: Bool
    @Environment(\.openTaskState) private var openTask

    init(services: AppServices, projectLocalId: String, labelFilter: Binding<String?>) {
        self.services = services
        self.projectLocalId = projectLocalId
        _labelFilter = labelFilter
        _showInfo = AppStorage(wrappedValue: true, MacProjectChrome.infoKey(projectLocalId))
    }

    private var showsRail: Bool { showInfo && openTask?.id == nil }

    func body(content: Content) -> some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(spacing: 0) {
                if labelFilter != nil { filterBar }
                content
            }
            if showsRail {
                MacProjectRail(services: services, projectLocalId: projectLocalId, labelFilter: $labelFilter)
                    .frame(width: 272)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.smooth, value: showsRail)
        .onReceive(NotificationCenter.default.publisher(for: .criaProjectInfoCommand)) { _ in showInfo.toggle() }
        // A filter left on with the rail hidden would hide tasks with nothing on screen to say why.
        .onChange(of: showInfo) { _, shown in if !shown { labelFilter = nil } }
    }

    private var filterBar: some View {
        HStack(spacing: 6) {
            Text("Showing").foregroundStyle(MacTheme.label2)
            Text(labelTitle).fontWeight(.semibold).foregroundStyle(Color(.primary))
            Button("Clear") { labelFilter = nil }.buttonStyle(.link)
            Spacer()
        }
        .font(.system(size: 12))
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }

    private var labelTitle: String {
        guard let labelFilter else { return "" }
        return (try? services.store.labels())?.first { $0.localId == labelFilter }?.title ?? "Label"
    }
}

struct MacProjectRailData: Equatable, Sendable {
    var project: ProjectRecord?
    var items: [TaskListItem] = []
    var people: [AssigneeRecord] = []
}

/// The project info rail: About, Progress, Coming up, Labels and People cards, all read from the local database.
struct MacProjectRail: View {
    let services: AppServices
    let projectLocalId: String
    @Binding var labelFilter: String?
    @State private var live: LiveValue<MacProjectRailData>
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.taskOpener) private var openTask
    @Environment(\.macSidebarActions) private var sheets

    init(services: AppServices, projectLocalId: String, labelFilter: Binding<String?>) {
        self.services = services
        self.projectLocalId = projectLocalId
        _labelFilter = labelFilter
        let store = services.store
        _live = State(initialValue: LiveValue(initial: MacProjectRailData()) {
            observeStore(store, kinds: [.projects, .tasks, .labels]) { reading in
                var seen = Set<Int>()
                let people = try reading.assigneesByTask(projectLocalId: projectLocalId).values
                    .flatMap { $0 }
                    .filter { seen.insert($0.userId).inserted }
                    .sorted { railPersonName($0).localizedCaseInsensitiveCompare(railPersonName($1)) == .orderedAscending }
                return try MacProjectRailData(
                    project: reading.project(localId: projectLocalId),
                    items: reading.taskItems(.project(projectLocalId), includeDone: true),
                    people: people
                )
            }
        })
    }

    private var items: [TaskListItem] { live.value.items }
    private var openItems: [TaskListItem] { items.filter { !$0.task.done } }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 12) {
                if let about { card("About") { Text(about).font(.system(size: 13)).foregroundStyle(Color(.foreground)) } }
                card("Progress") { progress }
                if !comingUp.isEmpty { card("Coming up") { comingUpRows } }
                if !labelCounts.isEmpty { card("Labels") { labelChips } }
                if !live.value.people.isEmpty { peopleCard }
            }
            .padding(.trailing, 16)
            .padding(.bottom, 16)
        }
        .scrollIndicators(.hidden)
        .task { await live.run() }
    }

    // MARK: Cards

    private func card<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        cardWithAction(title, action: nil, content: content)
    }

    private func cardWithAction<Content: View>(
        _ title: String, action: RailAction?, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(MacTheme.label2)
                Spacer()
                if let action {
                    Button(action.title, action: action.run).buttonStyle(.link).font(.system(size: 12))
                }
            }
            content()
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MacTheme.cell, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
        }
    }

    // MARK: About

    private var about: String? {
        guard let html = live.value.project?.description else { return nil }
        let text = AIPrompts.stripHtml(html).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    // MARK: Progress

    private var doneCount: Int { items.count - openItems.count }

    private var overdueCount: Int {
        let now = Date()
        return openItems.filter { item in item.task.dueDate.map { DueDates.isOverdue($0, now: now) } ?? false }.count
    }

    private var progress: some View {
        let fraction = items.isEmpty ? 0 : Double(doneCount) / Double(items.count)
        return HStack(spacing: 12) {
            ZStack {
                Circle().stroke(Color.primary.opacity(0.1), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(Color(.primary), style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.smooth(duration: 0.4), value: fraction)
            }
            .frame(width: 44, height: 44)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(doneCount) of \(items.count) done").font(.system(size: 15, weight: .semibold))
                Text(overdueCount == 0 ? "Nothing overdue" : "\(overdueCount) overdue")
                    .font(.system(size: 12))
                    .foregroundStyle(overdueCount == 0 ? MacTheme.label2 : MacTheme.coral)
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Coming up

    /// The next three open tasks with a due date, soonest first.
    private var comingUp: [TaskRecord] {
        let dated = openItems.compactMap { item -> (TaskRecord, Date)? in
            guard let due = item.task.dueDate, let date = DueDates.parse(due) else { return nil }
            return (item.task, date)
        }
        return dated.sorted { $0.1 < $1.1 }.prefix(3).map(\.0)
    }

    private var comingUpRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(comingUp, id: \.localId) { task in
                Button {
                    openTask?(task.localId)
                } label: {
                    HStack(spacing: 8) {
                        Circle().fill(priorityColour(task.priority)).frame(width: 6, height: 6)
                        Text(task.title).font(.system(size: 13)).foregroundStyle(Color(.foreground)).lineLimit(1)
                        Spacer(minLength: 4)
                        if let due = task.dueDate {
                            Text(DueDates.label(due, now: Date(), display: dateDisplay))
                                .font(.system(size: 12))
                                .foregroundStyle(DueDates.isOverdue(due, now: Date()) ? MacTheme.coral : MacTheme.label2)
                        }
                    }
                    .frame(height: 28)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func priorityColour(_ priority: Int) -> Color {
        if priority >= 4 { return MacTheme.coral }
        if priority == 3 { return MacTheme.marigold }
        return MacTheme.label3
    }

    // MARK: Labels

    /// Each label on the project's tasks with how many tasks carry it, most used first.
    private var labelCounts: [RailLabelCount] {
        var counts: [String: RailLabelCount] = [:]
        for item in items {
            for label in item.labels {
                counts[label.localId, default: RailLabelCount(label: label, count: 0)].count += 1
            }
        }
        return counts.values.sorted { $0.count != $1.count ? $0.count > $1.count : $0.label.title < $1.label.title }
    }

    private var labelChips: some View {
        ChipFlowLayout(spacing: 6) {
            ForEach(labelCounts, id: \.label.localId) { entry in
                let active = labelFilter == entry.label.localId
                let tint = Color(hexString: entry.label.hexColor) ?? Color(.primary)
                Button {
                    labelFilter = active ? nil : entry.label.localId
                } label: {
                    HStack(spacing: 4) {
                        Text(entry.label.title).foregroundStyle(Color(.foreground))
                        Text("\(entry.count)").foregroundStyle(MacTheme.label3)
                    }
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(tint.opacity(active ? 0.26 : 0.12), in: Capsule())
                    .overlay { if active { Capsule().strokeBorder(tint, lineWidth: 1) } }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
    }

    // MARK: People

    private var peopleCard: some View {
        var share: RailAction?
        if let sheets, let project = live.value.project {
            share = RailAction(title: "Share…") { sheets.sharing = ProjectShareTarget(project: project) }
        }
        return cardWithAction("People", action: share) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(live.value.people) { person in
                    HStack(spacing: 8) {
                        Text(String(railPersonName(person).prefix(1)).uppercased())
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color(.primary))
                            .frame(width: 22, height: 22)
                            .background(Color(.primary).opacity(0.13), in: Circle())
                            .accessibilityHidden(true)
                        Text(railPersonName(person)).font(.system(size: 13)).lineLimit(1)
                    }
                }
            }
        }
    }
}

/// A person's display name, else their username.
private func railPersonName(_ person: AssigneeRecord) -> String {
    person.displayName ?? person.username ?? "User \(person.userId)"
}

/// A rail card's link on the right of its title.
private struct RailAction {
    let title: String
    let run: () -> Void
}

/// A label on the project's tasks and how many carry it.
private struct RailLabelCount {
    let label: LabelRecord
    var count: Int
}
