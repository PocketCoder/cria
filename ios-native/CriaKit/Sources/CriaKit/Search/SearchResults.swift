import Foundation

/// Everything the search tab shows for one query: tasks from the FTS index, and projects, labels and saved
/// filters whose title contains the text (the palette's Views, Projects, Labels and Tasks groups).
public struct SearchResults: Equatable, Sendable {
    public var tasks: [TaskListItem] = []
    public var projects: [ProjectRecord] = []
    public var labels: [LabelRecord] = []
    public var filters: [SavedFilterRecord] = []

    public init() {}

    public var isEmpty: Bool { tasks.isEmpty && projects.isEmpty && labels.isEmpty && filters.isEmpty }
}

extension CriaStore {
    /// Offline search. Filters and dates typed in the line (`#label`, `!3`, `tomorrow`, `soon`) narrow the tasks;
    /// the remaining text also matches titles of projects, labels and saved filters. Blank input finds nothing.
    public func search(_ input: String, now: Date = Date(), calendar: Calendar = .cria) throws -> SearchResults {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return SearchResults() }
        let query = parseSearchQuery(trimmed, now: now, calendar: calendar)
        var results = SearchResults()
        results.tasks = try attachRowData(try searchTasks(query))
        let needle = query.text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !needle.isEmpty {
            results.projects = ProjectTree.visible(try projects()).filter { $0.title.lowercased().contains(needle) }
            results.labels = try labels().filter { $0.title.lowercased().contains(needle) }
            results.filters = try savedFilters().filter { $0.title.lowercased().contains(needle) }
        }
        return results
    }
}
