import SwiftUI

extension View {
    /// Sheets that fill the screen on iPhone need a size on the Mac, where a sheet is as small as its content. A no-op
    /// on iOS.
    @ViewBuilder
    func macSheetFrame() -> some View {
        #if os(macOS)
        frame(minWidth: 480, minHeight: 400)
        #else
        self
        #endif
    }
}
