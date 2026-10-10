import Foundation

/// Server shape for one task (`GET /tasks`). Mirrors `taskResponseSchema` in `src/domain/task.ts`.
/// Date fields pass through `normaliseDate`, so the "no date" sentinel decodes to `nil`.
public struct TaskResponse: Decodable, Equatable, Sendable {
    public struct CreatedBy: Decodable, Equatable, Sendable {
        public let id: Int?
    }

    public let id: Int
    public let projectId: Int
    public let title: String
    public let description: String?
    public let done: Bool?
    public let doneAt: String?
    public let dueDate: String?
    public let startDate: String?
    public let endDate: String?
    public let priority: Int?
    public let percentDone: Double?
    public let hexColor: String?
    public let position: Double?
    public let updated: String?
    public let created: String?
    public let createdBy: CreatedBy?
    public let isFavorite: Bool?
    public let repeatAfter: Int?
    public let repeatMode: Int?
    public let identifier: String?
    public let labels: [LabelResponse]?
    public let assignees: [AssigneeResponse]?
    public let attachments: [TaskAttachmentResponse]?
    public let reminders: [TaskReminderResponse]?
    public let comments: [CommentResponse]?
    /// Keyed by relation kind (`subtask`, `related`, ...). See `TaskRelationKind`.
    public let relatedTasks: [String: [RelatedTaskResponse]]?

    enum CodingKeys: String, CodingKey {
        case id, title, description, done, priority, identifier, labels, assignees
        case attachments, reminders, comments
        case projectId = "project_id"
        case doneAt = "done_at"
        case dueDate = "due_date"
        case startDate = "start_date"
        case endDate = "end_date"
        case percentDone = "percent_done"
        case hexColor = "hex_color"
        case position, updated, created
        case createdBy = "created_by"
        case isFavorite = "is_favorite"
        case repeatAfter = "repeat_after"
        case repeatMode = "repeat_mode"
        case relatedTasks = "related_tasks"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        projectId = try c.decode(Int.self, forKey: .projectId)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        done = try c.decodeIfPresent(Bool.self, forKey: .done)
        doneAt = normaliseDate(try c.decodeIfPresent(String.self, forKey: .doneAt))
        dueDate = normaliseDate(try c.decodeIfPresent(String.self, forKey: .dueDate))
        startDate = normaliseDate(try c.decodeIfPresent(String.self, forKey: .startDate))
        endDate = normaliseDate(try c.decodeIfPresent(String.self, forKey: .endDate))
        priority = try c.decodeIfPresent(Int.self, forKey: .priority)
        percentDone = try c.decodeIfPresent(Double.self, forKey: .percentDone)
        hexColor = try c.decodeIfPresent(String.self, forKey: .hexColor)
        position = try c.decodeIfPresent(Double.self, forKey: .position)
        updated = normaliseDate(try c.decodeIfPresent(String.self, forKey: .updated))
        created = normaliseDate(try c.decodeIfPresent(String.self, forKey: .created))
        createdBy = try c.decodeIfPresent(CreatedBy.self, forKey: .createdBy)
        isFavorite = try c.decodeIfPresent(Bool.self, forKey: .isFavorite)
        repeatAfter = try c.decodeIfPresent(Int.self, forKey: .repeatAfter)
        repeatMode = try c.decodeIfPresent(Int.self, forKey: .repeatMode)
        identifier = try c.decodeIfPresent(String.self, forKey: .identifier)
        labels = try c.decodeIfPresent([LabelResponse].self, forKey: .labels)
        assignees = try c.decodeIfPresent([AssigneeResponse].self, forKey: .assignees)
        attachments = try c.decodeIfPresent([TaskAttachmentResponse].self, forKey: .attachments)
        reminders = try c.decodeIfPresent([TaskReminderResponse].self, forKey: .reminders)
        comments = try c.decodeIfPresent([CommentResponse].self, forKey: .comments)
        relatedTasks = try c.decodeIfPresent([String: [RelatedTaskResponse]].self, forKey: .relatedTasks)
    }
}

/// Minimal embedded task in a relation. The full task arrives through the regular task pull.
public struct RelatedTaskResponse: Decodable, Equatable, Sendable {
    public let id: Int
    public let title: String?
    public let done: Bool?
    public let projectId: Int?

    enum CodingKeys: String, CodingKey {
        case id, title, done
        case projectId = "project_id"
    }
}

/// Inline reminder. `reminder` is the absolute trigger time, even for relative reminders.
public struct TaskReminderResponse: Decodable, Equatable, Sendable {
    public let reminder: String?
    public let relativePeriod: Int?
    public let relativeTo: String?

    enum CodingKeys: String, CodingKey {
        case reminder
        case relativePeriod = "relative_period"
        case relativeTo = "relative_to"
    }
}

/// Inline attachment metadata. `id` builds the download URL.
public struct TaskAttachmentResponse: Decodable, Equatable, Sendable {
    public struct File: Decodable, Equatable, Sendable {
        public let id: Int?
        public let name: String?
        public let size: Int?
        public let mime: String?
    }

    public let id: Int
    public let taskId: Int?
    public let created: String?
    public let file: File?

    enum CodingKeys: String, CodingKey {
        case id, created, file
        case taskId = "task_id"
    }
}

/// Vikunja's `RelationKind`, verbatim. The server returns all 11 kinds in `related_tasks`.
public enum TaskRelationKind: String, CaseIterable, Sendable {
    case subtask, parenttask, related, duplicates, duplicateof, blocking, blocked
    case precedes, follows, copiedfrom, copiedto

    /// Kinds the user can pick in the add-relation UI. The rest arrive automatically as inverses.
    public static let pickable: [TaskRelationKind] = [
        .subtask, .parenttask, .related, .blocking, .blocked, .duplicates, .precedes, .follows, .copiedfrom,
    ]

    /// The kind the server writes on the other task. Mirrors `inverseRelationKind` in `task.ts`.
    public var inverse: TaskRelationKind {
        switch self {
        case .subtask: .parenttask
        case .parenttask: .subtask
        case .related: .related
        case .duplicates: .duplicateof
        case .duplicateof: .duplicates
        case .blocking: .blocked
        case .blocked: .blocking
        case .precedes: .follows
        case .follows: .precedes
        case .copiedfrom: .copiedto
        case .copiedto: .copiedfrom
        }
    }
}
