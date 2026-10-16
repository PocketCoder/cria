import Observation
import SwiftUI

/// What the Mac shell hands to the shared screens. All of it is inert on iOS: nothing sets the opener or posts the
/// commands there.
private struct TaskOpenerKey: EnvironmentKey {
    static var defaultValue: (@MainActor (String) -> Void)? { nil }
}

extension EnvironmentValues {
    /// When set, a task row selects the task through this (the Mac's detail column) instead of pushing it.
    var taskOpener: (@MainActor (String) -> Void)? {
        get { self[TaskOpenerKey.self] }
        set { self[TaskOpenerKey.self] = newValue }
    }
}

/// The task open in the Mac's task panel. An object rather than a plain id in the environment: only the small highlight
/// behind each row reads `id`, so opening a task redraws those highlights and not every row in the list.
@MainActor @Observable
final class OpenTaskState {
    var id: String?
}

private struct OpenTaskStateKey: EnvironmentKey {
    static var defaultValue: OpenTaskState? { nil }
}

extension EnvironmentValues {
    /// Set by the Mac shell, so the open task's row can show as selected.
    var openTaskState: OpenTaskState? {
        get { self[OpenTaskStateKey.self] }
        set { self[OpenTaskStateKey.self] = newValue }
    }
}

private struct TaskCloserKey: EnvironmentKey {
    static var defaultValue: (@MainActor () -> Void)? { nil }
}

extension EnvironmentValues {
    /// Closes the open task in the Mac's detail column (after a delete there is nothing to pop, so `dismiss` does nothing).
    var taskCloser: (@MainActor () -> Void)? {
        get { self[TaskCloserKey.self] }
        set { self[TaskCloserKey.self] = newValue }
    }
}

/// Menu-bar and keyboard commands for the open task, posted by the Mac shell and carried out by `TaskDetailView`.
enum TaskCommand: String, Sendable {
    case done, due, priority, labels, move, favourite, copyLink, delete
}

extension Notification.Name {
    /// `object` is a `TaskCommand` raw value; `userInfo["task"]` is the task local id it is for.
    static let criaTaskCommand = Notification.Name("io.cria.taskCommand")
    /// `object` is a view kind: list, gantt, table or kanban.
    static let criaProjectViewCommand = Notification.Name("io.cria.projectViewCommand")
}
