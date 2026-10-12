import SwiftUI

/// SwiftUI wrapper around `EditorTextView`. The controller owns the content and the commands.
struct RichTextEditor: UIViewRepresentable {
    let controller: EditorController
    let initialHTML: String
    /// Resolves `cria://pending/{id}` sources. Set before the HTML loads so pending images render at once.
    let imageProvider: EditorStyling.ImageProvider
    let barActions: EditorBarActions
    /// Inline editor only (the task screen): the height to take, as last reported through `onHeightChange`.
    var inlineHeight: CGFloat?
    /// Set for the inline editor, which sizes to its text and is read-only until tapped. Nil for a full-screen editor.
    var onHeightChange: (@MainActor (CGFloat) -> Void)?

    func makeUIView(context: Context) -> EditorTextView {
        let view = EditorTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.alwaysBounceVertical = true
        view.keyboardDismissMode = .interactive
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        if let onHeightChange { view.configureInline(onHeightChange: onHeightChange) }
        let actions = barActions
        view.onOpenImage = { actions.onOpenImage($0) }
        // `.keyboard` toolbar items never reach a UITextView inside a representable, so the bar is its accessory view.
        view.installAccessoryBar(EditorFormattingBar(controller: controller, actions: barActions))
        controller.attach(view)
        controller.imageProvider = imageProvider
        controller.load(initialHTML)
        return view
    }

    func updateUIView(_ view: EditorTextView, context: Context) {}

    /// The inline editor takes the offered width and its measured height; a full-screen editor sizes as usual.
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: EditorTextView, context: Context) -> CGSize? {
        guard let inlineHeight else { return nil }
        return CGSize(width: proposal.width ?? uiView.bounds.width, height: inlineHeight)
    }

    static func dismantleUIView(_ view: EditorTextView, coordinator: EditorCoordinator) {
        // The text view is about to go; keep what it holds for a save that runs after this.
        coordinator.controller.captureFinalDocument()
    }

    func makeCoordinator() -> EditorCoordinator {
        EditorCoordinator(controller: controller)
    }
}

final class EditorCoordinator: NSObject, UITextViewDelegate {
    let controller: EditorController

    init(controller: EditorController) {
        self.controller = controller
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        controller.shouldChange(range: range, text: text)
    }

    func textViewDidChange(_ textView: UITextView) {
        controller.didChange()
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        controller.selectionChanged()
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        // A picker the editor opened took the focus for a moment; editing goes on once it closes.
        guard !controller.isHoldingFocus else { return }
        (textView as? EditorTextView)?.endInlineEditing()
        controller.onEndEditing()
    }
}
