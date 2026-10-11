import XCTest
@testable import CriaKit

final class ApiClientTests: XCTestCase {
    private func client(_ session: FakeSession, _ transport: StubTransport) -> ApiClient {
        ApiClient(session: session, core: HTTPCore(transport: transport))
    }

    func testAttachesBearerAndBuildsURL() async throws {
        let transport = StubTransport { _, _ in (200, #"{"id": 7, "username": "ada"}"#, [:]) }
        let user = try await client(FakeSession(serverURL: "https://vk.example/"), transport).currentUser()
        XCTAssertEqual(user.username, "ada")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://vk.example/api/v1/user")
        XCTAssertEqual(header(request, "Authorization"), "Bearer old")
        XCTAssertEqual(request.httpMethod, "GET")
    }

    func testVerbsFollowVikunjaSemantics() async throws {
        let transport = StubTransport { _, _ in (200, #"{"id": 1, "title": "x"}"#, [:]) }
        let api = client(FakeSession(), transport)
        _ = try await api.createProject(["title": .string("x")])
        _ = try await api.updateProject(id: 1, ["title": .string("y")])
        try await api.deleteProject(id: 1)
        XCTAssertEqual(transport.requests.map(\.httpMethod), ["PUT", "POST", "DELETE"])
        XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/v1/projects", "/api/v1/projects/1", "/api/v1/projects/1"])
        XCTAssertEqual(header(transport.requests[0], "Content-Type"), "application/json")
        let body = try XCTUnwrap(transport.requests[0].httpBody)
        XCTAssertEqual(try JSONDecoder().decode(JSONBody.self, from: body), ["title": .string("x")])
    }

    func testRelationAndLabelEndpoints() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let api = client(FakeSession(), transport)
        try await api.addLabel(taskId: 4, labelId: 9)
        try await api.removeAssignee(taskId: 4, userId: 2)
        try await api.removeRelation(taskId: 4, kind: "subtask", otherTaskId: 5)
        XCTAssertEqual(transport.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }, [
            "PUT /api/v1/tasks/4/labels",
            "DELETE /api/v1/tasks/4/assignees/2",
            "DELETE /api/v1/tasks/4/relations/subtask/5",
        ])
    }

    func testNon2xxThrowsApiErrorWithEnvelope() async throws {
        let transport = StubTransport { _, _ in (400, #"{"code": 4002, "message": "Nope"}"#, [:]) }
        do {
            _ = try await client(FakeSession(), transport).project(id: 1)
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error, ApiError(status: 400, code: 4002, message: "Nope", retryable: false))
        }
    }

    func testTransportFailureBecomesNetworkError() async throws {
        let transport = StubTransport { _, _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await client(FakeSession(), transport).project(id: 1)
            XCTFail("expected throw")
        } catch let error as NetworkError {
            XCTAssertTrue(error.retryable)
        }
    }

    func testSignedOutSessionThrowsAuthRequired() async throws {
        struct Empty: SessionProviding {
            func snapshot() async -> (serverURL: String, token: String)? { nil }
            func canRefresh() async -> Bool { false }
            func refreshSession() async -> String? { nil }
            func noteAuthorized() async {}
            func noteUnauthorized() async {}
        }
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let api = ApiClient(session: Empty(), core: HTTPCore(transport: transport))
        do {
            _ = try await api.project(id: 1)
            XCTFail("expected throw")
        } catch is AuthRequiredError {
            XCTAssertTrue(transport.requests.isEmpty)
        }
    }

    func testRefusesTokenOverPlainHTTP() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let api = client(FakeSession(serverURL: "http://vk.example"), transport)
        do {
            _ = try await api.project(id: 1)
            XCTFail("expected throw")
        } catch is InsecureDestinationError {
            XCTAssertTrue(transport.requests.isEmpty)
        }
    }

    func testAllowsLoopbackOverHTTP() async throws {
        let transport = StubTransport { _, _ in (200, #"{"id": 1, "title": "x"}"#, [:]) }
        _ = try await client(FakeSession(serverURL: "http://localhost:3456"), transport).project(id: 1)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testRefreshesAndRetriesOnceOn401() async throws {
        let transport = StubTransport { request, _ in
            header(request, "Authorization") == "Bearer fresh" ? (200, #"{"id": 1, "title": "x"}"#, [:]) : (401, "{}", [:])
        }
        let session = FakeSession(refreshable: true, refreshedToken: "fresh")
        let project = try await client(session, transport).project(id: 1)
        XCTAssertEqual(project.id, 1)
        XCTAssertEqual(transport.requests.count, 2)
        let calls = await session.refreshCalls
        let unauthorized = await session.unauthorizedCount
        let authorized = await session.authorizedCount
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(unauthorized, 0)
        XCTAssertEqual(authorized, 1)
    }

    func testRetryReplaysBody() async throws {
        let transport = StubTransport { request, _ in
            header(request, "Authorization") == "Bearer fresh" ? (200, #"{"id": 1, "title": "x"}"#, [:]) : (401, "{}", [:])
        }
        let session = FakeSession(refreshable: true, refreshedToken: "fresh")
        _ = try await client(session, transport).createProject(["title": .string("x")])
        XCTAssertEqual(transport.requests.last?.httpBody, transport.requests.first?.httpBody)
    }

    func testNoRefreshForNonRefreshableSessionAndCountsUnauthorized() async throws {
        let transport = StubTransport { _, _ in (401, "{}", [:]) }
        let session = FakeSession(refreshable: false)
        do {
            _ = try await client(session, transport).project(id: 1)
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 401)
        }
        XCTAssertEqual(transport.requests.count, 1)
        let calls = await session.refreshCalls
        let unauthorized = await session.unauthorizedCount
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(unauthorized, 1)
    }

    func testFailedRefreshReturnsOriginal401() async throws {
        let transport = StubTransport { _, _ in (401, "{}", [:]) }
        let session = FakeSession(refreshable: true, refreshedToken: nil)
        do {
            _ = try await client(session, transport).project(id: 1)
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 401)
        }
        XCTAssertEqual(transport.requests.count, 1)
        let unauthorized = await session.unauthorizedCount
        XCTAssertEqual(unauthorized, 1)
    }

    func testCircuitOpensAfterFiveHundreds() async throws {
        let transport = StubTransport { _, _ in (503, "down", [:]) }
        let api = client(FakeSession(), transport)
        for _ in 0..<4 { _ = try? await api.project(id: 1) }
        do {
            _ = try await api.project(id: 1)
            XCTFail("expected throw")
        } catch let error as NetworkError {
            XCTAssertTrue(error.message.contains("backing off"))
        }
        XCTAssertEqual(transport.requests.count, 4)
    }

    func testInfoProbeAnonymous() async throws {
        let transport = StubTransport { _, _ in
            (200, #"{"version": "0.24.1", "frontend_url": "", "enabled_background_providers": ["unsplash"]}"#, [:])
        }
        let info = try await ApiClient(serverURL: "https://vk.example/", core: HTTPCore(transport: transport)).info()
        XCTAssertEqual(info.version, "0.24.1")
        XCTAssertNil(info.frontendURL)
        XCTAssertEqual(info.backgroundProviders, ["unsplash"])
        XCTAssertNil(header(transport.requests[0], "Authorization"))
    }
}
