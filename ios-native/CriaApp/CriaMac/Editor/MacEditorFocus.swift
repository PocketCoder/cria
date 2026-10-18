import AppKit
import SwiftUI

/// Whether a Mac editor holds the keyboard: the text view posts each change, and a view that shows the editor (its
/// formatting bar, the description box) follows the one its controller drives.
@MainActor
enum MacEditorFocus {
    static let changed = Notification.Name("io.cria.mac.editorFocus")
    private static let focusedKey = "focused"

    static func post(_ view: NSTextView, focused: Bool) {
        NotificationCenter.default.post(name: changed, object: view, userInfo: [focusedKey: focused])
    }

    /// The focus carried by a notification for this controller's text view, or nil when it is about another editor.
    static func focus(in note: Notification, for controller: EditorController) -> Bool? {
        guard let surface = controller.textView, let view = note.object as? NSTextView, view === surface else { return nil }
        return note.userInfo?[focusedKey] as? Bool
    }
}

/// Keeps `focused` in step with the editor `controller` drives.
struct MacEditorFocusReader: ViewModifier {
    let controller: EditorController
    @Binding var focused: Bool

    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: MacEditorFocus.changed)) { note in
            if let focus = MacEditorFocus.focus(in: note, for: controller), focus != focused { focused = focus }
        }
    }
}
