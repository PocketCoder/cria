import CriaKit
import SwiftUI

/// Search tab: offline results for tasks, projects, labels and saved filters, with the same row actions as lists.
/// Typing `#label`, `!3`, a date or words like "due tomorrow", "overdue" or "high priority" narrows the tasks (see
/// `parseSearchQuery`); the filters it found show as chips above the results.
struct SearchScreen: View {
    let services: AppServices
    @State private var text = ""
    @State private var results = SearchResults()
    /// Each found subtask's parent title, for the "Subtask of" caption.
    @State private var parentTitles: [String: String] = [:]

    @Environment(\.dateDisplay) private var dateDisplay

    var body: some View {
        List {
            filterChips
            if !results.projects.isEmpty {
                Section("Projects") {
                    ForEach(results.projects, id: \.localId) { project in
                        NavigationLink(value: Route.project(project.localId)) { Label(project.title, systemImage: "folder") }
                    }
                }
            }
            if !results.labels.isEmpty {
                Section("Labels") {
                    ForEach(results.labels, id: \.localId) { label in
                        NavigationLink(value: Route.label(label.localId)) { Label(label.title, systemImage: "tag") }
                    }
                }
            }
            if !results.filters.isEmpty {
                Section("Filters") {
                    ForEach(results.filters, id: \.serverId) { filter in
                        NavigationLink(value: Route.savedFilter(filter.serverId)) {
                            Label(filter.title, systemImage: "line.3.horizontal.decrease.circle")
                        }
                    }
                }
            }
            if !results.tasks.isEmpty {
                Section("Tasks") {
                    ForEach(results.tasks, id: \.task.localId) { item in
                        TaskRowLink(
                            services: services, item: item, showProject: true,
                            tree: TaskRowTree(parentTitle: parentTitles[item.task.localId])
                        )
                    }
                }
            }
        }
            .criaSurface()
        .overlay { overlay }
        .navigationTitle("Search")
        .searchable(text: $text, prompt: "Tasks, projects, filters")
        .modifier(MinimizeSearchField())
        .task(id: text) { await runSearch() }
        // A swipe on a result (done, delete) changes the store, so re-run the query rather than keep a stale snapshot.
        .task {
            for await kind in services.store.bus.subscribe() where [.tasks, .projects, .labels].contains(kind) {
                search()
            }
        }
    }

    @ViewBuilder private var overlay: some View {
        if text.trimmingCharacters(in: .whitespaces).isEmpty {
            ContentUnavailableView(
                "Search", systemImage: "magnifyingglass",
                description: Text("Try ‘due tomorrow’ or ‘overdue high priority’. Works offline.")
            )
        } else if results.isEmpty {
            ContentUnavailableView.search(text: text)
        }
    }

    /// What the query was understood as, so a phrase like "due tomorrow" visibly became a filter.
    @ViewBuilder private var filterChips: some View {
        let chips = SearchFilterChips.chips(for: parseSearchQuery(text), display: dateDisplay)
        if !chips.isEmpty {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(chips) { chip in
                            CriaChip(text: chip.text, systemImage: chip.systemImage, tint: chip.tint)
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                .listRowBackground(Color.clear)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Filters: " + chips.map(\.text).joined(separator: ", "))
            }
        }
    }

    /// Waits briefly so fast typing does not search on every key, then reads from the local index.
    private func runSearch() async {
        try? await Task.sleep(for: .milliseconds(200))
        if Task.isCancelled { return }
        search()
    }

    private func search() {
        results = (try? services.store.search(text)) ?? SearchResults()
        parentTitles = (try? TaskListNesting.parentTitles(services.store, for: results.tasks)) ?? [:]
    }
}

/// iOS 26: the search field collapses into the detached search tab button.
private struct MinimizeSearchField: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.searchToolbarBehavior(.minimize)
        } else {
            content
        }
    }
}
