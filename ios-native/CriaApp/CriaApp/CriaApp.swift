import CriaKit
import SwiftUI

@main
struct CriaApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .task { await model.start() }
                .onChange(of: scenePhase) { _, phase in
                    Task { await model.setSyncActive(phase == .active) }
                }
        }
    }
}

struct RootView: View {
    let model: AppModel
    @State private var preferences = PreferencesStore().load()

    var body: some View {
        content
            .preferredColorScheme(Self.scheme(preferences.colorScheme))
            .onReceive(NotificationCenter.default.publisher(for: .criaPreferencesChanged)) { _ in
                preferences = PreferencesStore().load()
            }
    }

    private static func scheme(_ preference: ColorSchemePreference) -> ColorScheme? {
        switch preference {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.status {
        case .unknown:
            ProgressView()
        case .unauthenticated:
            NavigationStack { LoginView(model: model.makeLoginModel()) }
        case .authenticated:
            if let services = model.services {
                ShellView(services: services) { wipe in Task { await model.signOut(wipeLocalData: wipe) } }
                    .task { await ReminderScheduler.run(store: services.store) }
            } else if let error = model.startupError {
                Text(error).padding()
            } else {
                ProgressView()
            }
        }
    }
}
