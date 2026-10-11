import CriaKit
import SwiftUI

@main
struct CriaApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .task { await model.start() }
        }
    }
}

struct RootView: View {
    let model: AppModel

    var body: some View {
        switch model.status {
        case .unknown:
            ProgressView()
        case .unauthenticated:
            NavigationStack { LoginView(model: model.makeLoginModel()) }
        case .authenticated(let credentials):
            // Core screens arrive in Phase 4.
            VStack(spacing: 12) {
                Text("Signed in to \(credentials.serverURL)")
                Button("Sign out") { Task { await model.signOut() } }
            }
            .padding()
        }
    }
}
