import Foundation

/// Natural language to a Vikunja filter query, and the subtask de-duplication. Ported from `filterInstructions`,
/// `cleanFilter` and `BreakDown.tsx` in the Tauri build. The model writes dates as `now+7d` style offsets, which
/// the filter parser resolves; it never does date maths itself.
extension AIPrompts {
    // MARK: Filter from text

    public static func filterInstructions(projects: [String], labels: [String]) -> String {
        """
        Translate a request into a task filter query. Output only the query, on one line, with no explanation or code \
        formatting.
        Fields: done (true or false), priority (1 low to 5 highest), dueDate, startDate, endDate, labels, assignees, \
        project.
        Operators: = != > >= < <= like in, and "not in". Combine with && and ||, group with ( ).
        Dates are compared with < > <= >= against now, now+7d, now-1w, now+1m, now+1y (d days, w weeks, m months, y \
        years). Nothing else works for dates; a missing date can't be matched, so leave that part out.
        Put text values in double quotes. labels and project take names, for example labels in "urgent", "work" or \
        project = "Home".
        Projects: \(nameList(projects))
        Labels: \(nameList(labels))
        Only add conditions the request asks for. Also add done = false unless the request is about finished or \
        completed tasks.

        Examples:
        overdue -> done = false && dueDate < now
        urgent things -> done = false && labels in "urgent"
        high priority work stuff due in the next two weeks -> done = false && priority >= 3 && project = "Work" && \
        dueDate > now && dueDate < now+2w
        tasks in home or garden -> done = false && (project = "Home" || project = "Garden")
        things I finished this month -> done = true && dueDate > now-1m
        """
    }

    /// Model output to a bare filter query: the first non-empty line, without code fences, backticks or a
    /// "Query:" / "Filter:" prefix.
    public static func cleanFilter(_ text: String) -> String {
        let unfenced = replacing(text, "(?i)```[a-z]*\\n?", with: "")
        let line = unfenced.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty } ?? ""
        let unprefixed = replacing(line, "(?i)^(?:query|filter)\\s*:\\s*", with: "")
        return replacing(unprefixed, "^`+|`+$", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The repair prompt after a query fails to parse: one retry, with the parser's error fed back.
    public static func filterRepairPrompt(request: String, invalid query: String, error: String) -> String {
        "\(request)\n\nYour previous answer \"\(query)\" was invalid: \(error). Answer again with a valid query."
    }

    // MARK: Subtask suggestions

    /// Drops suggestions that repeat the parent task or an existing subtask, ignoring case.
    public static func newSubtasks(_ lines: [String], parentTitle: String, existing: [String]) -> [String] {
        let taken = Set(([parentTitle] + existing).map { $0.lowercased() })
        return lines.filter { !taken.contains($0.lowercased()) }
    }
}
