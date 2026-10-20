import Foundation

/// One task the review step proposes, already parsed from the model's quick-add line so the row can show the date,
/// project and labels the line will create. Edited in place before anything is saved.
public struct RambleProposal: Equatable, Sendable, Identifiable {
    public let id: Int
    public var title: String
    public var include = true
    /// ISO value as `TaskInput.dueDate` takes it: all-day (UTC midnight) or a timed instant.
    public var dueDate: String?
    /// Nil files the task in the capture project.
    public var projectLocalId: String?
    public var labelTitles: [String] = []
    public var priority = 0
    public var repeatAfter = 0
    public var repeatMode = 0
    public var assigneeUsernames: [String] = []
    /// Detail the model moved out of a long title; saved as the task description.
    public var notes: String?
    /// Tokens the model only suggested ("+Flat *house"). Shown, applied only on request.
    public var suggestion: String?

    public init(id: Int, title: String, dueDate: String? = nil, projectLocalId: String? = nil) {
        self.id = id
        self.title = title
        self.dueDate = dueDate
        self.projectLocalId = projectLocalId
    }

    /// Priority names in Vikunja's order (0 is none).
    public static let priorityNames = ["None", "Low", "Medium", "High", "Urgent", "Do now"]
}

public extension Ramble {
    /// Proposals for the review list. Each line is tidied for the date parser (`normaliseLine`) and parsed in the
    /// user's mode, the syntax the model was asked to write. A line left with no title is dropped. `knownLabels`,
    /// when given, keeps only labels that already exist (the model was told to choose from them).
    static func proposals(
        from drafts: [RambleDraft],
        projects: [ProjectRecord],
        mode: QuickAddMagicMode,
        knownLabels: [String]? = nil,
        now: Date = Date(),
        calendar: Calendar = .cria
    ) -> [RambleProposal] {
        let known = knownLabels.map { Set($0.map { $0.lowercased() }) }
        return drafts.compactMap { draft in
            proposal(from: draft, projects: projects, mode: mode, knownLabels: known, now: now, calendar: calendar)
        }
    }

    private static func proposal(
        from draft: RambleDraft, projects: [ProjectRecord], mode: QuickAddMagicMode, knownLabels: Set<String>?,
        now: Date, calendar: Calendar
    ) -> RambleProposal? {
        let raw = draft.line.trimmingCharacters(in: .whitespaces)
        guard mode.prefixes != nil else {
            // With the magic off nothing is parsed, as in Vikunja-web: the line is the title.
            guard !raw.isEmpty else { return nil }
            var plain = RambleProposal(id: draft.id, title: raw)
            plain.notes = draft.notes
            return plain
        }
        let parsed = parseQuickAdd(normaliseLine(raw), now: now, mode: mode, calendar: calendar)
        let title = tidyTitle(parsed.title, capitalise: raw.first?.isUppercase == true)
        guard !title.isEmpty else { return nil }
        let due = allDayWhenRelative(parsed.dueDate, line: normaliseLine(raw), calendar: calendar)
        var proposal = RambleProposal(id: draft.id, title: title, dueDate: due)
        proposal.projectLocalId = parsed.projectTitle.flatMap { findProject(titled: $0, in: projects) }?.localId
        proposal.labelTitles = parsed.labelTitles.filter { knownLabels?.contains($0.lowercased()) ?? true }
        proposal.priority = parsed.priority ?? 0
        proposal.repeatAfter = parsed.repeatAfter ?? 0
        proposal.repeatMode = parsed.repeatMode ?? 0
        proposal.assigneeUsernames = parsed.assigneeUsernames
        proposal.notes = draft.notes
        proposal.suggestion = draft.suggestion
        return proposal
    }

