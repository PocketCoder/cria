import SwiftUI

/// SwiftUI wrapper around `EditorTextView`. The controller owns the content and the commands.
struct RichTextEditor: UIViewRepresentable {
    let controller: EditorController
    let initialHTML: String

    func makeUIView(context: Context) -> EditorTextView {
        let view = EditorTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.alwaysBounceVertical = true
        view.keyboardDismissMode = .interactive
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        controller.attach(view)
        controller.load(initialHTML)
        return view
    }

    func updateUIView(_ view: EditorTextView, context: Context) {}

    func makeCoordinator() -> EditorCoordinator {
        EditorCoordinator(controller: controller)
    }
}

final class EditorCoordinator: NSObject, UITextViewDelegate {
    private let controller: EditorController

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
}
