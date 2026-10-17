import SwiftUI

/// A text field whose title is a placeholder, not a label. On iOS it is a plain `TextField`. In a grouped form on the
/// Mac a field's title becomes a label in a leading column and the typed text is pushed to the right; this one hides
/// the label, shows the title as the placeholder and reads left to right across the row, as the web inputs do.
struct CriaTextField: View {
    let placeholder: String
    @Binding var text: String
    var axis: Axis = .horizontal

    init(_ placeholder: String, text: Binding<String>, axis: Axis = .horizontal) {
        self.placeholder = placeholder
        _text = text
        self.axis = axis
    }

    var body: some View {
        #if os(macOS)
        TextField("", text: $text, prompt: Text(placeholder), axis: axis)
            .labelsHidden()
            .multilineTextAlignment(.leading)
        #else
        TextField(placeholder, text: $text, axis: axis)
        #endif
    }
}
