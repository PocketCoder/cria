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

private struct SelectedTaskKey: EnvironmentKey {
    static var defaultValue: String? { nil }
}

extension EnvironmentValues {
    /// The task open in the Mac's detail column, so its row can show as selected.
    var selectedTaskId: String? {
        get { self[SelectedTaskKey.self] }
        set { self[SelectedTaskKey.self] = newValue }
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
