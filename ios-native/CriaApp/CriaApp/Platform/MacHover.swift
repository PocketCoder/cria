import SwiftUI

/// The Mac's response to the pointer on a clickable control: the pointing-hand cursor and a slight tone shift while
/// the pointer is over it. A no-op on iOS.
struct MacHoverable: ViewModifier {
    @State private var hovering = false
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        #if os(macOS)
        content
            .brightness(hovering ? (colorScheme == .dark ? 0.08 : -0.05) : 0)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: hovering)
            .onHover { hovering = $0 }
            .modifier(MacPointer())
        #else
        content
        #endif
    }
}

/// The pointing-hand cursor over a clickable control on the Mac, and only while it is enabled. No tone change, so it
/// suits large targets such as rows. A no-op on iOS.
struct MacPointer: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled

    func body(content: Content) -> some View {
        #if os(macOS)
        content.pointerStyle(isEnabled ? .link : nil)
        #else
        content
        #endif
    }
}

extension View {
    /// The pointing-hand cursor over a clickable control on the Mac; nothing on iOS.
    func macPointer() -> some View {
        modifier(MacPointer())
    }

    /// The pointing-hand cursor and a hover tone on the Mac; nothing on iOS.
    func macHoverable() -> some View {
        modifier(MacHoverable())
    }
}
