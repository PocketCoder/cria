import CriaKit
import SwiftUI

/// The open task as a raised card over the content column, where the system inspector column used to sit: inset
/// 10pt from the column's edges, radius 14, a hairline edge and two shadows so it reads as lifted above the list. The
/// list keeps its place underneath and gains trailing room equal to the card, so no row is hidden behind it. The
/// card's leading edge drags to resize (320 to 560pt, remembered).
struct MacFloatingInspector: ViewModifier {
    let services: AppServices
    let actions: MacActions
    @AppStorage("mac.inspector.width") private var width: Double = 380
    @State private var dragStart: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let inset: CGFloat = 10
    private static let range: ClosedRange<Double> = 320...560

    private var isOpen: Bool { actions.openTaskId != nil }
    private var cardWidth: CGFloat { CGFloat(min(max(width, Self.range.lowerBound), Self.range.upperBound)) }
    private var motion: Animation? { reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86) }

    func body(content: Content) -> some View {
        // Siblings rather than an overlay, so the card does not take on the room the content makes for it.
        ZStack(alignment: .trailing) {
            content
                .safeAreaPadding(.trailing, isOpen ? cardWidth + Self.inset * 2 : 0)
            if isOpen {
                card
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(motion, value: isOpen)
    }

    private var card: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        return MacTaskInspector(services: services, actions: actions)
            .frame(width: cardWidth)
            .frame(maxHeight: .infinity)
            .background(MacTheme.inspector)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 1))
            .shadow(color: .black.opacity(0.10), radius: 2, y: 1)
            .shadow(color: .black.opacity(0.18), radius: 24, y: 12)
            .overlay(alignment: .leading) { resizeHandle }
            .padding(Self.inset)
    }

    /// A 6pt strip on the card's leading edge with the resize cursor.
    private var resizeHandle: some View {
        Color.clear
            .frame(width: 6)
            .contentShape(Rectangle())
            .pointerStyle(.frameResize(position: .leading))
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { value in
                        let start = dragStart ?? Double(cardWidth)
                        dragStart = start
                        let proposed = start - Double(value.translation.width)
                        width = min(max(proposed, Self.range.lowerBound), Self.range.upperBound)
                    }
                    .onEnded { _ in dragStart = nil }
            )
            .accessibilityHidden(true)
    }
}

extension View {
    /// The open task as a raised card over this view; see `MacFloatingInspector`.
    func macFloatingInspector(services: AppServices, actions: MacActions) -> some View {
        modifier(MacFloatingInspector(services: services, actions: actions))
    }
}
