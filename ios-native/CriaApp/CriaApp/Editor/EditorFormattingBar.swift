import SwiftUI
import UIKit

/// What the formatting bar asks its host to open. The host sets these once the editor appears; the bar reads them
/// when a button is tapped, so it never needs rebuilding.
@MainActor
final class EditorBarActions {
    var onLink: () -> Void = {}
    var onPhoto: () -> Void = {}
    var onMention: () -> Void = {}
}

/// The formatting buttons shown above the keyboard. Every button runs the same `EditorController` command as before.
struct EditorFormattingBar: View {
    let controller: EditorController
    let actions: EditorBarActions

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                barButton("bold", "Bold") { controller.toggleStyle(.bold) }
                barButton("italic", "Italic") { controller.toggleStyle(.italic) }
                barButton("underline", "Underline") { controller.toggleStyle(.underline) }
                barButton("strikethrough", "Strikethrough") { controller.toggleStyle(.strike) }
                barButton("textformat.size", "Heading") { controller.setBlock(.heading(2)) }
                barButton("list.bullet", "Bulleted list") { controller.setBlock(.bullet) }
                barButton("list.number", "Numbered list") { controller.setBlock(.ordered) }
                barButton("checklist", "Task list") { controller.setBlock(.task(checked: false)) }
                barButton("increase.indent", "Indent") { controller.changeIndent(by: 1) }
                barButton("decrease.indent", "Outdent") { controller.changeIndent(by: -1) }
                barButton("text.quote", "Quote") { controller.setBlock(.quote) }
                barButton("chevron.left.forwardslash.chevron.right", "Code block") { controller.setBlock(.code) }
                barButton("link", "Link") { actions.onLink() }
                barButton("photo", "Image") { actions.onPhoto() }
                barButton("at", "Mention") { actions.onMention() }
            }
            .padding(.horizontal, 8)
        }
        .foregroundStyle(Color(.foreground))
        // iOS 26 draws the keyboard-style input view see-through, so the form showed behind the buttons. A solid
        // material capsule keeps them readable over anything.
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color(.mutedForeground).opacity(0.2)))
        .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(height: EditorAccessoryView.barHeight)
    }

    private func barButton(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).frame(minWidth: 40, minHeight: 40)
        }
        .accessibilityLabel(label)
    }
}

/// Hosts the SwiftUI bar as a text view's `inputAccessoryView`. A `UIInputView` in keyboard style takes the keyboard's
/// own background; the height is explicit because an accessory view gets no size from SwiftUI.
final class EditorAccessoryView: UIInputView {
    static let barHeight: CGFloat = 52

    /// Kept for the life of the accessory view; releasing it would blank the bar.
    private let hosting: UIHostingController<EditorFormattingBar>

    @MainActor
    init(bar: EditorFormattingBar) {
        hosting = UIHostingController(rootView: bar)
        super.init(frame: CGRect(x: 0, y: 0, width: 0, height: Self.barHeight), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        autoresizingMask = [.flexibleWidth]
        hosting.safeAreaRegions = []
        hosting.view.backgroundColor = .clear
        hosting.view.frame = bounds
        hosting.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(hosting.view)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: Self.barHeight)
    }
}

extension EditorTextView {
    func installAccessoryBar(_ bar: EditorFormattingBar) {
        inputAccessoryView = EditorAccessoryView(bar: bar)
    }
}
