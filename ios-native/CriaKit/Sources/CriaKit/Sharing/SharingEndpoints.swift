import Foundation

private func number(_ value: Int) -> JSONValue { .number(Double(value)) }

/// One path segment, with `/` escaped as well (`.urlPathAllowed` keeps it).
private func pathSegment(_ text: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/")
    return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
}

private func single(_ key: String, _ value: JSONValue) -> JSONBody { [key: value] }

/// Project sharing and teams. Vikunja verbs: GET read, PUT create, POST update, DELETE delete.
/// Ported from `src/api/projectShares.ts` and `src/api/teams.ts`. Online only, like the web client.
public extension ApiClient {
    // MARK: Users

    func projectUsers(projectId: Int) async throws -> [UserShare] {
        let rows: [JSONValue]? = try await get("/projects/\(projectId)/users")
        return (rows ?? []).compactMap(UserShare.init)
    }

    func addProjectUser(projectId: Int, username: String, permission: SharePermission) async throws {
        let body: JSONBody = ["username": .string(username), "permission": number(permission.rawValue)]
        try await perform(.put, "/projects/\(projectId)/users", body: body)
    }

    /// The path takes the username, not the numeric id (the server reads `param:"user"`); a numeric id would 404.
    func updateProjectUser(projectId: Int, username: String, permission: SharePermission) async throws {
        let path = "/projects/\(projectId)/users/\(pathSegment(username))"
        try await perform(.post, path, body: single("permission", number(permission.rawValue)))
    }

    func removeProjectUser(projectId: Int, username: String) async throws {
        try await perform(.delete, "/projects/\(projectId)/users/\(pathSegment(username))")
    }

    // MARK: Teams on a project

    func projectTeams(projectId: Int) async throws -> [TeamShare] {
        let rows: [JSONValue]? = try await get("/projects/\(projectId)/teams")
        return (rows ?? []).compactMap(TeamShare.init)
    }

    func addProjectTeam(projectId: Int, teamId: Int, permission: SharePermission) async throws {
        let body: JSONBody = ["team_id": number(teamId), "permission": number(permission.rawValue)]
        try await perform(.put, "/projects/\(projectId)/teams", body: body)
    }

    func updateProjectTeam(projectId: Int, teamId: Int, permission: SharePermission) async throws {
        try await perform(.post, "/projects/\(projectId)/teams/\(teamId)", body: single("permission", number(permission.rawValue)))
    }

    func removeProjectTeam(projectId: Int, teamId: Int) async throws {
        try await perform(.delete, "/projects/\(projectId)/teams/\(teamId)")
    }

    // MARK: Link shares

    func linkShares(projectId: Int) async throws -> [LinkShare] {
        let rows: [JSONValue]? = try await get("/projects/\(projectId)/shares")
        return (rows ?? []).compactMap(LinkShare.init)
    }

    /// A password makes it a password-protected share (`sharing_type` 2), otherwise 1.
    func createLinkShare(projectId: Int, permission: SharePermission, name: String?, password: String?) async throws {
        var body: JSONBody = ["permission": number(permission.rawValue)]
        if let name, !name.isEmpty { body["name"] = .string(name) }
        if let password, !password.isEmpty { body["password"] = .string(password) }
        body["sharing_type"] = number(body["password"] == nil ? 1 : 2)
        try await perform(.put, "/projects/\(projectId)/shares", body: body)
    }

    func deleteLinkShare(projectId: Int, shareId: Int) async throws {
        try await perform(.delete, "/projects/\(projectId)/shares/\(shareId)")
    }

    // MARK: Teams

    func teams() async throws -> [Team] {
        let rows: [JSONValue]? = try await get("/teams")
        return (rows ?? []).compactMap(Team.init)
    }

    func team(id: Int) async throws -> Team? {
        let row: JSONValue = try await get("/teams/\(id)")
        return Team(row)
    }

    func createTeam(name: String) async throws -> Team? {
        let row: JSONValue = try await put("/teams", body: single("name", .string(name)))
        return Team(row)
    }

    /// The update writes `is_public` whatever the body says, so it must be sent back or a public team goes private.
    func renameTeam(id: Int, name: String, isPublic: Bool) async throws {
        let body: JSONBody = ["name": .string(name), "is_public": .bool(isPublic)]
        try await perform(.post, "/teams/\(id)", body: body)
    }

    func deleteTeam(id: Int) async throws {
        try await perform(.delete, "/teams/\(id)")
    }

    func addTeamMember(teamId: Int, username: String) async throws {
        try await perform(.put, "/teams/\(teamId)/members", body: single("username", .string(username)))
    }

    func removeTeamMember(teamId: Int, username: String) async throws {
        try await perform(.delete, "/teams/\(teamId)/members/\(pathSegment(username))")
    }

    /// The server flips the member's admin flag.
    func toggleTeamMemberAdmin(teamId: Int, userId: Int) async throws {
        try await perform(.post, "/teams/\(teamId)/members/\(userId)/admin")
    }
}
