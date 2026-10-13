import SwiftUI

@main
struct CriaMacApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            MacRootView(model: model)
                .tint(Color(.primary))
                .task { await model.start() }
                // One task per phase change, the previous one cancelled, so "inactive" can never land after "active".
                .task(id: scenePhase) { await model.setSyncActive(scenePhase == .active) }
        }
        .defaultSize(width: 1100, height: 720)
    }
}
