import CriaKit
import SwiftUI

struct MacRootView: View {
    let model: MacAppModel

    var body: some View {
        switch model.status {
        case .unknown:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .unauthenticated:
            MacLoginView(model: model.makeLoginModel()).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .authenticated:
            if let services = model.services {
                MacShellView(services: services, onSignOut: { Task { await model.signOut() } })
            } else if let error = model.startupError {
                Text(error).padding()
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
