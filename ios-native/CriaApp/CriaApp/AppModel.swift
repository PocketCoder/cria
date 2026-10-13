import CriaKit
import Foundation
import Observation
import UserNotifications
import WidgetKit

/// Top-level app state: owns the auth session, and once signed in the local store and sync services.
@MainActor @Observable
final class AppModel {
    private(set) var status: AuthStatus = .unknown
    private(set) var services: AppServices?
    private(set) var startupError: String?
    /// A `cria://` link or Spotlight hit that arrived before the shell could act on it.
    var pendingURL: URL?
    let session: AuthSession
    let api: ApiClient
    private let loginService: LoginService
    private let core: HTTPCore
    /// Set while `start()` or `startServicesIfNeeded()` is running, so overlapping calls (a second scene, a sign-in
    /// racing the launch) cannot open the database twice.
    private var isStarting = false
    private var isStartingServices = false
    /// Why "delete local data" did not finish, for an alert. The account is signed out either way.
    private(set) var wipeError: String?

    init() {
        let core = HTTPCore()
        self.core = core
        #if os(macOS)
        // A Mac that used the Tauri desktop app signs in with its stored credential, once (plan Phase 8).
        let importDone = "cria.tauriCredentialImportDone"
        let legacy = LegacyCredentialImport(
            slot: LegacyCredentialImport.tauriSlot(bundleIdentifier: Bundle.main.bundleIdentifier ?? ""),
            hasRun: { UserDefaults.standard.bool(forKey: importDone) },
            markRun: { UserDefaults.standard.set(true, forKey: importDone) })
        let session = AuthSession(core: core, legacyImport: legacy, resolver: .shared)
        #else
        let session = AuthSession(core: core, resolver: .shared)
        #endif
        self.session = session
        self.api = ApiClient(session: session, core: core, resolver: .shared)
        self.loginService = LoginService(core: core, resolver: .shared)
    }

    func start() async {
        guard !isStarting else { return }
        isStarting = true
        defer { isStarting = false }
        await session.hydrate()
        status = await session.status
        // Only ever set here: a Keychain that is not readable yet (before first unlock) must not blank the widget.
        if case .authenticated(let credentials) = status {
            SignedInFlag.set(true)
            LinkShareSessionFlag.set(credentials.authMethod == .linkShare)
        }
        await startServicesIfNeeded()
    }

    func signedIn(_ result: SignInResult) async throws {
        try await session.signIn(result.credentials)
        status = await session.status
        if case .authenticated = status {
            SignedInFlag.set(true)
            LinkShareSessionFlag.set(result.credentials.authMethod == .linkShare)
        }
        await startServicesIfNeeded()
    }

    /// `wipeLocalData` also deletes the database, queued blobs and cached backgrounds.
    func signOut(wipeLocalData: Bool = false) async {
        // First, so the widget, extensions and an in-flight reminder pass stop treating the account as signed in.
        SignedInFlag.set(false)
        LinkShareSessionFlag.set(false)
        await services?.stop()
        services = nil
        await session.signOut()
        status = await session.status
        // The previous account's task titles must not stay in system search, Notification Centre or on the Home Screen.
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
        await SpotlightIndexer.clear()
        if wipeLocalData { await wipeLocalFiles() }
        // After any wipe, so the widget does not read the old database one last time.
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Gives the views that still hold the store a moment to go away before the files are deleted, so the database is
    /// not unlinked while open. A failure is reported, not hidden.
    private func wipeLocalFiles() async {
        try? await Task.sleep(nanoseconds: 600_000_000)
        do {
            try LocalDataWipe.wipe(root: CriaPaths.dataDirectory())
            LocalDataWipe.forgetAccount()
            wipeError = nil
        } catch {
            wipeError = String(describing: error)
        }
    }

    func dismissWipeError() {
        wipeError = nil
    }

    func setSyncActive(_ isActive: Bool) async {
        // The Keychain was not readable at launch (before first unlock): try again now the user is here.
        if isActive, case .unauthenticated = status, await session.credentialsUnavailable { await start() }
        await services?.coordinator.setActive(isActive)
    }

    func makeLoginModel() -> LoginViewModel {
        LoginViewModel(service: loginService) { [weak self] result in
            try await self?.signedIn(result)
        }
    }

    private func startServicesIfNeeded() async {
        guard case .authenticated = status, services == nil, !isStartingServices else { return }
        isStartingServices = true
        defer { isStartingServices = false }
        do {
            let root = CriaPaths.dataDirectory()
            let database = try CriaDatabase.open(at: CriaPaths.databaseURL(root: root))
            let built = await AppServices(
                api: api,
                store: CriaStore(database: database),
                blobDirectory: root.appendingPathComponent("blobs", isDirectory: true),
                settings: UserSettingsService(session: session, core: core, resolver: .shared)
            )
            services = built
            startupError = nil
            Task { await built.start() }
        } catch {
            startupError = String(describing: error)
        }
    }
}
