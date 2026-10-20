import AppKit
import CriaKit

extension SlashKey {
    /// The key a text-system command stands for, when the slash menu may take it.
    init?(selector: Selector) {
        switch selector {
        case #selector(NSResponder.moveDown(_:)): self = .next
        case #selector(NSResponder.moveUp(_:)): self = .previous
        case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertTab(_:)): self = .execute
        case #selector(NSResponder.cancelOperation(_:)): self = .close
        default: return nil
        }
    }
}

extension MacEditorTextView {
    /// The caret's rectangle in screen coordinates, for panels and popovers that open beside it.
    func caretScreenRect() -> NSRect? {
        let rect = firstRect(forCharacterRange: NSRange(location: selection.location, length: 0), actualRange: nil)
        return rect.height > 0 ? rect : nil
    }
}
