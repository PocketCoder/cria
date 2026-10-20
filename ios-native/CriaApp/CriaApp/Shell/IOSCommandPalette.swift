#if os(iOS)
import CriaKit
import SwiftUI

/// ⌘K on an iPad with a keyboard: type to filter, ↑ ↓ to move, Return to run. Views, projects and commands, and from
/// two characters, tasks. The filtering and grouping are `PaletteModel`, shared with the Mac palette.
struct IOSCommandPalette: View {
    /// What choosing a row asks the shell to do.
    enum Choice {
        case go(AppTab)
        case project(String)
        case task(String)
        case newTask
    }

    let services: AppServices
    let onChoose: (Choice) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dateDisplay) private var dateDisplay
    @State private var query = ""
    @State private var chosen = 0
    @State private var projects: [ProjectRecord] = []
    @State private var found: [TaskListItem] = []
    @FocusState private var focused: Bool

    private static let tabs: [(tab: AppTab, key: String?)] = [
        (.today, "⌘1"), (.upcoming, "⌘2"), (.inbox, "⌘3"), (.favorites, nil), (.search, "⌘F"), (.browse, nil)
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextField("Go to a list, project or command", text: $query)
                    .focused($focused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit(runChosen)
                    .onKeyPress(.downArrow) { move(1) }
                    .onKeyPress(.upArrow) { move(-1) }
                    .onChange(of: query) { chosen = 0 }
                    .padding(12)
                Divider()
                list
            }
            .navigationTitle("Command palette")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .task {
            focused = true
            projects = ProjectTree.visible((try? services.store.projects()) ?? [])
        }
        .task(id: query) { await searchTasks() }
    }

    private var list: some View {
        ScrollViewReader { proxy in
            List {
                ForEach(PaletteModel.sections(shown), id: \.group) { section in
                    Section(section.group.rawValue) {
                        ForEach(section.entries) { entry in
                            row(entry).id(entry.id)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .onChange(of: chosen) { if shown.indices.contains(chosen) { proxy.scrollTo(shown[chosen].id) } }
        }
    }

    private func row(_ entry: PaletteEntry) -> some View {
        let isChosen = shown.indices.contains(chosen) && shown[chosen].id == entry.id
        return Button { run(entry) } label: {
            HStack(spacing: 10) {
                Image(systemName: entry.symbol).frame(width: 22).foregroundStyle(Color(.primary))
                Text(entry.title).lineLimit(1)
                Spacer()
                Text(entry.detail).font(Theme.caption).foregroundStyle(Color(.mutedForeground)).lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .listRowBackground(isChosen ? Color(.primary).opacity(0.12) : Color.clear)
    }

    // MARK: Content

    private var places: [PaletteEntry] {
        var result = Self.tabs.map { item in
            PaletteEntry(id: "go.\(item.tab.rawValue)", title: item.tab.title, group: .goTo, detail: item.key ?? "", symbol: item.tab.symbol)
        }
        result.append(PaletteEntry(id: "cmd.task", title: "New task", group: .commands, detail: "⌘N", symbol: "plus"))
        result += projects.map { PaletteEntry(id: "p.\($0.localId)", title: $0.title, group: .projects, symbol: "folder") }
        return result
    }

    private var taskEntries: [PaletteEntry] {
        found.map { item in
            let due = item.task.dueDate.map { DueDates.label($0, now: Date(), display: dateDisplay) }
            return PaletteEntry(
                id: "t.\(item.task.localId)", title: item.task.title, group: .tasks,
                detail: [item.projectTitle, due].compactMap { $0 }.joined(separator: " · "),
                symbol: item.task.done ? "checkmark.circle" : "circle"
            )
        }
    }

    private var shown: [PaletteEntry] {
        PaletteModel.shown(places: places, tasks: taskEntries, query: query)
    }

    // MARK: Actions

    private func move(_ step: Int) -> KeyPress.Result {
        chosen = PaletteModel.move(chosen, count: shown.count, by: step)
        return .handled
    }

    private func runChosen() {
        if shown.indices.contains(chosen) { run(shown[chosen]) }
    }

    private func run(_ entry: PaletteEntry) {
        guard let choice = choice(for: entry) else { return }
        dismiss()
        // After the sheet has gone, so a command that opens another sheet is not swallowed by the dismissal.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            onChoose(choice)
        }
    }

    private func choice(for entry: PaletteEntry) -> Choice? {
        let id = entry.id
        if id == "cmd.task" { return .newTask }
        if id.hasPrefix("go."), let tab = AppTab(rawValue: String(id.dropFirst(3))) { return .go(tab) }
        if id.hasPrefix("p.") { return .project(String(id.dropFirst(2))) }
        if id.hasPrefix("t.") { return .task(String(id.dropFirst(2))) }
        return nil
    }

    /// From two characters, after a short pause so typing does not search on every key; off the main thread.
    private func searchTasks() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard text.count >= 2 else {
            found = []
            return
        }
        try? await Task.sleep(for: .milliseconds(200))
        if Task.isCancelled { return }
        let store = services.store
        let results = await Task.detached(priority: .userInitiated) { (try? store.search(text))?.tasks ?? [] }.value
        guard !Task.isCancelled else { return }
        found = Array(results.prefix(20))
    }
}
#endif
