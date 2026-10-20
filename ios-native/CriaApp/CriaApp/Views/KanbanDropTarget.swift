import CriaKit
import SwiftUI

/// Accepts a dragged card, unless the board is read-only. A selection tick as a dragged card moves over a new column
/// or card (a new place to land), a light impact when it drops.
struct KanbanDropTarget: ViewModifier {
    let enabled: Bool
    /// Told when a drag enters or leaves, so the column can show it is where the card will land.
    var onTargetChange: (Bool) -> Void = { _ in }
    let action: (String) -> Bool
    @State private var targeted = false
    @State private var drops = 0

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.dropDestination(for: String.self) { items, _ in
                guard let taskId = items.first.flatMap(KanbanPayload.taskId(from:)) else { return false }
                let accepted = action(taskId)
                if accepted { drops += 1 }
                return accepted
            } isTargeted: { targeted = $0; onTargetChange($0) }
                .sensoryFeedback(trigger: targeted) { _, now in now ? SensoryFeedback.selection : nil }
                .sensoryFeedback(.impact(weight: .light), trigger: drops)
        } else {
            content
        }
    }
}
