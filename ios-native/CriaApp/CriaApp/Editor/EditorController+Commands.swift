import CriaKit
import UIKit

/// Toolbar commands: inline styles, block kinds, indentation, links, mentions and images.
extension EditorController {
    func toggleStyle(_ style: InlineStyle) {
        guard let view = textView else { return }
        let range = view.selectedRange
        if range.length == 0 {
            toggleTypingStyle(style, in: view)
            return
        }
        edit {
            let storage = view.textStorage
            var allHave = true
            storage.enumerateAttribute(.criaStyles, in: range) { value, _, _ in
                if !EditorStyling.styleSet(value).contains(style) { allHave = false }
            }
            var updates: [(NSRange, Set<InlineStyle>)] = []
            storage.enumerateAttribute(.criaStyles, in: range) { value, subrange, _ in
                var styles = EditorStyling.styleSet(value)
                if allHave { styles.remove(style) } else { styles.insert(style) }
                updates.append((subrange, styles))
            }
            for (subrange, styles) in updates {
                if styles.isEmpty {
                    storage.removeAttribute(.criaStyles, range: subrange)
                } else {
                    storage.addAttribute(.criaStyles, value: styles.map(\.rawValue).sorted().joined(separator: ","), range: subrange)
                }
            }
            EditorStyling.restyle(storage, around: range, images: imageProvider)
        }
    }

    private func toggleTypingStyle(_ style: InlineStyle, in view: EditorTextView) {
        let info = RichDocumentText.blockInfo(from: view.typingAttributes)
        var styles = EditorStyling.styleSet(view.typingAttributes[.criaStyles])
        if styles.contains(style) { styles.remove(style) } else { styles.insert(style) }
        view.typingAttributes = EditorStyling.typingAttributes(kind: info.kind, depth: info.depth, styles: styles)
    }

    /// Applies a block kind to the selected paragraphs; choosing the active kind again turns them back into paragraphs.
    func setBlock(_ target: BlockKind) {
        guard let view = textView else { return }
        let paragraphs = EditorParagraphs.intersecting(view.selectedRange, in: view.textStorage)
            .filter { paragraph in
                if case .image = paragraph.kind { return false }
                return paragraph.kind != .rule
            }
        guard let first = paragraphs.first else {
            let info = RichDocumentText.blockInfo(from: view.typingAttributes)
            let kind = EditorRules.toggled(info.kind, to: target)
            let depth = EditorRules.depth(afterChangingTo: kind, from: 0)
            view.typingAttributes = EditorStyling.typingAttributes(kind: kind, depth: depth, styles: [])
            return
        }
        let kind = EditorRules.toggled(first.kind, to: target)
        edit {
            for paragraph in paragraphs {
                convert(paragraph, to: kind, depth: EditorRules.depth(afterChangingTo: kind, from: paragraph.depth))
            }
        }
    }

    func changeIndent(by delta: Int) {
        guard let view = textView else { return }
        let paragraphs = EditorParagraphs.intersecting(view.selectedRange, in: view.textStorage).filter { $0.kind.isListItem }
        guard !paragraphs.isEmpty else { return }
        edit {
            for paragraph in paragraphs {
                let depth = delta > 0
                    ? EditorRules.indented(depth: paragraph.depth, kind: paragraph.kind)
                    : EditorRules.outdented(depth: paragraph.depth)
                convert(paragraph, to: paragraph.kind, depth: depth)
            }
        }
    }

    /// Links the selection, or inserts the address itself as a link when nothing is selected.
    func insertLink(_ address: String) {
        guard let view = textView, !address.isEmpty else { return }
        let range = view.selectedRange
        if range.length > 0 {
            edit {
                view.textStorage.addAttribute(.criaLink, value: address, range: range)
                EditorStyling.restyle(view.textStorage, around: range, images: imageProvider)
            }
            return
        }
        insertRun(address, extra: [.criaLink: address])
    }

    func insertMention(username: String) {
        guard !username.isEmpty else { return }
        insertRun("@\(username)", extra: [.criaMention: username])
        insertRun(" ", extra: [:])
    }

    /// Types plain text at the caret (the "@" of a cancelled mention picker).
    func insertLiteral(_ text: String) {
        insertRun(text, extra: [:])
    }

    /// Inserts an inline image as its own paragraph after the paragraph the caret is in.
    func insertImage(_ image: RichImage) {
        guard let view = textView else { return }
        let storage = view.textStorage
        edit {
            var location = storage.length
            if let paragraph = EditorParagraphs.containing(view.selectedRange.location, in: storage) {
                location = paragraph.range.location + paragraph.range.length
                if !hasTerminator(paragraph, in: storage) {
                    insert("\n", at: location, kind: paragraph.kind, depth: paragraph.depth)
                    location += 1
                }
            }
            let text = RichDocumentText.objectCharacter + "\n"
            let attributes = RichDocumentText.blockAttributes(kind: .image(image), depth: 0)
            let inserted = NSAttributedString(string: text, attributes: attributes)
            storage.replaceCharacters(in: NSRange(location: location, length: 0), with: inserted)
            EditorStyling.restyle(storage, around: NSRange(location: location, length: 2), images: imageProvider)
            view.selectedRange = NSRange(location: location + 2, length: 0)
            view.typingAttributes = EditorStyling.typingAttributes(kind: .paragraph, depth: 0, styles: [])
        }
    }

    private func hasTerminator(_ paragraph: EditorParagraph, in storage: NSTextStorage) -> Bool {
        guard paragraph.range.length > 0 else { return false }
        return (storage.string as NSString).character(at: paragraph.range.location + paragraph.range.length - 1) == 10
    }

    private func insertRun(_ text: String, extra: [NSAttributedString.Key: Any]) {
        guard let view = textView else { return }
        let range = view.selectedRange
        edit {
            let info = RichDocumentText.blockInfo(from: view.typingAttributes)
            var attributes = EditorStyling.typingAttributes(kind: info.kind, depth: info.depth, styles: [])
            attributes.merge(extra) { _, new in new }
            view.textStorage.replaceCharacters(in: range, with: NSAttributedString(string: text, attributes: attributes))
            let end = range.location + (text as NSString).length
            let inserted = NSRange(location: range.location, length: end - range.location)
            EditorStyling.restyle(view.textStorage, around: inserted, images: imageProvider)
            view.selectedRange = NSRange(location: end, length: 0)
        }
    }
}
