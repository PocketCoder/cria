import CriaKit
import SwiftUI

/// Signed out: the shared sign-in screen. Signed in: the Mac shell, with the same preference environment the iOS
/// `RootView` provides.
struct MacRootView: View {
    let model: AppModel
    @State private var preferences = PreferencesStore().load()

    var body: some View {
        content
            .environment(\.dateDisplay, DateDisplay(dateFormat: preferences.dateFormat, timeFormat: preferences.timeFormat))
            .environment(\.playsCompletionSound, preferences.playSoundWhenDone)
            .environment(\.preferences, preferences)
            .onChange(of: preferences.custom.rules, initial: true) { _, rules in CriaRules.current = rules }
            .onReceive(NotificationCenter.default.publisher(for: .criaPreferencesChanged)) { _ in
                preferences = PreferencesStore().load()
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.status {
        case .unknown:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .unauthenticated:
            NavigationStack { LoginView(model: model.makeLoginModel()) }
        case .authenticated:
            if let services = model.services {
                MacShellView(services: services) { wipe in Task { await model.signOut(wipeLocalData: wipe) } }
                    .task { await SyncSideEffects.run(services: services) }
            } else if let error = model.startupError {
                Text(error).padding()
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
