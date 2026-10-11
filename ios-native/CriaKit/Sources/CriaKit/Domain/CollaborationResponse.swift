import Foundation

/// Server shape for one comment. Mirrors `commentResponseSchema` in `src/domain/comment.ts`.
public struct CommentResponse: Decodable, Equatable, Sendable {
    public struct Author: Decodable, Equatable, Sendable {
        public let id: Int?
        public let name: String?
        public let username: String?
    }

    public struct ReactionUser: Decodable, Equatable, Sendable {
        public let id: Int?
        public let name: String?
        public let username: String?
    }

    public let id: Int
    public let comment: String?
    public let author: Author?
    public let created: String?
    public let updated: String?
    /// Emoji to the users who reacted with it.
    public let reactions: [String: [ReactionUser]]?
}

/// Server shape for one project view. Mirrors `viewResponseSchema` in `src/domain/view.ts`.
public struct ViewResponse: Decodable, Equatable, Sendable {
    public enum ViewKind: String, Decodable, Sendable {
        case list, gantt, table, kanban
    }

    public enum BucketConfigMode: String, Decodable, Sendable {
        case none, manual, filter
    }

    public let id: Int
    public let title: String
    public let projectId: Int
    public let viewKind: ViewKind
    public let position: Double?
    /// The TaskCollection JSON string, e.g. `{"filter": "...", "filter_include_nulls": false}`.
    public let filter: String?
    public let bucketConfigurationMode: BucketConfigMode?
    public let bucketConfiguration: [JSONValue]?
    public let defaultBucketId: Int?
    public let doneBucketId: Int?
    public let created: String?
    public let updated: String?

    enum CodingKeys: String, CodingKey {
        case id, title, position, filter, created, updated
        case projectId = "project_id"
        case viewKind = "view_kind"
        case bucketConfigurationMode = "bucket_configuration_mode"
        case bucketConfiguration = "bucket_configuration"
        case defaultBucketId = "default_bucket_id"
        case doneBucketId = "done_bucket_id"
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        projectId = try container.decode(Int.self, forKey: .projectId)
        viewKind = try container.decode(ViewKind.self, forKey: .viewKind)
        position = try container.decodeIfPresent(Double.self, forKey: .position)
        // Vikunja sends a TaskCollection object (`{"filter": "done = false", ...}`); older servers a plain string.
        // Decoding it as a string failed every view with a filter, the default List view included.
        switch try container.decodeIfPresent(JSONValue.self, forKey: .filter) {
        case .string(let text)?:
            filter = text
        case .object(let object)?:
            let data = try JSONEncoder().encode(JSONValue.object(object))
            filter = String(bytes: data, encoding: .utf8)
        default:
            filter = nil
        }
        bucketConfigurationMode = try container.decodeIfPresent(BucketConfigMode.self, forKey: .bucketConfigurationMode)
        bucketConfiguration = try container.decodeIfPresent([JSONValue].self, forKey: .bucketConfiguration)
        defaultBucketId = try container.decodeIfPresent(Int.self, forKey: .defaultBucketId)
        doneBucketId = try container.decodeIfPresent(Int.self, forKey: .doneBucketId)
        created = try container.decodeIfPresent(String.self, forKey: .created)
        updated = try container.decodeIfPresent(String.self, forKey: .updated)
    }
}

/// Server shape for one kanban bucket. Mirrors `bucketResponseSchema` in `src/domain/bucket.ts`.
public struct BucketResponse: Decodable, Equatable, Sendable {
    public let id: Int
    public let title: String
    public let projectViewId: Int
    public let position: Double?
    public let limit: Int?
    public let createdById: Int?
    public let created: String?
    public let updated: String?

    enum CodingKeys: String, CodingKey {
        case id, title, position, limit, created, updated
        case projectViewId = "project_view_id"
        case createdById = "created_by_id"
    }
}
