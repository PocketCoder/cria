import CriaKit
import SwiftUI

/// The last Settings section: plain sign out, or sign out and delete this device's copy (database, queued uploads and
/// cached backgrounds, which the widget and share extension also read). The delete asks first and says how many
/// changes have not reached the server, since those are lost with it.
struct SignOutSettingsSection: View {
    let services: AppServices
    let version: String
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var wipePrompt: WipePrompt?

    /// Counts read when the button is tapped. Nil when the queue could not be read.
    struct WipePrompt {
        let pending: Int?
        let failed: Int?
    }

    var body: some View {
        Section {
            Button(role: .destructive) { onSignOut(false) } label: {
                Text("Sign out").frame(maxWidth: .infinity)
            }
            Button(role: .destructive) { askToWipe() } label: {
                Text("Sign out and delete data on this iPhone").frame(maxWidth: .infinity)
            }
        } footer: {
            Text("Cria \(version) ").frame(maxWidth: .infinity)
        }
        .alert(
            "Delete data on this iPhone?",
            isPresented: Binding(get: { wipePrompt != nil }, set: { if !$0 { wipePrompt = nil } }),
            presenting: wipePrompt
        ) { _ in
            Button("Sign Out and Delete", role: .destructive) { onSignOut(true) }
            Button("Cancel", role: .cancel) {}
        } message: { prompt in
            Text(Self.message(for: prompt))
        }
    }

    private func askToWipe() {
        let store = services.store
        wipePrompt = WipePrompt(pending: try? store.outboxCount(), failed: try? store.deadLetters().count)
    }

    static func message(for prompt: WipePrompt) -> String {
        var parts: [String] = []
        switch prompt.pending {
        case .none:
            parts.append("Changes that have not reached the server yet will be lost.")
        case .some(0):
            parts.append("Every change on this iPhone has reached the server.")
        case .some(let count):
            parts.append("\(changes(count)) on this iPhone \(count == 1 ? "has" : "have") not reached the server yet and will be lost.")
        }
        if let failed = prompt.failed, failed > 0 {
            parts.append("\(changes(failed)) that failed to sync will also be lost.")
        }
        parts.append("Your tasks on the server are not affected.")
        return parts.joined(separator: " ")
    }

    private static func changes(_ count: Int) -> String {
        count == 1 ? "1 change" : "\(count) changes"
    }
}
