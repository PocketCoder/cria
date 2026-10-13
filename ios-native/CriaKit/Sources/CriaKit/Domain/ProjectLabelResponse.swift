import Foundation

/// Server shape for one project. Mirrors `projectResponseSchema` in `src/domain/project.ts`.
public struct ProjectResponse: Decodable, Equatable, Sendable {
    public let id: Int
    public let title: String
    public let description: String?
    public let identifier: String?
    public let parentProjectId: Int?
    public let hexColor: String?
    public let isArchived: Bool?
    public let isFavorite: Bool?
    public let position: Double?
    public let updated: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, identifier, position, updated
        case parentProjectId = "parent_project_id"
        case hexColor = "hex_color"
        case isArchived = "is_archived"
        case isFavorite = "is_favorite"
    }
}

/// Server shape for one label. Mirrors `labelResponseSchema` in `src/domain/label.ts`.
public struct LabelResponse: Decodable, Equatable, Sendable {
    public let id: Int
    public let title: String
    public let description: String?
    public let hexColor: String?
    public let updated: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, updated
        case hexColor = "hex_color"
    }
}
