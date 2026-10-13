import Foundation

/// Client-side checks before the account endpoints. Nil means valid. Ported from `src/lib/accountValidation.ts`.
public enum AccountValidation {
    public static func newPassword(_ password: String, confirm: String) -> String? {
        if password != confirm { return "Passwords do not match" }
        if password.count < 6 { return "Password must be at least 6 characters" }
        return nil
    }

    public static func emailAddress(_ email: String) -> String? {
        email.contains("@") ? nil : "Invalid email address"
    }
}
