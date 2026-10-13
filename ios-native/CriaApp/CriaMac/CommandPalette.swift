import CriaKit
import SwiftUI

private struct PaletteItem: Identifiable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
    let run: @MainActor () -> Void
}

/// ⌘K: type to filter, ↑ ↓ to move, Return to run. Covers the smart views, projects, saved filters and commands,
/// as `src/components/CommandPalette.tsx` does.
struct CommandPalette: View {
    let services: AppServices
    let actions: MacActions
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var chosen = 0
    @State private var projects: [ProjectRecord] = []
    @State private var filters: [SavedFilterRecord] = []
    @FocusState private var searching: Bool

    var body: some View {
        VStack(spacing: 0) {
            TextField("Go to a list, project or command", text: $query)
                .textFieldStyle(.plain)
                .font(.title3)
                .padding(14)
                .focused($searching)
                .onSubmit(runChosen)
                .onKeyPress(.downArrow) { move(1) }
                .onKeyPress(.upArrow) { move(-1) }
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
        }
        .frame(width: 520, height: 380)
        .task {
            searching = true
            projects = ProjectTree.visible((try? services.store.projects()) ?? [])
            filters = (try? services.store.savedFilters()) ?? []
        }
    }

    private func row(_ item: PaletteItem, selected: Bool) -> some View {
        HStack {
            Image(systemName: item.symbol).frame(width: 22).foregroundStyle(.secondary)
            Text(item.title)
            Spacer()
            Text(item.detail).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .listRowBackground(selected ? Color.accentColor.opacity(0.2) : Color.clear)
    }

    private var items: [PaletteItem] {
        var result = [
            go("Today", "sun.max", .today), go("Upcoming", "calendar", .upcoming), go("Inbox", "tray", .inbox),
            go("Favourites", "star", .favorites), go("Search", "magnifyingglass", .search),
            PaletteItem(id: "cmd.task", title: "New task", detail: "Command", symbol: "plus") { actions.newTask() },
            PaletteItem(id: "cmd.project", title: "New project", detail: "Command", symbol: "folder.badge.plus") {
                actions.creatingProject = true
            },
            PaletteItem(id: "cmd.shortcuts", title: "Keyboard shortcuts", detail: "Command", symbol: "keyboard") {
                actions.showingShortcuts = true
            }
        ]
        result += projects.map { project in
            PaletteItem(id: "p.\(project.localId)", title: project.title, detail: "Project", symbol: "folder") {
                actions.go(.project(project.localId))
            }
        }
        result += filters.map { filter in
            PaletteItem(id: "f.\(filter.serverId)", title: filter.title, detail: "Saved filter", symbol: "line.3.horizontal.decrease") {
                actions.go(.savedFilter(filter.serverId))
            }
        }
        return result
    }

    private func go(_ title: String, _ symbol: String, _ destination: MacSelection) -> PaletteItem {
        PaletteItem(id: "go.\(title)", title: title, detail: "Go to", symbol: symbol) { actions.go(destination) }
    }

    private var shown: [PaletteItem] {
        let text = query.trimmingCharacters(in: .whitespaces)
        let all = items
        let matches = text.isEmpty ? all : all.filter { $0.title.localizedCaseInsensitiveContains(text) }
        return Array(matches.prefix(40))
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
}
