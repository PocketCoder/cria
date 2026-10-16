import CriaKit
import SwiftUI

private struct PaletteItem: Identifiable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
    var tint: Color?
    /// Set for a task row, which ⌘Return completes.
    var taskId: String?
    let run: @MainActor () -> Void
}

/// ⌘K: type to filter, ↑ ↓ to move, Return to run, ⌘Return to complete a task. Covers the smart views, projects,
/// labels, saved filters, commands and, from two characters, tasks, as `src/components/CommandPalette.tsx` does.
struct CommandPalette: View {
    let services: AppServices
    let actions: MacActions
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.playsCompletionSound) private var playsSound
    @Environment(\.preferences) private var preferences
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
            TextField("Go to a list, project, label or task, or run a command", text: $query)
                .textFieldStyle(.plain)
                .font(.title3)
                .padding(14)
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
            Divider()
            ScrollViewReader { proxy in
                List(Array(shown.enumerated()), id: \.element.id) { index, item in
                    row(item, selected: index == chosen)
                        .id(item.id)
                        .contentShape(Rectangle())
                        .onTapGesture { run(item) }
                        .listRowSeparator(.hidden)
                }
                .listStyle(.plain)
                .onChange(of: chosen) { if shown.indices.contains(chosen) { proxy.scrollTo(shown[chosen].id) } }
            }
            footer
        }
        .frame(width: 560, height: 420)
        .task {
            searching = true
            projects = ProjectTree.visible((try? services.store.projects()) ?? [])
            filters = (try? services.store.savedFilters()) ?? []
            labels = (try? services.store.labels()) ?? []
        }
        .task(id: query) { await searchTasks() }
    }

    private func row(_ item: PaletteItem, selected: Bool) -> some View {
        HStack {
            Image(systemName: item.symbol).frame(width: 22).foregroundStyle(item.tint ?? Color(.mutedForeground))
            Text(item.title).foregroundStyle(Color(.foreground)).lineLimit(1)
            Spacer()
            Text(item.detail).font(Theme.caption).foregroundStyle(Color(.mutedForeground)).lineLimit(1)
        }
        .padding(.vertical, 2)
        .listRowBackground(selected ? Color(.primary).opacity(0.14) : Color.clear)
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

    private var commands: [PaletteItem] {
        var result = [
            go("Today", "calendar", .today), go("Upcoming", "calendar.badge.clock", .upcoming), go("Inbox", "tray", .inbox),
            go("Favourites", "star", .favorites), go("Search", "magnifyingglass", .search),
            PaletteItem(id: "cmd.task", title: "New task", detail: "Command", symbol: "plus") { actions.newTask() },
            PaletteItem(id: "cmd.project", title: "New project", detail: "Command", symbol: "folder.badge.plus") {
                actions.creatingProject = true
            },
            PaletteItem(id: "cmd.labels", title: "Labels", detail: "Command", symbol: "tag") { actions.sidebar.showingLabels = true },
            PaletteItem(id: "cmd.sync", title: "Sync now", detail: "Command", symbol: "arrow.triangle.2.circlepath") {
                actions.syncNow()
            },
            PaletteItem(id: "cmd.shortcuts", title: "Keyboard shortcuts", detail: "Command", symbol: "keyboard") {
                actions.showingShortcuts = true
            }
        ]
        if !isLinkShare {
            result.append(PaletteItem(
                id: "cmd.filter", title: "New saved filter", detail: "Command", symbol: "line.3.horizontal.decrease"
            ) { actions.sidebar.newFilter() })
            result.append(PaletteItem(id: "cmd.teams", title: "Teams", detail: "Command", symbol: "person.2") {
                actions.sidebar.showingTeams = true
            })
        }
        return result
    }

    /// Views, projects, labels, saved filters and commands that match the text by title.
    private var places: [PaletteItem] {
        var result = commands
        result += projects.map { project in
            PaletteItem(id: "p.\(project.localId)", title: project.title, detail: "Project", symbol: "circle.fill",
                        tint: Color(hexString: project.hexColor)) { actions.go(.project(project.localId)) }
        }
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

    private func go(_ title: String, _ symbol: String, _ destination: MacSelection) -> PaletteItem {
        PaletteItem(id: "go.\(title)", title: title, detail: "Go to", symbol: symbol) { actions.go(destination) }
    }

    private var shown: [PaletteItem] {
        let text = query.trimmingCharacters(in: .whitespaces)
        let matches = text.isEmpty ? places : places.filter { $0.title.localizedCaseInsensitiveContains(text) }
        return Array(matches.prefix(40)) + taskItems
    }

    private func move(_ step: Int) -> KeyPress.Result {
        guard !shown.isEmpty else { return .handled }
        chosen = min(max(chosen + step, 0), shown.count - 1)
        return .handled
    }

    private func runChosen() {
        if shown.indices.contains(chosen) { run(shown[chosen]) }
    }

    private func run(_ item: PaletteItem) {
        dismiss()
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
            _ = try services.store.updateTask(localId: id, patch: TaskPatch(done: true))
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
