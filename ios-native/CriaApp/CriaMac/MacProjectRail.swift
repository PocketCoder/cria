import CriaKit
import SwiftUI

/// Puts the info rail beside a project's List view, with the "Showing label · Clear" bar above the list while a
/// label chip filters it. The rail hides when switched off for the project or while a task is open in the inspector.
/// Its figures come from the List view's own store read (`ProjectListData`), so the rail reads nothing itself.
struct MacProjectRailHost: ViewModifier {
    let services: AppServices
    let projectLocalId: String
    let summary: ProjectRailSummary
    @Binding var labelFilter: String?
    @AppStorage private var showInfo: Bool
    @Environment(\.openTaskState) private var openTask

    init(services: AppServices, projectLocalId: String, summary: ProjectRailSummary, labelFilter: Binding<String?>) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.summary = summary
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
                MacProjectRail(services: services, summary: summary, labelFilter: $labelFilter)
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
        summary.labels.first { $0.label.localId == labelFilter }?.label.title ?? "Label"
    }
}

/// The project info rail: About, Progress, Coming up, Labels and People cards.
struct MacProjectRail: View {
    let services: AppServices
    let summary: ProjectRailSummary
    @Binding var labelFilter: String?
    @State private var aboutDraft = ""
    @FocusState private var editingAbout: Bool
    /// The project's shares, for People's roles. Online only; empty until loaded or when offline.
    @State private var shares: [UserShare] = []
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.taskOpener) private var openTask
    @Environment(\.macSidebarActions) private var sheets
    @FocusedValue(\.macActions) private var actions

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 12) {
                card("About") { aboutField }
                card("Progress") { MacRailProgress(done: summary.done, total: summary.total, overdue: summary.overdue) }
                if !summary.comingUp.isEmpty {
                    card("Coming up", action: RailAction(title: "Upcoming") { actions?.go(.upcoming) }) { comingUpRows }
                }
                if !summary.labels.isEmpty { card("Labels") { labelChips } }
                if !people.isEmpty || sheets != nil { peopleCard }
            }
            .padding(.trailing, 16)
            .padding(.bottom, 16)
        }
        .scrollIndicators(.hidden)
        .onAppear { aboutDraft = about }
        .onChange(of: about) { _, text in if !editingAbout { aboutDraft = text } }
        .task(id: summary.project?.serverId) { await loadShares() }
    }

    private func card<Content: View>(
        _ title: String, action: RailAction? = nil, @ViewBuilder content: () -> Content
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

    private var about: String {
        AIPrompts.stripHtml(summary.project?.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Edited in place; saved when the field loses focus or on Return.
    private var aboutField: some View {
        TextField("Add a description", text: $aboutDraft, axis: .vertical)
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .foregroundStyle(Color(.foreground))
            .lineLimit(1...8)
            .focused($editingAbout)
            .onSubmit { saveAbout() }
            .onChange(of: editingAbout) { _, now in if !now { saveAbout() } }
            .onExitCommand {
                aboutDraft = about
                editingAbout = false
            }
            .disabled(summary.project == nil)
    }

    /// The description is HTML: each line of the plain text becomes an escaped paragraph.
    private func saveAbout() {
        let text = aboutDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let project = summary.project, text != about else { return }
        let html = text.split(separator: "\n", omittingEmptySubsequences: true).map { line in
            "<p>" + line.replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;") + "</p>"
        }.joined()
        var patch = ProjectPatch()
        patch.description = .set(html.isEmpty ? nil : html)
        do {
            _ = try services.store.updateProject(localId: project.localId, patch: patch)
        } catch {
            sheets?.failureTitle = "Could not save"
            sheets?.failure = String(describing: error)
        }
    }

    // MARK: Coming up

    private var comingUpRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(summary.comingUp, id: \.localId) { task in
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

    private var labelChips: some View {
        ChipFlowLayout(spacing: 6) {
            ForEach(summary.labels, id: \.label.localId) { entry in
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

    /// The project's shares with their role once loaded, else everyone assigned to its tasks (no role known).
    private var people: [MacRailPerson] {
        if !shares.isEmpty {
            return shares.map { share in
                MacRailPerson(
                    id: share.serverId, name: share.name ?? share.username,
                    role: share.permission == .read ? "Can view" : "Can edit"
                )
            }
        }
        return summary.people.map { MacRailPerson(id: $0.userId, name: ProjectRailSummary.personName($0), role: nil) }
    }

    private var peopleCard: some View {
        var share: RailAction?
        if let sheets, let project = summary.project {
            share = RailAction(title: "Share…") { sheets.sharing = ProjectShareTarget(project: project) }
        }
        return card("People", action: share) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(people) { person in
                    HStack(spacing: 8) {
                        Text(String(person.name.prefix(1)).uppercased())
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color(.primary))
                            .frame(width: 22, height: 22)
                            .background(Color(.primary).opacity(0.13), in: Circle())
                            .accessibilityHidden(true)
                        Text(person.name).font(.system(size: 13)).lineLimit(1)
                        Spacer(minLength: 4)
                        if let role = person.role {
                            Text(role).font(.system(size: 12)).foregroundStyle(MacTheme.label2)
                        }
                    }
                }
                if people.isEmpty {
                    Text("Only you").font(.system(size: 13)).foregroundStyle(MacTheme.label2)
                }
            }
        }
    }

    private func loadShares() async {
        guard let serverId = summary.project?.serverId else { return }
        shares = (try? await services.api.projectUsers(projectId: serverId)) ?? []
    }
}

/// Progress: a 44pt ring (5pt stroke, round caps, from the top) that springs to its value over 400ms, then the counts.
private struct MacRailProgress: View {
    let done: Int
    let total: Int
    let overdue: Int

    var body: some View {
        let fraction = total == 0 ? 0 : Double(done) / Double(total)
        HStack(spacing: 12) {
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
                Text("\(done) of \(total) done").font(.system(size: 15, weight: .semibold))
                Text(overdue == 0 ? "Nothing overdue" : "\(overdue) overdue")
                    .font(.system(size: 12))
                    .foregroundStyle(overdue == 0 ? MacTheme.label2 : MacTheme.coral)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Someone in the People card, with their role when the shares have loaded.
private struct MacRailPerson: Identifiable {
    let id: Int
    let name: String
    let role: String?
}

/// A rail card's link on the right of its title.
private struct RailAction {
    let title: String
    let run: () -> Void
}
