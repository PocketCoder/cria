import Foundation

/// A non-2xx response. Ported from `src/api/errors.ts`.
public struct ApiError: Error, Equatable, Sendable, CustomStringConvertible {
    public let status: Int
    public let code: Int?
    public let message: String
    public let retryable: Bool
    /// The op is blocked on an un-synced dependency; the drain loop must not count it as an attempt.
    public let dependency: Bool

    public init(status: Int, code: Int?, message: String, retryable: Bool, dependency: Bool = false) {
        self.status = status
        self.code = code
        self.message = message
        self.retryable = retryable
        self.dependency = dependency
    }

    public var description: String { message }
}

/// Transport failure (offline, timeout, DNS, circuit open). Always retryable.
public struct NetworkError: Error, Equatable, Sendable, CustomStringConvertible {
    public let message: String
    public let retryable = true

    public init(_ message: String) {
        self.message = message
    }

    public var description: String { message }
}

public struct AuthRequiredError: Error, Equatable, Sendable {
    public init() {}
}

/// Refusal to send credentials over plaintext (non-https, non-loopback).
public struct InsecureDestinationError: Error, Equatable, Sendable, CustomStringConvertible {
    public let message: String
    public var description: String { message }
}

public func classifyRetryable(status: Int) -> Bool {
    status >= 500 || status == 408 || status == 429
}

/// Builds an `ApiError` from a response body. Parses Vikunja's `{code, message}` envelope defensively,
/// falling back to the first 200 characters of plain text, then `HTTP <status>`.
public func buildApiError(status: Int, body: Data?) -> ApiError {
    var code: Int?
    var message = "HTTP \(status)"
    if let body, !body.isEmpty {
        if let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            if let parsed = object["code"] as? Int { code = parsed }
            if let text = object["message"] as? String, !text.isEmpty { message = text }
        } else if let text = String(data: body, encoding: .utf8), !text.isEmpty {
            message = String(text.prefix(200))
        }
    }
    return ApiError(status: status, code: code, message: message, retryable: classifyRetryable(status: status))
}

/// Vikunja answers 412 when a TOTP passcode is required to finish a password login.
public func isTotpRequired(_ error: Error) -> Bool {
    (error as? ApiError)?.status == 412
}

/// Cross-stack "is this an offline failure?" check, so the UI can show a friendlier message.
/// Ported from `src/lib/errors.ts`, plus the URLSession equivalents.
public func isOfflineError(_ error: Error) -> Bool {
    if error is NetworkError { return true }
    if let urlError = error as? URLError {
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost,
             .timedOut, .dnsLookupFailed, .dataNotAllowed:
            return true
        default:
            break
        }
    }
    let text = String(describing: error)
    return text.range(of: "error sending request|Failed to fetch|Load failed|NetworkError",
                      options: [.regularExpression, .caseInsensitive]) != nil
}
