import CriaKit
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
    /// The row `j`/`k` have moved to; Return opens it. Clicking a row moves it there too.
    var focusedId: String?
    /// The list on screen, in order, as `publishesTaskOrder` reports it.
    var visibleIds: [String] = []
}

extension View {
    /// Mac: hands the list's rows, in order, to the shell for `j`/`k`, and scrolls the keyboard focus into view. The
    /// ids are only worked out on the Mac; on iOS this returns the view untouched.
    @ViewBuilder
    func publishesTaskOrder(_ ids: @autoclosure () -> [String]) -> some View {
        #if os(macOS)
        modifier(TaskOrderPublisher(ids: ids()))
        #else
        self
        #endif
    }
}

#if os(macOS)
private struct TaskOrderPublisher: ViewModifier {
    let ids: [String]
    @Environment(\.openTaskState) private var state

    func body(content: Content) -> some View {
        ScrollViewReader { proxy in
            content
                .onChange(of: ids, initial: true) { _, ids in state?.visibleIds = ids }
                .onChange(of: state?.focusedId) { _, id in
                    if let id { withAnimation(.snappy(duration: 0.2)) { proxy.scrollTo(id) } }
                }
        }
    }
}
#endif

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
    case done, due, priority, labels, move, favourite, copyLink, subscribe, delete
}

/// The desktop app's other task keys (`a`, `c`, `.`, `..`, `...`), carried out by `TaskCommandHandler` itself.
/// Posted with the same notification as `TaskCommand`.
enum TaskShortcut: String, Sendable {
    case assign, colour, copyIdentifier, copyIdentifierTitle, copyIdentifierTitleLink

    /// What the copy keys put on the clipboard: the server's identifier ("PROJ-42", or the title before the first
    /// sync), then the title, then the link, as in `TaskDetail.tsx`.
    func copiedText(_ task: TaskRecord, link: URL?) -> String? {
        let identifier = task.identifier ?? task.title
        switch self {
        case .copyIdentifier: return identifier
        case .copyIdentifierTitle: return "\(identifier) \(task.title)"
        case .copyIdentifierTitleLink:
            return "\(identifier) \(task.title) \(link?.absoluteString ?? "")".trimmingCharacters(in: .whitespaces)
        case .assign, .colour: return nil
        }
    }
}

extension Notification.Name {
    /// `object` is a `TaskCommand` raw value; `userInfo["task"]` is the task local id it is for.
    static let criaTaskCommand = Notification.Name("io.cria.taskCommand")
    /// `object` is a view kind: list, gantt, table or kanban.
    static let criaProjectViewCommand = Notification.Name("io.cria.projectViewCommand")
}
