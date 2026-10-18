import SwiftUI

/// A row title being renamed in place: the draft, and what Return (or leaving the field) and Esc do.
struct RowRename {
    var text: Binding<String>
    var commit: () -> Void
    var cancel: () -> Void
}

#if os(macOS)
/// The title as a borderless field in the title's font, focused as it appears. Leaving it saves, as Return does.
struct RowTitleField: View {
    let rename: RowRename
    @FocusState private var focused: Bool
    @State private var ended = false

    var body: some View {
        TextField("Title", text: rename.text)
            .textFieldStyle(.plain)
            .font(Theme.rowTitle)
            .foregroundStyle(Color(.foreground))
            .labelsHidden()
            .focused($focused)
            .onAppear { focused = true }
            .onSubmit { end(rename.commit) }
            .onExitCommand { end(rename.cancel) }
            .onChange(of: focused) { _, isFocused in
                if !isFocused { end(rename.commit) }
            }
            .accessibilityLabel("Task title")
    }

    /// Once only: Return also takes the focus away, which would save a second time.
    private func end(_ action: () -> Void) {
        guard !ended else { return }
        ended = true
        action()
    }
}
#endif
