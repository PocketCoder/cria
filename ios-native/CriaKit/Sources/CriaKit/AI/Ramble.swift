import Foundation

/// One line the model proposed from a ramble. Ported from `src/features/ramble/rambleLogic.ts`.
public struct RambleDraft: Equatable, Sendable, Identifiable {
    public let id: Int
    public var line: String
    public var include = true
    /// Tokens the model only suggested (a project or label that fits but was not named). Shown, never applied.
    public var suggestion: String?
    /// Detail the model moved out of a long title; saved as the task description.
    public var notes: String?

    public init(id: Int, line: String, suggestion: String? = nil, notes: String? = nil) {
        self.id = id
        self.line = line
        self.suggestion = suggestion
        self.notes = notes
    }
}

public enum Ramble {
    /// Splits a model line "Title ~ +Flat || extra detail" into the rest and its notes.
    public static func splitNotes(_ raw: String) -> (text: String, notes: String?) {
        guard let range = raw.range(of: " || ") else { return (raw, nil) }
        let notes = raw[range.upperBound...].trimmingCharacters(in: .whitespaces)
        return (String(raw[..<range.lowerBound]), notes.isEmpty ? nil : notes)
    }

    /// Splits "Title ~ +Flat *house" into the line and its suggestion. With the magic off the model writes no tokens,
    /// so nothing is split.
    public static func splitSuggestion(_ raw: String, mode: QuickAddMagicMode) -> (line: String, suggestion: String?) {
        guard mode.prefixes != nil, let range = raw.range(of: " ~ ") else {
            return (raw.trimmingCharacters(in: .whitespaces), nil)
        }
        let line = raw[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
        let suggestion = raw[range.upperBound...].trimmingCharacters(in: .whitespaces)
        return (line, suggestion.isEmpty ? nil : suggestion)
    }

    /// Drafts for freshly parsed model lines, numbered from `firstId`.
    public static func drafts(fromLines lines: [String], firstId: Int = 0, mode: QuickAddMagicMode = .default) -> [RambleDraft] {
        lines.enumerated().map { offset, raw in
            let (text, notes) = splitNotes(raw)
            let (line, suggestion) = splitSuggestion(text, mode: mode)
            return RambleDraft(id: firstId + offset, line: line, suggestion: suggestion, notes: notes)
        }
    }

    /// Whether a line still has a title once its quick-add tokens are stripped. Parsed in the user's mode, the
    /// syntax the model was asked to write.
    public static func hasTitle(_ line: String, mode: QuickAddMagicMode) -> Bool {
        !parseQuickAdd(line.trimmingCharacters(in: .whitespaces), mode: mode).title.isEmpty
    }

    /// Drafts that will be created: ticked and with a title. A line of only tokens is skipped.
    public static func chosen(_ drafts: [RambleDraft], mode: QuickAddMagicMode) -> [RambleDraft] {
        drafts.filter { $0.include && hasTitle($0.line, mode: mode) }
    }

    /// Plain notes as the HTML the task editor stores.
    public static func notesToHtml(_ notes: String) -> String {
        let escaped = notes
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        return "<p>\(escaped)</p>"
    }

    /// "3 tasks" / "1 task".
    public static func taskCount(_ count: Int) -> String {
        "\(count) task\(count == 1 ? "" : "s")"
    }
}

public extension CriaStore {
    /// Creates one task from a quick-add line. An unknown or missing project falls back to `fallbackProjectId`.
    /// Typed labels are applied best effort. Returns nil when the line has no title.
    @discardableResult
    func createFromQuickAdd(
        line: String,
        projects: [ProjectRecord],
        fallbackProjectId: String,
        mode: QuickAddMagicMode,
        notes: String? = nil
    ) throws -> TaskRecord? {
        let parsed = parseQuickAdd(line, mode: mode)
        guard !parsed.title.isEmpty else { return nil }
        let project = parsed.projectTitle.flatMap { findProject(titled: $0, in: projects) }
        var input = TaskInput(title: parsed.title, projectLocalId: project?.localId ?? fallbackProjectId)
        if let notes, !notes.isEmpty { input.description = Ramble.notesToHtml(notes) }
        input.dueDate = parsed.dueDate
        if let priority = parsed.priority, priority > 0 { input.priority = priority }
        input.repeatAfter = parsed.repeatAfter ?? 0
        input.repeatMode = parsed.repeatMode ?? 0
        return try persistQuickAdd(input, labelTitles: parsed.labelTitles, assigneeUsernames: parsed.assigneeUsernames)
    }
}
