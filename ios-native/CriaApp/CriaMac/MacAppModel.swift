import CriaKit
import Foundation
import Observation

/// Top-level state for the Mac app: the auth session, and once signed in the local store and sync services. A
/// trimmed copy of the iOS `AppModel` (no widgets, Spotlight or notifications yet); Phase 1 shares the original.
@MainActor @Observable
final class MacAppModel {
    private(set) var status: AuthStatus = .unknown
    private(set) var services: AppServices?
    private(set) var startupError: String?
    let session: AuthSession
    let api: ApiClient
    private let loginService: LoginService
    private let core: HTTPCore
    private var isStarting = false
    private var isStartingServices = false

    init() {
        let core = HTTPCore()
        self.core = core
        let session = AuthSession(core: core)
        self.session = session
        self.api = ApiClient(session: session, core: core)
        self.loginService = LoginService(core: core)
    }

    func start() async {
        guard !isStarting else { return }
        isStarting = true
        defer { isStarting = false }
        await session.hydrate()
        status = await session.status
        await startServicesIfNeeded()
    }

    func signedIn(_ result: SignInResult) async throws {
        try await session.signIn(result.credentials)
        status = await session.status
        await startServicesIfNeeded()
    }

    func signOut() async {
        await services?.stop()
        services = nil
        await session.signOut()
        status = await session.status
    }

    func setSyncActive(_ isActive: Bool) async {
        // The Keychain was not readable at launch: try again now the user is here.
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
                blobDirectory: CriaPaths.blobDirectory(root: root),
                settings: UserSettingsService(session: session, core: core)
            )
            services = built
            startupError = nil
            Task { await built.start() }
        } catch {
            startupError = String(describing: error)
        }
    }
}
