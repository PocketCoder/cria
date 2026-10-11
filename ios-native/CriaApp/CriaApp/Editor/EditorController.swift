import CriaKit
import UIKit

/// Snapshot used by undo. The text is copied and never mutated, so it is safe to hand to the undo manager.
final class EditorSnapshot: @unchecked Sendable {
    let text: NSAttributedString
    let selection: NSRange

    init(text: NSAttributedString, selection: NSRange) {
        self.text = text
        self.selection = selection
    }
}

/// Owns the editor text view and applies edits to it. The toolbar calls the commands; the text view delegate calls
/// `shouldChange`, `didChange` and `selectionChanged`. Keeps all rules in `EditorRules` (CriaKit) and only does
/// the attribute and text surgery here.
@MainActor
final class EditorController {
    weak var textView: EditorTextView?
    var imageProvider: EditorStyling.ImageProvider = { _ in nil }
    var onMentionTrigger: () -> Void = {}
    var onChange: () -> Void = {}

    func attach(_ view: EditorTextView) {
        textView = view
        view.onToggleTask = { [weak self] paragraph in self?.toggleTask(paragraph) }
    }

    /// Replaces the content with a document parsed from stored HTML.
    func load(_ html: String) {
        guard let view = textView else { return }
        let document = RichDocument(html: html)
        let text = NSMutableAttributedString(attributedString: RichDocumentText.attributedString(from: document))
        EditorStyling.restyleAll(text, images: imageProvider)
        view.textStorage.setAttributedString(text)
        view.typingAttributes = EditorStyling.typingAttributes(kind: .paragraph, depth: 0, styles: [])
        view.refreshMarkers()
    }

    func currentDocument() -> RichDocument {
        guard let view = textView else { return RichDocument() }
        return RichDocumentText.document(from: view.textStorage)
    }

    // MARK: Delegate hooks

    func shouldChange(range: NSRange, text: String) -> Bool {
        guard let view = textView else { return true }
        if text == "\n" {
            handleReturn(range)
            return false
        }
        if text == "@", range.length == 0, isMentionPosition(range.location, in: view) {
            onMentionTrigger()
            return false
        }
        if text.isEmpty, view.selectedRange.length == 0, range.length == 1, range.location + 1 == view.selectedRange.location {
            return handleBackspace(deletingAt: range.location)
        }
        return true
    }

    func didChange() {
        textView?.refreshMarkers()
        onChange()
    }

    func selectionChanged() {
        guard let view = textView, view.selectedRange.length == 0 else { return }
        guard let paragraph = EditorParagraphs.containing(view.selectedRange.location, in: view.textStorage) else { return }
        if paragraph.isEmpty {
            view.typingAttributes = EditorStyling.typingAttributes(kind: paragraph.kind, depth: paragraph.depth, styles: [])
        }
    }

    private func isMentionPosition(_ location: Int, in view: EditorTextView) -> Bool {
        guard location > 0 else { return true }
        let previous = (view.textStorage.string as NSString).substring(with: NSRange(location: location - 1, length: 1))
        return previous.rangeOfCharacter(from: .whitespacesAndNewlines) != nil
    }

    // MARK: Return and Backspace

    private func handleReturn(_ range: NSRange) {
        guard let view = textView else { return }
        var location = range.location
        if range.length > 0 {
            view.textStorage.replaceCharacters(in: range, with: "")
            location = range.location
        }
        let current = EditorParagraphs.containing(location, in: view.textStorage)
        let kind = current?.kind ?? kindFromTyping()
        let depth = current?.depth ?? 0
        let action = EditorRules.returnAction(kind: kind, depth: depth, isEmpty: current?.isEmpty ?? true)
        edit {
            switch action {
            case .continueWith(let next): split(at: location, current: (kind, depth), next: next)
            case .exitToParagraph: convert(current, to: .paragraph, depth: 0)
            case .outdent: convert(current, to: kind, depth: EditorRules.outdented(depth: depth))
            case .lineBreak: insert(RichDocumentText.lineSeparator, at: location, kind: kind, depth: depth)
            }
        }
    }

