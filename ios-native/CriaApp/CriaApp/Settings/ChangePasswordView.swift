import CriaKit
import SwiftUI

struct ChangePasswordView: View {
    let services: AppServices
    @State private var oldPassword = ""
    @State private var newPassword = ""
    @State private var confirmation = ""
    @State private var message: String?
    @State private var succeeded = false
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                SecureField("Current password", text: $oldPassword)
                SecureField("New password", text: $newPassword)
                SecureField("Confirm new password", text: $confirmation)
            }
            if let message {
                Section { Text(message).foregroundStyle(Color(succeeded ? ThemeToken.success : ThemeToken.destructive)) }
            }
            Section {
                Button("Change password") { Task { await submit() } }
                    .disabled(busy || oldPassword.isEmpty)
            }
        }
        .criaSurface()
        .navigationTitle("Change password")
    }

    private func submit() async {
        if let problem = AccountValidation.newPassword(newPassword, confirm: confirmation) {
            message = problem
            succeeded = false
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await services.api.changePassword(old: oldPassword, new: newPassword)
            message = "Password changed"
            succeeded = true
            oldPassword = ""
            newPassword = ""
            confirmation = ""
        } catch {
            message = String(describing: error)
            succeeded = false
        }
    }
}
