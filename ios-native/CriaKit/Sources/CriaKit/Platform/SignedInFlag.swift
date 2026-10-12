import Foundation

/// Whether an account is signed in, kept in the App Group defaults for the widget, the share extension and App
/// Intents, which cannot see the app's session. The app sets it when authenticated and clears it on sign-out, so
/// nothing outside the app shows or files tasks for an account that has gone.
public enum SignedInFlag {
    static let key = "cria.signedIn"

    /// Unset counts as signed in: installs from before the flag existed have never written it, and their widget and
    /// share extension must keep working until the app next runs. Only an explicit sign-out turns it off.
    public static func isSignedIn(defaults: UserDefaults = CriaPaths.sharedDefaults()) -> Bool {
        defaults.object(forKey: key) == nil || defaults.bool(forKey: key)
    }

    public static func set(_ signedIn: Bool, defaults: UserDefaults = CriaPaths.sharedDefaults()) {
        defaults.set(signedIn, forKey: key)
    }
}
