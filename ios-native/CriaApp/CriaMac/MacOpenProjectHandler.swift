import SwiftUI

/// Shows the project the inspector's breadcrumb names (`criaOpenProject`, object: the project's local id).
struct MacOpenProjectHandler: ViewModifier {
    let actions: MacActions

    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: .criaOpenProject)) { note in
            guard let projectLocalId = note.object as? String else { return }
            actions.go(.project(projectLocalId))
        }
    }
}
