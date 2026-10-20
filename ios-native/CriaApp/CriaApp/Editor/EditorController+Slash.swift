import CriaKit
import Observation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// What the slash menu shows: the commands matching what was typed after the "/" and the highlighted one. Observed by
/// the iOS formatting bar and the Mac panel; `EditorController` keeps it in step with the caret.
@MainActor @Observable
final class SlashMenuState {
    var isOpen = false
    var query = ""
    var commands: [SlashCommand] = []
    var selected = 0
    /// Storage index of the "/" while open.
    var triggerLocation = 0
    /// The "/" the user closed with Escape: it stays closed until another "/" is typed.
    var dismissedAt: Int?

    /// Open with something to choose. With no match the menu hides, as in Vikunja-web.
    var isVisible: Bool { isOpen && !commands.isEmpty }
}

/// The slash menu: typing "/" at the start of a paragraph or after whitespace lists the formats of the formatting bar;
/// choosing one removes the "/query" and applies the format with the same commands as the bar.
extension EditorController {
    /// Opens, updates or closes the menu to match the text before the caret.
    func refreshSlash() {
        guard let view = textView, view.holdsKeyboardFocus, view.selection.length == 0, let found = slashMatch(in: view) else {
            slash.dismissedAt = nil
            closeSlash()
            return
        }
        if slash.dismissedAt == found.trigger {
            closeSlash()
            return
        }
        let changed = !slash.isOpen || slash.triggerLocation != found.trigger || slash.query != found.match.query
        slash.isOpen = true
        slash.triggerLocation = found.trigger
        guard changed else { return }
        slash.query = found.match.query
        slash.commands = SlashMenu.filter(found.match.query)
        slash.selected = 0
        onSlashChange()
    }

    func closeSlash() {
        guard slash.isOpen else { return }
        slash.isOpen = false
        slash.commands = []
        slash.query = ""
        slash.selected = 0
        onSlashChange()
    }

    /// A key the open menu may take. False when it is closed, or has nothing to choose and the key is not Escape.
    func handleSlashKey(_ key: SlashKey) -> Bool {
        guard slash.isOpen, SlashMenu.takes(key, count: slash.commands.count) else { return false }
        switch key {
        case .next: slash.selected = SlashMenu.step(slash.selected, count: slash.commands.count, by: 1)
        case .previous: slash.selected = SlashMenu.step(slash.selected, count: slash.commands.count, by: -1)
        case .execute: runSlash(slash.commands[min(slash.selected, slash.commands.count - 1)])
        case .close:
            slash.dismissedAt = slash.triggerLocation
            closeSlash()
        }
        return true
    }

    /// Removes the "/query" and applies `command`.
    func runSlash(_ command: SlashCommand) {
        guard let view = textView, let found = slashMatch(in: view) else {
            closeSlash()
            return
        }
        closeSlash()
        edit {
            view.storage.replaceCharacters(in: NSRange(location: found.trigger, length: found.match.length), with: "")
            view.selection = NSRange(location: found.trigger, length: 0)
        }
        apply(command)
    }

    private func apply(_ command: SlashCommand) {
        switch command {
        case .heading1: setBlock(.heading(1))
        case .heading2: setBlock(.heading(2))
        case .heading3: setBlock(.heading(3))
        case .bulletList: setBlock(.bullet)
        case .numberedList: setBlock(.ordered)
        case .taskList: setBlock(.task(checked: false))
        case .quote: setBlock(.quote)
        case .codeBlock: setBlock(.code)
        case .divider: insertRule()
        case .bold: toggleStyle(.bold)
        case .italic: toggleStyle(.italic)
        case .underline: toggleStyle(.underline)
        case .strikethrough: toggleStyle(.strike)
        case .image: onSlashImage()
        }
    }

    /// The "/query" before the caret, if there is one worth a menu: not inside a code block, a rule or an image.
    private func slashMatch(in view: any EditorSurface) -> (match: SlashMatch, trigger: Int)? {
        let caret = view.selection.location
        guard caret > 0, caret <= view.storage.length,
              let paragraph = EditorParagraphs.containing(caret, in: view.storage) else { return nil }
        switch paragraph.kind {
        case .code, .rule, .image: return nil
        default: break
        }
        // A command word is short; reading only the tail keeps a typing burst in a long paragraph cheap.
        let from = max(paragraph.range.location, caret - 48)
        guard caret > from else { return nil }
        let text = view.storage.mutableString.substring(with: NSRange(location: from, length: caret - from))
        guard let match = SlashMenu.match(textBeforeCaret: text), match.length < 40 else { return nil }
        return (match, caret - match.length)
    }

    /// A divider after the paragraph the caret is in; an empty paragraph is replaced by it.
    func insertRule() {
        guard let view = textView else { return }
        let storage = view.storage
        edit {
            var location = storage.length
            var replacing = 0
            if let paragraph = EditorParagraphs.containing(view.selection.location, in: storage) {
                let end = paragraph.range.location + paragraph.range.length
                if paragraph.isEmpty {
                    location = paragraph.range.location
                    replacing = paragraph.range.length
                } else {
                    location = end
                    if (storage.string as NSString).character(at: end - 1) != 10 {
                        insert("\n", at: end, kind: paragraph.kind, depth: paragraph.depth)
                        location += 1
                    }
                }
            }
            let text = RichDocumentText.objectCharacter + "\n"
            let attributes = RichDocumentText.blockAttributes(kind: .rule, depth: 0)
            storage.replaceCharacters(
                in: NSRange(location: location, length: replacing), with: NSAttributedString(string: text, attributes: attributes)
            )
            EditorStyling.restyle(storage, around: NSRange(location: location, length: 2), images: imageProvider)
            view.selection = NSRange(location: location + 2, length: 0)
            view.typing = EditorStyling.typingAttributes(kind: .paragraph, depth: 0, styles: [])
        }
    }
}
