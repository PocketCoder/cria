import XCTest
@testable import CriaKit

final class SharingEndpointsTests: XCTestCase {
    private func client(_ transport: StubTransport) -> ApiClient {
        ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
    }

    private func reply(_ body: String) -> StubTransport {
        StubTransport { _, _ in (200, body, ["Content-Type": "application/json"]) }
    }

    func testUserSharesSkipRowsWithoutIdOrUsername() async throws {
        let json = #"[{"id": 1, "username": "ann", "name": "Ann", "permission": 2}, {"id": 2}, {"username": "x"}]"#
        let shares = try await client(reply(json)).projectUsers(projectId: 5)
        XCTAssertEqual(shares.map(\.username), ["ann"])
        XCTAssertEqual(shares.first?.permission, .admin)
    }

    func testNullListReadsAsEmpty() async throws {
        let shares = try await client(reply("null")).projectTeams(projectId: 5)
        XCTAssertTrue(shares.isEmpty)
    }

    func testLinkShareFlagsPasswordAndSharer() async throws {
        let json = """
        [{"id": 3, "hash": "abc", "permission": 1, "sharing_type": 2, "shared_by": {"username": "jo"}},
         {"id": 4, "hash": "def", "name": "", "permission": 0, "sharing_type": 1}, {"id": 5}]
        """
        let shares = try await client(reply(json)).linkShares(projectId: 5)
        XCTAssertEqual(shares.count, 2)
        XCTAssertTrue(shares[0].hasPassword)
        XCTAssertEqual(shares[0].sharedByName, "jo")
        XCTAssertFalse(shares[1].hasPassword)
        XCTAssertNil(shares[1].name)
    }

    func testAddUserUsesPutWithPermission() async throws {
        let transport = reply("{}")
        try await client(transport).addProjectUser(projectId: 7, username: "ann", permission: .write)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/v1/projects/7/users")
        let body = try XCTUnwrap(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        XCTAssertEqual(body["username"] as? String, "ann")
        XCTAssertEqual(body["permission"] as? Int, 1)
    }

    func testCreateLinkShareSetsSharingTypeFromPassword() async throws {
        let withPassword = reply("{}")
        try await client(withPassword).createLinkShare(projectId: 7, permission: .read, name: "", password: "pw")
        let plain = reply("{}")
        try await client(plain).createLinkShare(projectId: 7, permission: .read, name: "Team", password: nil)
        func sent(_ transport: StubTransport) throws -> [String: Any] {
            try XCTUnwrap(transport.requests.first?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        }
        XCTAssertEqual(try sent(withPassword)["sharing_type"] as? Int, 2)
        XCTAssertNil(try sent(withPassword)["name"])
        XCTAssertEqual(try sent(plain)["sharing_type"] as? Int, 1)
        XCTAssertEqual(try sent(plain)["name"] as? String, "Team")
    }

    func testRemoveTeamMemberEscapesUsername() async throws {
        let transport = reply("{}")
        try await client(transport).removeTeamMember(teamId: 2, username: "a b")
        XCTAssertEqual(transport.requests.first?.httpMethod, "DELETE")
        XCTAssertEqual(transport.requests.first?.url?.absoluteString, "https://vk.example/api/v1/teams/2/members/a%20b")
    }

    func testProjectUserPathsUseTheUsername() async throws {
        let transport = reply("{}")
        let api = client(transport)
        try await api.updateProjectUser(projectId: 7, username: "ann b", permission: .admin)
        try await api.removeProjectUser(projectId: 7, username: "ann b")
        XCTAssertEqual(transport.requests.map { "\($0.httpMethod ?? "") \($0.url?.absoluteString ?? "")" }, [
            "POST https://vk.example/api/v1/projects/7/users/ann%20b",
            "DELETE https://vk.example/api/v1/projects/7/users/ann%20b"
        ])
    }

    func testRenameTeamSendsIsPublicBack() async throws {
        let transport = reply("{}")
        try await client(transport).renameTeam(id: 2, name: "Crew", isPublic: true)
        let sent = try XCTUnwrap(transport.requests.first?.httpBody)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: sent) as? [String: Any])
        XCTAssertEqual(body["is_public"] as? Bool, true)
        XCTAssertEqual(body["name"] as? String, "Crew")
    }

    func testTeamDecodesMembers() async throws {
        let json = #"{"id": 2, "name": "Crew", "description": "", "members": [{"id": 9, "username": "ann", "admin": true}, {"id": 8}]}"#
        let team = try await client(reply(json)).team(id: 2)
        XCTAssertEqual(team?.name, "Crew")
        XCTAssertNil(team?.description)
        XCTAssertEqual(team?.members.map(\.username), ["ann"])
        XCTAssertEqual(team?.members.first?.admin, true)
    }
}
