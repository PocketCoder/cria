import XCTest
@testable import CriaKit

@MainActor
final class LoginViewModelTests: XCTestCase {
    private final class Box: @unchecked Sendable {
        var signedIn: [SignInResult] = []
    }

    private let userJSON = #"{"id": 3, "username": "ada"}"#

    private func model(_ transport: StubTransport, box: Box = Box()) -> (LoginViewModel, Box) {
        let viewModel = LoginViewModel(service: LoginService(core: HTTPCore(transport: transport))) { result in
            box.signedIn.append(result)
        }
        viewModel.serverURL = "https://vk.example"
        return (viewModel, box)
    }

    func testInvalidServerURLShowsFieldError() async {
        let (viewModel, box) = model(StubTransport { _, _ in (200, "{}", [:]) })
        viewModel.serverURL = "http://example.com"
        await viewModel.submit()
        XCTAssertEqual(viewModel.serverURLError, LoginValidation.invalidURLMessage)
        XCTAssertTrue(box.signedIn.isEmpty)
    }

    func testShortTokenIsRejectedLocally() async {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let (viewModel, _) = model(transport)
        viewModel.token = "short"
        await viewModel.submit()
        XCTAssertEqual(viewModel.submitError, "Paste your API token from Vikunja settings.")
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testTokenSignInSucceeds() async {
        let user = userJSON
        let (viewModel, box) = model(StubTransport { _, _ in (200, user, [:]) })
        viewModel.token = "  pat_12345678 "
        await viewModel.submit()
        XCTAssertNil(viewModel.submitError)
        XCTAssertFalse(viewModel.isSubmitting)
        XCTAssertEqual(box.signedIn.first?.credentials.token, "pat_12345678")
        XCTAssertEqual(box.signedIn.first?.credentials.authMethod, .token)
    }

    func testRejectedTokenShowsFriendlyError() async {
        let (viewModel, box) = model(StubTransport { _, _ in (401, "{}", [:]) })
        viewModel.token = "pat_12345678"
        await viewModel.submit()
        XCTAssertTrue(viewModel.submitError?.contains("rejected") == true)
        XCTAssertTrue(box.signedIn.isEmpty)
    }

    func testPasswordRequiresBothFields() async {
        let (viewModel, _) = model(StubTransport { _, _ in (200, "{}", [:]) })
        viewModel.switchMethod(.password)
        viewModel.username = "ada"
        await viewModel.submit()
        XCTAssertEqual(viewModel.submitError, "Enter your username and password.")
    }

    func testTotpFlowAsksThenAcceptsCode() async throws {
        let user = userJSON
        let transport = StubTransport { request, _ in
            if request.url?.path == "/api/v1/user" { return (200, user, [:]) }
            let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            return body?["totp_passcode"] as? String == "123456"
                ? (200, #"{"token": "jwt"}"#, [:])
                : (412, #"{"code": 1017, "message": "totp"}"#, [:])
        }
        let (viewModel, box) = model(transport)
        viewModel.switchMethod(.password)
        viewModel.username = "ada"
        viewModel.password = "pw"
        await viewModel.submit()
        XCTAssertTrue(viewModel.totpRequired)
        XCTAssertNil(viewModel.submitError)

        viewModel.totpCode = "000000"
        await viewModel.submit()
        XCTAssertEqual(viewModel.submitError, "Invalid two-factor code. Try again.")

        viewModel.totpCode = "123456"
        await viewModel.submit()
        XCTAssertNil(viewModel.submitError)
        XCTAssertEqual(box.signedIn.first?.credentials.authMethod, .password)
    }

    func testSwitchMethodResetsTransientState() async {
        let (viewModel, _) = model(StubTransport { _, _ in (412, "{}", [:]) })
        viewModel.switchMethod(.password)
        viewModel.username = "a"
        viewModel.password = "b"
        await viewModel.submit()
        XCTAssertTrue(viewModel.totpRequired)
        viewModel.switchMethod(.token)
        XCTAssertFalse(viewModel.totpRequired)
        XCTAssertNil(viewModel.submitError)
    }

    func testPersistenceFailureIsShown() async {
        struct Boom: Error, LocalizedError { var errorDescription: String? { "Keychain locked" } }
        let user = userJSON
        let viewModel = LoginViewModel(service: LoginService(core: HTTPCore(transport: StubTransport { _, _ in (200, user, [:]) }))) { _ in
            throw Boom()
        }
        viewModel.serverURL = "https://vk.example"
        viewModel.token = "pat_12345678"
        await viewModel.submit()
        XCTAssertEqual(viewModel.submitError, "Keychain locked")
    }
}
