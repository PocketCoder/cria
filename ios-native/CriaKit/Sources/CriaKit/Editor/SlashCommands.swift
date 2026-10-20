import Foundation

/// One entry of the editor's slash menu: a format the formatting bar already offers. Ported from `COMMANDS` in
/// `src/features/task-detail/editorCommands.tsx`; the keys are the same, so "/h1" and "/hr" work as in Vikunja-web.
public enum SlashCommand: String, CaseIterable, Sendable, Equatable {
    case heading1, heading2, heading3, bulletList, numberedList, taskList, quote, codeBlock, divider
    case bold, italic, underline, strikethrough, image

    /// What the menu filters on besides the title.
    public var key: String {
        switch self {
        case .heading1: "h1"
        case .heading2: "h2"
        case .heading3: "h3"
        case .bulletList: "bullet"
        case .numberedList: "number"
        case .taskList: "tasklist"
        case .quote: "quote"
        case .codeBlock: "codeblock"
        case .divider: "hr"
        case .bold: "bold"
        case .italic: "italic"
        case .underline: "underline"
        case .strikethrough: "strike"
        case .image: "image"
        }
    }

    public var title: String {
        switch self {
        case .heading1: "Heading 1"
        case .heading2: "Heading 2"
        case .heading3: "Heading 3"
        case .bulletList: "Bulleted list"
        case .numberedList: "Numbered list"
        case .taskList: "Task list"
        case .quote: "Quote"
        case .codeBlock: "Code block"
        case .divider: "Divider"
        case .bold: "Bold"
        case .italic: "Italic"
        case .underline: "Underline"
        case .strikethrough: "Strikethrough"
        case .image: "Image"
        }
    }

    public var summary: String {
        switch self {
        case .heading1: "Big section heading"
        case .heading2: "Medium section heading"
        case .heading3: "Small section heading"
        case .bulletList: "Create a simple bulleted list"
        case .numberedList: "Create a list with numbering"
        case .taskList: "Track tasks with a to-do list"
        case .quote: "Capture a quote or highlight"
        case .codeBlock: "Write a block of code"
        case .divider: "Divide a section"
        case .bold: "Make text bold"
        case .italic: "Make text italic"
        case .underline: "Underline text"
        case .strikethrough: "Cross out text"
        case .image: "Add an image from your photos or files"
        }
    }

    /// An SF Symbol name.
    public var symbol: String {
        switch self {
        case .heading1: "textformat.size.larger"
        case .heading2: "textformat.size"
        case .heading3: "textformat.size.smaller"
        case .bulletList: "list.bullet"
        case .numberedList: "list.number"
        case .taskList: "checklist"
        case .quote: "text.quote"
        case .codeBlock: "chevron.left.forwardslash.chevron.right"
        case .divider: "minus"
        case .bold: "bold"
        case .italic: "italic"
        case .underline: "underline"
        case .strikethrough: "strikethrough"
        case .image: "photo"
        }
    }
}

/// A `/query` found just before the caret.
public struct SlashMatch: Equatable, Sendable {
    /// What was typed after the "/" (may be empty).
    public let query: String
    /// UTF-16 length of the "/" and the query: what to delete when a command is chosen.
    public let length: Int

    public init(query: String, length: Int) {
        self.query = query
        self.length = length
    }
}

/// Keys the open menu takes over. The Mac text view maps Up, Down, Return, Tab and Escape to these.
public enum SlashKey: Equatable, Sendable {
    case next, previous, execute, close
}

/// The slash menu's rules: when it opens, what it lists and which keys it takes. Ported from `matchSlashQuery`,
/// `filterCommands`, `slashKeyAction` and `stepSlashIndex` in the Tauri editor, and unit tested without a device.
public enum SlashMenu {
    /// The command query when the text before the caret ends in a "/" that starts the text or follows whitespace,
    /// followed by word characters only; nil otherwise. `textBeforeCaret` is the caret's paragraph up to the caret.
    public static func match(textBeforeCaret text: String) -> SlashMatch? {
        let characters = Array(text)
        var index = characters.count
        while index > 0, isWordCharacter(characters[index - 1]) { index -= 1 }
        guard index > 0, characters[index - 1] == "/" else { return nil }
        let slash = index - 1
        if slash > 0, !characters[slash - 1].isWhitespace { return nil }
        let query = String(characters[index...])
        return SlashMatch(query: query, length: ("/" + query).utf16.count)
    }

    /// Commands whose key or title contains `query`, case-insensitively. An empty query lists every command.
    public static func filter(_ query: String) -> [SlashCommand] {
        let needle = query.lowercased()
        // `contains("")` is false in Swift, so a bare "/" would list nothing.
        guard !needle.isEmpty else { return SlashCommand.allCases }
        return SlashCommand.allCases.filter { command in
            command.key.contains(needle) || command.title.lowercased().contains(needle)
        }
    }

    /// Wrap-around step through `count` items.
    public static func step(_ current: Int, count: Int, by delta: Int) -> Int {
        guard count > 0 else { return 0 }
        return ((current + delta) % count + count) % count
    }

    /// Whether the open menu takes `key`. With nothing to choose only Escape does, so Return and the arrows keep
    /// their normal meaning.
    public static func takes(_ key: SlashKey, count: Int) -> Bool {
        count > 0 || key == .close
    }

    private static func isWordCharacter(_ character: Character) -> Bool {
        character.isLetter || character.isNumber || character == "_"
    }
}
