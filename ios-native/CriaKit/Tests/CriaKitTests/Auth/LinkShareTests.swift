import XCTest
@testable import CriaKit

final class ShareLinkInputTests: XCTestCase {
    func testParsesFullAuthURLAndItsServer() {
        let parsed = ShareLinkInput.parse("  https://vk.example/share/AbC123xyz/auth \n")
        XCTAssertEqual(parsed, ShareLinkInput(hash: "AbC123xyz", serverURL: "https://vk.example"))
    }

    func testParsesWithoutAuthSuffixWithSlashOrQuery() {
        XCTAssertEqual(ShareLinkInput.parse("https://vk.example/share/abc")?.hash, "abc")
        XCTAssertEqual(ShareLinkInput.parse("https://vk.example/share/abc/")?.hash, "abc")
        XCTAssertEqual(ShareLinkInput.parse("https://vk.example/share/abc/auth?view=list")?.hash, "abc")
        XCTAssertEqual(ShareLinkInput.parse("https://vk.example/share/abc/auth#x")?.hash, "abc")
    }

    func testKeepsAPathPrefixAndPortInTheServer() {
        let parsed = ShareLinkInput.parse("https://example.com:8443/vikunja/share/h4sh/auth")
        XCTAssertEqual(parsed?.serverURL, "https://example.com:8443/vikunja")
        XCTAssertEqual(parsed?.hash, "h4sh")
    }

    func testBareHashHasNoServer() {
        XCTAssertEqual(ShareLinkInput.parse("abcDEF123"), ShareLinkInput(hash: "abcDEF123", serverURL: nil))
    }

    func testPathWithoutSchemeGivesHashButNoServer() {
        XCTAssertEqual(ShareLinkInput.parse("/share/abc/auth"), ShareLinkInput(hash: "abc", serverURL: nil))
    }

    func testRejectsNonShareInput() {
        XCTAssertNil(ShareLinkInput.parse(""))
        XCTAssertNil(ShareLinkInput.parse("https"))
        XCTAssertNil(ShareLinkInput.parse("https://vk.example/projects/3"))
        XCTAssertNil(ShareLinkInput.parse("https://vk.example/share/abc/other"))
        XCTAssertNil(ShareLinkInput.parse("not a hash"))
    }
}

