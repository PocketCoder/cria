import Foundation
import GRDB

/// One person assigned to a task.
public struct AssigneeRecord: Equatable, Sendable, Identifiable {
    public let userId: Int
    public let username: String?
    /// The person's display name when one has been seen (pull or user search); nil falls back to the username.
    public let displayName: String?
    public var id: Int { userId }

    public init(userId: Int, username: String?, displayName: String? = nil) {
        self.userId = userId
        self.username = username
        self.displayName = displayName
    }
}

/// Display names of people seen in assignee lists and user searches. The assignee table (shared with the desktop
/// schema) keeps only the username, so names live here, on this device, keyed by user id.
public final class UserNameDirectory: @unchecked Sendable {
    public static let shared = UserNameDirectory()
    private static let key = "cria.userNames"
    private let lock = NSLock()
    private var names: [Int: String]
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.dictionary(forKey: Self.key) as? [String: String] ?? [:]
        names = Dictionary(uniqueKeysWithValues: stored.compactMap { key, value in Int(key).map { ($0, value) } })
    }

    public func name(for userId: Int) -> String? {
        lock.withLock { names[userId] }
    }

    func remember(_ pairs: [(Int, String?)]) {
        let changed: [String: String]? = lock.withLock {
            var dirty = false
            for (id, name) in pairs {
                guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty, names[id] != name else { continue }
                names[id] = name
                dirty = true
            }
            return dirty ? Dictionary(uniqueKeysWithValues: names.map { (String($0.key), $0.value) }) : nil
        }
        if let changed { defaults.set(changed, forKey: Self.key) }
    }
}

extension CriaStore {
    /// The task's assignees, by name.
    public func assignees(forTask taskLocalId: String) throws -> [AssigneeRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT user_server_id, username FROM task_assignees
                 WHERE task_local_id = ? AND deleted = 0
                 ORDER BY username COLLATE NOCASE ASC, user_server_id ASC
                """, arguments: [taskLocalId]).map {
                let userId: Int = $0["user_server_id"]
                return AssigneeRecord(userId: userId, username: $0["username"], displayName: UserNameDirectory.shared.name(for: userId))
            }
        }
    }

    /// User mutation: assigns a user (from a user search) and queues the add.
    public func addAssignee(taskLocalId: String, userId: Int, username: String) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(sql: """
                INSERT OR REPLACE INTO task_assignees (task_local_id, user_server_id, username, updated_at, synced_at, dirty, deleted)
                VALUES (?, ?, ?, ?, NULL, 1, 0)
                """, arguments: [taskLocalId, userId, username, now])
            try connection.enqueue(
                .taskAssignee, localId: taskLocalId, operation: .add,
                payload: ["task_local_id": taskLocalId, "user_server_id": userId], at: now
            )
        }
    }

    /// User mutation: unassigns and queues the removal.
    public func removeAssignee(taskLocalId: String, userId: Int) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "DELETE FROM task_assignees WHERE task_local_id = ? AND user_server_id = ?", arguments: [taskLocalId, userId]
            )
            try connection.enqueue(
                .taskAssignee, localId: taskLocalId, operation: .remove,
                payload: ["task_local_id": taskLocalId, "user_server_id": userId], at: now
            )
        }
    }
}
