import CriaKit
import SwiftUI

/// The preference environment the iOS `RootView` provides: date and time format, completion sound, and the custom
/// rules the parsers read. Applied to the window and to the Settings window alike.
struct MacPreferenceEnvironment: ViewModifier {
    @State private var preferences = PreferencesStore().load()

    func body(content: Content) -> some View {
        content
            .environment(\.dateDisplay, DateDisplay(dateFormat: preferences.dateFormat, timeFormat: preferences.timeFormat))
            .environment(\.playsCompletionSound, preferences.playSoundWhenDone)
            .environment(\.preferences, preferences)
            .onChange(of: preferences.custom.rules, initial: true) { _, rules in CriaRules.current = rules }
            .onReceive(NotificationCenter.default.publisher(for: .criaPreferencesChanged)) { _ in
                preferences = PreferencesStore().load()
            }
    }
}

/// Signed out: the shared sign-in screen. Signed in: the Mac shell.
struct MacRootView: View {
    let model: AppModel

    var body: some View {
        content
            .modifier(MacPreferenceEnvironment())
            .onOpenURL { model.pendingURL = $0 }
            // A tapped notification becomes a link the shell opens.
            .onChange(of: NotificationRouter.shared.pendingURL, initial: true) { _, url in
                guard let url else { return }
                NotificationRouter.shared.pendingURL = nil
                model.pendingURL = url
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
                MacShellView(
                    services: services,
                    onSignOut: { wipe in Task { await model.signOut(wipeLocalData: wipe) } },
                    pendingURL: Binding(get: { model.pendingURL }, set: { model.pendingURL = $0 })
                )
                .task { await SyncSideEffects.run(services: services) }
                .task { await ReminderScheduler.run(store: services.store) }
                .task { await SummaryScheduler.run(store: services.store) }
            } else if let error = model.startupError {
                Text(error).padding()
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

/// The ⌘, window: the shared settings screens.
struct MacSettingsScene: View {
    let model: AppModel

    var body: some View {
        TabView {
            Group {
                if let services = model.services {
                    SettingsView(services: services) { wipe in Task { await model.signOut(wipeLocalData: wipe) } }
                } else {
                    Text("Sign in to change settings.").foregroundStyle(.secondary).padding(40)
                }
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            MacSettingsView()
                .tabItem { Label("Mac", systemImage: "desktopcomputer") }
        }
        .frame(width: 560, height: 640)
        .modifier(MacPreferenceEnvironment())
    }
}
