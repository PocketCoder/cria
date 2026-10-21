import SwiftUI

/// A Settings row that opens a sub-screen in a sheet with Done, in place of pushing it. The Settings window's tabs
/// are its navigation: a push inside a tab brought a back button that fought the tabs, changed the window title and
/// kept the pushed screen when switching tabs.
struct MacSettingsSheetLink<Label: View, Destination: View>: View {
    let destination: () -> Destination
    let label: () -> Label
    /// A push button ("Change…", "Export…") rather than a row with a chevron.
    var isButton = false
    @State private var isPresented = false

    init(@ViewBuilder destination: @escaping () -> Destination, @ViewBuilder label: @escaping () -> Label) {
        self.destination = destination
        self.label = label
    }

    var body: some View {
        trigger.sheet(isPresented: $isPresented) {
            NavigationStack {
                destination()
                    .formStyle(.grouped)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { isPresented = false }
                        }
                    }
            }
            .frame(minWidth: 520, idealWidth: 560, minHeight: 440, idealHeight: 520)
        }
    }

    @ViewBuilder private var trigger: some View {
        if isButton {
            Button { isPresented = true } label: { label() }
        } else {
            Button { isPresented = true } label: {
                HStack {
                    label()
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

extension MacSettingsSheetLink where Label == Text {
    /// A title ending in "…" opens from a push button, as macOS settings do; any other from a chevron row.
    init(_ title: String, @ViewBuilder destination: @escaping () -> Destination) {
        self.init(destination: destination) { Text(title) }
        isButton = title.hasSuffix("…")
    }
}
