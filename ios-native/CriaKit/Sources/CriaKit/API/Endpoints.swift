import Foundation

/// Typed wrappers for the endpoints the sync engine and screens use. Vikunja verbs:
/// GET read, PUT create, POST update, DELETE delete (AGENTS.md). Bodies are `JSONValue` objects
/// built by the per-entity push code (the `taskToBody` quirks live there, in Phase 3).
public typealias JSONBody = [String: JSONValue]

public struct ServerInfo: Decodable, Equatable, Sendable {
    public let version: String?
    public let frontendURL: String?
    public let backgroundProviders: [String]

    enum CodingKeys: String, CodingKey {
        case version
        case frontendURL = "frontend_url"
        case backgroundProviders = "enabled_background_providers"
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(String.self, forKey: .version)
        let frontend = try container.decodeIfPresent(String.self, forKey: .frontendURL)
        frontendURL = (frontend?.isEmpty ?? true) ? nil : frontend
        backgroundProviders = try container.decodeIfPresent([String].self, forKey: .backgroundProviders) ?? []
    }
}

public extension ApiClient {
    // Server and user
    func info() async throws -> ServerInfo { try await get("/info") }
    func currentUser() async throws -> UserResponse { try await get("/user") }

    // Paged lists (projects, tasks, labels, views, buckets) go through `fetchAllPages`.

    // Projects
    func project(id: Int) async throws -> ProjectResponse { try await get("/projects/\(id)") }
    func createProject(_ body: JSONBody) async throws -> ProjectResponse { try await put("/projects", body: body) }
    func updateProject(id: Int, _ body: JSONBody) async throws -> ProjectResponse { try await post("/projects/\(id)", body: body) }
    func deleteProject(id: Int) async throws { try await perform(.delete, "/projects/\(id)") }

    // Tasks
    func task(id: Int) async throws -> TaskResponse { try await get("/tasks/\(id)") }
    func createTask(projectId: Int, _ body: JSONBody) async throws -> TaskResponse {
        try await put("/projects/\(projectId)/tasks", body: body)
    }
    func updateTask(id: Int, _ body: JSONBody) async throws -> TaskResponse { try await post("/tasks/\(id)", body: body) }
    func deleteTask(id: Int) async throws { try await perform(.delete, "/tasks/\(id)") }
    func setTaskPosition(id: Int, _ body: JSONBody) async throws { try await perform(.post, "/tasks/\(id)/position", body: body) }

    // Task labels, assignees, relations
    func addLabel(taskId: Int, labelId: Int) async throws {
        let body: JSONBody = ["label_id": .number(Double(labelId))]
        try await perform(.put, "/tasks/\(taskId)/labels", body: body)
    }
    func removeLabel(taskId: Int, labelId: Int) async throws { try await perform(.delete, "/tasks/\(taskId)/labels/\(labelId)") }
    func addAssignee(taskId: Int, userId: Int) async throws {
        let body: JSONBody = ["user_id": .number(Double(userId))]
        try await perform(.put, "/tasks/\(taskId)/assignees", body: body)
    }
    func removeAssignee(taskId: Int, userId: Int) async throws { try await perform(.delete, "/tasks/\(taskId)/assignees/\(userId)") }
    func addRelation(taskId: Int, _ body: JSONBody) async throws { try await perform(.put, "/tasks/\(taskId)/relations", body: body) }
    func removeRelation(taskId: Int, kind: String, otherTaskId: Int) async throws {
        try await perform(.delete, "/tasks/\(taskId)/relations/\(kind)/\(otherTaskId)")
    }

    // Labels
    func label(id: Int) async throws -> LabelResponse { try await get("/labels/\(id)") }
    func createLabel(_ body: JSONBody) async throws -> LabelResponse { try await put("/labels", body: body) }
    func updateLabel(id: Int, _ body: JSONBody) async throws -> LabelResponse { try await put("/labels/\(id)", body: body) }
    func deleteLabel(id: Int) async throws { try await perform(.delete, "/labels/\(id)") }

    // Views and buckets
    func createView(projectId: Int, _ body: JSONBody) async throws -> ViewResponse {
        try await put("/projects/\(projectId)/views", body: body)
    }
    func updateView(projectId: Int, id: Int, _ body: JSONBody) async throws -> ViewResponse {
        try await post("/projects/\(projectId)/views/\(id)", body: body)
    }
    func deleteView(projectId: Int, id: Int) async throws { try await perform(.delete, "/projects/\(projectId)/views/\(id)") }
    func createBucket(projectId: Int, viewId: Int, _ body: JSONBody) async throws -> BucketResponse {
        try await put("/projects/\(projectId)/views/\(viewId)/buckets", body: body)
    }
    func updateBucket(projectId: Int, viewId: Int, id: Int, _ body: JSONBody) async throws -> BucketResponse {
        try await post("/projects/\(projectId)/views/\(viewId)/buckets/\(id)", body: body)
    }
    func deleteBucket(projectId: Int, viewId: Int, id: Int) async throws {
        try await perform(.delete, "/projects/\(projectId)/views/\(viewId)/buckets/\(id)")
    }
    func moveTaskToBucket(projectId: Int, viewId: Int, bucketId: Int, _ body: JSONBody) async throws {
        try await perform(.post, "/projects/\(projectId)/views/\(viewId)/buckets/\(bucketId)/tasks", body: body)
    }

    // Comments
    func createComment(taskId: Int, _ body: JSONBody) async throws -> CommentResponse {
        try await put("/tasks/\(taskId)/comments", body: body)
    }
    func updateComment(taskId: Int, id: Int, _ body: JSONBody) async throws -> CommentResponse {
        try await post("/tasks/\(taskId)/comments/\(id)", body: body)
    }
    func deleteComment(taskId: Int, id: Int) async throws { try await perform(.delete, "/tasks/\(taskId)/comments/\(id)") }

    // Subscriptions
    func subscribe(entity: String, id: Int) async throws { try await perform(.put, "/subscriptions/\(entity)/\(id)") }
    func unsubscribe(entity: String, id: Int) async throws { try await perform(.delete, "/subscriptions/\(entity)/\(id)") }

    // Saved filters
    func savedFilter(id: Int) async throws -> JSONValue { try await get("/filters/\(id)") }
    func createSavedFilter(_ body: JSONBody) async throws -> JSONValue { try await put("/filters", body: body) }
    func updateSavedFilter(id: Int, _ body: JSONBody) async throws -> JSONValue { try await post("/filters/\(id)", body: body) }
    func deleteSavedFilter(id: Int) async throws { try await perform(.delete, "/filters/\(id)") }
}
