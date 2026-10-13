import XCTest
@testable import CriaKit

final class LoginServiceTests: XCTestCase {
    private func service(_ transport: StubTransport) -> LoginService {
        LoginService(core: HTTPCore(transport: transport))
    }

    func testPasswordLoginReadsTokenAndCookie() async throws {
        let transport = StubTransport { _, _ in
            (200, #"{"token": "jwt"}"#, ["Set-Cookie": "vikunja_refresh_token=r1; Path=/; HttpOnly"])
        }
        let result = try await service(transport).loginWithPassword(serverURL: "https://vk.example/", username: "ada", password: "pw")
        XCTAssertEqual(result, PasswordLoginResult(token: "jwt", refreshToken: "r1"))
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://vk.example/api/v1/login")
        XCTAssertEqual(request.httpMethod, "POST")
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["username"] as? String, "ada")
        XCTAssertEqual(body["long_token"] as? Bool, true)
        XCTAssertNil(body["totp_passcode"])
    }

    func testPasswordLoginSendsTotpWhenGiven() async throws {
        let transport = StubTransport { _, _ in (200, #"{"token": "jwt"}"#, [:]) }
        let result = try await service(transport).loginWithPassword(
            serverURL: "https://vk.example", username: "a", password: "b", totpPasscode: "123456")
        XCTAssertNil(result.refreshToken)
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(transport.requests.first?.httpBody)) as? [String: Any])
        XCTAssertEqual(body["totp_passcode"] as? String, "123456")
    }

    func testTotpRequiredSurfacesAs412() async throws {
        let transport = StubTransport { _, _ in (412, #"{"code": 1017, "message": "Invalid totp passcode"}"#, [:]) }
        do {
            _ = try await service(transport).loginWithPassword(serverURL: "https://vk.example", username: "a", password: "b")
            XCTFail("expected throw")
        } catch {
            XCTAssertTrue(isTotpRequired(error))
        }
    }

    func testRefusesPasswordOverPlainHTTP() async throws {
        let transport = StubTransport { _, _ in (200, #"{"token": "jwt"}"#, [:]) }
        do {
            _ = try await service(transport).loginWithPassword(serverURL: "http://vk.example", username: "a", password: "b")
            XCTFail("expected throw")
        } catch is InsecureDestinationError {
            XCTAssertTrue(transport.requests.isEmpty)
        }
    }

    func testMissingTokenIsAnError() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        do {
            _ = try await service(transport).loginWithPassword(serverURL: "https://vk.example", username: "a", password: "b")
            XCTFail("expected throw")
        } catch is ApiError {}
    }

    func testPasswordSignInFetchesUser() async throws {
        let transport = StubTransport { request, _ in
            request.url?.path == "/api/v1/login"
                ? (200, #"{"token": "jwt"}"#, ["Set-Cookie": "vikunja_refresh_token=r1"])
                : (200, #"{"id": 3, "username": "ada"}"#, [:])
        }
        let result = try await service(transport).signInWithPassword(serverURL: "https://vk.example/", username: "ada", password: "pw")
        let expected = Credentials(serverURL: "https://vk.example", token: "jwt", authMethod: .password, refreshToken: "r1")
        XCTAssertEqual(result.credentials, expected)
        XCTAssertEqual(result.user.username, "ada")
        XCTAssertEqual(header(transport.requests[1], "Authorization"), "Bearer jwt")
    }

    func testTokenSignInVerifiesWithUserEndpoint() async throws {
        let transport = StubTransport { _, _ in (200, #"{"id": 3, "username": "ada"}"#, [:]) }
        let result = try await service(transport).signInWithToken(serverURL: "https://vk.example", token: "pat_abcdef12")
        XCTAssertEqual(result.credentials.authMethod, .token)
        XCTAssertNil(result.credentials.refreshToken)
        XCTAssertEqual(header(transport.requests[0], "Authorization"), "Bearer pat_abcdef12")
    }

    func testRejectedTokenThrows401() async throws {
        let transport = StubTransport { _, _ in (401, #"{"message": "no"}"#, [:]) }
        do {
            _ = try await service(transport).signInWithToken(serverURL: "https://vk.example", token: "bad")
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 401)
        }
    }
}