    /// "in 2 days" parses to that far from now, at this time of day (as in Vikunja-web). A dictated "the day after
    /// tomorrow" or "in a week" means the day, so a due date made that way, with no time typed, is all-day.
    private static func allDayWhenRelative(_ due: String?, line: String, calendar: Calendar) -> String? {
        guard let due, DueDates.hasTimeOfDay(due), let date = DueDates.parse(due),
              line.range(of: #"(?i)\bin\s+\d+\s+(?:day|week|month)s?\b"#, options: .regularExpression) != nil,
              line.range(of: #"(?i)\s(?:at|@)\s+\d"#, options: .regularExpression) == nil else { return due }
        return DueDates.allDayISO(for: date, calendar: calendar)
    }

    /// Applies a suggestion ("+Flat *house") the user accepted: a known project replaces the current one and labels
    /// are added. The suggestion is then cleared.
    static func applyingSuggestion(
        to proposal: RambleProposal, projects: [ProjectRecord], mode: QuickAddMagicMode
    ) -> RambleProposal {
        guard let suggestion = proposal.suggestion else { return proposal }
        var next = proposal
        let parsed = parseQuickAdd(suggestion, mode: mode)
        if let project = parsed.projectTitle.flatMap({ findProject(titled: $0, in: projects) }) {
            next.projectLocalId = project.localId
        }
        next.labelTitles = mergeLabelTitles(next.labelTitles, parsed.labelTitles)
        next.suggestion = nil
        return next
    }

    /// Proposals that will be created: ticked and with a title.
    static func chosen(_ proposals: [RambleProposal]) -> [RambleProposal] {
        proposals.filter { $0.include && !$0.title.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    // MARK: Normalising model lines

    private static let datePhrase = "(?:today|tonight|tomorrow|tmrw|next\\s+week|(?:this\\s+)?weekend"
        + "|(?:(?:this|next)\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)"
        + "|in\\s+\\d+\\s+[a-z]+)\\b"

    private static let numberWords = [
        "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
        "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "a couple of": 2
    ]

    /// Rewrites the date wording small models produce into the phrases the quick-add date parser reads, before the
    /// line is parsed. The parser itself is shared with Quick Add and stays strict; this only widens what Ramble
    /// accepts:
    /// - "5 p.m." becomes "5pm" (the dots otherwise split the time and leave "p.m." in the title).
    /// - "the day after tomorrow" becomes "in 2 days" (else "tomorrow" alone would match).
    /// - "in two days", "in a week" become "in 2 days", "in 1 week".
    /// - A connective before a date ("by tomorrow", "due friday", "on tomorrow", "before next week") is dropped, so
    ///   the title does not end in "by".
    /// - "this friday" becomes "friday" ("this" before a weekday is not a date word to Vikunja-web).
    /// - A date in brackets ("(tomorrow)") loses them: Vikunja-web's date words need a space before them.
    /// Case is ignored throughout ("Tomorrow" already parses; the parser is case-insensitive).
    static func normaliseLine(_ line: String) -> String {
        var text = replacing(line, "(?i)\\b(\\d{1,2}(?::\\d{2})?)\\s*([ap])\\.\\s?m\\b\\.?", with: "$1$2m")
        text = replacing(text, "(?i)\\b(?:the\\s+)?day\\s+after\\s+tomorrow\\b", with: "in 2 days")
        text = spelledOutCounts(text)
        text = replacing(text, "(?i)\\b(?:due\\s+(?:on|by)|due|by|on|before|for)\\s+(?=" + datePhrase + ")", with: "")
        text = replacing(text, "(?i)\\bthis\\s+(?=(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b)", with: "")
        text = replacing(text, "(?i)[(\\[]\\s*(" + datePhrase + ")\\s*[)\\]]", with: " $1 ")
        return text
    }

    /// "in two days" to "in 2 days".
    private static func spelledOutCounts(_ text: String) -> String {
        let words = numberWords.keys.sorted { $0.count > $1.count }.map { $0.replacingOccurrences(of: " ", with: "\\s+") }
        let pattern = "(?i)\\bin\\s+(" + words.joined(separator: "|") + ")\\s+(minute|hour|day|week|month|year)s?\\b"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let source = NSString(string: text)
        var result = text as NSString
        for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)).reversed() {
            let word = source.substring(with: match.range(at: 1)).lowercased()
                .split(whereSeparator: \.isWhitespace).joined(separator: " ")
            guard let count = numberWords[word] else { continue }
            let unit = source.substring(with: match.range(at: 2)).lowercased()
            let phrase = "in \(count) \(unit)\(count == 1 ? "" : "s")"
            result = result.replacingCharacters(in: match.range, with: phrase) as NSString
        }
        return result as String
    }

    /// Cleans the punctuation a removed date leaves behind: "Email the landlord, ," or "Buy milk ()" or
    /// ": email the landlord". `capitalise` restores a capital the removed leading date carried.
    static func tidyTitle(_ title: String, capitalise: Bool = false) -> String {
        var text = replacing(title, "\\(\\s*\\)|\\[\\s*\\]|\u{201C}\\s*\u{201D}|\"\\s*\"", with: "")
        text = replacing(text, "\\s+([,;:!?])", with: "$1")
        text = replacing(text, "([,;:])(?:\\s*[,;:])+", with: "$1")
        text = replacing(text, "^[\\s,;:\\-\u{2013}\u{2014}]+", with: "")
        text = replacing(text, "[\\s,;:\\-\u{2013}\u{2014}!]+$", with: "")
        text = replacing(text, "\\s{2,}", with: " ").trimmingCharacters(in: .whitespaces)
        if capitalise, let first = text.first, first.isLowercase {
            text = first.uppercased() + text.dropFirst()
        }
        return text
    }

    private static func replacing(_ text: String, _ pattern: String, with template: String) -> String {
        text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
    }
}

public extension CriaStore {
    /// Creates the task a reviewed proposal describes. A missing project falls back to `fallbackProjectId`; labels
    /// are applied best effort (as for a typed quick-add line). Returns nil when the title is empty.
    @discardableResult
    func createTask(from proposal: RambleProposal, fallbackProjectId: String) throws -> TaskRecord? {
        let title = proposal.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return nil }
        var input = TaskInput(title: title, projectLocalId: proposal.projectLocalId ?? fallbackProjectId)
        if let notes = proposal.notes, !notes.isEmpty { input.description = Ramble.notesToHtml(notes) }
        input.dueDate = proposal.dueDate
        if proposal.priority > 0 { input.priority = proposal.priority }
        input.repeatAfter = proposal.repeatAfter
        input.repeatMode = proposal.repeatMode
        return try persistQuickAdd(input, labelTitles: proposal.labelTitles, assigneeUsernames: proposal.assigneeUsernames)
    }
}
