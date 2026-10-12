import CoreSpotlight
import CriaKit
import SwiftUI
import UserNotifications

@main
struct CriaApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Theme.applyNavigationAppearance()
        // Before launch finishes, so a tap on a notification that started the app is delivered.
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .tint(Color(.primary))
                .task { await model.start() }
                // One task per phase change, the previous one cancelled, so "inactive" can never land after "active".
                .task(id: scenePhase) {
                    // iOS kills a suspended app that holds a lock on a file in the shared container.
                    if scenePhase == .background { CriaDatabase.suspend() } else { CriaDatabase.resume() }
                    await model.setSyncActive(scenePhase == .active)
                    // Sync pulls do not notify the store, so recount the summary notifications on foreground.
                    if scenePhase == .active { NotificationCenter.default.post(name: .criaRefreshSchedules, object: nil) }
                }
        }
    }
}

struct RootView: View {
    let model: AppModel
    @State private var preferences = PreferencesStore().load()

    var body: some View {
        content
            .onOpenURL { model.pendingURL = $0 }
            .onChange(of: NotificationRouter.shared.pendingURL, initial: true) { _, url in
                guard let url else { return }
                NotificationRouter.shared.pendingURL = nil
                model.pendingURL = url
            }
            .onContinueUserActivity(CSSearchableItemActionType) { activity in
                let key = CSSearchableItemActivityIdentifier
                if let identifier = activity.userInfo?[key] as? String {
                    model.pendingURL = DeepLink.taskURL(localId: identifier)
                }
            }
            .alert("Could not delete local data", isPresented: Binding(
                get: { model.wipeError != nil },
                set: { if !$0 { model.dismissWipeError() } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.wipeError ?? "")
            }
            .preferredColorScheme(Self.scheme(preferences.colorScheme))
            .environment(\.dateDisplay, DateDisplay(dateFormat: preferences.dateFormat, timeFormat: preferences.timeFormat))
            .environment(\.playsCompletionSound, preferences.playSoundWhenDone)
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
                ShellView(
                    services: services,
                    onSignOut: { wipe in Task { await model.signOut(wipeLocalData: wipe) } },
                    pendingURL: Binding(get: { model.pendingURL }, set: { model.pendingURL = $0 })
                )
                .task { await ReminderScheduler.run(store: services.store) }
                .task { await SummaryScheduler.run(store: services.store) }
                .task { await SyncSideEffects.run(services: services) }
            } else if let error = model.startupError {
                Text(error).padding()
            } else {
                ProgressView()
            }
        }
    }
}
