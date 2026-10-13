import Foundation

public struct ParsedNotification: Equatable, Sendable {
    public let text: String
    /// Server id of the task to open on tap, when one applies.
    public let taskServerId: Int?
}

/// Human-readable text for Vikunja in-app notifications. Ported from `src/lib/notificationParse.ts`. Payload shapes
/// mirror the server's `ToDB()` structs; everything is defensive and unknown names fall back to the raw name.
public enum NotificationParse {
    public static func parse(name: String, payload: JSONValue?) -> ParsedNotification {
        let doer = userName(payload?["doer"])
        let task = taskTitle(payload?["task"])
        let taskId = payload?["task"]?["id"]?.intValue
        switch name {
        case "task.assigned":
            return ParsedNotification(text: "\(doer) assigned you to “\(task)”", taskServerId: taskId)
        case "task.comment":
            let mentioned = payload?["mentioned"]?.boolValue == true
            let text = mentioned ? "\(doer) mentioned you in a comment on “\(task)”" : "\(doer) commented on “\(task)”"
            return ParsedNotification(text: text, taskServerId: taskId)
        case "task.mentioned":
            return ParsedNotification(text: "\(doer) mentioned you on “\(task)”", taskServerId: taskId)
        case "task.deleted":
            return ParsedNotification(text: "\(doer) deleted “\(task)”", taskServerId: nil)
        case "task.reminder":
            return ParsedNotification(text: "Reminder: “\(task)”", taskServerId: taskId)
        case "task.undone.overdue":
            let text = taskId != nil ? "“\(task)” is overdue" : "You have overdue tasks"
            return ParsedNotification(text: text, taskServerId: taskId)
        case "team.member.added":
            let team = payload?["team"]?["name"]?.stringValue ?? "a team"
            return ParsedNotification(text: "\(doer) added \(userName(payload?["member"])) to team “\(team)”", taskServerId: nil)
        case "project.created":
            let title = payload?["project"]?["title"]?.stringValue ?? ""
            return ParsedNotification(text: "\(doer) created project “\(title)”", taskServerId: nil)
        case "data.export.ready":
            return ParsedNotification(text: "Your data export is ready to download", taskServerId: nil)
        default:
            return ParsedNotification(text: name, taskServerId: nil)
        }
    }

    private static func userName(_ user: JSONValue?) -> String {
        nonEmpty(user?["name"]?.stringValue) ?? nonEmpty(user?["username"]?.stringValue) ?? "Someone"
    }

    private static func taskTitle(_ task: JSONValue?) -> String {
        nonEmpty(task?["title"]?.stringValue) ?? "a task"
    }

    private static func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }
}

/// One in-app notification from `GET /notifications`.
public struct AppNotification: Equatable, Sendable, Identifiable {
    public let id: Int
    public let name: String
    public let payload: JSONValue?
    public let isRead: Bool
    public let created: String?

    public var parsed: ParsedNotification { NotificationParse.parse(name: name, payload: payload) }

    init?(_ row: JSONValue) {
        guard let id = row["id"]?.intValue else { return nil }
        self.id = id
        name = row["name"]?.stringValue ?? ""
        payload = row["notification"]
        // Vikunja sends Go's zero time for unread notifications.
        isRead = normaliseDate(row["read_at"]?.stringValue) != nil
        created = row["created"]?.stringValue
    }
}

public extension ApiClient {
    func notifications() async throws -> [AppNotification] {
        let rows: [JSONValue]? = try await get("/notifications", query: ["page": "1", "per_page": "50"])
        return (rows ?? []).compactMap(AppNotification.init)
    }

    /// The server marks it read only when the body says `read: true` (an empty body means "unread").
    func markNotificationRead(id: Int) async throws {
        let body: JSONBody = ["read": .bool(true)]
        try await perform(.post, "/notifications/\(id)", body: body)
    }

    func markAllNotificationsRead() async throws {
        try await perform(.post, "/notifications")
    }
}
