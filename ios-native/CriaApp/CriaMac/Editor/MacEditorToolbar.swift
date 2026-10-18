import CriaKit
import SwiftUI

/// The formatting bar above the Mac editor, as the design handoff lays it out: Bold, Italic, Strikethrough, Code, then
/// Heading, Bulleted, Numbered, Checklist and Link, with Mention on the right. Every button runs the same
/// `EditorController` command as the iOS bar; ⌘B, ⌘I and ⌘U toggle bold, italic and underline (underline has no
/// button), and ⌘L adds a link (⌘K opens the command palette). At 45% until the editor has the keyboard.
struct MacEditorToolbar: View {
    let controller: EditorController
    let actions: EditorBarActions
    @State private var focused = false

    private var state: EditorBarState { controller.barState }

    var body: some View {
        // Scrolls sideways when the pane is narrower than the bar, so the bar never widens the task pane.
        // A fixed height and the offered width: a sideways scroll view otherwise reports its full content width as its
        // ideal size, which the form around it measures on every layout pass.
        // At least as wide as the pane, so Mention sits at the right edge.
        GeometryReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) { bar.frame(minWidth: proxy.size.width) }
        }
            .frame(maxWidth: .infinity)
            .frame(height: 30)
            .opacity(focused ? 1 : 0.45)
            .animation(.easeOut(duration: 0.15), value: focused)
            .modifier(MacEditorFocusReader(controller: controller, focused: $focused))
            // ⌘U keeps working without a button of its own.
            .background {
                Button("Underline") { controller.toggleStyle(.underline) }
                    .keyboardShortcut("u", modifiers: .command)
                    .opacity(0)
                    .accessibilityHidden(true)
            }
    }

    private var bar: some View {
        HStack(spacing: 2) {
            button("bold", "Bold", on: state.isOn(.bold), key: "b") { controller.toggleStyle(.bold) }
            button("italic", "Italic", on: state.isOn(.italic), key: "i") { controller.toggleStyle(.italic) }
            button("strikethrough", "Strikethrough", on: state.isOn(.strike)) { controller.toggleStyle(.strike) }
            button("chevron.left.forwardslash.chevron.right", "Code", on: state.isOn(.code)) { controller.toggleStyle(.code) }
            divider
            button("textformat.size", "Heading", on: state.isBlock(.heading(2))) { controller.setBlock(.heading(2)) }
            button("list.bullet", "Bulleted list", on: state.isBlock(.bullet)) { controller.setBlock(.bullet) }
            button("list.number", "Numbered list", on: state.isBlock(.ordered)) { controller.setBlock(.ordered) }
            button("checklist", "Checklist", on: state.isBlock(.task(checked: false))) {
                controller.setBlock(.task(checked: false))
            }
            button("link", "Link (⌘L)", key: "l") { actions.onLink() }
            Spacer(minLength: 8)
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
