import CriaKit
import Foundation
import Observation

/// Top-level app state: owns the auth session, and once signed in the local store and sync services.
@MainActor @Observable
final class AppModel {
    private(set) var status: AuthStatus = .unknown
    private(set) var services: AppServices?
    private(set) var startupError: String?
    let session: AuthSession
    let api: ApiClient
    private let loginService: LoginService
    private let core: HTTPCore

    private static let appGroup = "group.io.cria.app"

    init() {
        let core = HTTPCore()
        self.core = core
        let session = AuthSession(core: core)
        self.session = session
        self.api = ApiClient(session: session, core: core)
        self.loginService = LoginService(core: core)
    }

    func start() async {
        await session.hydrate()
        status = await session.status
        await startServicesIfNeeded()
    }

    func signedIn(_ result: SignInResult) async throws {
        try await session.signIn(result.credentials)
        status = await session.status
        await startServicesIfNeeded()
    }

    /// `wipeLocalData` also deletes the database, queued blobs and cached backgrounds.
    func signOut(wipeLocalData: Bool = false) async {
        await services?.stop()
        services = nil
        await session.signOut()
        status = await session.status
        if wipeLocalData {
            try? LocalDataWipe.wipe(root: Self.dataDirectory())
        }
    }

    func setSyncActive(_ isActive: Bool) async {
        await services?.coordinator.setActive(isActive)
    }

    func makeLoginModel() -> LoginViewModel {
        LoginViewModel(service: loginService) { [weak self] result in
            try await self?.signedIn(result)
        }
    }

    private func startServicesIfNeeded() async {
        guard case .authenticated = status, services == nil else { return }
        do {
            let root = Self.dataDirectory()
            let database = try CriaDatabase.open(at: root.appendingPathComponent("cria.sqlite"))
            let built = await AppServices(
                api: api,
                store: CriaStore(database: database),
                blobDirectory: root.appendingPathComponent("blobs", isDirectory: true),
                settings: UserSettingsService(session: session, core: core)
            )
            services = built
            startupError = nil
            Task { await built.start() }
        } catch {
            startupError = String(describing: error)
        }
    }

    /// The App Group container when the build is signed with the group (S-00 decision), else Application Support.
    private static func dataDirectory() -> URL {
        let fileManager = FileManager.default
        if let group = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return group
        }
        let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        return (support ?? fileManager.temporaryDirectory).appendingPathComponent("Cria", isDirectory: true)
    }
}
