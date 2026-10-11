import CriaKit
import Observation

/// Top-level app state: owns the auth session and exposes its status to SwiftUI.
@MainActor @Observable
final class AppModel {
    private(set) var status: AuthStatus = .unknown
    let session: AuthSession
    let api: ApiClient
    private let loginService: LoginService

    init() {
        let core = HTTPCore()
        let session = AuthSession(core: core)
        self.session = session
        self.api = ApiClient(session: session, core: core)
        self.loginService = LoginService(core: core)
    }

    func start() async {
        await session.hydrate()
        status = await session.status
    }

    func signedIn(_ result: SignInResult) async throws {
        try await session.signIn(result.credentials)
        status = await session.status
    }

    func signOut() async {
        await session.signOut()
        status = await session.status
    }

    func makeLoginModel() -> LoginViewModel {
        LoginViewModel(service: loginService) { [weak self] result in
            try await self?.signedIn(result)
        }
    }
}
