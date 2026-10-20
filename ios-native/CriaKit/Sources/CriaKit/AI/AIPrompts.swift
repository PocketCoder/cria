import Foundation

/// Prompt builders and output parsers for the on-device model. Ported from `src/lib/aiPrompts.ts`. Pure: no model,
/// no database. Design rule: the model never does date maths. Prompts ask for dates in words ("next friday") and the
/// quick-add parser resolves them.
public enum AIPrompts {
    /// On-device context is about 4K tokens; roughly 6K characters is safe.
    public static let maxInputChars = 6000
    static let maxNames = 50
    /// Shorter lists when the model picks projects and labels itself: every name is read for every task.
    static let autoTagMaxNames = 30

    public static func clip(_ text: String, max: Int = maxInputChars) -> String {
        text.count > max ? "\(text.prefix(max))…" : text
    }

    /// Keeps the end (most recent) when clipping, e.g. comment threads.
    public static func clipStart(_ text: String, max: Int = maxInputChars) -> String {
        text.count > max ? "…\(text.suffix(max))" : text
    }

    static func nameList(_ names: [String], max: Int = maxNames) -> String {
        let shown = names.prefix(max).map { quickAddNeedsQuoting($0) ? "\"\($0)\"" : $0 }
        return shown.isEmpty ? "(none)" : shown.joined(separator: ", ")
    }

    static func replacing(_ text: String, _ pattern: String, with template: String) -> String {
        text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
    }

