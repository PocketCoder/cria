import Foundation

/// Server shape for `GET /user`. Mirrors `userResponseSchema` and `userFromResponse` in `src/domain/user.ts`.
public struct UserResponse: Decodable, Equatable, Sendable {
    /// The settings fields the client reads. Missing values fall back to the TypeScript defaults.
    public struct Settings: Decodable, Equatable, Sendable {
        public let defaultProjectId: Int?
        public let language: String?
        public let timezone: String?
        public let weekStart: Int?

        enum CodingKeys: String, CodingKey {
            case language, timezone
            case defaultProjectId = "default_project_id"
            case weekStart = "week_start"
        }
    }

    public let id: Int
    public let username: String
    public let email: String?
    public let name: String?
    public let settings: Settings?

    /// Falls back to `'en'` when the server sends no language.
    public var resolvedLanguage: String { settings?.language ?? "en" }
    /// Falls back to `UTC` when the server sends no timezone.
    public var resolvedTimezone: String { settings?.timezone ?? "UTC" }
    /// 0 = Sunday ... 6 = Saturday. Falls back to 1 (Monday).
    public var resolvedWeekStart: Int { settings?.weekStart ?? 1 }
}

/// Server shape for one task assignee. Mirrors `assigneeResponseSchema` in `src/domain/task-assignee.ts`.
public struct AssigneeResponse: Decodable, Equatable, Sendable {
    public let id: Int
    public let username: String?
    public let name: String?
    public let email: String?
}
