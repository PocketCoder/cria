import XCTest
@testable import CriaKit

private func refreshReply(token: String = "new", cookie: String? = "vikunja_refresh_token=ref2; Path=/; HttpOnly") -> (Int, String, [String: String]) {
    (200, #"{"token": "\#(token)"}"#, cookie.map { ["Set-Cookie": $0] } ?? [:])
}

final class AuthSessionTests: XCTestCase {
    private let password = Credentials(serverURL: "https://vk.example", token: "old", authMethod: .password, refreshToken: "ref1")

    private func makeSession(_ transport: StubTransport, creds: Credentials? = nil, store: CredentialStore? = nil,
                             onSignOut: @escaping @Sendable () async -> Void = {}) async throws -> (AuthSession, CredentialStore) {
        let store = store ?? CredentialStore(slot: MemorySlot())
        if let creds { try store.save(creds) }
        let session = AuthSession(store: store, core: HTTPCore(transport: transport), onSignOut: onSignOut)
        await session.hydrate()
        return (session, store)
    }

    func testConcurrentRefreshIssuesExactlyOneRequest() async throws {
        let transport = StubTransport { _, _ in
            try await Task.sleep(nanoseconds: 50_000_000)
            return refreshReply()
        }
        let (session, _) = try await makeSession(transport, creds: password)
        let tokens = await withTaskGroup(of: String?.self) { group in
            for _ in 0..<8 { group.addTask { await session.refreshSession() } }
            var collected: [String?] = []
            for await token in group { collected.append(token) }
            return collected
        }
        XCTAssertEqual(tokens.compactMap { $0 }, Array(repeating: "new", count: 8))
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testRefreshSendsCookieAndPersistsRotatedToken() async throws {
        let transport = StubTransport { _, _ in refreshReply() }
        let (session, store) = try await makeSession(transport, creds: password)
        let token = await session.refreshSession()
        XCTAssertEqual(token, "new")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://vk.example/api/v1/user/token/refresh")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(header(request, "Cookie"), "vikunja_refresh_token=ref1")
        XCTAssertNil(header(request, "Authorization"))
        XCTAssertEqual(store.load()?.token, "new")
        XCTAssertEqual(store.load()?.refreshToken, "ref2")
    }

    func testKeepsOldRefreshTokenWhenNoCookieReturned() async throws {
        let transport = StubTransport { _, _ in refreshReply(cookie: nil) }
        let (session, store) = try await makeSession(transport, creds: password)
        _ = await session.refreshSession()
        XCTAssertEqual(store.load()?.refreshToken, "ref1")
    }

    func testSequentialRefreshesAreSeparateRequests() async throws {
        let transport = StubTransport { _, _ in refreshReply() }
        let (session, _) = try await makeSession(transport, creds: password)
        _ = await session.refreshSession()
        _ = await session.refreshSession()
        XCTAssertEqual(transport.requests.count, 2)
    }

    func testFailedRefreshReturnsNilAndKeepsSession() async throws {
        let transport = StubTransport { _, _ in (401, "{}", [:]) }
        let (session, store) = try await makeSession(transport, creds: password)
        let token = await session.refreshSession()
        XCTAssertNil(token)
        XCTAssertEqual(store.load(), password)
        let status = await session.status
        XCTAssertEqual(status, .authenticated(password))
    }

    func testNoRefreshForTokenLoginsOrSignedOut() async throws {
        let transport = StubTransport { _, _ in refreshReply() }
        let apiToken = Credentials(serverURL: "https://vk.example", token: "t", authMethod: .token)
        let (tokenSession, _) = try await makeSession(transport, creds: apiToken)
        let tokenCanRefresh = await tokenSession.canRefresh()
        let tokenResult = await tokenSession.refreshSession()
        XCTAssertFalse(tokenCanRefresh)
        XCTAssertNil(tokenResult)
        let (empty, _) = try await makeSession(transport)
        let emptyResult = await empty.refreshSession()
        XCTAssertNil(emptyResult)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testRefusesRefreshOverPlainHTTP() async throws {
        let transport = StubTransport { _, _ in refreshReply() }
        let insecure = Credentials(serverURL: "http://vk.example", token: "old", authMethod: .password, refreshToken: "ref1")
        let (session, _) = try await makeSession(transport, creds: insecure)
        let result = await session.refreshSession()
        XCTAssertNil(result)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testSignsOutAfterThreeConsecutiveUnauthorized() async throws {
        let cleared = Counter()
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let (session, store) = try await makeSession(transport, creds: password) { await cleared.bump() }
        await session.noteUnauthorized()
        await session.noteUnauthorized()
        var status = await session.status
        XCTAssertEqual(status, .authenticated(password))
        await session.noteUnauthorized()
        status = await session.status
        XCTAssertEqual(status, .unauthenticated)
        XCTAssertNil(store.load())
        let count = await cleared.value
        XCTAssertEqual(count, 1)
    }

    func testSuccessResetsUnauthorizedStreak() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let (session, _) = try await makeSession(transport, creds: password)
        await session.noteUnauthorized()
        await session.noteUnauthorized()
        await session.noteAuthorized()
        await session.noteUnauthorized()
        await session.noteUnauthorized()
        let status = await session.status
        XCTAssertEqual(status, .authenticated(password))
    }

    func testUnauthorizedWhileSignedOutIsIgnored() async throws {
        let cleared = Counter()
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let (session, _) = try await makeSession(transport) { await cleared.bump() }
        for _ in 0..<5 { await session.noteUnauthorized() }
        let count = await cleared.value
        XCTAssertEqual(count, 0)
    }

    func testHydrateAndSignInPersist() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let (session, store) = try await makeSession(transport)
        var status = await session.status
        XCTAssertEqual(status, .unauthenticated)
        try await session.signIn(password)
        XCTAssertEqual(store.load(), password)
        let snapshot = await session.snapshot()
        XCTAssertEqual(snapshot?.token, "old")
        status = await session.status
        XCTAssertEqual(status, .authenticated(password))
    }

    func testSignInFailureLeavesSignedOut() async throws {
        struct Failing: SecretSlot {
            func read() throws -> String? { nil }
            func write(_ value: String) throws { throw KeychainError(status: -25308) }
            func delete() throws {}
        }
        let session = AuthSession(store: CredentialStore(slot: Failing()))
        await session.hydrate()
        do {
            try await session.signIn(password)
            XCTFail("expected throw")
        } catch is KeychainError {}
        let status = await session.status
        XCTAssertEqual(status, .unauthenticated)
    }

    func testClientRefreshesThroughRealSession() async throws {
        let transport = StubTransport { request, _ in
            if request.url?.path == "/api/v1/user/token/refresh" { return (200, #"{"token": "new"}"#, [:]) }
            return header(request, "Authorization") == "Bearer new" ? (200, #"{"id": 1, "title": "x"}"#, [:]) : (401, "{}", [:])
        }
        let (session, _) = try await makeSession(transport, creds: password)
        let api = ApiClient(session: session, core: HTTPCore(transport: transport))
        async let first = api.project(id: 1)
        async let second = api.project(id: 1)
        let projects = try await [first, second]
        XCTAssertEqual(projects.map(\.id), [1, 1])
        let refreshes = transport.requests.filter { $0.url?.path.hasSuffix("/token/refresh") == true }
        XCTAssertEqual(refreshes.count, 1)
    }
}

actor Counter {
    private(set) var value = 0
    func bump() { value += 1 }
}
