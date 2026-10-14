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
                // Safety net: never spin forever on a stalled credential read.
                .task {
                    try? await Task.sleep(nanoseconds: 10_000_000_000)
                    model.leaveSpinnerIfStuck()
                }
        case .unauthenticated:
            NavigationStack { LoginView(model: model.makeLoginModel()) }
                .safeAreaInset(edge: .bottom) { DesktopSignInOffer(model: model) }
                .task { MacBackground.shared.stop() }
        case .authenticated:
            if let services = model.services {
                MacShellView(
                    services: services,
                    onSignOut: { wipe in Task { await model.signOut(wipeLocalData: wipe) } },
                    pendingURL: Binding(get: { model.pendingURL }, set: { model.pendingURL = $0 })
                )
                // Not tied to this window: see `MacBackground`.
                .task { MacBackground.shared.start(services) }
            } else if let error = model.startupError {
                StartupProblem(message: error, model: model)
            } else {
                StartingServices(model: model)
            }
        }
    }
}

/// Opening the database and services. After 10 seconds it offers a Retry instead of spinning on its own.
private struct StartingServices: View {
    let model: AppModel
    @State private var stalled = false

    var body: some View {
        Group {
            if stalled {
                StartupProblem(message: "Cria is taking longer than expected to open its data.", model: model)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            launchLog.error("services: still starting after the grace period")
            stalled = true
        }
    }
}

private struct StartupProblem: View {
    let message: String
    let model: AppModel

    var body: some View {
        VStack(spacing: 12) {
            Text(message).multilineTextAlignment(.center)
            Button("Retry") { Task { await model.retryStartup() } }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Under the sign-in form: adopt the Tauri desktop app's stored sign-in, only when the user asks. The Keychain may show
/// an access prompt for the other app's item; the read runs off the main actor with a timeout.
private struct DesktopSignInOffer: View {
    let model: AppModel
    @State private var isWorking = false
    @State private var message: String?

    var body: some View {
        if model.legacyImport.isAvailable || message != nil {
            VStack(spacing: 6) {
                if model.legacyImport.isAvailable {
                    Button {
                        isWorking = true
                        message = nil
                        Task {
                            message = await model.adoptDesktopSignIn()
                            isWorking = false
                        }
                    } label: {
                        if isWorking { ProgressView().controlSize(.small) } else { Text("Use my Cria desktop sign-in") }
                    }
                    .disabled(isWorking)
                }
                if let message { Text(message).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center) }
            }
            .padding()
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
