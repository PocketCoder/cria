import XCTest
@testable import CriaKit

/// A tiny Vikunja that holds settings and answers the v2 PATCH, the v1 GET and the v1 POST.
private final class SettingsServer: @unchecked Sendable {
    enum Release { case v27, v24, v1Only }

    private let lock = NSLock()
    private var _settings: [String: Any]
    private var _trail: [String] = []
    private var _bodies: [[String: Any]] = []
    var release: Release
    var failUserRead = false
    var patchReply: (status: Int, contentType: String, body: String)?
    var transport: StubTransport!

    var trail: [String] { lock.withLock { _trail } }
    var bodies: [[String: Any]] { lock.withLock { _bodies } }
    var settings: [String: Any] { lock.withLock { _settings } }

    init(release: Release = .v27) throws {
        self.release = release
        _settings = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(serverSettingsJSON.utf8)) as? [String: Any])
        transport = StubTransport { [unowned self] request, _ in self.handle(request) }
    }

    private func handle(_ request: URLRequest) -> (Int, String, [String: String]) {
        let line = "\(request.httpMethod ?? "") \(request.url?.path ?? "")"
        let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        lock.withLock {
            _trail.append(line)
            if let body { _bodies.append(body) }
        }
        let json = ["Content-Type": "application/json"]
        switch line {
        case "PATCH /api/v2/user/settings/general":
            if let reply = patchReply { return (reply.status, reply.body, ["Content-Type": reply.contentType]) }
            switch release {
            case .v1Only: return (404, "{}", json)
            case .v24: return (405, "{}", json)
            case .v27:
                guard let body, !body.isEmpty else { return (304, "", [:]) }
                lock.withLock { merge(&_settings, body) }
                return (200, "{}", json)
            }
        case "GET /api/v1/user":
            if failUserRead { return (500, #"{"message": "boom"}"#, json) }
            let data = (try? JSONSerialization.data(withJSONObject: ["id": 1, "username": "j", "settings": settings])) ?? Data()
            return (200, String(bytes: data, encoding: .utf8) ?? "", json)
        case "POST /api/v1/user/settings/general":
            if let body { lock.withLock { _settings = body } }
            return (200, "{}", json)
        default:
            return (404, "{}", json)
        }
    }

    private func merge(_ target: inout [String: Any], _ patch: [String: Any]) {
        for (key, value) in patch {
            if let nested = value as? [String: Any], var existing = target[key] as? [String: Any] {
                merge(&existing, nested)
                target[key] = existing
            } else {
                target[key] = value
            }
        }
    }
}

final class UserSettingsServiceTests: XCTestCase {
    private func makeService(_ server: SettingsServer, base: String = "https://vk.example") -> UserSettingsService {
        let session = FakeSession(serverURL: base)
        return UserSettingsService(session: session, core: HTTPCore(transport: server.transport))
    }

    private func frontend(_ server: SettingsServer) -> [String: Any] {
        server.settings["frontend_settings"] as? [String: Any] ?? [:]
    }

    func testPatchSendsOnlyTheChangedFieldsAsMergePatch() async throws {
        let server = try SettingsServer()
        try await makeService(server).save(SettingsChange(settings: ["name": .string("Jacob")]))
        XCTAssertEqual(server.trail, ["PATCH /api/v2/user/settings/general"])
        XCTAssertEqual(server.bodies.first as? [String: String], ["name": "Jacob"])
        XCTAssertEqual(server.settings["name"] as? String, "Jacob")
        XCTAssertEqual(server.settings["week_start"] as? Int, 0, "untouched fields keep the server's value")
    }

    func testMergePatchContentTypeHeader() async throws {
        let server = try SettingsServer()
        try await makeService(server).save(SettingsChange(settings: ["name": .string("A")]))
        let request = try XCTUnwrap(server.transport.requests.first)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/merge-patch+json")
    }

    func testChangesOneCriaPrefWithoutTouchingSiblingsOrOtherClientsKeys() async throws {
        let server = try SettingsServer()
        try await makeService(server).save(SettingsChange(cria: ["colorScheme": .string("dark")]))
        let sent = try XCTUnwrap(server.bodies.first)
        XCTAssertEqual(((sent["frontend_settings"] as? [String: Any])?["cria"] as? [String: String]), ["colorScheme": "dark"])
        let cria = frontend(server)["cria"] as? [String: String]
        XCTAssertEqual(cria, ["colorScheme": "dark", "dateFormat": "DD/MM/YYYY"])
        XCTAssertEqual(frontend(server)["sidebar_width"] as? Int, 320)
    }

    func testNullsAreNeverSent() async throws {
        let server = try SettingsServer()
        try await makeService(server).save(SettingsChange(
            frontend: ["color_schema": .null], cria: ["dateFormat": .null, "colorScheme": .string("dark")]
        ))
        let sent = try XCTUnwrap(server.bodies.first)
        XCTAssertEqual((sent["frontend_settings"] as? [String: Any])?.count, 1)
        XCTAssertEqual(frontend(server)["color_schema"] as? String, "dark")
        XCTAssertEqual((frontend(server)["cria"] as? [String: String])?["dateFormat"], "DD/MM/YYYY")
    }

    func testEmpty304CountsAsSaved() async throws {
        let server = try SettingsServer()
        try await makeService(server).save(SettingsChange(frontend: ["a": .null]))
        XCTAssertEqual(server.trail, ["PATCH /api/v2/user/settings/general"])
    }

    func testFallsBackToFullPostOnServersWithoutPatch() async throws {
        for release in [SettingsServer.Release.v24, .v1Only] {
            let server = try SettingsServer(release: release)
            try await makeService(server).save(SettingsChange(cria: ["colorScheme": .string("dark")]))
            XCTAssertEqual(server.trail, [
                "PATCH /api/v2/user/settings/general", "GET /api/v1/user", "POST /api/v1/user/settings/general"
            ])
            let post = try XCTUnwrap(server.bodies.last)
            XCTAssertEqual(post["name"] as? String, "Jake")
            XCTAssertEqual(post["default_project_id"] as? Int, 7)
            XCTAssertEqual(post["language"] as? String, "de")
            XCTAssertEqual((post["frontend_settings"] as? [String: Any])?["sidebar_width"] as? Int, 320)
            XCTAssertEqual(((post["frontend_settings"] as? [String: Any])?["cria"] as? [String: String]),
                           ["colorScheme": "dark", "dateFormat": "DD/MM/YYYY"])
        }
    }

    func testRemembersUnsupportedPerServerSoLaterSavesGoStraightToV1() async throws {
        let server = try SettingsServer(release: .v24)
        let service = makeService(server)
        try await service.save(SettingsChange(settings: ["name": .string("A")]))
        try await service.save(SettingsChange(settings: ["week_start": .number(3)]))
        XCTAssertEqual(server.trail, [
            "PATCH /api/v2/user/settings/general", "GET /api/v1/user", "POST /api/v1/user/settings/general",
            "GET /api/v1/user", "POST /api/v1/user/settings/general"
        ])
        XCTAssertEqual(server.settings["name"] as? String, "A")
        XCTAssertEqual(server.settings["week_start"] as? Int, 3)
        XCTAssertEqual(server.settings["language"] as? String, "de")
    }

    func testFallsBackOn501AndOnA2xxThatIsNotJSON() async throws {
        let replies: [(Int, String, String)] = [(501, "application/json", "{}"), (200, "text/html", "<!doctype html>")]
        for reply in replies {
            let server = try SettingsServer()
            server.patchReply = reply
            try await makeService(server).save(SettingsChange(settings: ["name": .string("Jacob")]))
            XCTAssertEqual(server.trail.last, "POST /api/v1/user/settings/general")
            XCTAssertEqual(server.settings["name"] as? String, "Jacob")
            XCTAssertEqual(server.settings["language"] as? String, "de")
        }
    }

    func testSendsNothingWhenTheV1ReadFails() async throws {
        let server = try SettingsServer(release: .v1Only)
        server.failUserRead = true
        do {
            try await makeService(server).save(SettingsChange(settings: ["name": .string("X")]))
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 500)
        }
        XCTAssertEqual(server.trail, ["PATCH /api/v2/user/settings/general", "GET /api/v1/user"])
        XCTAssertEqual(server.settings["name"] as? String, "Jake")
    }

    func testARejectedPatchSurfacesWithoutFallingBackToV1() async throws {
        let server = try SettingsServer()
        server.patchReply = (422, "application/json", #"{"message": "invalid"}"#)
        do {
            try await makeService(server).save(SettingsChange(settings: ["name": .string("X")]))
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 422)
        }
        XCTAssertEqual(server.trail, ["PATCH /api/v2/user/settings/general"])
    }

    func testFailedSaveDoesNotBlockLaterOnesAndSavesRunInOrder() async throws {
        let server = try SettingsServer()
        server.patchReply = (422, "application/json", "{}")
        let service = makeService(server)
        do {
            try await service.save(SettingsChange(settings: ["name": .string("bad")]))
            XCTFail("expected throw")
        } catch {}
        server.patchReply = nil
        async let first: Void = service.save(SettingsChange(settings: ["name": .string("one")]))
        async let second: Void = service.save(SettingsChange(settings: ["name": .string("two")]))
        _ = try await (first, second)
        // Which save queued first is up to the scheduler; what matters is they never overlap, so the last
        // write is the final state and both were sent.
        let sent = server.bodies.suffix(2).compactMap { $0["name"] as? String }
        XCTAssertEqual(Set(sent), ["one", "two"])
        XCTAssertEqual(server.settings["name"] as? String, sent.last)
    }

    func testUnsupportedMemoIsPerServerURL() async throws {
        let server = try SettingsServer(release: .v1Only)
        let first = makeService(server, base: "https://a.example")
        try await first.save(SettingsChange(settings: ["name": .string("A")]))
        let other = try SettingsServer(release: .v27)
        try await makeService(other, base: "https://b.example").save(SettingsChange(settings: ["name": .string("B")]))
        XCTAssertEqual(other.trail, ["PATCH /api/v2/user/settings/general"])
    }
}
