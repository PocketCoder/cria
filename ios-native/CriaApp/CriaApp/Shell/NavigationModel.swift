import CriaKit
import Observation
import SwiftUI

@MainActor @Observable
final class NavigationModel {
    var state = NavigationState()

    func pathBinding(for tab: AppTab) -> Binding<[Route]> {
        Binding(
            get: { self.state.path(for: tab) },
            set: { self.state.setPath($0, for: tab) }
        )
    }

    var selection: Binding<AppTab> {
        Binding(get: { self.state.selected }, set: { self.state.selected = $0 })
    }
}
