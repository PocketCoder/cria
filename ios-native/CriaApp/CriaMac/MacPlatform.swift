import AppKit
import CriaKit
import KeyboardShortcuts
import ServiceManagement
import SwiftUI

/// The Mac-only preferences, stored in `UserDefaults`. Defaults follow the Tauri app's `trayIconEnabled` (on),
/// `closeToTray` (on) and `hideDockOnTray` (off).
enum MacPrefs {
    static let menuBar = "cria.mac.menuBarExtra"
    static let closeToMenuBar = "cria.mac.closeToMenuBar"
    static let hideDock = "cria.mac.hideDockIcon"

    static func registerDefaults() {
        UserDefaults.standard.register(defaults: [menuBar: true, closeToMenuBar: true, hideDock: false])
    }
}

extension KeyboardShortcuts.Name {
    /// The Tauri app's global shortcut: ⌘⇧A.
    static let quickAdd = Self("quickAdd", default: .init(.a, modifiers: [.command, .shift]))
}

extension Notification.Name {
    /// Asks the open window to show quick add (the global hotkey and the menu bar).
    static let criaQuickAdd = Notification.Name("io.cria.mac.quickAdd")
}

/// The reminder and summary schedulers and the Spotlight and widget refresh. They belong to the signed-in session, not
/// to the window: with the window closed to the menu bar, a pull that changes a reminder must still reschedule it.
@MainActor
final class MacBackground {
    static let shared = MacBackground()
    private var running: ObjectIdentifier?
    private var tasks: [Task<Void, Never>] = []

    func start(_ services: AppServices) {
        guard running != ObjectIdentifier(services) else { return }
        stop()
        running = ObjectIdentifier(services)
        let store = services.store
        tasks = [
            Task { await SyncSideEffects.run(services: services) },
            Task { await ReminderScheduler.run(store: store) },
            Task { await SummaryScheduler.run(store: store) },
            Task { await DockBadge.run(store: store) }
        ]
    }

    func stop() {
        tasks.forEach { $0.cancel() }
        tasks = []
        running = nil
        DockBadge.show(0)
    }
}

/// The Dock icon's count: open tasks overdue or due today, as the desktop app's badge (`src/queries/badge.ts`). It
/// follows task and project changes, and re-reads when the day turns over so yesterday's "today" is not left behind.
enum DockBadge {
    static func run(store: CriaStore) async {
        async let changes: Void = follow(store)
        async let midnight: Void = followDay(store)
        _ = await (changes, midnight)
    }

    @MainActor
    static func show(_ count: Int) {
        NSApp.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
    }

    private static func follow(_ store: CriaStore) async {
        for await open in observeStore(store, kinds: [.tasks, .projects], read: { try openToday($0) }) {
            await show(open)
        }
    }

    private static func followDay(_ store: CriaStore) async {
        var day = Calendar.cria.startOfDay(for: Date())
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            let today = Calendar.cria.startOfDay(for: Date())
            guard today != day else { continue }
            day = today
            if let open = try? openToday(store) { await show(open) }
        }
    }

    private static func openToday(_ store: CriaStore) throws -> Int {
        try store.smartGroups(.today).reduce(0) { $0 + $1.items.count }
    }
}

/// Finding and raising the main window. With no window (closed to the menu bar) it opens a `cria://` link, which makes
/// the WindowGroup create one and hands the link to its shell: no private AppKit selector, and exactly one window.
@MainActor
enum MacWindows {
    /// The main window, not the Settings window or a panel such as the menu bar popover.
    private static var mainWindow: NSWindow? {
        let candidates = NSApp.windows.filter { window in
            guard window.canBecomeMain, !(window is NSPanel) else { return false }
            return !(window.identifier?.rawValue.localizedCaseInsensitiveContains("settings") ?? false)
        }
        return candidates.first { $0.isVisible && !$0.isMiniaturized } ?? candidates.first { $0.isMiniaturized }
    }

    /// Brings the main window forward, or opens `link` (which creates a window) when there is none.
    static func showMain(opening link: String = "cria://today") {
        NSApp.activate(ignoringOtherApps: true)
        if let window = mainWindow {
            window.makeKeyAndOrderFront(nil)
        } else if let url = URL(string: link) {
            NSWorkspace.shared.open(url)
        }
    }

    static func requestQuickAdd() {
        if mainWindow != nil {
            // The shell opens the floating quick-add panel, which activates the app itself; the window stays put.
            NotificationCenter.default.post(name: .criaQuickAdd, object: nil)
        } else {
            // A new window shows quick add for this link, as for any cria://add link.
            showMain(opening: "cria://add")
        }
    }
}

/// Close to the menu bar, hiding the Dock icon while no window is open, and the global quick-add hotkey.
@MainActor
final class MacAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        MacPrefs.registerDefaults()
        KeyboardShortcuts.onKeyUp(for: .quickAdd) {
            Task { @MainActor in MacWindows.requestQuickAdd() }
        }
        let center = NotificationCenter.default
        center.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { [weak self] _ in
            // After the window has gone, not while it is closing.
            Task { @MainActor in self?.updateActivationPolicy() }
        }
        center.addObserver(forName: NSWindow.didBecomeMainNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.updateActivationPolicy() }
        }
    }

    /// Keeps running in the menu bar when the last window closes, unless Settings says to quit.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        !UserDefaults.standard.bool(forKey: MacPrefs.closeToMenuBar)
    }

    private func updateActivationPolicy() {
        MacActivation.update()
    }
}

/// Dock icon visibility: hidden while no window is open when "Hide the Dock icon" is on.
@MainActor
enum MacActivation {
    static func update() {
        let hide = UserDefaults.standard.bool(forKey: MacPrefs.hideDock)
        let hasWindow = NSApp.windows.contains { $0.isVisible && $0.canBecomeMain }
        let wanted: NSApplication.ActivationPolicy = hide && !hasWindow ? .accessory : .regular
        if NSApp.activationPolicy() != wanted { NSApp.setActivationPolicy(wanted) }
    }
}

/// The Mac-only rows of the Settings window's General tab, as sections for the pane's grouped form.
struct MacSettingsView: View {
    @AppStorage(MacPrefs.menuBar) private var menuBar = true
    @AppStorage(MacPrefs.closeToMenuBar) private var closeToMenuBar = true
    @AppStorage(MacPrefs.hideDock) private var hideDock = false
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?

    var body: some View {
        Section("Startup") {
            Toggle("Open Cria at login", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { _, enabled in setLaunchAtLogin(enabled) }
            if let loginError { Text(loginError).foregroundStyle(Color(.destructive)).font(Theme.caption) }
        }
        Section {
            Toggle("Show Cria in the menu bar", isOn: $menuBar)
            Toggle("Keep running when the window closes", isOn: $closeToMenuBar)
            Toggle("Hide Dock icon while the window is closed", isOn: $hideDock)
                .onChange(of: hideDock) { MacActivation.update() }
        } header: {
            Text("Menu bar and Dock")
        } footer: {
            Text("Today\u{2019}s tasks and New Task, one click away.").font(Theme.caption)
        }
        Section {
            KeyboardShortcuts.Recorder("Global shortcut", name: .quickAdd)
        } header: {
            Text("Quick add")
        } footer: {
            Text("Opens New Task from any app.").font(Theme.caption)
        }
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        // Already what the system has (this also runs after the toggle snaps back from a failure).
        guard enabled != (SMAppService.mainApp.status == .enabled) else { return }
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = nil
        } catch {
            loginError = String(describing: error)
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }
}
