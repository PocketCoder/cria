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

/// Finding and raising the main window, and quick add requests that arrive while no window exists.
@MainActor
enum MacWindows {
    /// Set when quick add was asked for with no window open; the next shell to appear shows it.
    static var quickAddPending = false

    /// True when a window already existed and was brought forward.
    @discardableResult
    static func showMain() -> Bool {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.canBecomeMain && !$0.isMiniaturized && $0.isVisible })
            ?? NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
            return true
        }
        // The WindowGroup has no window (closed to the menu bar): ask for a new one.
        NSApp.sendAction(Selector(("newWindowForTab:")), to: nil, from: nil)
        return false
    }

    static func requestQuickAdd() {
        if showMain() {
            NotificationCenter.default.post(name: .criaQuickAdd, object: nil)
        } else {
            quickAddPending = true
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
        let hide = UserDefaults.standard.bool(forKey: MacPrefs.hideDock)
        let hasWindow = NSApp.windows.contains { $0.isVisible && $0.canBecomeMain }
        let wanted: NSApplication.ActivationPolicy = hide && !hasWindow ? .accessory : .regular
        if NSApp.activationPolicy() != wanted { NSApp.setActivationPolicy(wanted) }
    }
}

/// The "Mac" tab of the Settings window.
struct MacSettingsView: View {
    @AppStorage(MacPrefs.menuBar) private var menuBar = true
    @AppStorage(MacPrefs.closeToMenuBar) private var closeToMenuBar = true
    @AppStorage(MacPrefs.hideDock) private var hideDock = false
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?

    var body: some View {
        Form {
            Section("Menu bar") {
                Toggle("Show in menu bar", isOn: $menuBar)
                Toggle("Keep running in the menu bar when the window is closed", isOn: $closeToMenuBar)
                Toggle("Hide the Dock icon while no window is open", isOn: $hideDock)
            }
            Section("Quick add") {
                KeyboardShortcuts.Recorder("Global shortcut", name: .quickAdd)
            }
            Section("Startup") {
                Toggle("Open Cria at login", isOn: Binding(get: { launchAtLogin }, set: setLaunchAtLogin))
                if let loginError { Text(loginError).foregroundStyle(.red).font(.caption) }
            }
        }
        .formStyle(.grouped)
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = nil
        } catch {
            loginError = String(describing: error)
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }
}
