import XCTest
@testable import CriaKit

final class ApiV2ClientTests: XCTestCase {
    private func client(_ transport: StubTransport, version: ApiVersion = .apiV2) -> ApiClient {
        ApiClient(session: FakeSession(), core: HTTPCore(transport: transport), version: version)
    }

    private func summary(_ transport: StubTransport) -> [String] {
        transport.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
    }

    // MARK: Verb and path mapping

    func testCreateIsPostAndUpdateIsPutOnV2() async throws {
        let transport = StubTransport { _, _ in (200, #"{"id": 1, "title": "x"}"#, [:]) }
        let api = client(transport)
        _ = try await api.createProject(["title": .string("x")])
        _ = try await api.updateProject(id: 1, ["title": .string("y")])
        try await api.deleteProject(id: 1)
        XCTAssertEqual(summary(transport), ["POST /api/v2/projects", "PUT /api/v2/projects/1", "DELETE /api/v2/projects/1"])
        // A PUT is a full replace: the whole body goes, never a partial one.
        let body = try XCTUnwrap(transport.requests[1].httpBody)
        XCTAssertEqual(try JSONDecoder().decode(JSONBody.self, from: body), ["title": .string("y")])
    }

    func testV1KeepsTheOriginalVerbs() async throws {
        let transport = StubTransport { _, _ in (200, #"{"id": 1, "title": "x"}"#, [:]) }
        let api = client(transport, version: .apiV1)
        _ = try await api.createProject(["title": .string("x")])
        _ = try await api.updateProject(id: 1, ["title": .string("y")])
        XCTAssertEqual(summary(transport), ["PUT /api/v1/projects", "POST /api/v1/projects/1"])
    }

    func testEveryEndpointMapsToItsV2Route() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let api = client(transport)
        try await api.addLabel(taskId: 4, labelId: 9)
        try await api.addAssignee(taskId: 4, userId: 2)
        try await api.addRelation(taskId: 4, ["other_task_id": .number(5), "relation_kind": .string("subtask")])
        try await api.removeLabel(taskId: 4, labelId: 9)
        try await api.setTaskPosition(id: 4, ["position": .number(1)])
        try await api.moveTaskToBucket(projectId: 1, viewId: 2, bucketId: 3, ["task_id": .number(4)])
        try await api.subscribe(entity: "task", id: 4)
        try await api.unsubscribe(entity: "task", id: 4)
        try await api.addCommentReaction(commentId: 5, emoji: "x")
        try await api.removeCommentReaction(commentId: 5, emoji: "x")
        try await api.markNotificationRead(id: 6)
        try await api.markAllNotificationsRead()
        XCTAssertEqual(summary(transport), [
            "POST /api/v2/tasks/4/labels", "POST /api/v2/tasks/4/assignees", "POST /api/v2/tasks/4/relations",
            "DELETE /api/v2/tasks/4/labels/9", "PUT /api/v2/tasks/4/position",
            "PUT /api/v2/projects/1/views/2/buckets/3/tasks", "POST /api/v2/subscriptions/task/4",
            "DELETE /api/v2/subscriptions/task/4", "POST /api/v2/comments/5/reactions",
            "POST /api/v2/comments/5/reactions/delete", "PUT /api/v2/notifications/6", "POST /api/v2/notifications"
        ])
    }

    func testEntityWritesMapToV2Routes() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let api = client(transport)
        _ = try? await api.createComment(taskId: 4, ["comment": .string("c")])
        _ = try? await api.updateComment(taskId: 4, id: 8, ["comment": .string("c")])
        _ = try? await api.createView(projectId: 1, ["title": .string("v")])
        _ = try? await api.updateView(projectId: 1, id: 2, ["title": .string("v")])
        _ = try? await api.createBucket(projectId: 1, viewId: 2, ["title": .string("b")])
        _ = try? await api.updateBucket(projectId: 1, viewId: 2, id: 3, ["title": .string("b")])
        _ = try? await api.createLabel(["title": .string("l")])
        _ = try? await api.updateLabel(id: 7, ["title": .string("l")])
        _ = try? await api.createSavedFilter(["title": .string("f")])
        _ = try? await api.updateSavedFilter(id: 7, ["title": .string("f")])
        try await api.updateEmail(newEmail: "a@b.example", password: "pw")
        XCTAssertEqual(summary(transport), [
            "POST /api/v2/tasks/4/comments", "PUT /api/v2/tasks/4/comments/8", "POST /api/v2/projects/1/views",
            "PUT /api/v2/projects/1/views/2", "POST /api/v2/projects/1/views/2/buckets",
            "PUT /api/v2/projects/1/views/2/buckets/3", "POST /api/v2/labels", "PUT /api/v2/labels/7",
            "POST /api/v2/filters", "PUT /api/v2/filters/7", "PUT /api/v2/user/settings/email"
        ])
    }

    func testSharingEndpointsMapToV2() async throws {
        let transport = StubTransport { _, _ in (200, "[]", [:]) }
        let api = client(transport)
        _ = try? await api.createTeam(name: "T")
        _ = try? await api.addTeamMember(teamId: 1, username: "ada")
        _ = try? await api.addProjectUser(projectId: 2, username: "ada", permission: .read)
        XCTAssertEqual(summary(transport).first, "POST /api/v2/teams")
        XCTAssertTrue(summary(transport).contains("POST /api/v2/teams/1/members"))
        XCTAssertTrue(summary(transport).contains("POST /api/v2/projects/2/users"))
    }

    func testSearchParametersRenamedToQ() async throws {
        let transport = StubTransport { _, _ in (200, "[]", [:]) }
        let api = client(transport)
        _ = try await api.searchUsers("ada")
        _ = try await api.searchUnsplash("sea", page: 2)
        XCTAssertEqual(transport.requests[0].url?.query, "q=ada")
        XCTAssertEqual(transport.requests[1].url?.path, "/api/v2/backgrounds/unsplash/search")
        XCTAssertEqual(transport.requests[1].url?.query, "page=2&q=sea")
        let legacy = StubTransport { _, _ in (200, "[]", [:]) }
        _ = try await client(legacy, version: .apiV1).searchUsers("ada")
        XCTAssertEqual(legacy.requests[0].url?.query, "s=ada")
    }

    func testAvatarProviderRouteOnV2() async throws {
        let transport = StubTransport { _, _ in (200, #"{"avatar_provider": "gravatar"}"#, [:]) }
        let api = client(transport)
        let provider = try await api.avatarProvider()
        try await api.setAvatarProvider("initials")
        XCTAssertEqual(provider, "gravatar")
        XCTAssertEqual(summary(transport), ["GET /api/v2/user/settings/avatar/provider", "PUT /api/v2/user/settings/avatar/provider"])
    }

    func testAttachmentUploadIsPostOnV2AndPutOnV1() async throws {
        let reply = #"{"success": [{"id": 7}]}"#
        let modern = StubTransport { _, _ in (201, reply, [:]) }
        _ = try await client(modern).uploadAttachment(taskId: 4, fileName: "a.png", mime: "image/png", bytes: Data([1]))
        XCTAssertEqual(summary(modern), ["POST /api/v2/tasks/4/attachments"])
        let legacy = StubTransport { _, _ in (200, reply, [:]) }
        _ = try await client(legacy, version: .apiV1).uploadAttachment(taskId: 4, fileName: "a.png", mime: "image/png", bytes: Data([1]))
        XCTAssertEqual(summary(legacy), ["PUT /api/v1/tasks/4/attachments"])
    }

    // MARK: v1-only and v2-only routes

    func testV1OnlyRoutesStayOnV1EvenAgainstV2() async throws {
        let transport = StubTransport { _, _ in (200, #"{"secret": "s", "enabled": false}"#, [:]) }
        let api = client(transport)
        _ = try? await api.totpStatus()
        _ = try? await api.enrollTotp()
        _ = try? await api.enableTotp(passcode: "123456")
        _ = try? await api.uploadAvatar(fileName: "a.png", mime: "image/png", bytes: Data([1]))
        XCTAssertEqual(summary(transport), [
            "GET /api/v1/user/settings/totp", "POST /api/v1/user/settings/totp/enroll",
            "POST /api/v1/user/settings/totp/enable", "PUT /api/v1/user/settings/avatar/upload"
        ])
    }

    func testSessionsAreV2OnlyAndReadTheEnvelope() async throws {
        let body = #"{"items": [{"id": "abc", "device_info": "Chrome on Mac OS X"}], "#
            + #""page": 1, "per_page": 50, "total": 1, "total_pages": 1}"#
        let transport = StubTransport { _, _ in (200, body, [:]) }
        let listing = try await client(transport, version: .apiV1).sessions()
        XCTAssertEqual(summary(transport), ["GET /api/v2/user/sessions"])
        XCTAssertEqual(listing?.sessions.count, 1)
    }

    func testMergePatchIsAlwaysV2() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        _ = try await client(transport, version: .apiV1).mergePatch("/user/settings/general", body: ["name": .string("x")])
        XCTAssertEqual(summary(transport), ["PATCH /api/v2/user/settings/general"])
    }

    // MARK: Lists, empty bodies and errors

    func testEnvelopePagesAreUnwrappedAndFetchedInFull() async throws {
        let transport = StubTransport { request, _ in
            let second = request.url?.query?.hasPrefix("page=2") == true
            let items = second ? #"[{"id": 3}]"# : #"[{"id": 1}, {"id": 2}]"#
            return (200, #"{"items": \#(items), "page": 1, "per_page": 2, "total": 3, "total_pages": 2}"#, [:])
        }
        let raws = try await client(transport).fetchAllPages("/projects", perPage: 2)
        let ids = try raws.map { try XCTUnwrap((try JSONSerialization.jsonObject(with: $0) as? [String: Any])?["id"] as? Int) }
        XCTAssertEqual(ids, [1, 2, 3])
        XCTAssertEqual(Set(summary(transport)), ["GET /api/v2/projects"])
        XCTAssertEqual(transport.requests.count, 2)
    }

    func testNullAndEmptyEnvelopeItemsMeanNoRows() async throws {
        for body in [#"{"items": null, "page": 1, "per_page": 50, "total": 0, "total_pages": 0}"#,
                     #"{"items": [], "page": 1, "per_page": 50, "total": 0, "total_pages": 0}"#] {
            let transport = StubTransport { _, _ in (200, body, [:]) }
            let raws = try await client(transport).fetchAllPages("/labels")
            XCTAssertTrue(raws.isEmpty)
        }
    }

    func testBareArrayWithHeaderStillWorksOnV1() async throws {
        let transport = StubTransport { _, _ in (200, #"[{"id": 1}]"#, ["x-pagination-total-pages": "1"]) }
        let raws = try await client(transport, version: .apiV1).fetchAllPages("/labels")
        XCTAssertEqual(raws.count, 1)
    }

    func testNonListObjectsAreLeftAlone() async throws {
        let transport = StubTransport { _, _ in (200, #"{"id": 1, "title": "x", "items": "keep"}"#, [:]) }
        let response = try await client(transport).send(.get, "/projects/1")
        let object = try JSONSerialization.jsonObject(with: response.data) as? [String: Any]
        XCTAssertEqual(object?["items"] as? String, "keep")
    }

    func test204DeleteWithEmptyBodySucceeds() async throws {
        let transport = StubTransport { _, _ in (204, "", [:]) }
        let api = client(transport)
        try await api.deleteTask(id: 1)
        try await api.removeAssignee(taskId: 1, userId: 2)
        try await api.performIgnoring404(.delete, "/tasks/9")
        XCTAssertEqual(transport.requests.count, 3)
    }

    func testProblemJSONBecomesApiError() {
        let body = Data((#"{"title": "Unprocessable Entity", "status": 422, "#
            + #""detail": "title: cannot be empty", "code": 2002, "errors": []}"#).utf8)
        let error = buildApiError(status: 422, body: body)
        XCTAssertEqual(error, ApiError(status: 422, code: 2002, message: "title: cannot be empty", retryable: false))
        let titleOnly = buildApiError(status: 403, body: Data(#"{"title": "Forbidden", "status": 403}"#.utf8))
        XCTAssertEqual(titleOnly.message, "Forbidden")
        XCTAssertEqual(buildApiError(status: 400, body: Data(#"{"code": 4002, "message": "Nope"}"#.utf8)).message, "Nope")
    }

    func testProblemJSONThrownFromARequest() async throws {
        let transport = StubTransport { _, _ in (422, #"{"title": "Unprocessable Entity", "detail": "bad body", "code": 2002}"#, [:]) }
        do {
            _ = try await client(transport).createProject(["title": .string("")])
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 422)
            XCTAssertEqual(error.message, "bad body")
            XCTAssertFalse(error.retryable)
        }
    }

    func testTotpRequiredOnBothVersions() {
        XCTAssertTrue(isTotpRequired(ApiError(status: 412, code: 1017, message: "", retryable: false)))
        XCTAssertTrue(isTotpRequired(ApiError(status: 412, code: nil, message: "", retryable: false)))
        XCTAssertTrue(isTotpRequired(ApiError(status: 422, code: 1017, message: "", retryable: false)))
        XCTAssertFalse(isTotpRequired(ApiError(status: 422, code: 2002, message: "", retryable: false)))
        XCTAssertFalse(isTotpRequired(ApiError(status: 401, code: nil, message: "", retryable: false)))
    }
}
