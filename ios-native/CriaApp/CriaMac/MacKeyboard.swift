import AppKit
import CriaKit
import SwiftUI

/// Single-key and two-key shortcuts from the desktop app (`src/lib/shortcuts.ts`). A key-down monitor rather than
/// SwiftUI focus: nothing has to hold focus for them to work, and the sidebar's type-to-select never sees them. Keys
/// are left alone while a text field or text view is being typed in, while a sheet is up, and with any modifier held.
/// `g` and the dots wait one second for the rest of their sequence.
@MainActor
final class KeySequencer {
    private enum Pending: Equatable { case goTo, dots(Int) }

    private var pending: Pending?
    private var timeout: Task<Void, Never>?
    private var monitor: Any?
    private var services: AppServices?
    private weak var actions: MacActions?
    /// The shell's own window: with two windows open, each shell answers only its own keys.
    weak var window: NSWindow?

    func install(actions: MacActions, services: AppServices) {
        self.actions = actions
        self.services = services
        guard monitor == nil else { return }
        // AppKit calls local monitors on the main thread.
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let consumed = MainActor.assumeIsolated { self?.consume(event) ?? false }
            return consumed ? nil : event
        }
    }

    func remove() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        stopWaiting()
    }

    private func consume(_ event: NSEvent) -> Bool {
        accepts(event) && handle(event)
    }

    private func accepts(_ event: NSEvent) -> Bool {
        guard let window = event.window, window === self.window, window.isKeyWindow, window.attachedSheet == nil else { return false }
        let held = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
        // `?` (shortcuts help) is typed with Shift; every other key here takes no modifier.
        guard held.isEmpty || (held == .shift && event.charactersIgnoringModifiers == "?") else { return false }
        // Typing: the field editor and every text view are NSText.
        return !(window.firstResponder is NSText)
    }

    private func handle(_ event: NSEvent) -> Bool {
        guard let actions else { return false }
        switch event.keyCode {
        case 36, 76: return actions.openFocused()
        case 51: return actions.hasOpenTask ? run(.delete, actions) : false
        default: break
        }
        guard let key = event.charactersIgnoringModifiers, key.count == 1 else { return false }
        if case .dots(let count)? = pending {
            if key == "." { return dot(count + 1, actions) }
            fireDots(count, actions)
        }
        if pending == .goTo {
            stopWaiting()
            return second(key, actions)
        }
        return first(key, actions)
    }

    private func first(_ key: String, _ actions: MacActions) -> Bool {
        switch key {
        case "g":
            wait(for: .goTo)
            return true
        case "?":
            actions.showingShortcuts = true
            return true
        case "j": return actions.moveFocus(1)
        case "k": return actions.moveFocus(-1)
        case ".": return actions.hasOpenTask ? dot(1, actions) : false
        case "t": return run(.done, actions)
        case "d": return run(.due, actions)
        case "p": return run(.priority, actions)
        case "l": return run(.labels, actions)
        case "m": return run(.move, actions)
        case "s": return run(.favourite, actions)
        case "a": return run(.assign, actions)
        case "c": return run(.colour, actions)
        case "u":
            guard let services else { return false }
            return actions.goToOpenTasksProject(services: services)
        default: return false
        }
    }

    private func second(_ key: String, _ actions: MacActions) -> Bool {
        switch key {
        case "o": actions.go(.today)
        case "u": actions.go(.upcoming)
        case "l": actions.projectView("list")
        case "k": actions.projectView("kanban")
        case "t": actions.projectView("table")
        case "g": actions.projectView("gantt")
        case "a": actions.sidebar.showingLabels = true
        case "m": actions.sidebar.showingTeams = true
        default: return false
        }
        return true
    }

    /// `.`, `..` and `...`: three dots copy at once; fewer wait to see whether another follows.
    private func dot(_ count: Int, _ actions: MacActions) -> Bool {
        stopWaiting()
        if count >= 3 {
            fireDots(3, actions)
        } else {
            wait(for: .dots(count))
        }
        return true
    }

    private func fireDots(_ count: Int, _ actions: MacActions) {
        stopWaiting()
        switch count {
        case 1: actions.task(TaskShortcut.copyIdentifier)
        case 2: actions.task(TaskShortcut.copyIdentifierTitle)
        default: actions.task(TaskShortcut.copyIdentifierTitleLink)
        }
    }

    private func wait(for state: Pending) {
        pending = state
        timeout?.cancel()
        timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled, let self else { return }
            if case .dots(let count)? = self.pending, let actions = self.actions {
                self.fireDots(count, actions)
            } else {
                self.pending = nil
            }
        }
    }

    private func run(_ command: TaskCommand, _ actions: MacActions) -> Bool {
        guard actions.hasOpenTask else { return false }
        actions.task(command)
        return true
    }

    private func run(_ shortcut: TaskShortcut, _ actions: MacActions) -> Bool {
        guard actions.hasOpenTask else { return false }
        actions.task(shortcut)
        return true
    }

    private func stopWaiting() {
        pending = nil
        timeout?.cancel()
        timeout = nil
    }
}

/// Reports the window a SwiftUI view is in, for `KeySequencer`.
struct HostWindowReader: NSViewRepresentable {
    let onWindow: @MainActor (NSWindow?) -> Void

    func makeNSView(context: Context) -> WindowTrackingView {
        let view = WindowTrackingView()
        view.onWindow = onWindow
        return view
    }

    func updateNSView(_ view: WindowTrackingView, context: Context) {}
}

final class WindowTrackingView: NSView {
    var onWindow: (@MainActor (NSWindow?) -> Void)?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        onWindow?(window)
    }
}
