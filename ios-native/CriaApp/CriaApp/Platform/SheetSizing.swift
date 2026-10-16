import SwiftUI

extension View {
    /// Sheets that fill the screen on iPhone need a size on the Mac, where a sheet is as small as its content. A no-op
    /// on iOS. The button style goes back to the system's, so a sheet opened from a list row (whose row style the
    /// sheet would inherit) still has standard Cancel and Save buttons; its own list sets the row style again.
    @ViewBuilder
    func macSheetFrame(width: CGFloat = 480, height: CGFloat = 400) -> some View {
        #if os(macOS)
        frame(minWidth: width, idealWidth: width, minHeight: height, idealHeight: height)
            .buttonStyle(.automatic)
        #else
        self
        #endif
    }

    /// List rows on the Mac without the grey bezel AppKit gives a default button, for lists that do not use
    /// `criaSurface`. A no-op on iOS.
    @ViewBuilder
    func macRowButtons() -> some View {
        #if os(macOS)
        buttonStyle(FormRowButtonStyle())
        #else
        self
        #endif
    }

    /// A picker's option rows read as one group on the Mac, as the desktop app's menus do. A no-op on iOS.
    @ViewBuilder
    func macRowSeparatorHidden() -> some View {
        #if os(macOS)
        listRowSeparator(.hidden)
        #else
        self
        #endif
    }
}