final class LinkShareLoginServiceTests: XCTestCase {
    func testPostsPasswordAndSignsInWithShareToken() async throws {
        let transport = StubTransport { _, _ in (200, #"{"token": "share-jwt"}"#, [:]) }
        let service = LoginService(core: HTTPCore(transport: transport))
        let result = try await service.signInWithLinkShare(serverURL: "https://vk.example/", hash: "abc", password: "pw")
        XCTAssertEqual(result.credentials, Credentials(serverURL: "https://vk.example", token: "share-jwt", authMethod: .linkShare))
        XCTAssertEqual(result.user.username, "link-share-abc")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://vk.example/api/v1/shares/abc/auth")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["password"] as? String, "pw")
    }

    func testSendsEmptyPasswordWhenNoneGiven() async throws {
        let transport = StubTransport { _, _ in (200, #"{"token": "share-jwt"}"#, [:]) }
        let service = LoginService(core: HTTPCore(transport: transport))
        _ = try await service.signInWithLinkShare(serverURL: "https://vk.example", hash: "abc")
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(transport.requests.first?.httpBody)) as? [String: Any])
        XCTAssertEqual(body["password"] as? String, "")
    }

    func testRefusesPlainHTTP() async throws {
        let transport = StubTransport { _, _ in (200, #"{"token": "share-jwt"}"#, [:]) }
        let service = LoginService(core: HTTPCore(transport: transport))
        do {
            _ = try await service.signInWithLinkShare(serverURL: "http://vk.example", hash: "abc")
            XCTFail("expected throw")
        } catch is InsecureDestinationError {
            XCTAssertTrue(transport.requests.isEmpty)
        }
    }

    func testPasswordRequiredIsRecognised() async throws {
        let transport = StubTransport { _, _ in (412, #"{"code": 13001, "message": "needs a password"}"#, [:]) }
        let service = LoginService(core: HTTPCore(transport: transport))
        do {
            _ = try await service.signInWithLinkShare(serverURL: "https://vk.example", hash: "abc")
            XCTFail("expected throw")
        } catch {
            XCTAssertTrue(LinkShareError.needsPassword(error))
        }
    }
}

@MainActor
final class LinkShareLoginViewModelTests: XCTestCase {
    private final class Box: @unchecked Sendable {
        var signedIn: [SignInResult] = []
    }

    private func model(_ transport: StubTransport, box: Box = Box()) -> LoginViewModel {
        let viewModel = LoginViewModel(service: LoginService(core: HTTPCore(transport: transport))) { result in
            box.signedIn.append(result)
        }
        viewModel.switchMethod(.linkShare)
        return viewModel
    }

    func testPastedLinkFillsServerAndSignsIn() async {
        let box = Box()
        let transport = StubTransport { _, _ in (200, #"{"token": "share-jwt"}"#, [:]) }
        let viewModel = model(transport, box: box)
        viewModel.shareLink = "https://vk.example/share/abc/auth"
        await viewModel.submit()
        XCTAssertEqual(viewModel.serverURL, "https://vk.example")
        XCTAssertNil(viewModel.submitError)
        XCTAssertEqual(box.signedIn.first?.credentials.authMethod, .linkShare)
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/v1/shares/abc/auth")
    }

    func testServerFieldWinsOverTheLinkOrigin() async {
        let transport = StubTransport { _, _ in (200, #"{"token": "share-jwt"}"#, [:]) }
        let viewModel = model(transport)
        viewModel.serverURL = "https://api.example"
        viewModel.shareLink = "abc"
        await viewModel.submit()
        XCTAssertEqual(transport.requests.first?.url?.absoluteString, "https://api.example/api/v1/shares/abc/auth")
    }

    func testAdoptServerReplacesTheFieldFromAPastedURL() {
        let viewModel = model(StubTransport { _, _ in (200, "{}", [:]) })
        viewModel.serverURL = "https://old.example"
        viewModel.shareLink = "https://new.example/share/abc/auth"
        viewModel.adoptServerFromShareLink()
        XCTAssertEqual(viewModel.serverURL, "https://new.example")
    }

    func testUnparseableLinkIsRejectedLocally() async {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let viewModel = model(transport)
        viewModel.serverURL = "https://vk.example"
        viewModel.shareLink = "https://vk.example/projects/3"
        await viewModel.submit()
        XCTAssertEqual(viewModel.submitError, "Paste a share link or its code.")
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testPasswordRequiredShowsTheFieldThenWrongPassword() async {
        let box = Box()
        let transport = StubTransport { request, _ in
            let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            switch body?["password"] as? String {
            case "right": return (200, #"{"token": "share-jwt"}"#, [:])
            case "": return (412, #"{"code": 13001, "message": "needs a password"}"#, [:])
            default: return (403, #"{"code": 13002, "message": "invalid"}"#, [:])
            }
        }
        let viewModel = model(transport, box: box)
        viewModel.shareLink = "https://vk.example/share/abc/auth"
        await viewModel.submit()
        XCTAssertTrue(viewModel.sharePasswordRequired)
        XCTAssertEqual(viewModel.submitError, "This share needs a password.")

        viewModel.sharePassword = "wrong"
        await viewModel.submit()
        XCTAssertEqual(viewModel.submitError, "Wrong password for this share.")
        XCTAssertTrue(box.signedIn.isEmpty)

        viewModel.sharePassword = "right"
        await viewModel.submit()
        XCTAssertNil(viewModel.submitError)
        XCTAssertEqual(box.signedIn.count, 1)
    }

    func testUnknownShareSaysSo() async {
        let viewModel = model(StubTransport { _, _ in (404, #"{"code": 2, "message": "not found"}"#, [:]) })
        viewModel.serverURL = "https://vk.example"
        viewModel.shareLink = "abc"
        await viewModel.submit()
        XCTAssertTrue(viewModel.submitError?.contains("find that share") == true)
    }
}

final class LinkShareSessionFlagTests: XCTestCase {
    func testRoundTrips() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "cria.test.linkShareFlag"))
        defaults.removePersistentDomain(forName: "cria.test.linkShareFlag")
        XCTAssertFalse(LinkShareSessionFlag.isActive(defaults: defaults))
        LinkShareSessionFlag.set(true, defaults: defaults)
        XCTAssertTrue(LinkShareSessionFlag.isActive(defaults: defaults))
        LinkShareSessionFlag.set(false, defaults: defaults)
        XCTAssertFalse(LinkShareSessionFlag.isActive(defaults: defaults))
    }
}
