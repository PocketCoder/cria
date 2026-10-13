import AppKit
import CriaKit
import SwiftUI

/// Scrolls normally, or (inline mode) passes the wheel up so the form around it scrolls instead.
final class MacEditorScrollView: NSScrollView {
    var forwardsWheel = false

    override func scrollWheel(with event: NSEvent) {
        if forwardsWheel { nextResponder?.scrollWheel(with: event) } else { super.scrollWheel(with: event) }
    }
}

/// SwiftUI wrapper around `MacEditorTextView`, the Mac counterpart of the iOS `RichTextEditor` with the same
/// parameters. The controller owns the content and the commands.
struct RichTextEditor: NSViewRepresentable {
    let controller: EditorController
    let initialHTML: String
    /// Resolves `cria://pending/{id}` sources. Set before the HTML loads so pending images render at once.
    let imageProvider: EditorStyling.ImageProvider
    let barActions: EditorBarActions
    /// Inline editor only (the task screen): the height to take, as last reported through `onHeightChange`.
    var inlineHeight: CGFloat?
    /// Set for the inline editor, which sizes to its text. Nil for a full-screen editor.
    var onHeightChange: (@MainActor (CGFloat) -> Void)?

    func makeNSView(context: Context) -> MacEditorScrollView {
        let inline = onHeightChange != nil
        let scroll = MacEditorScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = !inline
        scroll.forwardsWheel = inline
        let view = MacEditorTextView()
        view.delegate = context.coordinator
        if inline {
            view.textContainer?.lineFragmentPadding = 0
            view.textContainerInset = NSSize(width: 0, height: 6)
            view.onHeightChange = onHeightChange
        } else {
            view.textContainerInset = NSSize(width: 12, height: 12)
        }
        let actions = barActions
        view.onImageData = { actions.onImageData($0, $1, $2) }
        scroll.documentView = view
        controller.attach(view)
        controller.imageProvider = imageProvider
        controller.load(initialHTML)
        return scroll
    }

    func updateNSView(_ view: MacEditorScrollView, context: Context) {}

    /// The inline editor takes the offered width and its measured height; a full-screen editor sizes as usual.
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: MacEditorScrollView, context: Context) -> CGSize? {
        guard let inlineHeight else { return nil }
        return CGSize(width: proposal.width ?? nsView.bounds.width, height: inlineHeight)
    }

    static func dismantleNSView(_ view: MacEditorScrollView, coordinator: MacEditorCoordinator) {
        // The text view is about to go; keep what it holds for a save that runs after this.
        coordinator.controller.captureFinalDocument()
    }

    func makeCoordinator() -> MacEditorCoordinator {
        MacEditorCoordinator(controller: controller)
    }
}

@MainActor
final class MacEditorCoordinator: NSObject, NSTextViewDelegate {
    let controller: EditorController

    init(controller: EditorController) {
        self.controller = controller
    }

    func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
        // AppKit sends nil for an attribute-only change and "" for a deletion. The controller acts only on a Return,
        // an "@", or the exact one-character backspace pattern (collapsed caret just after the range), so a nil that
        // is not that passes through unchanged.
        controller.shouldChange(range: range, text: text ?? "")
    }

    func textDidChange(_ notification: Notification) {
        controller.didChange()
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        controller.selectionChanged()
    }

    func textDidEndEditing(_ notification: Notification) {
        // A picker the editor opened took the focus for a moment; editing goes on once it closes.
        guard !controller.isHoldingFocus else { return }
        controller.onEndEditing()
    }
}