    private func handleBackspace(deletingAt location: Int) -> Bool {
        guard let view = textView,
              let paragraph = EditorParagraphs.containing(location + 1, in: view.textStorage),
              paragraph.range.location == location + 1 else { return true }
        switch EditorRules.backspaceAction(kind: paragraph.kind, depth: paragraph.depth) {
        case .mergeWithPrevious:
            return true
        case .outdent:
            edit { convert(paragraph, to: paragraph.kind, depth: EditorRules.outdented(depth: paragraph.depth)) }
        case .toParagraph:
            edit { convert(paragraph, to: .paragraph, depth: 0) }
        }
        return false
    }

    func kindFromTyping() -> BlockKind {
        guard let view = textView else { return .paragraph }
        return RichDocumentText.blockInfo(from: view.typingAttributes).kind
    }

    // MARK: Text surgery

    private func split(at location: Int, current: (BlockKind, Int), next: BlockKind) {
        guard let view = textView else { return }
        let storage = view.textStorage
        let terminator = NSAttributedString(
            string: "\n", attributes: RichDocumentText.blockAttributes(kind: current.0, depth: current.1)
        )
        storage.replaceCharacters(in: NSRange(location: location, length: 0), with: terminator)
        let depth = EditorRules.depth(afterChangingTo: next, from: current.1)
        if let second = EditorParagraphs.containing(location + 1, in: storage) {
            apply(kind: next, depth: depth, to: second.range)
        }
        EditorStyling.restyle(storage, around: NSRange(location: location, length: 2), images: imageProvider)
        view.selectedRange = NSRange(location: location + 1, length: 0)
        view.typingAttributes = EditorStyling.typingAttributes(kind: next, depth: depth, styles: [])
    }

    func insert(_ text: String, at location: Int, kind: BlockKind, depth: Int) {
        guard let view = textView else { return }
        let attributes = EditorStyling.typingAttributes(kind: kind, depth: depth, styles: [])
        let inserted = NSAttributedString(string: text, attributes: attributes)
        view.textStorage.replaceCharacters(in: NSRange(location: location, length: 0), with: inserted)
        view.selectedRange = NSRange(location: location + (text as NSString).length, length: 0)
    }

    func convert(_ paragraph: EditorParagraph?, to kind: BlockKind, depth: Int) {
        guard let view = textView else { return }
        guard let paragraph else {
            view.typingAttributes = EditorStyling.typingAttributes(kind: kind, depth: depth, styles: [])
            return
        }
        apply(kind: kind, depth: depth, to: paragraph.range)
        EditorStyling.restyle(view.textStorage, around: paragraph.range, images: imageProvider)
        view.typingAttributes = EditorStyling.typingAttributes(kind: kind, depth: depth, styles: [])
    }

    func apply(kind: BlockKind, depth: Int, to range: NSRange) {
        guard let storage = textView?.textStorage else { return }
        storage.removeAttribute(.criaDepth, range: range)
        storage.removeAttribute(.criaImage, range: range)
        storage.addAttributes(RichDocumentText.blockAttributes(kind: kind, depth: depth), range: range)
    }

    private func toggleTask(_ paragraph: EditorParagraph) {
        guard case .task(let checked) = paragraph.kind else { return }
        edit { convert(paragraph, to: .task(checked: !checked), depth: paragraph.depth) }
    }

    // MARK: Undo

    /// Runs a change and registers an undo step that restores the text before it.
    func edit(_ change: () -> Void) {
        guard let view = textView else { return }
        let before = EditorSnapshot(text: NSAttributedString(attributedString: view.textStorage), selection: view.selectedRange)
        change()
        registerUndo(restoring: before)
        didChange()
    }

    private func registerUndo(restoring snapshot: EditorSnapshot) {
        guard let view = textView else { return }
        let current = EditorSnapshot(text: NSAttributedString(attributedString: view.textStorage), selection: view.selectedRange)
        view.undoManager?.registerUndo(withTarget: self) { target in
            MainActor.assumeIsolated { target.restore(snapshot, redo: current) }
        }
    }

    private func restore(_ snapshot: EditorSnapshot, redo: EditorSnapshot) {
        guard let view = textView else { return }
        view.textStorage.setAttributedString(snapshot.text)
        view.selectedRange = snapshot.selection
        registerUndo(restoring: redo)
        didChange()
    }
}
