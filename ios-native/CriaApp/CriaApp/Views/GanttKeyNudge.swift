import CriaKit
import SwiftUI

extension View {
    /// Mac only: click a bar to focus it, then Left and Right move it a day, with Shift moving only the end and
    /// Option or Command only the start (as in the web app). A no-op on iOS.
    func ganttKeyNudge(_ onNudge: @escaping (Int, GanttNudgeEdge) -> Void) -> some View {
        #if os(macOS)
        modifier(GanttKeyNudge(onNudge: onNudge))
        #else
        self
        #endif
    }
}

#if os(macOS)
private struct GanttKeyNudge: ViewModifier {
    let onNudge: (Int, GanttNudgeEdge) -> Void
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .simultaneousGesture(TapGesture().onEnded { focused = true })
            .onKeyPress(phases: [.down, .repeat]) { press in
                let direction: Int
                switch press.key {
                case .leftArrow: direction = -1
                case .rightArrow: direction = 1
                default: return .ignored
                }
                let modifiers = press.modifiers
                let edge: GanttNudgeEdge
                if modifiers.contains(.shift) {
                    edge = .end
                } else if modifiers.contains(.option) || modifiers.contains(.command) {
                    edge = .start
                } else {
                    edge = .both
                }
                onNudge(direction, edge)
                return .handled
            }
    }
}
#endif
