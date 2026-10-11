import Foundation
import GRDB

/// What the share extension turns shared items into: a task title and an HTML description holding the link.
public struct ShareContent: Equatable, Sendable {
    public let title: String
    public let descriptionHtml: String?

    /// Shared `text` and `url` (either may be nil) to a task. A page title, when the sender gives one, is the task
    /// title; else the first line of shared text; else the host of the link. Nil when there is nothing to save.
    public static func make(title: String?, text: String?, url: URL?) -> ShareContent? {
        let page = clean(title)
        let body = clean(text)
        let firstLine = body.flatMap { $0.components(separatedBy: .newlines).first.flatMap(clean) }
        let heading = page ?? firstLine ?? url?.host
        guard let heading else { return nil }
        var parts: [String] = []
        if let url { parts.append("<p><a href=\"\(escape(url.absoluteString))\">\(escape(url.absoluteString))</a></p>") }
        if let body, body != heading { parts.append("<p>\(escape(body))</p>") }
        return ShareContent(title: String(heading.prefix(250)), descriptionHtml: parts.isEmpty ? nil : parts.joined())
    }

    private static func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

public extension CriaStore {
    private static let capturePrefKey = "cria.captureProjectLocalId"

    /// The app records its default (inbox) project here so extensions and intents, which cannot ask the server, know
    /// where to file a new task.
    func rememberCaptureProject(serverId: Int?, defaults: UserDefaults = CriaPaths.sharedDefaults()) throws {
        var local: String?
        if let serverId {
            local = try projects().first { $0.serverId == serverId }?.localId
        }
        defaults.set(local, forKey: Self.capturePrefKey)
    }

    /// The remembered capture project if it still exists, else the first live project. Nil with no projects.
    func captureProjectId(defaults: UserDefaults = CriaPaths.sharedDefaults()) throws -> String? {
        let all = try projects()
        if let saved = defaults.string(forKey: Self.capturePrefKey), all.contains(where: { $0.localId == saved }) { return saved }
        return all.first?.localId
    }

    /// Saves a shared item or intent input as a task in the capture project. The outbox pushes it on the next sync.
    @discardableResult
    func captureTask(
        title: String,
        descriptionHtml: String? = nil,
        defaults: UserDefaults = CriaPaths.sharedDefaults()
    ) throws -> TaskRecord? {
        guard let project = try captureProjectId(defaults: defaults) else { return nil }
        return try createTask(TaskInput(title: title, projectLocalId: project, description: descriptionHtml))
    }

    /// A task by local id, or by server id when `identifier` is numeric. Nil when missing or deleted.
    func resolveTaskId(_ identifier: String) throws -> String? {
        try resolveLocalId(table: "tasks", identifier: identifier)
    }

    func resolveProjectId(_ identifier: String) throws -> String? {
        try resolveLocalId(table: "projects", identifier: identifier)
    }

    private func resolveLocalId(table: String, identifier: String) throws -> String? {
        let column = Int(identifier) == nil ? "local_id" : "server_id"
        let sql = "SELECT local_id FROM \(table) WHERE \(column) = ? AND deleted = 0"
        let argument: any DatabaseValueConvertible = Int(identifier) ?? identifier
        return try database.writer.read { connection in
            try String.fetchOne(connection, sql: sql, arguments: [argument])
        }
    }
}

/// What the Today widget shows, read straight from the shared database.
public struct TodaySnapshot: Equatable, Sendable {
    public struct Entry: Equatable, Sendable, Identifiable {
        public let id: String
        public let title: String
        public let isOverdue: Bool

        public init(id: String, title: String, isOverdue: Bool) {
            self.id = id
            self.title = title
            self.isOverdue = isOverdue
        }
    }

    public let entries: [Entry]
    /// Open tasks due today or overdue, including any beyond `entries`.
    public let total: Int

    public init(entries: [Entry], total: Int) {
        self.entries = entries
        self.total = total
    }

    public static func load(store: CriaStore, limit: Int, now: Date = Date()) throws -> TodaySnapshot {
        let groups = try store.smartGroups(.today, now: now)
        var all: [Entry] = []
        for group in groups {
            for item in group.items {
                all.append(Entry(id: item.task.localId, title: item.task.title, isOverdue: group.key == "overdue"))
            }
        }
        return TodaySnapshot(entries: Array(all.prefix(limit)), total: all.count)
    }
}
