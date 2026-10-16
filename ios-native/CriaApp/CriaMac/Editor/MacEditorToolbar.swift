import CriaKit
import SwiftUI

/// The formatting bar above the Mac editor. Every button runs the same `EditorController` command as the iOS bar;
/// ⌘B, ⌘I and ⌘U toggle bold, italic and underline, and ⌘L adds a link (⌘K opens the command palette).
struct MacEditorToolbar: View {
    let controller: EditorController
    let actions: EditorBarActions

    private var state: EditorBarState { controller.barState }

    var body: some View {
        // Scrolls sideways when the pane is narrower than the bar, so the bar never widens the task pane.
        // A fixed height and the offered width: a sideways scroll view otherwise reports its full content width as its
        // ideal size, which the form around it measures on every layout pass.
        ScrollView(.horizontal, showsIndicators: false) { bar }
            .frame(maxWidth: .infinity)
            .frame(height: 30)
    }

    private var bar: some View {
        HStack(spacing: 2) {
            button("bold", "Bold", on: state.isOn(.bold), key: "b") { controller.toggleStyle(.bold) }
            button("italic", "Italic", on: state.isOn(.italic), key: "i") { controller.toggleStyle(.italic) }
            button("underline", "Underline", on: state.isOn(.underline), key: "u") { controller.toggleStyle(.underline) }
            button("strikethrough", "Strikethrough", on: state.isOn(.strike)) { controller.toggleStyle(.strike) }
            button("chevron.left.forwardslash.chevron.right", "Code", on: state.isOn(.code)) { controller.toggleStyle(.code) }
            divider
            button("textformat.size", "Heading", on: state.isBlock(.heading(2))) { controller.setBlock(.heading(2)) }
            button("list.bullet", "Bulleted list", on: state.isBlock(.bullet)) { controller.setBlock(.bullet) }
            button("list.number", "Numbered list", on: state.isBlock(.ordered)) { controller.setBlock(.ordered) }
            button("checklist", "Task list", on: state.isBlock(.task(checked: false))) {
                controller.setBlock(.task(checked: false))
            }
            button("increase.indent", "Indent") { controller.changeIndent(by: 1) }
            button("decrease.indent", "Outdent") { controller.changeIndent(by: -1) }
            button("text.quote", "Quote", on: state.isBlock(.quote)) { controller.setBlock(.quote) }
            button("curlybraces", "Code block", on: state.isBlock(.code)) { controller.setBlock(.code) }
            divider
            button("link", "Link", key: "l") { actions.onLink() }
            button("photo", "Image") { actions.onPhoto() }
            button("at", "Mention") { actions.onMention() }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    private var divider: some View {
        Divider().frame(height: 16).padding(.horizontal, 2)
    }

    /// `on` is nil for buttons with no state (indent, link); otherwise the button is tinted and reads as selected.
    @ViewBuilder
    private func button(
        _ symbol: String, _ label: String, on isOn: Bool? = nil, key: KeyEquivalent? = nil, action: @escaping () -> Void
    ) -> some View {
        let base = Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 26, height: 24)
                .background(isOn == true ? Color(.primary).opacity(0.18) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
        .accessibilityAddTraits(isOn == true ? .isSelected : [])
        if let key {
            base.keyboardShortcut(key, modifiers: .command)
        } else {
            base
        }
    }
}
