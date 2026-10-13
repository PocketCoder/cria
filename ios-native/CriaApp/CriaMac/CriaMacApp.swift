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
    }

    var body: some Scene {
        WindowGroup(id: "main") {
            MacRootView(model: model)
                .tint(Color(.primary))
                .task { await model.start() }
                // One task per phase change, the previous one cancelled, so "inactive" can never land after "active".
                .task(id: scenePhase) { await model.setSyncActive(scenePhase == .active) }
        }
        .defaultSize(width: 1100, height: 720)
        .commands { MacCommands() }
        MenuBarExtra("Cria", systemImage: "checkmark.circle", isInserted: $showMenuBar) {
            MacMenuBarContent(model: model)
        }
        .menuBarExtraStyle(.window)
        Settings {
            MacSettingsScene(model: model).tint(Color(.primary))
        }
    }
}
