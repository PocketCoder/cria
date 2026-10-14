import CriaKit
import Foundation
import Observation
import os
import UserNotifications
import WidgetKit

/// Launch stages, so a hang can be located from Console (subsystem io.cria.app, category launch).
let launchLog = Logger(subsystem: "io.cria.app", category: "launch")

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
    #if os(macOS)
    /// The Tauri desktop app's stored sign-in, adopted only when the user asks (plan Phase 8). Never read at launch: the
    /// Keychain can block on an access prompt for another app's item.
    let legacyImport: LegacyCredentialImport = {
        let importDone = "cria.tauriCredentialImportDone"
        return LegacyCredentialImport(
            slot: LegacyCredentialImport.tauriSlot(bundleIdentifier: Bundle.main.bundleIdentifier ?? ""),
            hasRun: { UserDefaults.standard.bool(forKey: importDone) },
            markRun: { UserDefaults.standard.set(true, forKey: importDone) })
    }()
    #endif

    init() {
        let core = HTTPCore()
        self.core = core
        let session = AuthSession(core: core, resolver: .shared)
        self.session = session
        self.api = ApiClient(session: session, core: core, resolver: .shared)
        self.loginService = LoginService(core: core, resolver: .shared)
    }

    func start() async {
        guard !isStarting else { return }
        isStarting = true
        defer { isStarting = false }
        launchLog.info("start: hydrating credentials")
        await session.hydrate()
        status = await session.status
        launchLog.info("start: hydrate finished")
        // Only ever set here: a Keychain that is not readable yet (before first unlock) must not blank the widget.
        if case .authenticated(let credentials) = status {
            SignedInFlag.set(true)
            LinkShareSessionFlag.set(credentials.authMethod == .linkShare)
        }
        await startServicesIfNeeded()
        launchLog.info("start: finished")
    }

    /// The launch safety net: if credentials are still loading after the spinner's grace period, show the sign-in
    /// screen rather than spin forever. A late `hydrate()` still signs the user in.
    func leaveSpinnerIfStuck() {
        guard status == .unknown else { return }
        launchLog.error("start: still unknown after the grace period, showing sign-in")
        status = .unauthenticated
    }

    /// Retries opening the database and services after a startup error or a stall.
    func retryStartup() async {
        launchLog.info("retry requested")
        startupError = nil
        await startServicesIfNeeded()
    }

    #if os(macOS)
    /// User-initiated takeover of the Tauri desktop sign-in. Returns a message to show when nothing was adopted.
    func adoptDesktopSignIn() async -> String? {
        launchLog.info("takeover: reading the desktop app's Keychain item")
        let outcome = await legacyImport.adopt(into: session)
        launchLog.info("takeover: finished")
        switch outcome {
        case .adopted:
            status = await session.status
            if case .authenticated(let credentials) = status {
                SignedInFlag.set(true)
                LinkShareSessionFlag.set(credentials.authMethod == .linkShare)
            }
            await startServicesIfNeeded()
            return nil
        case .nothingToAdopt:
            return "No usable sign-in from the Cria desktop app was found, or access was refused. Sign in below."
        case .timedOut:
            return "The Keychain did not answer. If macOS showed an access prompt, answer it and try again, or sign in below."
        case .saveFailed:
            return "The sign-in was found but could not be saved to the Keychain. Sign in below."
        }
    }
    #endif

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
            launchLog.info("services: opening database")
            let database = try CriaDatabase.open(at: CriaPaths.databaseURL(root: root))
            launchLog.info("services: database open, building services")
            let built = await AppServices(
                api: api,
                store: CriaStore(database: database),
                blobDirectory: root.appendingPathComponent("blobs", isDirectory: true),
                settings: UserSettingsService(session: session, core: core, resolver: .shared)
            )
            services = built
            startupError = nil
            launchLog.info("services: ready")
            Task { await built.start() }
        } catch {
            launchLog.error("services: failed: \(String(describing: error), privacy: .public)")
            startupError = String(describing: error)
        }
    }
}
