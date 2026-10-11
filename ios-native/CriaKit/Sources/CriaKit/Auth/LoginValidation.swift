import Foundation

/// Client-side checks and error text for the login and account forms.
/// Ported from `serverUrlSchema` and `messageFor` in `loginHelpers.ts` and from `accountValidation.ts`.
public enum LoginValidation {
    static let loopbackHosts: Set<String> = ["localhost", "127.0.0.1", "::1", "[::1]"]
    public static let invalidURLMessage = "Use https:// or a loopback address (localhost/127.0.0.1) for http://"
    public static let minimumTokenLength = 8

    /// Returns the trimmed URL without trailing slashes, or the reason it is unacceptable.
    public static func validateServerURL(_ input: String) -> Result<String, ValidationError> {
        let trimmed = normalizeBase(input.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !trimmed.isEmpty, !trimmed.contains(" "), let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(), let host = url.host, !host.isEmpty,
              scheme == "https" || scheme == "http" else {
            return .failure(ValidationError(message: "Enter a valid server URL."))
        }
        if scheme == "https" || loopbackHosts.contains(host.lowercased()) { return .success(trimmed) }
        return .failure(ValidationError(message: invalidURLMessage))
    }

    public static func message(for error: Error) -> String {
        if let api = error as? ApiError {
            switch api.status {
            case 401, 403: return "That was rejected. Double-check your credentials."
            case 404: return "Couldn't find a Vikunja API at that URL. Is /api/v1 reachable?"
            default: return api.message.isEmpty ? "Server returned HTTP \(api.status)." : api.message
            }
        }
        if error is NetworkError { return "Couldn't reach the server. Check the URL and your connection." }
        if let insecure = error as? InsecureDestinationError { return insecure.message }
        let text = error.localizedDescription
        return text.isEmpty ? "Sign-in failed." : text
    }

    /// Nil means valid. Mismatch is checked before length, as in `validateNewPassword`.
    public static func validateNewPassword(_ newPassword: String, confirm: String) -> String? {
        if newPassword != confirm { return "Passwords do not match" }
        if newPassword.count < 6 { return "Password must be at least 6 characters" }
        return nil
    }

    public static func validateEmail(_ email: String) -> String? {
        email.contains("@") ? nil : "Invalid email address"
    }
}

public struct ValidationError: Error, Equatable, Sendable {
    public let message: String
}
