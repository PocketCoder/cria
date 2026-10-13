import Foundation
import Observation

/// State and submit flow of the login screen. Ported from `LoginScreen.tsx` (token, password and share link methods).
@MainActor @Observable
public final class LoginViewModel {
    public enum Method: String, CaseIterable, Sendable {
        case token, password, linkShare
    }

    public var method: Method = .token
    public var serverURL = ""
    public var token = ""
    public var username = ""
    public var password = ""
    public var totpCode = ""
    /// A share URL or its bare hash.
    public var shareLink = ""
    public var sharePassword = ""
    /// Keep the username (never the password) for the next sign-in to this server. Password sign-in only.
    public var rememberMe = true

    public private(set) var serverURLError: String?
    public private(set) var submitError: String?
    public private(set) var totpRequired = false
    /// Set once the server said the share has a password, so the field is shown.
    public private(set) var sharePasswordRequired = false
    public private(set) var isSubmitting = false
    /// Servers signed in to before, newest first, for the quick-pick chips. Empty until `adoptRecentServers`.
    public private(set) var recentServers: [String] = []

    @ObservationIgnored private var recentStore: RecentServers?
    /// The address that passed validation in the current submit, for remembering it once the sign-in works.
    @ObservationIgnored private var validatedURL: String?
    private let service: LoginService
    private let onSignedIn: @MainActor (SignInResult) async throws -> Void

    /// `onSignedIn` persists the session (`AuthSession.signIn`) and caches the user.
    public init(service: LoginService = LoginService(), onSignedIn: @escaping @MainActor (SignInResult) async throws -> Void) {
        self.service = service
        self.onSignedIn = onSignedIn
    }

    public func switchMethod(_ newMethod: Method) {
        method = newMethod
        submitError = nil
        totpRequired = false
        totpCode = ""
        serverURLError = nil
    }

    /// Starts using the recent-server list: loads it, and when the server field is still empty fills it (and the
    /// username remembered for it) from the newest entry. A remembered username also opens the Password tab.
    public func adoptRecentServers(_ store: RecentServers) {
        guard recentStore == nil else { return }
        recentStore = store
        recentServers = store.servers()
        guard serverURL.isEmpty, let latest = recentServers.first else { return }
        pickServer(latest)
        if !username.isEmpty { method = .password }
    }

    /// A tap on a recent-server chip.
    public func pickServer(_ server: String) {
        serverURL = server
        serverURLError = nil
        if let saved = recentStore?.username(for: server) { username = saved }
    }

    public func forgetServer(_ server: String) {
        recentStore?.forget(server: server)
        recentServers = recentStore?.servers() ?? []
    }

    /// Fills the server field from a pasted share URL, so pasting the link is enough. The field stays editable for
    /// servers whose web app and API live on different hosts.
    public func adoptServerFromShareLink() {
        guard let server = ShareLinkInput.parse(shareLink)?.serverURL else { return }
        serverURL = server
        serverURLError = nil
    }

    public func submit() async {
        submitError = nil
        if method == .linkShare, serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            adoptServerFromShareLink()
        }
        let url: String
        switch LoginValidation.validateServerURL(serverURL) {
        case .failure(let failure):
            serverURLError = failure.message
            return
        case .success(let value):
            serverURLError = nil
            url = value
            validatedURL = value
        }

        switch method {
        case .token:
            let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count >= LoginValidation.minimumTokenLength else {
                submitError = "Paste your API token from Vikunja settings."
                return
            }
            await run { try await self.service.signInWithToken(serverURL: url, token: trimmed) }
        case .password:
            guard !username.isEmpty, !password.isEmpty else {
                submitError = "Enter your username and password."
                return
            }
            await submitPassword(url: url)
        case .linkShare:
            guard let share = ShareLinkInput.parse(shareLink) else {
                submitError = "Paste a share link or its code."
                return
            }
            await submitLinkShare(url: url, hash: share.hash)
        }
    }

    private func submitLinkShare(url: String, hash: String) async {
        let password = sharePassword.isEmpty ? nil : sharePassword
        await run(handleError: { error in
            if LinkShareError.needsPassword(error) {
                self.sharePasswordRequired = true
                self.submitError = password == nil ? "This share needs a password." : "Wrong password for this share."
                return true
            }
            guard (error as? ApiError)?.status == 404 else { return false }
            self.submitError = "Couldn\u{2019}t find that share on this server. Check the link and the server URL."
            return true
        }, {
            try await self.service.signInWithLinkShare(serverURL: url, hash: hash, password: password)
        })
    }

    private func submitPassword(url: String) async {
        let code = totpCode.trimmingCharacters(in: .whitespaces)
        let passcode: String? = totpRequired && !code.isEmpty ? code : nil
        let wasTotpStep = totpRequired
        await run(handleError: { error in
            guard isTotpRequired(error) else { return false }
            // 412 with no code yet asks for one; 412 after a code means the code was wrong.
            self.totpRequired = true
            self.submitError = wasTotpStep ? "Invalid two-factor code. Try again." : nil
            return true
        }, {
            try await self.service.signInWithPassword(serverURL: url, username: self.username, password: self.password,
                                                      totpPasscode: passcode)
        })
    }

    private func run(handleError: ((Error) -> Bool)? = nil, _ operation: @escaping () async throws -> SignInResult) async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let result = try await operation()
            try await onSignedIn(result)
            rememberSignIn()
        } catch {
            if handleError?(error) == true { return }
            submitError = LoginValidation.message(for: error)
        }
    }

    /// Only once the server has accepted the credentials. The username is kept for password sign-ins with
    /// "Remember me" on; the password is never stored.
    private func rememberSignIn() {
        guard let recentStore, let url = validatedURL else { return }
        let keepName = method == .password && rememberMe
        recentStore.remember(server: url, username: keepName ? username : nil)
        recentServers = recentStore.servers()
    }
}
