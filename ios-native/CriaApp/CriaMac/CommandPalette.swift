import CriaKit
import SwiftUI

private struct PaletteItem: Identifiable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
    var tint: Color?
    /// Its key equivalent, shown on the right in place of the detail.
    var shortcut: String?
    /// Set for a task row, which ⌘Return completes.
    var taskId: String?
    let run: @MainActor () -> Void
}

/// ⌘K: type to filter, ↑ ↓ to move, Return to run, ⌘Return to complete a task. Covers the smart views, projects,
/// labels, saved filters, commands and, from two characters, tasks, as `src/components/CommandPalette.tsx` does.
struct CommandPalette: View {
    let services: AppServices
    let actions: MacActions
    /// Set when shown as the floating panel (`MacOverlays`) rather than a sheet.
    var onClose: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openSettings) private var openSettings
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.playsCompletionSound) private var playsSound
    @Environment(\.preferences) private var preferences
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false
    @State private var query = ""
    @State private var chosen = 0
    @State private var projects: [ProjectRecord] = []
    @State private var filters: [SavedFilterRecord] = []
    @State private var labels: [LabelRecord] = []
    @State private var tasks: [TaskListItem] = []
    @State private var failure: String?
    @FocusState private var searching: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 17)).foregroundStyle(MacTheme.label2)
                TextField("Go to a list, project or command", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 17))
                    .focused($searching)
                    .onSubmit(runChosen)
                    .onKeyPress(.downArrow) { move(1) }
                    .onKeyPress(.upArrow) { move(-1) }
                    .onKeyPress(.return, phases: .down) { press in
                        guard press.modifiers.contains(.command) else { return .ignored }
                        completeChosen()
                        return .handled
                    }
                    .onChange(of: query) { chosen = 0 }
                Text("esc")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(MacTheme.label3)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 5))
            }
            .padding(.horizontal, 16)
            .frame(height: 54)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(groups, id: \.title) { group in
                            Text(group.title)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(MacTheme.label3)
                                .padding(.horizontal, 10)
                                .padding(.top, 8)
                                .padding(.bottom, 4)
                            ForEach(group.rows, id: \.item.id) { row in
                                self.row(row.item, selected: row.index == chosen)
                                    .id(row.item.id)
                                    .contentShape(Rectangle())
                                    .onTapGesture { run(row.item) }
                            }
                        }
                    }
                    .padding(6)
                }
                .frame(maxHeight: 340)
                .onChange(of: chosen) { if shown.indices.contains(chosen) { proxy.scrollTo(shown[chosen].id) } }
            }
            footer
        }
        .frame(width: 600)
        .focusEffectDisabled()
        .onExitCommand { close() }
        .task {
            searching = true
            projects = ProjectTree.visible((try? services.store.projects()) ?? [])
            filters = (try? services.store.savedFilters()) ?? []
            labels = (try? services.store.labels()) ?? []
        }
        .task(id: query) { await searchTasks() }
    }

    /// A 32pt row, accent filled with white text when chosen.
    private func row(_ item: PaletteItem, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: item.symbol)
                .font(.system(size: 13))
                .frame(width: 18)
                .foregroundStyle(selected ? Color.white : (item.tint ?? Color(.primary)))
            Text(item.title).font(.system(size: 13)).foregroundStyle(selected ? Color.white : Color(.foreground)).lineLimit(1)
            Spacer()
            Text(item.shortcut ?? (item.taskId == nil ? "" : item.detail))
                .font(.system(size: 11))
                .foregroundStyle(selected ? Color.white.opacity(0.8) : MacTheme.label3)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(selected ? Color(.primary) : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    /// The palette's sections, in display order, each row carrying its index in `shown`.
    private var groups: [(title: String, rows: [(index: Int, item: PaletteItem)])] {
        var result: [(title: String, rows: [(index: Int, item: PaletteItem)])] = []
        for (index, item) in shown.enumerated() {
            let title = Self.group(of: item)
            if result.last?.title == title {
                result[result.count - 1].rows.append((index: index, item: item))
            } else {
                result.append((title: title, rows: [(index: index, item: item)]))
            }
        }
        return result
    }

    private static let groupOrder = ["Go to", "Projects", "Labels", "Saved filters", "Commands", "Tasks"]

    private static func group(of item: PaletteItem) -> String {
        if item.taskId != nil { return "Tasks" }
        switch item.detail {
        case "Go to": return "Go to"
        case "Project": return "Projects"
        case "Label": return "Labels"
        case "Saved filter": return "Saved filters"
        default: return "Commands"
        }
    }

    @ViewBuilder private var footer: some View {
        let hint = shown.indices.contains(chosen) && shown[chosen].taskId != nil
            ? "Return to open · ⌘Return to complete" : "Return to run · Esc to close"
        Text(failure ?? hint)
            .font(Theme.caption)
            .foregroundStyle(failure == nil ? Color(.mutedForeground) : Color(.destructive))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
    }

    /// Views, projects, labels, saved filters and commands that match the text by title.
    private var places: [PaletteItem] {
        var result = commands
        result += projects.map { project in
            PaletteItem(id: "p.\(project.localId)", title: project.title, detail: "Project", symbol: "circle.fill",
                        tint: Color(hexString: project.hexColor)) { actions.go(.project(project.localId)) }
        }
        // Labels and saved filters only come up when searching, so the empty palette shows Go to, Projects and Commands.
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return result }
        result += labels.map { label in
            PaletteItem(id: "l.\(label.localId)", title: label.title, detail: "Label", symbol: "tag.fill",
                        tint: Color(hexString: label.hexColor)) { actions.go(.label(label.localId)) }
        }
        result += filters.map { filter in
            PaletteItem(id: "f.\(filter.serverId)", title: filter.title, detail: "Saved filter", symbol: "line.3.horizontal.decrease") {
                actions.go(.savedFilter(filter.serverId))
            }
        }
        return result
    }

    /// Found tasks, matched by the search index (title and description), with their project and due date.
    private var taskItems: [PaletteItem] {
        tasks.map { item in
            let task = item.task
            let due = task.dueDate.map { DueDates.label($0, now: Date(), display: dateDisplay) }
            let detail = [item.projectTitle, due].compactMap { $0 }.joined(separator: " · ")
            return PaletteItem(id: "t.\(task.localId)", title: task.title, detail: detail,
                               symbol: task.done ? "checkmark.circle" : "circle", taskId: task.localId) {
                actions.openTask(task.localId)
            }
        }
    }

    private var shown: [PaletteItem] {
        let text = query.trimmingCharacters(in: .whitespaces)
        let matches = text.isEmpty ? places : places.filter { $0.title.localizedCaseInsensitiveContains(text) }
        // Grouped in display order (a stable sort keeps each group's own order), so ↑ ↓ follow the sections.
        let rank = { (item: PaletteItem) in Self.groupOrder.firstIndex(of: Self.group(of: item)) ?? Self.groupOrder.count }
        let grouped = Array(matches.prefix(40)).enumerated()
            .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
            .map(\.element)
        return grouped + taskItems
    }

    private func move(_ step: Int) -> KeyPress.Result {
        guard !shown.isEmpty else { return .handled }
        chosen = min(max(chosen + step, 0), shown.count - 1)
        return .handled
    }

    private func runChosen() {
        if shown.indices.contains(chosen) { run(shown[chosen]) }
    }

    private func close() {
        if let onClose { onClose() } else { dismiss() }
    }

    private func run(_ item: PaletteItem) {
        close()
        // After the sheet has gone, so a command that opens another sheet is not swallowed by the dismissal.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            item.run()
        }
    }

    /// ⌘Return on a task: completes it and stays open, as the desktop palette does.
    private func completeChosen() {
        guard shown.indices.contains(chosen), let id = shown[chosen].taskId else { return }
        do {
            try undo.updateTask(services, localId: id, patch: TaskPatch(done: true))
            failure = nil
            if playsSound { CompletionSound.play(preferences.custom.completionTone) }
        } catch {
            failure = "Could not complete the task: \(error)"
        }
        Task { await findTasks(query) }
    }

    /// From two characters, after a short pause so typing does not search on every key.
    private func searchTasks() async {
        guard query.trimmingCharacters(in: .whitespaces).count >= 2 else {
            tasks = []
            return
        }
        try? await Task.sleep(for: .milliseconds(200))
        if Task.isCancelled { return }
        await findTasks(query)
    }

    /// Off the main thread, as Search does; kept only if the text has not moved on.
    private func findTasks(_ text: String) async {
        let store = services.store
        let input = text.trimmingCharacters(in: .whitespaces)
        let found = await Task.detached(priority: .userInitiated) { (try? store.search(input))?.tasks ?? [] }.value
        guard !Task.isCancelled, text == query else { return }
        tasks = Array(found.prefix(20))
    }
}

