import XCTest
@testable import CriaKit

final class TwoFactorTests: XCTestCase {
    func testPasscodeSanitisedAndComplete() {
        XCTAssertEqual(TotpPasscode.sanitised("123 456 789"), "123456")
        XCTAssertEqual(TotpPasscode.sanitised("ab1"), "1")
        XCTAssertTrue(TotpPasscode.isComplete("123456"))
        XCTAssertFalse(TotpPasscode.isComplete("12345"))
        XCTAssertFalse(TotpPasscode.isComplete("12345a"))
    }

    func testStatusNilWhenNotEnrolled() async throws {
        let transport = StubTransport { _, _ in (412, #"{"code": 1016, "message": "not enrolled"}"#, [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let status = try await api.totpStatus()
        XCTAssertNil(status)
    }

    func testStatusThrowsOtherErrors() async {
        let transport = StubTransport { _, _ in (500, #"{"code": 1, "message": "boom"}"#, [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        do {
            _ = try await api.totpStatus()
            XCTFail("expected a throw")
        } catch {
            XCTAssertEqual((error as? ApiError)?.status, 500)
        }
    }

    func testEnrolAndEnableAndDisable() async throws {
        let json = #"{"enabled": false, "secret": "ABC", "url": "otpauth://totp/x"}"#
        let transport = StubTransport { _, _ in (200, json, ["Content-Type": "application/json"]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let status = try await api.enrollTotp()
        XCTAssertEqual(status, TotpStatus(enabled: false, secret: "ABC", url: "otpauth://totp/x"))
        try await api.enableTotp(passcode: "123456")
        try await api.disableTotp(password: "pw")
        let paths = transport.requests.map { $0.url?.path ?? "" }
        XCTAssertEqual(paths, ["/api/v1/user/settings/totp/enroll", "/api/v1/user/settings/totp/enable",
                               "/api/v1/user/settings/totp/disable"])
        let enable = try XCTUnwrap(transport.requests[1].httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] })
        XCTAssertEqual(enable, ["passcode": "123456"])
    }
}
