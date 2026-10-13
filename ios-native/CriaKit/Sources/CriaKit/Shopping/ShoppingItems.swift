import Foundation

/// One OCR'd list item the user can tick, edit or drop before it becomes a task.
/// Ported from `src/features/shoppingPhoto/photoItems.ts`.
public struct DraftItem: Equatable, Sendable, Identifiable {
    public let id: Int
    public var text: String
    public var include = true

    public init(id: Int, text: String) {
        self.id = id
        self.text = text
    }
}

public enum ShoppingItems {
    private static let leadingMarker = "^\\s*(?:[-–—*•·▪◦‣⁃o☐☑✓✔x×]\\s+|\\[[ xX]?\\]\\s*|\\d{1,3}[.)]\\s+)"
    private static let heading = "(?i)^(?:shopping(?:\\s+list)?|grocery(?:\\s+list)?|groceries|to\\s*buy|list|todo|to\\s*do)\\s*:?\\s*$"
    private static let separator = "(?i)\\s*,\\s*|\\s+and\\s+"

    private static func replacing(_ text: String, _ pattern: String, with template: String = "") -> String {
        text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }

    private static func letterCount(_ text: String) -> Int {
        text.unicodeScalars.filter { ($0.value >= 65 && $0.value <= 90) || ($0.value >= 97 && $0.value <= 122) }.count
    }

    private static func normaliseWhitespace(_ text: String) -> String {
        replacing(text, "\\s+", with: " ").trimmingCharacters(in: .whitespaces)
    }

    private static func stripEdgePunctuation(_ text: String) -> String {
        replacing(replacing(text, "^[\\s,;.]+"), "[\\s,;]+$").trimmingCharacters(in: .whitespaces)
    }

    /// Splits a line that clearly enumerates several items ("milk, eggs and bread"). Rejects the split when a
    /// fragment is implausibly tiny, so "1,5 kg flour" stays whole.
    private static func splitInline(_ line: String) -> [String] {
        guard matches(line, "(?i),|\\band\\b") else { return [line] }
        let parts = replacing(line, separator, with: "\u{1}")
            .components(separatedBy: "\u{1}")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        if parts.count < 2 || parts.contains(where: { letterCount($0) < 2 }) { return [line] }
        return parts
    }

    /// OCR lines (one string per recognised line, in reading order) to cleaned, de-duplicated item strings.
    /// Order is kept; the first occurrence of a duplicate wins.
    public static func parse(_ lines: [String], splitInline shouldSplit: Bool = true, minLetters: Int = 1) -> [String] {
        var out: [String] = []
        var seen = Set<String>()
        for raw in lines {
            for segment in raw.components(separatedBy: .newlines) {
                let line = stripEdgePunctuation(replacing(normaliseWhitespace(segment), leadingMarker))
                if line.isEmpty || matches(line, heading) { continue }
                for candidate in shouldSplit ? splitInline(line) : [line] {
                    let item = stripEdgePunctuation(candidate)
                    if letterCount(item) < minLetters { continue }
                    if seen.insert(item.lowercased()).inserted { out.append(item) }
                }
            }
        }
        return out
    }

    public static func drafts(from items: [String]) -> [DraftItem] {
        items.enumerated().map { DraftItem(id: $0.offset, text: $0.element) }
    }

    /// Items that will become tasks: included and non-blank.
    public static func selected(_ items: [DraftItem]) -> [DraftItem] {
        items.filter { $0.include && !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    public static func selectedLabel(_ count: Int) -> String { "\(count) item\(count == 1 ? "" : "s") selected" }

    public static func addButtonLabel(_ count: Int) -> String { "Add \(count) task\(count == 1 ? "" : "s")" }

    /// Items left to save after `savedIds` were created, so a retry skips them.
    public static func withoutSaved(_ items: [DraftItem], savedIds: Set<Int>) -> [DraftItem] {
        items.filter { !savedIds.contains($0.id) }
    }
}

public extension CriaStore {
    /// One task per chosen item in `projectId`, optionally tagged (a label failure is not fatal). `onSaved` fires
    /// after each create, so a mid-batch failure still tells the caller which ones landed.
    func createTasks(
        fromItems chosen: [DraftItem],
        projectId: String,
        label: String,
        onSaved: (DraftItem) -> Void = { _ in }
    ) throws {
        let tag = label.trimmingCharacters(in: .whitespaces)
        for item in chosen {
            let created = try createTask(TaskInput(title: item.text.trimmingCharacters(in: .whitespaces), projectLocalId: projectId))
            if !tag.isEmpty { try? applyLabels(byTitle: [tag], toTask: created.localId) }
            onSaved(item)
        }
    }
}