    /// Rich text (Vikunja HTML) to plain text for prompts.
    public static func stripHtml(_ html: String) -> String {
        var text = replacing(html, "(?i)<br\\s*/?>", with: "\n")
        text = replacing(text, "(?i)</(p|div|li|h[1-6])>", with: "\n")
        text = replacing(text, "<[^>]*>", with: "")
        for (entity, plain) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&amp;", "&")] {
            text = text.replacingOccurrences(of: entity, with: plain)
        }
        text = replacing(text, "\n{3,}", with: "\n\n")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Model output to one clean line per item: strips bullets and numbering, drops labels like "Output:", dedupes
    /// case-insensitively. A leading `*label` (no space) is a quick-add token, not a bullet, so it survives.
    public static func parseLines(_ text: String, max: Int = 50) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in text.components(separatedBy: "\n") {
            let line = cleanLine(raw)
            if line.isEmpty || line.hasSuffix(":") { continue }
            if !seen.insert(line.lowercased()).inserted { continue }
            out.append(line)
            if out.count >= max { break }
        }
        return out
    }

    private static func cleanLine(_ raw: String) -> String {
        var line = raw.trimmingCharacters(in: .whitespaces)
        line = replacing(line, "^(?:[-•–]\\s+|\\*\\s+|\\d+[.)]\\s+)", with: "")
        line = replacing(line, "(?i)^(?:output|tasks?|subtasks?|items?)\\s*:\\s*", with: "")
        line = replacing(line, "^[\"'`]+|[\"'`]+$", with: "")
        // A title's trailing full stop (not an ellipsis), which small models add.
        line = replacing(line, "(?<!\\.)\\.$", with: "")
        return line.trimmingCharacters(in: .whitespaces)
    }

    // MARK: Ramble

    private static let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

    private static let exampleRamble = """
        ugh I need to call the dentist sometime next week, and email the landlord tomorrow, and um renew the car \
        insurance before the end of the month, that's really important, oh and buy milk
        """

    public struct RambleContext: Sendable {
        public var projects: [String]
        public var labels: [String]
        public var now: Date
        public var mode: QuickAddMagicMode
        /// "Let Ramble choose projects and labels": the model files and tags each task itself, from the given names
        /// only. Has no effect with the magic disabled (there is no syntax to tag with).
        public var autoTag: Bool

        public init(projects: [String], labels: [String], now: Date = Date(), mode: QuickAddMagicMode = .default,
                    autoTag: Bool = false) {
            self.projects = projects
            self.labels = labels
            self.now = now
            self.mode = mode
            self.autoTag = autoTag
        }
    }

    /// "Tuesday 10 February 2026", the en-GB long form the TS build uses.
    static func longDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.dateFormat = "EEEE d MMMM yyyy"
        return formatter.string(from: date)
    }

    /// "feb 28": the last day of `now`'s month, written the way the date parser reads it.
    static func endOfMonth(_ now: Date) -> String {
        let calendar = Calendar.cria
        let range = calendar.range(of: .day, in: .month, for: now)
        let month = calendar.component(.month, from: now)
        return "\(months[month - 1]) \(range?.count ?? 28)"
    }

    private static func rambleIntro(_ now: Date) -> String {
        """
        You turn a person's spoken ramble into a to-do list. Today is \(longDate(now)).
        Output one task per line and nothing else: no numbering, bullets, headings or commentary.
        """
    }

    private static let rambleOutro = """
        Keep every title short, under about 60 characters. If the person gave detail that does not fit in a short \
        title, keep the short title and put the detail after everything else on the line, separated by " || ", as one \
        plain sentence of notes. Most tasks have no notes.
        Write each title without a full stop at the end.
        Skip filler, thinking aloud and anything that is not a task. Merge repeats of the same task.
        """

    /// Instructions for turning a ramble into quick-add lines in the user's Quick Add Magic mode, so the same parser
    /// resolves them. With the magic disabled the model writes plain titles and keeps any date in words.
    public static func rambleInstructions(_ context: RambleContext) -> String {
        guard let prefixes = context.mode.prefixes else { return plainRamble(context.now) }
        let monthEnd = endOfMonth(context.now)
        let priority = prefixes.priority
        return """
            \(rambleIntro(context.now))
            Each line is a short imperative task title, optionally followed by these tokens:
            - A due date in plain words, as the person said it (tomorrow, tomorrow at 5pm, next friday, in 3 days, this \
            weekend). Keep every date the person mentions. Only for "end of the month/week" style deadlines, write the \
            month and day instead (\(monthEnd)).
            - A repeat in plain words (every week, every 2 days, daily).
            \(tagRules(context, prefixes: prefixes))
            - \(priority)3 only if the person says it is important, \(priority)4 only if they say it is urgent. Most \
            tasks have no priority.
            \(rambleOutro)

            Example ramble: \(exampleRamble)
            Example output:
            Call the dentist next week
            Email the landlord tomorrow
            Renew car insurance \(monthEnd) \(priority)3
            Buy milk
            """
    }

    /// The project and label lines. By default the model applies only what the person names and suggests the rest
    /// after " ~ "; with `autoTag` it files and tags every task itself, choosing only from the listed names.
    private static func tagRules(_ context: RambleContext, prefixes: QuickAddPrefixes) -> String {
        let project = prefixes.project
        let label = prefixes.label
        let quoting = """
            Put quotes around names with spaces or any character other than letters, digits, - and _, like \
            \(project)"Home Admin" or \(project)"Mum's".
            """
        guard context.autoTag else {
            return """
                - \(project)Project to file it in a project, but only when the person names it ("add it to Finance", \
                "put that under Home Admin"). Only use these projects: \(nameList(context.projects)). \(quoting)
                - \(label)label to tag it, but only when the person names it. Existing labels: \(nameList(context.labels)).
                - A project or label that merely fits the subject (a project called Flat or House suits anything about \
                the home, landlord, rent, repairs or cleaning) is a suggestion, not a choice. Put suggestions after the \
                whole task, separated by " ~ ", for example: Email the landlord tomorrow ~ \(project)Flat \(label)house. \
                Suggest only existing projects and labels, only when one clearly fits, and never one the person already \
                named.
                """
        }
        let projects = nameList(context.projects, max: autoTagMaxNames)
        let labels = nameList(context.labels, max: autoTagMaxNames)
        return """
            - \(project)Project to file it in the one project from this list that the person names or that fits the \
            task best: \(projects). Leave it out when none fits. \(quoting)
            - \(label)label to tag it with up to two labels from this list that the person names or that fit the \
            task: \(labels). Leave them out when none fits.
            - Use only the project and label names listed above, written exactly as shown. Never make one up. For \
            example, with a project called Flat and a label called house, write: Email the landlord tomorrow \
            \(project)Flat \(label)house
            """
    }

    private static func plainRamble(_ now: Date) -> String {
        """
        \(rambleIntro(now))
        Each line is a short imperative task title in plain words, with no symbols or tags such as + * @ # or !.
        Keep every date and repeat the person mentions in the title, in plain words as they said them (tomorrow, next \
        friday, every week).
        \(rambleOutro)

        Example ramble: \(exampleRamble)
        Example output:
        Call the dentist next week
        Email the landlord tomorrow
        Renew car insurance before the end of the month
        Buy milk
        """
    }

    // MARK: Subtasks

    public static let subtaskInstructions = """
        Break a task into 3 to 8 concrete, actionable subtasks, in the order they would be done.
        Output one subtask per line and nothing else: short imperative titles with no full stop, and no numbering, \
        bullets or commentary.
        Do not repeat the parent task itself.
        """

    public static func subtaskPrompt(title: String, descriptionHtml: String?) -> String {
        let notes = descriptionHtml.map(stripHtml) ?? ""
        return clip(notes.isEmpty ? "Task: \(title)" : "Task: \(title)\nNotes: \(notes)")
    }

    // MARK: Summary

    public static let summaryInstructions = """
        Summarise a task's comment thread in 2 to 4 short bullet points: decisions made, open questions, and who is \
        waiting on what.
        Plain text only. Start each line with "- ". No heading or preamble.
        """

    public struct ThreadComment: Sendable {
        public var authorName: String?
        public var comment: String
        public var createdAt: String?

        public init(authorName: String?, comment: String, createdAt: String?) {
            self.authorName = authorName
            self.comment = comment
            self.createdAt = createdAt
        }
    }

    public static func commentsPrompt(_ comments: [ThreadComment]) -> String {
        let lines = comments.map { entry -> String in
            let when = entry.createdAt.map { " (\($0.prefix(10)))" } ?? ""
            return "\(entry.authorName ?? "Someone")\(when): \(stripHtml(entry.comment))"
        }
        return clipStart(lines.joined(separator: "\n"))
    }

    // MARK: Tidy OCR lines

    public static let tidyListInstructions = """
        These lines were read from a photo of a list by OCR. They may have misread characters, items split across two \
        lines, prices, headings and totals.
        Return every list item, one per line. Keep every item: never leave one out.
        - Fix obvious misreadings (lem0ns -> lemons).
        - Join an item that was split across two lines (whole wheat / bread -> whole wheat bread).
        - Remove prices from an item but keep the item (milk £1.20 -> milk).
        - Keep quantities (2 lemons).
        - Drop lines that are only a heading, a total or a price.
        No numbering, bullets or commentary.

        Example input:
        GROCERIES
        3 appels
        oat milk 1.80
        cheddar
        cheese
        TOTAL 9.40
        Example output:
        3 apples
        oat milk
        cheddar cheese
        """

    // MARK: Errors

    /// Native error codes to something a person can act on. Ported from `aiErrorMessage`.
    public static func errorMessage(_ message: String) -> String {
        let table: [(code: String, text: String)] = [
            ("appleIntelligenceNotEnabled", "Turn on Apple Intelligence in Settings to use this."),
            ("deviceNotEligible", "This device doesn't support Apple Intelligence."),
            ("modelNotReady", "Apple Intelligence is still getting ready. Try again in a few minutes."),
            ("unsupportedOS", "Needs iOS 26 on a device with Apple Intelligence."),
            ("cancelled", "Cancelled."),
            ("exceededContextWindowSize", "That's too long for the on-device model. Try something shorter."),
            ("guardrailViolation", "The on-device model declined that request.")
        ]
        let lowered = message.lowercased()
        if let hit = table.first(where: { lowered.contains($0.code.lowercased()) }) { return hit.text }
        return "Something went wrong: \(message)"
    }
}
