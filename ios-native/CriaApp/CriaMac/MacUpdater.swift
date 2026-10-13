import Sparkle
import SwiftUI

/// Sparkle's standard updater. It only starts when the build carries a public key (`SUPublicEDKey`), so a build made
/// before the key exists, or a local one, never prompts about updates it could not verify.
@MainActor
final class MacUpdater: ObservableObject {
    static let shared = MacUpdater()

    let controller: SPUStandardUpdaterController
    let isConfigured: Bool

    private init() {
        let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
        isConfigured = !key.isEmpty
        controller = SPUStandardUpdaterController(startingUpdater: isConfigured, updaterDelegate: nil, userDriverDelegate: nil)
    }

    func checkForUpdates() { controller.checkForUpdates(nil) }
}

/// "Check for Updates…" in the app menu.
struct CheckForUpdatesCommand: View {
    @ObservedObject var updater: MacUpdater

    var body: some View {
        Button("Check for Updates…") { updater.checkForUpdates() }
            .disabled(!updater.isConfigured)
    }
}
