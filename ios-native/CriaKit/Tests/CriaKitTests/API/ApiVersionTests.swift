import XCTest
@testable import CriaKit

final class ApiVersionTests: XCTestCase {
    private func freshDefaults() -> UserDefaults {
        let name = "cria.test.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name) ?? .standard
        suite.removePersistentDomain(forName: name)
        return suite
    }

    private func infoTransport(version: String?) -> StubTransport {
        StubTransport { request, _ in
            if request.url?.path == "/api/v1/info" {
                return (200, version.map { #"{"version": "\#($0)", "frontend_url": ""}"# } ?? "{}", [:])
            }
            return (404, "{}", [:])
        }
    }

    func testParsesTheLeadingVersion() throws {
        let parsed = try XCTUnwrap(ApiVersionPolicy.parse("v2.7.0-16-g58f7cf47"))
        XCTAssertEqual([parsed.major, parsed.minor, parsed.patch], [2, 7, 0])
        XCTAssertNotNil(ApiVersionPolicy.parse("0.24.1"))
        XCTAssertNil(ApiVersionPolicy.parse("dev"))
        XCTAssertNil(ApiVersionPolicy.parse(nil))
    }

    func testV2FromTwoSevenZero() {
        let cases: [(String?, ApiVersion)] = [
            ("v2.7.0", .apiV2), ("v2.7.0-16-g58f7cf47", .apiV2), ("v2.10.1", .apiV2), ("v3.0.0", .apiV2),
            ("v2.6.9", .apiV1), ("v1.9.0", .apiV1), ("0.24.1", .apiV1), ("unstable", .apiV1), (nil, .apiV1)
        ]
        for (text, expected) in cases {
            XCTAssertEqual(ApiVersionPolicy.resolve(infoVersion: text, forceV1: false), expected, "\(text ?? "nil")")
        }
        XCTAssertEqual(ApiVersionPolicy.resolve(infoVersion: "v2.7.0", forceV1: true), .apiV1)
    }

    func testResolverProbesOncePerServerAndCaches() async {
        let transport = infoTransport(version: "v2.7.0")
        let core = HTTPCore(transport: transport)
        let resolver = VersionResolver(defaults: freshDefaults())
        let first = await resolver.version(forServer: "https://a.example/", core: core)
        let again = await resolver.version(forServer: "https://a.example", core: core)
        XCTAssertEqual([first, again], [.apiV2, .apiV2])
        XCTAssertEqual(transport.requests.count, 1)
        _ = await resolver.version(forServer: "https://b.example", core: core)
        XCTAssertEqual(transport.requests.count, 2, "each server URL is probed separately")
    }

    func testReprobeAsksTheServerAgain() async {
        let transport = infoTransport(version: "v2.7.0")
        let core = HTTPCore(transport: transport)
        let resolver = VersionResolver(defaults: freshDefaults())
        _ = await resolver.version(forServer: "https://a.example", core: core)
        resolver.reprobe(server: "https://a.example/")
        _ = await resolver.version(forServer: "https://a.example", core: core)
        XCTAssertEqual(transport.requests.count, 2)
    }

    func testForceV1SkipsTheProbeEntirely() async {
        let defaults = freshDefaults()
        ApiVersionPolicy.setForceV1(true, defaults: defaults)
        let transport = infoTransport(version: "v2.7.0")
        let resolver = VersionResolver(defaults: defaults)
        let version = await resolver.version(forServer: "https://a.example", core: HTTPCore(transport: transport))
        XCTAssertEqual(version, .apiV1)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testFailedProbeFallsBackToV1WithoutCaching() async {
        let transport = StubTransport { _, index in
            index == 1 ? (404, "{}", [:]) : (200, #"{"version": "v2.7.0"}"#, [:])
        }
        let core = HTTPCore(transport: transport)
        let resolver = VersionResolver(defaults: freshDefaults())
        let first = await resolver.version(forServer: "https://a.example", core: core)
        let second = await resolver.version(forServer: "https://a.example", core: core)
        XCTAssertEqual([first, second], [.apiV1, .apiV2])
    }

    func testResolvingClientUsesTheDetectedPrefix() async throws {
        let transport = StubTransport { request, _ in
            request.url?.path == "/api/v1/info" ? (200, #"{"version": "v2.7.0"}"#, [:]) : (200, #"{"id": 1, "username": "ada"}"#, [:])
        }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport),
                            resolver: VersionResolver(defaults: freshDefaults()))
        _ = try await api.currentUser()
        XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/v1/info", "/api/v2/user"])
    }

    func testResolvingClientHonoursForceV1() async throws {
        let defaults = freshDefaults()
        ApiVersionPolicy.setForceV1(true, defaults: defaults)
        let transport = StubTransport { _, _ in (200, #"{"id": 1, "username": "ada"}"#, [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport),
                            resolver: VersionResolver(defaults: defaults))
        _ = try await api.currentUser()
        XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/v1/user"])
    }

    func testRefreshUsesTheResolvedVersion() async throws {
        let transport = StubTransport { request, _ in
            if request.url?.path == "/api/v1/info" { return (200, #"{"version": "v2.7.0"}"#, [:]) }
            return (200, #"{"token": "new"}"#, ["Set-Cookie": "vikunja_refresh_token=ref2; Path=/; HttpOnly"])
        }
        let store = CredentialStore(slot: MemorySlot())
        try store.save(Credentials(serverURL: "https://vk.example", token: "old", authMethod: .password, refreshToken: "ref1"))
        let session = AuthSession(store: store, core: HTTPCore(transport: transport),
                                  resolver: VersionResolver(defaults: freshDefaults()))
        await session.hydrate()
        let token = await session.refreshSession()
        XCTAssertEqual(token, "new")
        XCTAssertEqual(transport.requests.last?.url?.absoluteString, "https://vk.example/api/v2/user/token/refresh")
    }

    func testLoginAndLinkShareUseTheResolvedVersion() async throws {
        let transport = StubTransport { request, _ in
            if request.url?.path == "/api/v1/info" { return (200, #"{"version": "v2.7.0"}"#, [:]) }
            return (200, #"{"token": "jwt"}"#, [:])
        }
        let service = LoginService(core: HTTPCore(transport: transport), resolver: VersionResolver(defaults: freshDefaults()))
        _ = try await service.loginWithPassword(serverURL: "https://vk.example", username: "a", password: "b")
        _ = try await service.signInWithLinkShare(serverURL: "https://vk.example", hash: "abc")
        let paths = transport.requests.map { $0.url?.path ?? "" }
        XCTAssertTrue(paths.contains("/api/v2/login"))
        XCTAssertTrue(paths.contains("/api/v2/shares/abc/auth"))
    }

    func testSettingsSaveSkipsThePatchWhenV1IsForced() async throws {
        let defaults = freshDefaults()
        ApiVersionPolicy.setForceV1(true, defaults: defaults)
        let transport = StubTransport { request, _ in
            if request.httpMethod == "GET" { return (200, #"{"id": 1, "username": "j", "settings": {"name": "J"}}"#, [:]) }
            return (200, "{}", [:])
        }
        let core = HTTPCore(transport: transport)
        let service = UserSettingsService(
            api: ApiClient(session: FakeSession(), core: core, version: .apiV1),
            apiV2: ApiClient(session: FakeSession(), core: core, version: .apiV2),
            resolver: VersionResolver(defaults: defaults))
        try await service.save(SettingsChange(settings: ["name": .string("A")]))
        let sent = transport.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        XCTAssertEqual(sent, ["GET /api/v1/user", "POST /api/v1/user/settings/general"])
    }

    func testApiPathsHandleBothPrefixes() {
        XCTAssertEqual(ApiPaths.stripPrefix("https://vk.example/api/v1/"), "https://vk.example")
        XCTAssertEqual(ApiPaths.stripPrefix("https://vk.example/api/v2"), "https://vk.example")
        XCTAssertEqual(ApiPaths.path(after: "/x/api/v2/tasks/1/attachments/2"), "/tasks/1/attachments/2")
        XCTAssertEqual(ApiPaths.path(after: "/api/v1/user"), "/user")
        XCTAssertNil(ApiPaths.path(after: "/other/path"))
        XCTAssertTrue(ApiPaths.isServerAPI("https://vk.example/api/v2/tasks/1", server: "https://vk.example"))
        XCTAssertFalse(ApiPaths.isServerAPI("https://evil.example/api/v2/tasks/1", server: "https://vk.example"))
    }
}
