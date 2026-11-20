import SwiftUI
#if os(macOS)
import AppKit
#endif

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
    /// Whether this view set the hand, so leaving puts the arrow back only for its own hand.
    @State private var showsHand = false

    func body(content: Content) -> some View {
        #if os(macOS)
        content
            .pointerStyle(isEnabled ? .link : nil)
            // `.pointerStyle` alone lost to AppKit's cursor rects in lists, scroll views and tables, so the arrow came
            // back over rows and cards. Setting the hand on every pointer move wins, and the arrow returns on leaving.
            .onContinuousHover { phase in
                switch phase {
                case .active:
                    guard isEnabled else { return }
                    showsHand = true
                    NSCursor.pointingHand.set()
                case .ended:
                    guard showsHand else { return }
                    showsHand = false
                    NSCursor.arrow.set()
                }
            }
            .onDisappear {
                if showsHand { NSCursor.arrow.set() }
                showsHand = false
            }
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
