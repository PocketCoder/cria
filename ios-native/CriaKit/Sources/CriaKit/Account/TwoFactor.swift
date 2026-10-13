import Foundation

/// TOTP enrolment state from `GET /user/settings/totp` and `POST /user/settings/totp/enroll`.
/// Ported from `TotpStatus` in `src/api/account.ts`.
public struct TotpStatus: Equatable, Sendable {
    public let enabled: Bool
    /// Base32 secret, present after enrolling.
    public let secret: String?
    /// `otpauth://` URL, present after enrolling.
    public let url: String?

    public init(enabled: Bool = false, secret: String? = nil, url: String? = nil) {
        self.enabled = enabled
        self.secret = secret
        self.url = url
    }

    init(_ row: JSONValue) {
        enabled = row["enabled"]?.boolValue ?? false
        secret = row["secret"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        url = row["url"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
    }
}

/// The authenticator code: exactly six digits, as `SecurityTab.tsx` requires before enabling.
public enum TotpPasscode {
    public static let length = 6

    /// Keeps digits only and caps the length, so a pasted "123 456" becomes "123456".
    public static func sanitised(_ input: String) -> String {
        String(input.filter(\.isNumber).prefix(length))
    }

    public static func isComplete(_ input: String) -> Bool {
        input.count == length && input.allSatisfy(\.isNumber)
    }
}

/// Server error code for "TOTP is not enrolled" (HTTP 412), which the client reads as "no status".
let totpNotEnrolledCode = 1016

public extension ApiClient {
    /// Nil when TOTP has not been enrolled (412 with code 1016).
    func totpStatus() async throws -> TotpStatus? {
        let response = try await send(.get, "/user/settings/totp")
        if response.isSuccess { return TotpStatus(try response.decoded(JSONValue.self)) }
        let error = buildApiError(status: response.status, body: response.data)
        if error.code == totpNotEnrolledCode { return nil }
        throw error
    }

    /// Starts enrolment: the server generates a secret and returns it with the otpauth URL.
    func enrollTotp() async throws -> TotpStatus {
        let row: JSONValue = try await post("/user/settings/totp/enroll")
        return TotpStatus(row)
    }

    func enableTotp(passcode: String) async throws {
        try await perform(.post, "/user/settings/totp/enable", body: AccountRequests.enableTotp(passcode: passcode))
    }

    func disableTotp(password: String) async throws {
        try await perform(.post, "/user/settings/totp/disable", body: AccountRequests.passwordOnly(password))
    }

    /// PNG bytes of the enrolment QR code.
    func totpQRCode() async throws -> Data {
        let response = try await send(.get, "/user/settings/totp/qrcode")
        try response.requireSuccess()
        return response.data
    }
}
