import XCTest
@testable import CriaKit

final class AccountTests: XCTestCase {
    func testPasswordValidation() {
        XCTAssertEqual(AccountValidation.newPassword("abcdef", confirm: "abcdeg"), "Passwords do not match")
        XCTAssertEqual(AccountValidation.newPassword("abc", confirm: "abc"), "Password must be at least 6 characters")
        XCTAssertNil(AccountValidation.newPassword("abcdef", confirm: "abcdef"))
    }

    func testEmailValidation() {
        XCTAssertNil(AccountValidation.emailAddress("a@b.c"))
        XCTAssertEqual(AccountValidation.emailAddress("nope"), "Invalid email address")
    }

    func testGroupsFromArrayAreDedupedAndSorted() throws {
        let routes = try decodeFixture(JSONValue.self, #"[{"tasks": {}, "labels": {}}, {"tasks": {}, "projects": {}}]"#)
        let groups = ApiTokenPermissions.groups(fromRoutes: routes)
        XCTAssertEqual(groups.map(\.group), ["labels", "projects", "tasks"])
        XCTAssertEqual(groups[0].permissions.map(\.id), ["labels:read_all", "labels:create", "labels:update", "labels:delete"])
        XCTAssertEqual(groups[0].permissions.map(\.label), ["Read all", "Create", "Update", "Delete"])
    }

    func testGroupsFromPlainObject() throws {
        let routes = try decodeFixture(JSONValue.self, #"{"tasks": {"read_all": {}}, "labels": {}}"#)
        XCTAssertEqual(ApiTokenPermissions.groups(fromRoutes: routes).map(\.group), ["labels", "tasks"])
    }

    func testSelectionToPermissions() {
        let result = ApiTokenPermissions.permissions(fromSelection: ["tasks:read_all", "tasks:create", "labels:delete", "broken"])
        XCTAssertEqual(result, ["tasks": ["read_all", "create"], "labels": ["delete"]])
    }

    func testCreateTokenSendsPermissionsAndReadsSecret() async throws {
        let transport = StubTransport { _, _ in (200, #"{"id": 5, "title": "CI", "token": "tk_abc"}"#, ["Content-Type": "application/json"]) }
        let client = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let token = try await client.createApiToken(
            title: "CI", expiresAt: "2027-01-01T00:00:00Z", permissions: ["tasks": ["read_all"]]
        )
        XCTAssertEqual(token?.token, "tk_abc")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/v1/tokens")
        let sent = try XCTUnwrap(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        XCTAssertEqual((sent["permissions"] as? [String: [String]]), ["tasks": ["read_all"]])
    }

    func testTokenListHidesNoDateExpiry() async throws {
        let json = #"[{"id": 1, "title": "A", "expires_at": "0001-01-01T00:00:00Z"}, {"title": "no id"}]"#
        let transport = StubTransport { _, _ in (200, json, ["Content-Type": "application/json"]) }
        let client = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let tokens = try await client.apiTokens()
        XCTAssertEqual(tokens.count, 1)
        XCTAssertNil(tokens.first?.expiresAt)
    }

    func testChangePasswordBody() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let client = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        try await client.changePassword(old: "old", new: "newpass")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.path, "/api/v1/user/password")
        let sent = try XCTUnwrap(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] })
        XCTAssertEqual(sent, ["old_password": "old", "new_password": "newpass"])
    }

    func testWipeRemovesDatabaseFilesAndBlobsOnly() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("wipe-\(UUID().uuidString)")
        let manager = FileManager.default
        try manager.createDirectory(at: root.appendingPathComponent("blobs"), withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        for name in ["cria.sqlite", "cria.sqlite-wal", "cria.sqlite-shm", "blobs/project-bg-1", "keep.txt"] {
            manager.createFile(atPath: root.appendingPathComponent(name).path, contents: Data("x".utf8))
        }
        try LocalDataWipe.wipe(root: root)
        let left = try manager.contentsOfDirectory(atPath: root.path)
        XCTAssertEqual(left, ["keep.txt"])
    }

    func testWipeOfAnEmptyDirectoryIsFine() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("wipe-\(UUID().uuidString)")
        XCTAssertNoThrow(try LocalDataWipe.wipe(root: root))
    }
}
