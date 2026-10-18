import SwiftUI

/// The content column's margins from the macOS design: list content capped at 1000pt and centred, at least 16pt from
/// the sides, and 40pt clear at the bottom. Projects lay themselves out (their Kanban, Table and Gantt use the full
/// width), so only the bottom margin applies there. Screens set their own top margin under the large title.
struct MacListColumn: ViewModifier {
    let isCapped: Bool
    @State private var width: CGFloat = 0

    static let maxWidth: CGFloat = 1000
    static let side: CGFloat = 16
    static let bottom: CGFloat = 40

    func body(content: Content) -> some View {
        if isCapped {
            content
                .contentMargins(.horizontal, max(Self.side, ((width - Self.maxWidth) / 2).rounded()), for: .scrollContent)
                .contentMargins(.bottom, Self.bottom, for: .scrollContent)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        } else {
            content.contentMargins(.bottom, Self.bottom, for: .scrollContent)
        }
    }
}

/// Press feedback for custom buttons: scale 0.94 on a bouncy spring over 180ms.
struct MacPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.timingCurve(0.34, 1.56, 0.64, 1, duration: 0.18), value: configuration.isPressed)
    }
}

extension AnyTransition {
    /// Popovers and panels: fade in from scale 0.97 and 4pt up over 140ms.
    static var macPopover: AnyTransition {
        .opacity.combined(with: .scale(scale: 0.97)).combined(with: .offset(y: 4))
            .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.14))
    }
}
