import Foundation

extension CriaStore {
    /// Stamps the task's subscription state locally. Not an outbox op: `AppServices.setTaskSubscribed` calls the server
    /// first (the Tauri `subscribeToTask` does it online-only too) and the next pull restores the server's answer.
    public func setTaskSubscribed(localId: String, subscribed: Bool) throws {
        try userWrite(announcing: [.tasks]) { connection in
            try connection.execute(
                sql: "UPDATE tasks SET is_subscribed = ? WHERE local_id = ? AND deleted = 0", arguments: [subscribed, localId]
            )
        }
    }
}

extension AppServices {
    /// Subscribes to or unsubscribes from a task. Online only: nothing changes locally unless the server accepted it.
    /// A task that has not been pushed yet has no server id and throws `CriaStoreError.notFound`.
    public func setTaskSubscribed(localId: String, subscribed: Bool) async throws {
        guard let serverId = try store.taskServerId(localId: localId) else { throw CriaStoreError.notFound(localId) }
        if subscribed {
            try await api.subscribe(entity: "task", id: serverId)
        } else {
            try await api.unsubscribe(entity: "task", id: serverId)
        }
        try store.setTaskSubscribed(localId: localId, subscribed: subscribed)
    }
}
