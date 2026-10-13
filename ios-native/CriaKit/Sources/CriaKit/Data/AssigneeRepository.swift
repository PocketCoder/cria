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

/// Display names and usernames of people seen in assignee lists, task creators and user searches. The schema (shared
/// with the desktop) keeps only an assignee's username, so names live here, on this device, keyed by user id.
public final class UserNameDirectory: @unchecked Sendable {
    public static let shared = UserNameDirectory()
    private static let key = "cria.userNames"
    private static let usernameKey = "cria.usernames"
    private let lock = NSLock()
    private var names: [Int: String]
    private var usernames: [Int: String]
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        names = Self.load(defaults, key: Self.key)
        usernames = Self.load(defaults, key: Self.usernameKey)
    }

    public func name(for userId: Int) -> String? {
        lock.withLock { names[userId] }
    }

    /// The person's username, when one has been seen. Prefer `name(for:)` for display.
    public func username(for userId: Int) -> String? {
        lock.withLock { usernames[userId] }
    }

    /// Drops every name, here and on disk (signing out with "delete data").
    func forget() {
        lock.withLock {
            names = [:]
            usernames = [:]
        }
        defaults.removeObject(forKey: Self.key)
        defaults.removeObject(forKey: Self.usernameKey)
    }

    /// Stores display names (and, optionally, usernames) by user id. Nil and blank values are ignored.
    func remember(_ pairs: [(Int, String?)], usernames usernamePairs: [(Int, String?)] = []) {
        let changed: (names: [String: String]?, usernames: [String: String]?) = lock.withLock {
            (Self.merge(pairs, into: &names), Self.merge(usernamePairs, into: &usernames))
        }
        if let names = changed.names { defaults.set(names, forKey: Self.key) }
        if let usernames = changed.usernames { defaults.set(usernames, forKey: Self.usernameKey) }
    }

    /// Merges `pairs` and returns the whole map in its stored form when anything changed.
    private static func merge(_ pairs: [(Int, String?)], into map: inout [Int: String]) -> [String: String]? {
        var dirty = false
        for (id, value) in pairs {
            guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty, map[id] != value else { continue }
            map[id] = value
            dirty = true
        }
        return dirty ? Dictionary(uniqueKeysWithValues: map.map { (String($0.key), $0.value) }) : nil
    }

    private static func load(_ defaults: UserDefaults, key: String) -> [Int: String] {
        let stored = defaults.dictionary(forKey: key) as? [String: String] ?? [:]
        return Dictionary(uniqueKeysWithValues: stored.compactMap { key, value in Int(key).map { ($0, value) } })
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
