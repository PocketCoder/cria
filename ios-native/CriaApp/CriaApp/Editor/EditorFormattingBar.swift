import SwiftUI
import UIKit

/// What the formatting bar asks its host to open. The host sets these once the editor appears; the bar reads them
/// when a button is tapped, so it never needs rebuilding.
@MainActor
final class EditorBarActions {
    var onLink: () -> Void = {}
    var onPhoto: () -> Void = {}
    var onMention: () -> Void = {}
    /// A tap on an inline image while the editor is idle: open it full size.
    var onOpenImage: (String) -> Void = { _ in }
}

/// The formatting buttons shown above the keyboard. Every button runs the same `EditorController` command as before.
struct EditorFormattingBar: View {
    let controller: EditorController
    let actions: EditorBarActions

    private var state: EditorBarState { controller.barState }

    var body: some View {
        HStack(spacing: 0) {
            formatButtons
            Divider().frame(height: 24)
            // Pinned outside the scrolling buttons: the way to put the keyboard away while typing.
            barButton("keyboard.chevron.compact.down", "Hide keyboard") {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .padding(.horizontal, 4)
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
        // The accessory view has a fixed height, so the glyphs stop growing before they would clip; a long press
        // shows the Large Content Viewer instead.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private var formatButtons: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                barButton("bold", "Bold", on: state.isOn(.bold)) { controller.toggleStyle(.bold) }
                barButton("italic", "Italic", on: state.isOn(.italic)) { controller.toggleStyle(.italic) }
                barButton("underline", "Underline", on: state.isOn(.underline)) { controller.toggleStyle(.underline) }
                barButton("strikethrough", "Strikethrough", on: state.isOn(.strike)) { controller.toggleStyle(.strike) }
                barButton("textformat.size", "Heading", on: state.isBlock(.heading(2))) { controller.setBlock(.heading(2)) }
                barButton("list.bullet", "Bulleted list", on: state.isBlock(.bullet)) { controller.setBlock(.bullet) }
                barButton("list.number", "Numbered list", on: state.isBlock(.ordered)) { controller.setBlock(.ordered) }
                barButton("checklist", "Task list", on: state.isBlock(.task(checked: false))) {
                    controller.setBlock(.task(checked: false))
                }
                barButton("increase.indent", "Indent") { controller.changeIndent(by: 1) }
                barButton("decrease.indent", "Outdent") { controller.changeIndent(by: -1) }
                barButton("text.quote", "Quote", on: state.isBlock(.quote)) { controller.setBlock(.quote) }
                barButton("chevron.left.forwardslash.chevron.right", "Code block", on: state.isBlock(.code)) {
                    controller.setBlock(.code)
                }
                barButton("link", "Link") { actions.onLink() }
                barButton("photo", "Image") { actions.onPhoto() }
                barButton("at", "Mention") { actions.onMention() }
            }
            .padding(.horizontal, 8)
        }
    }

    /// `on` is nil for buttons with no state (indent, link); otherwise the button is tinted and reads as selected.
    private func barButton(_ symbol: String, _ label: String, on isOn: Bool? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(minWidth: 40, minHeight: 40)
                .background(isOn == true ? Color(.primary).opacity(0.15) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        }
        .accessibilityLabel(label)
        .accessibilityAddTraits(isOn == true ? .isSelected : [])
        .accessibilityShowsLargeContentViewer()
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
