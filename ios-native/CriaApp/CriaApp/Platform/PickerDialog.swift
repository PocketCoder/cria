import SwiftUI

/// One choice in a `pickerDialog`.
struct PickerOption: Identifiable {
    let id: String
    let title: String
    /// A colour dot before the title (projects, colours, priorities); the Mac list only.
    var tint: Color?
    /// Ticked in the Mac list.
    var isCurrent = false
}

extension View {
    /// A short list to choose from: the confirmation dialog on iOS, unchanged; on the Mac, where that dialog is a
    /// column of alert buttons, a filterable list sheet (`MacPickerSheet`).
    func pickerDialog(
        _ title: String, isPresented: Binding<Bool>, options: [PickerOption], onPick: @escaping (String) -> Void
    ) -> some View {
        #if os(macOS)
        sheet(isPresented: isPresented) { MacPickerSheet(title: title, options: options, onPick: onPick) }
        #else
        confirmationDialog(title, isPresented: isPresented) {
            ForEach(options) { option in
                Button(option.title) { onPick(option.id) }
            }
        }
        #endif
    }
}
