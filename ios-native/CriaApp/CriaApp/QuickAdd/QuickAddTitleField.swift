#if canImport(UIKit)
import CriaKit
import SwiftUI
import UIKit

/// Quick add's task name. Each Quick Add Magic token (a date, `*label`, `+project`, `!priority`, a repeat or a
/// "remind …" phrase) shows as a tinted pill in the line as it is typed, and stays plain editable text. A token whose
/// field was then set with a picker is struck through instead, as the picker's value is the one saved.
struct QuickAddTitleField: UIViewRepresentable {
    @Binding var text: String
    let tokens: [QuickAddToken]
    let overridden: Set<QuickAddField>
    var returnKey: UIReturnKeyType = .done
    /// Raised by the sheet to put the caret here (after a picker closes, or for the next task).
    let focusRequest: Int
    let onReturn: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        // TextKit 1, so the layout manager can draw the pills behind the glyphs.
        let storage = NSTextStorage()
        let layout = PillLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        let view = UITextView(frame: .zero, textContainer: container)
        view.delegate = context.coordinator
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.font = Self.font
        view.adjustsFontForContentSizeCategory = true
        view.accessibilityLabel = "Task name"
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let placeholder = UILabel()
        placeholder.text = "Task name"
        placeholder.font = Self.font
        placeholder.adjustsFontForContentSizeCategory = true
        placeholder.textColor = .placeholderText
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(placeholder)
        NSLayoutConstraint.activate([
            placeholder.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            placeholder.topAnchor.constraint(equalTo: view.topAnchor)
        ])
        context.coordinator.placeholder = placeholder
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        view.returnKeyType = returnKey
        // Leave the text alone while a keyboard is composing (marked text), or the composition breaks.
        if view.markedTextRange == nil { restyle(view) }
        context.coordinator.placeholder?.isHidden = !text.isEmpty
        if context.coordinator.lastFocusRequest != focusRequest {
            context.coordinator.lastFocusRequest = focusRequest
            DispatchQueue.main.async { view.becomeFirstResponder() }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? uiView.bounds.width
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: max(fitted.height, Self.font.lineHeight))
    }

    /// The text with each token's pill or strikethrough, keeping the caret where it was.
    private func restyle(_ view: UITextView) {
        let styled = NSMutableAttributedString(string: text, attributes: [.font: Self.font, .foregroundColor: UIColor.label])
        let length = styled.length
        for token in tokens where token.start < token.end && token.end <= length {
            let range = NSRange(location: token.start, length: token.end - token.start)
            if let field = QuickAddPreview.field(for: token.kind), overridden.contains(field) {
                styled.addAttributes([
                    .foregroundColor: UIColor.secondaryLabel, .strikethroughStyle: NSUnderlineStyle.single.rawValue
                ], range: range)
            } else if let tint = QuickAddPreview.tint(for: token.kind) {
                let colour = UIColor(tint)
                styled.addAttributes([.foregroundColor: colour, .criaPill: colour.withAlphaComponent(0.16)], range: range)
            }
        }
        guard !view.attributedText.isEqual(to: styled) else { return }
        let selection = view.selectedRange
        view.attributedText = styled
        view.typingAttributes = [.font: Self.font, .foregroundColor: UIColor.label]
        view.selectedRange = NSRange(location: min(selection.location, length), length: 0)
    }

    static var font: UIFont {
        let base = UIFont.preferredFont(forTextStyle: .title3)
        return UIFont.systemFont(ofSize: base.pointSize, weight: .semibold)
    }

    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: QuickAddTitleField
        weak var placeholder: UILabel?
        var lastFocusRequest = -1

        init(_ parent: QuickAddTitleField) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            placeholder?.isHidden = !textView.text.isEmpty
        }

        /// Return adds the task (or queues it); it never puts a line break in the name.
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard text.contains("\n") else { return true }
            let pasted = text.replacingOccurrences(of: "\n", with: " ")
            if text == "\n" {
                parent.onReturn()
            } else if let current = textView.text, let swap = Range(range, in: current) {
                parent.text = current.replacingCharacters(in: swap, with: pasted)
            }
            return false
        }
    }
}

extension NSAttributedString.Key {
    /// The fill of a quick add token's pill.
    static let criaPill = NSAttributedString.Key("cria.pill")
}

/// Draws a rounded fill behind every run marked `.criaPill`.
private final class PillLayoutManager: NSLayoutManager {
    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage, let container = textContainers.first else { return }
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(.criaPill, in: characters) { value, range, _ in
            guard let fill = value as? UIColor else { return }
            let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let none = NSRange(location: NSNotFound, length: 0)
            enumerateEnclosingRects(forGlyphRange: glyphs, withinSelectedGlyphRange: none, in: container) { rect, _ in
                let pill = rect.offsetBy(dx: origin.x, dy: origin.y).insetBy(dx: -3, dy: 1)
                fill.setFill()
                UIBezierPath(roundedRect: pill, cornerRadius: 7).fill()
            }
        }
    }
}
#endif
