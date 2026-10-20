import AppKit
import CriaKit

/// What the task keys and the Task menu act on: the task open in the inspector, else the row `j`/`k` selected. The
/// open task's detail carries the command out (`TaskCommandHandler`); a selected task that is not open gets the
/// commands that need no picker straight from here.
extension MacActions {
    var commandTarget: String? {
        if let openTaskId { return openTaskId }
        guard let id = selectedTaskId, panel.visibleIds.contains(id) else { return nil }
        return id
    }

    var hasCommandTarget: Bool { commandTarget != nil }

    /// False when there is no task to act on, or the command needs the open task's pickers.
    @discardableResult
    func task(_ command: TaskCommand) -> Bool {
        guard let id = commandTarget else { return false }
        if id == openTaskId {
            post(command.rawValue, to: id)
            return true
        }
        guard let services, let task = try? services.store.task(localId: id) else { return false }
        switch command {
        case .done: return update(id, TaskPatch(done: !task.done), services)
        case .favourite: return update(id, TaskPatch(isFavorite: !task.isFavorite), services)
        case .delete:
            if let undo {
                try? undo.deleteTask(localId: id, title: task.title)
            } else {
                try? services.store.deleteTask(localId: id)
            }
            return true
        case .copyLink:
            guard let url = services.taskWebURL(task) else { return false }
            return copy(url.absoluteString)
        case .subscribe:
            Task { try? await services.setTaskSubscribed(localId: id, subscribed: !task.isSubscribed) }
            return true
        // The Due, Priority, Labels and Move pickers belong to the open task's detail.
        case .due, .priority, .labels, .move: return false
        }
    }

    @discardableResult
    func task(_ shortcut: TaskShortcut) -> Bool {
        guard let id = commandTarget else { return false }
        if id == openTaskId {
            post(shortcut.rawValue, to: id)
            return true
        }
        guard let services, let task = try? services.store.task(localId: id),
              let text = shortcut.copiedText(task, link: services.taskWebURL(task)) else { return false }
        return copy(text)
    }

    /// Task > Duplicate: copies the target and opens the copy.
    func duplicateTarget() {
        guard let id = commandTarget, let copy = try? services?.store.duplicateTask(localId: id) else { return }
        openTask(copy.localId)
    }

    private func post(_ raw: String, to id: String) {
        NotificationCenter.default.post(name: .criaTaskCommand, object: raw, userInfo: ["task": id])
    }

    private func update(_ id: String, _ patch: TaskPatch, _ services: AppServices) -> Bool {
        (try? undo.updateTask(services, localId: id, patch: patch)) != nil
    }

    private func copy(_ text: String) -> Bool {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        return true
    }
}
