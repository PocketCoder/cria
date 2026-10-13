import SwiftUI

// iOS-only SwiftUI API under the same names, so shared views compile on macOS unchanged. Each is a no-op or the
// nearest Mac equivalent. Nothing here is compiled for iOS.
#if os(macOS)

struct TextInputAutocapitalization: Sendable {
    static let never = TextInputAutocapitalization()
    static let characters = TextInputAutocapitalization()
    static let words = TextInputAutocapitalization()
    static let sentences = TextInputAutocapitalization()
}

enum ShimKeyboardType: Sendable {
    case `default`, URL, numberPad, emailAddress, decimalPad, numbersAndPunctuation
}

enum ShimTitleDisplayMode: Sendable {
    case automatic, inline, large
}

enum EditMode: Sendable {
    case inactive, transient, active

    var isEditing: Bool { self != .inactive }
}

private struct EditModeKey: EnvironmentKey {
    static let defaultValue: Binding<EditMode>? = nil
}

extension EnvironmentValues {
    var editMode: Binding<EditMode>? {
        get { self[EditModeKey.self] }
        set { self[EditModeKey.self] = newValue }
    }
}

/// Reordering on the Mac needs no edit mode, so the button draws nothing.
struct EditButton: View {
    var body: some View { EmptyView() }
}

enum ShimSectionSpacing: Sendable {
    case `default`, compact
}

extension View {
    func listSectionSpacing(_ spacing: ShimSectionSpacing) -> some View { self }

    func textInputAutocapitalization(_ style: TextInputAutocapitalization?) -> some View { self }

    func keyboardType(_ type: ShimKeyboardType) -> some View { self }

    func navigationBarTitleDisplayMode(_ mode: ShimTitleDisplayMode) -> some View { self }

    func fullScreenCover<Item: Identifiable, Content: View>(
        item: Binding<Item?>, @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        sheet(item: item, content: content)
    }

    func fullScreenCover<Content: View>(
        isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        sheet(isPresented: isPresented, content: content)
    }
}

/// The camera is iOS-only: the Mac offers no "Take photo" row, and the closure is never called.
struct CameraPicker: View {
    static let isAvailable = false
    let onCapture: (Data) -> Void

    init(onCapture: @escaping (Data) -> Void) {
        self.onCapture = onCapture
    }

    var body: some View { EmptyView() }
}

enum ShimDrawerDisplayMode: Sendable {
    case automatic, always
}

extension SearchFieldPlacement {
    static func navigationBarDrawer(displayMode: ShimDrawerDisplayMode) -> SearchFieldPlacement { .automatic }
}

extension DatePickerStyle where Self == FieldDatePickerStyle {
    /// The wheel is iOS-only; a text field with steppers is the Mac's time entry.
    static var wheel: FieldDatePickerStyle { .field }
}

extension PickerStyle where Self == MenuPickerStyle {
    static var navigationLink: MenuPickerStyle { .menu }
}

extension ToolbarItemPlacement {
    static var topBarLeading: ToolbarItemPlacement { .navigation }
    static var topBarTrailing: ToolbarItemPlacement { .primaryAction }
}

extension ToolbarPlacement {
    static var navigationBar: ToolbarPlacement { .windowToolbar }
}

#endif
