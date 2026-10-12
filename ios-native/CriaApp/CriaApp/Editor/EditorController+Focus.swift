import UIKit

/// Keeps an editing session alive across the pickers the editor opens (mention, link, photo). Presenting a sheet or
/// an alert resigns the text view; without this that ends editing, so the inline editor saves, turns read-only and
/// needs another tap.
extension EditorController {
    /// True while editing, a picker's pause included.
    var isEditing: Bool { isHoldingFocus || textView?.isFirstResponder == true }

    /// Call just before presenting a picker. Remembers the caret; the resign that follows does not end editing.
    func holdFocus() {
        guard let view = textView, view.isFirstResponder else { return }
        heldSelection = view.selectedRange
        isHoldingFocus = true
    }

    /// Call once the picker has gone. Brings the keyboard back with the caret where it was, then runs `change` (the
    /// insertion of what was picked). If the text view cannot take focus again, editing ends as it would have.
    func restoreFocus(then change: @escaping @MainActor () -> Void = {}) {
        guard isHoldingFocus else {
            change()
            return
        }
        attemptRestore(change, retries: 4)
    }

    private func attemptRestore(_ change: @escaping @MainActor () -> Void, retries: Int) {
        let view = textView
        if let view, view.window != nil, view.becomeFirstResponder() {
            isHoldingFocus = false
            restoreSelection(view)
            change()
            return
        }
        // A sheet or alert still on its way out keeps the focus for a moment.
        if retries > 0, view != nil {
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(150))
                self?.attemptRestore(change, retries: retries - 1)
            }
            return
        }
        isHoldingFocus = false
        if let view { restoreSelection(view) }
        change()
        view?.endInlineEditing()
        onEndEditing()
    }

    private func restoreSelection(_ view: EditorTextView) {
        defer { heldSelection = nil }
        guard let held = heldSelection, NSMaxRange(held) <= view.textStorage.length else { return }
        view.selectedRange = held
    }

    /// An image arrived for `source` after the text loaded: swap its placeholder for it. Attributes only, so this is
    /// neither an edit nor an undo step.
    func refreshImages(source: String) {
        guard let view = textView else { return }
        let storage = view.textStorage
        storage.beginEditing()
        for paragraph in EditorParagraphs.all(in: storage) {
            guard case .image(let image) = paragraph.kind, EditorStyling.source(of: image) == source else { continue }
            EditorStyling.restyle(storage, around: paragraph.range, images: imageProvider)
        }
        storage.endEditing()
        view.refreshMarkers()
    }
}