extension CommandPalette {
    /// Go to rows, then the seven commands the design lists, in its order.
    private var commands: [PaletteItem] {
        var result = [
            go("Today", "calendar", .today, "⌘1"), go("Upcoming", "calendar.badge.clock", .upcoming, "⌘2"),
            go("Inbox", "tray", .inbox, "⌘3"), go("Favourites", "star", .favorites), go("Search", "magnifyingglass", .search, "⌘F"),
            PaletteItem(id: "go.labels", title: "Labels", detail: "Go to", symbol: "tag") { actions.sidebar.showingLabels = true }
        ]
        if !isLinkShare {
            result.append(PaletteItem(id: "go.teams", title: "Teams", detail: "Go to", symbol: "person.2") {
                actions.sidebar.showingTeams = true
            })
            result.append(command("filter", "New saved filter", "line.3.horizontal.decrease") { actions.sidebar.newFilter() })
        }
        result.append(command("task", "New task", "plus", "⌘N") { actions.newTask() })
        if AIStatus.shared.isOfferable {
            result.append(command("ramble", "Ramble to tasks", "mic") { actions.showingRamble = true })
        }
        result += [
            command("photo", "List from photo", "photo") { actions.showingPhoto = true },
            command("project", "New project", "folder.badge.plus", "⇧⌘N") { actions.creatingProject = true },            command("sidebar", "Toggle sidebar", "sidebar.left", "⌘E") { actions.toggleSidebar() },
            command("settings", "Settings", "gearshape", "⌘,") { openSettings() },
            command("shortcuts", "Keyboard shortcuts", "keyboard", "?") { actions.showingShortcuts = true }
        ]
        return result
    }

    private func command(
        _ id: String, _ title: String, _ symbol: String, _ shortcut: String? = nil, run: @escaping @MainActor () -> Void
    ) -> PaletteItem {
        PaletteItem(id: "cmd.\(id)", title: title, detail: "Command", symbol: symbol, shortcut: shortcut, run: run)
    }

    private func go(_ title: String, _ symbol: String, _ destination: MacSelection, _ shortcut: String? = nil) -> PaletteItem {
        PaletteItem(id: "go.\(title)", title: title, detail: "Go to", symbol: symbol, shortcut: shortcut) { actions.go(destination) }
    }
}
