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
        .publishesTaskOrder(results.tasks.map(\.task.localId))
            .criaSurface()
        .overlay { overlay }
        .navigationTitle("Search")
        .searchable(text: $text, prompt: "Tasks, projects, filters")
        .modifier(MinimizeSearchField())
        .task(id: text) { await runSearch() }
        // A swipe on a result (done, delete) changes the store, so re-run the query rather than keep a stale snapshot.
        .task {
            for await kind in services.store.bus.subscribe() where [.tasks, .projects, .labels].contains(kind) {
                await search()
            }
        }
    }

    @ViewBuilder private var overlay: some View {
        if text.trimmingCharacters(in: .whitespaces).isEmpty {
            ContentUnavailableView {
                Label("Search", systemImage: "magnifyingglass")
            } description: {
                Text("Words search titles and descriptions. Labels (#home), priorities (!3, high priority) and dates "
                     + "(tomorrow, next week, overdue) become filters. Works offline.")
            } actions: {
                SearchExamples { text = $0 }
            }
        } else if results.isEmpty {
            ContentUnavailableView.search(text: text)
        }
    }

    /// What the query was understood as, so a phrase like "due tomorrow" visibly became a filter.
    @ViewBuilder private var filterChips: some View {
        let chips = SearchFilterChips.chips(for: parseSearchQuery(text), display: dateDisplay)
        if !chips.isEmpty {
            Section {
                // The query as typed, with the parts read as filters coloured, so it is clear what was recognised.
                Text(SearchHighlightStyle.attributed(text))
                    .font(Theme.rowSubtitle)
                    .listRowBackground(Color.clear)
                    .accessibilityHidden(true)
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
        await search()
    }

    /// Reads off the main thread (the index, every result's row data and the parent lookups), then shows the results
    /// only if the text is still what was searched for.
    private func search() async {
        let store = services.store
        let query = text
        let found = await Task.detached(priority: .userInitiated) { () -> (SearchResults, [String: String]) in
            let results = (try? store.search(query)) ?? SearchResults()
            return (results, (try? TaskListNesting.parentTitles(store, for: results.tasks)) ?? [:])
        }.value
        guard !Task.isCancelled, query == text else { return }
        results = found.0
        parentTitles = found.1
    }
}

/// iOS 26: the search field collapses into the detached search tab button.
private struct MinimizeSearchField: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            content.searchToolbarBehavior(.minimize)
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// Example searches under the empty Search screen: a tap runs one, which teaches the filter words by use.
private struct SearchExamples: View {
    let onPick: (String) -> Void

    private static let examples = ["due tomorrow", "overdue high priority", "#home", "!3 this week", "soon"]

    var body: some View {
        ChipFlowLayout {
            ForEach(Self.examples, id: \.self) { example in
                Button { onPick(example) } label: {
                    CriaChip(text: example, systemImage: "magnifyingglass", tint: Color(.primary))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Search for \(example)")
            }
        }
        .frame(maxWidth: 360)
    }
}

/// Colours for the parts of a search the parser recognised, matching the filter chips' tints.
enum SearchHighlightStyle {
    static func attributed(_ query: String) -> AttributedString {
        let text = query as NSString
        var output = AttributedString()
        var cursor = 0
        for mark in searchHighlights(query) where mark.start >= cursor && mark.end <= text.length {
            if mark.start > cursor {
                output += AttributedString(text.substring(with: NSRange(location: cursor, length: mark.start - cursor)))
            }
            var piece = AttributedString(text.substring(with: NSRange(location: mark.start, length: mark.end - mark.start)))
            piece.foregroundColor = colour(mark.kind)
            piece.font = Theme.rowSubtitle.weight(.semibold)
            output += piece
            cursor = mark.end
        }
        if cursor < text.length { output += AttributedString(text.substring(from: cursor)) }
        return output
    }

    private static func colour(_ kind: SearchHighlightKind) -> Color {
        switch kind {
        case .label: return Color(.meadow700)
        case .priority: return Color(.marigold700)
        case .date: return Color(.sky700)
        }
    }
}
