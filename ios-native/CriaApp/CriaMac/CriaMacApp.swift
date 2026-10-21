import SwiftUI
import UserNotifications

@main
struct CriaMacApp: App {
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var delegate
    @State private var model = AppModel()
    @AppStorage(MacPrefs.menuBar) private var showMenuBar = true
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Before launch finishes, so a tap on a notification that started the app is delivered.
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
        NotificationRouter.registerCategories()
        // Starts Sparkle at launch (it only runs when the build has a public key).
        _ = MacUpdater.shared
    }

    var body: some Scene {
        WindowGroup(id: "main") {
            MacRootView(model: model)
                .tint(Color(.primary))
                .task { await model.start() }
                // One task per phase change, the previous one cancelled, so "inactive" can never land after "active".
                // The Mac never pauses the sync (unlike iOS, where it saves battery); a phase change to active pulls.
                .task(id: scenePhase) { await model.keepSyncing(pullNow: scenePhase == .active) }
        }
        .defaultSize(width: 1100, height: 720)
        .commands { MacCommands() }
        MenuBarExtra(
            "Cria", systemImage: "checkmark.circle",
            isInserted: .distinct(get: { showMenuBar }, set: { showMenuBar = $0 })
        ) {
            MacMenuBarContent(model: model)
                .tint(Color(.primary))
                // The completion sound and its tone, as in the window.
                .modifier(MacPreferenceEnvironment())
        }
        .menuBarExtraStyle(.window)
        Settings {
            MacSettingsScene(model: model).tint(Color(.primary))
        }
    }
}
