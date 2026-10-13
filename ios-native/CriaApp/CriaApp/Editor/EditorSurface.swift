import Foundation

/// What `EditorController` needs from a text view, so one controller drives `UITextView` on iOS and `NSTextView` on the
/// Mac. The names avoid the two classes' own (`selectedRange` is a method on `NSTextView`, `textStorage` optional).
@MainActor
protocol EditorSurface: AnyObject {
    var storage: NSTextStorage { get }
    var selection: NSRange { get set }
    var typing: [NSAttributedString.Key: Any] { get set }
    /// True while the view has the keyboard focus.
    var isFocused: Bool { get }
    var isInWindow: Bool { get }
    var editorUndoManager: UndoManager? { get }
    var onToggleTask: ((EditorParagraph) -> Void)? { get set }
    /// Backspace with the caret at the very start. Returns false when it handled the key (cleared list formatting).
    var onBackspaceAtStart: (() -> Bool)? { get set }
    /// The text size changed while the editor is open; the controller restyles at the new size.
    var onContentSizeChange: (() -> Void)? { get set }
    /// Asks for the focus. False when the view could not take it.
    func focus() -> Bool
    func unfocus()
    /// Redraws list markers and reports the height an inline editor needs.
    func refreshMarkers()
    /// Back to read-only once editing ends (inline mode on iOS only).
    func endInlineEditing()
}
