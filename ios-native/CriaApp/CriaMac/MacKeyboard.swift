import SwiftUI

/// Single-key and two-key shortcuts (`g o`, `t`, `d`, ...) from the desktop app. Plain keys only: a text field that
/// has focus takes its keys first, so typing never triggers these. A `g` waits one second for its second key.
@MainActor
final class KeySequencer {
    private var waitingForSecondKey = false
    private var timeout: Task<Void, Never>?

    func handle(_ press: KeyPress, actions: MacActions) -> KeyPress.Result {
        guard press.modifiers.isEmpty else { return .ignored }
        if press.key == .delete { return actions.hasOpenTask ? run(.delete, actions) : .ignored }
        if waitingForSecondKey {
            stopWaiting()
            return second(press.characters, actions)
        }
        switch press.characters {
        case "g":
            waitingForSecondKey = true
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(1))
                if !Task.isCancelled { self?.waitingForSecondKey = false }
            }
            return .handled
        case "t": return run(.done, actions)
        case "d": return run(.due, actions)
        case "p": return run(.priority, actions)
        case "l": return run(.labels, actions)
        case "m": return run(.move, actions)
        case "s": return run(.favourite, actions)
        default: return .ignored
        }
    }

    private func second(_ key: String, _ actions: MacActions) -> KeyPress.Result {
        switch key {
        case "o": actions.go(.today)
        case "u": actions.go(.upcoming)
        case "l": actions.projectView("list")
        case "k": actions.projectView("kanban")
        case "t": actions.projectView("table")
        case "g": actions.projectView("gantt")
        default: return .ignored
        }
        return .handled
    }

    private func run(_ command: TaskCommand, _ actions: MacActions) -> KeyPress.Result {
        guard actions.hasOpenTask else { return .ignored }
        actions.task(command)
        return .handled
    }

    private func stopWaiting() {
        waitingForSecondKey = false
        timeout?.cancel()
    }
}
