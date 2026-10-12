import XCTest
@testable import CriaKit

@MainActor
final class RecentServersTests: XCTestCase {
    private let userJSON = #"{"id": 3, "username": "ada"}"#

    /// `/user` answers with the user; the login call answers with a token.
    private func passwordTransport(_ user: String) -> HTTPCore {
        HTTPCore(transport: StubTransport { request, _ in
            request.url?.path == "/api/v1/user" ? (200, user, [:]) : (200, #"{"token": "jwt"}"#, [:])
        })
    }

    private func idleModel() -> LoginViewModel {
        LoginViewModel(service: LoginService(core: HTTPCore(transport: StubTransport { _, _ in (200, "{}", [:]) }))) { _ in }
    }

    private func defaults() throws -> UserDefaults {
        try XCTUnwrap(UserDefaults(suiteName: "recent-\(UUID().uuidString)"))
    }

    func testNewestFirstWithoutRepeatsAndCappedAtFive() async throws {
        let recents = RecentServers(defaults: try defaults())
        for index in 1...7 { recents.remember(server: "https://s\(index).example", username: nil) }
        recents.remember(server: "https://s5.example", username: nil)
        XCTAssertEqual(recents.servers(), ["https://s5.example", "https://s7.example", "https://s6.example",
                                          "https://s4.example", "https://s3.example"])
    }

    func testUsernameFollowsTheServerAndIsDroppedWhenNotRemembered() async throws {
        let recents = RecentServers(defaults: try defaults())
        recents.remember(server: "https://a.example", username: "ada")
        recents.remember(server: "https://b.example", username: "bob")
        XCTAssertEqual(recents.username(for: "https://a.example"), "ada")
        recents.remember(server: "https://a.example", username: nil)
        XCTAssertNil(recents.username(for: "https://a.example"))
        XCTAssertEqual(recents.username(for: "https://b.example"), "bob")
    }

    func testForgetRemovesServerAndName() async throws {
        let recents = RecentServers(defaults: try defaults())
        recents.remember(server: "https://a.example", username: "ada")
        recents.forget(server: "https://a.example")
        XCTAssertEqual(recents.servers(), [])
        XCTAssertNil(recents.username(for: "https://a.example"))
    }

    func testAdoptPrefillsLatestServerAndUsernameAndOpensPasswordTab() async throws {
        let recents = RecentServers(defaults: try defaults())
        recents.remember(server: "https://a.example", username: "ada")
        let viewModel = idleModel()
        viewModel.adoptRecentServers(recents)
        XCTAssertEqual(viewModel.serverURL, "https://a.example")
        XCTAssertEqual(viewModel.username, "ada")
        XCTAssertEqual(viewModel.method, .password)
        XCTAssertEqual(viewModel.recentServers, ["https://a.example"])
    }

    func testAdoptKeepsAServerAlreadyTyped() async throws {
        let recents = RecentServers(defaults: try defaults())
        recents.remember(server: "https://a.example", username: "ada")
        let viewModel = idleModel()
        viewModel.serverURL = "https://typed.example"
        viewModel.adoptRecentServers(recents)
        XCTAssertEqual(viewModel.serverURL, "https://typed.example")
        XCTAssertEqual(viewModel.method, .token)
    }

    func testPickServerFillsItsUsername() async throws {
        let recents = RecentServers(defaults: try defaults())
        recents.remember(server: "https://a.example", username: "ada")
        recents.remember(server: "https://b.example", username: nil)
        let viewModel = idleModel()
        viewModel.adoptRecentServers(recents)
        viewModel.pickServer("https://a.example")
        XCTAssertEqual(viewModel.serverURL, "https://a.example")
        XCTAssertEqual(viewModel.username, "ada")
    }

    func testSuccessfulPasswordSignInRemembersServerAndUsernameButNotPassword() async throws {
        let defaults = try defaults()
        let user = userJSON
        let viewModel = LoginViewModel(service: LoginService(core: passwordTransport(user))) { _ in }
        viewModel.adoptRecentServers(RecentServers(defaults: defaults))
        viewModel.serverURL = "https://vk.example"
        viewModel.switchMethod(.password)
        viewModel.username = "ada"
        viewModel.password = "secret"
        await viewModel.submit()
        let recents = RecentServers(defaults: defaults)
        XCTAssertEqual(recents.servers(), ["https://vk.example"])
        XCTAssertEqual(recents.username(for: "https://vk.example"), "ada")
        XCTAssertFalse(defaults.dictionaryRepresentation().values.contains { "\($0)".contains("secret") })
        XCTAssertEqual(viewModel.recentServers, ["https://vk.example"])
    }

    func testRememberMeOffKeepsServerButNotUsername() async throws {
        let defaults = try defaults()
        let user = userJSON
        let viewModel = LoginViewModel(service: LoginService(core: passwordTransport(user))) { _ in }
        viewModel.adoptRecentServers(RecentServers(defaults: defaults))
        viewModel.serverURL = "https://vk.example"
        viewModel.switchMethod(.password)
        viewModel.username = "ada"
        viewModel.password = "secret"
        viewModel.rememberMe = false
        await viewModel.submit()
        let recents = RecentServers(defaults: defaults)
        XCTAssertEqual(recents.servers(), ["https://vk.example"])
        XCTAssertNil(recents.username(for: "https://vk.example"))
    }

    func testFailedSignInRemembersNothing() async throws {
        let defaults = try defaults()
        let rejecting = HTTPCore(transport: StubTransport { _, _ in (401, "{}", [:]) })
        let viewModel = LoginViewModel(service: LoginService(core: rejecting)) { _ in }
        viewModel.adoptRecentServers(RecentServers(defaults: defaults))
        viewModel.serverURL = "https://vk.example"
        viewModel.token = "pat_12345678"
        await viewModel.submit()
        XCTAssertEqual(RecentServers(defaults: defaults).servers(), [])
    }
}
