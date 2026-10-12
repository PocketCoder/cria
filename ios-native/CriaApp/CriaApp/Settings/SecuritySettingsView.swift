import CriaKit
import SwiftUI
import UIKit

/// Security: password, email and two-factor authentication. Ported from `SecurityTab.tsx`; sessions live on
/// their own screen (`SessionsView`).
struct SecuritySettingsView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var needsSignIn = false

    init(services: AppServices, onSignOut: @escaping (_ wipeLocalData: Bool) -> Void) {
        self.services = services
        self.onSignOut = onSignOut
    }

    var body: some View {
        Form {
            Section {
                NavigationLink {
                    ChangePasswordView(services: services, onSignOut: onSignOut)
                } label: {
                    SettingsLabel("Change password", symbol: "key", token: .llama800)
                }
            } header: {
                Text("Password")
            }
            EmailSections(services: services)
            TotpSections(services: services, needsSignIn: $needsSignIn)
            Section {
                NavigationLink {
                    SessionsView(services: services, onSignOut: onSignOut)
                } label: {
                    SettingsLabel("Sessions", symbol: "iphone.and.arrow.forward", token: .sky500)
                }
            }
        }
        .criaSurface()
        .tint(Color(.primary))
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Two-factor enabled", isPresented: $needsSignIn) {
            Button("OK") { onSignOut(false) }
        } message: {
            Text("The server ended all your sessions, including this one. You will need to sign in again.")
        }
    }
}

/// Inline feedback line: success in the success colour, failure in destructive.
struct AccountFeedback: View {
    let message: String
    let succeeded: Bool

    var body: some View {
        Text(message)
            .font(Theme.caption)
            .foregroundStyle(Color(succeeded ? ThemeToken.successText : ThemeToken.destructive))
    }
}

private struct EmailSections: View {
    let services: AppServices
    @State private var newEmail = ""
    @State private var password = ""
    @State private var message: String?
    @State private var succeeded = false
    @State private var busy = false

    var body: some View {
        Section {
            TextField("New email address", text: $newEmail)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Current password", text: $password)
                .textContentType(.password)
            if let message { AccountFeedback(message: message, succeeded: succeeded) }
            Button("Update email") { Task { await submit() } }
                .disabled(busy || newEmail.isEmpty || password.isEmpty)
        } header: {
            Text("Email")
        } footer: {
            Text("The server may ask you to confirm the new address by email.").font(Theme.caption)
        }
    }

    private func submit() async {
        if let problem = AccountValidation.emailAddress(newEmail) {
            message = problem
            succeeded = false
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await services.api.updateEmail(newEmail: newEmail, password: password)
            message = "Email update requested"
            succeeded = true
            newEmail = ""
            password = ""
        } catch {
            message = String(describing: error)
            succeeded = false
        }
    }
}

private enum TotpPhase {
    case loading, notEnrolled, enrolling, enabled
}

private struct TotpSections: View {
    let services: AppServices
    /// Set once two-factor is on: the server ends every session, so the parent asks the user to sign in again.
    @Binding var needsSignIn: Bool
    @State private var phase = TotpPhase.loading
    @State private var status: TotpStatus?
    @State private var qrImage: UIImage?
    @State private var passcode = ""
    @State private var disabling = false
    @State private var disablePassword = ""
    @State private var errorMessage: String?
    @State private var copied = false

    var body: some View {
        Group {
            switch phase {
            case .loading: Section("Two-factor authentication") { ProgressView() }
            case .notEnrolled: notEnrolledSection
            case .enrolling: enrollingSections
            case .enabled: enabledSections
            }
            if let errorMessage {
                Section { Text(errorMessage).font(Theme.caption).foregroundStyle(Color(.destructive)) }
            }
        }
        .task { await load() }
    }

    private var notEnrolledSection: some View {
        Section {
            Button { Task { await enrol() } } label: {
                SettingsLabel("Set up two-factor", symbol: "lock.shield", token: .meadow500)
            }
        } header: {
            Text("Two-factor authentication")
        } footer: {
            Text("Use an authenticator app such as Google Authenticator or Authy.").font(Theme.caption)
        }
    }

    private var enrollingSections: some View {
        Group {
            Section {
                if let qrImage {
                    Image(uiImage: qrImage).interpolation(.none).resizable().scaledToFit()
                        .frame(width: 180, height: 180).frame(maxWidth: .infinity)
                        .accessibilityLabel("Two-factor QR code")
                }
                if let secret = status?.secret {
                    LabeledContent("Secret") {
                        Text(secret).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                    }
                    Button(copied ? "Copied" : "Copy secret", systemImage: "doc.on.doc") { copy(secret) }
                }
                if let link = status?.url.flatMap({ URL(string: $0) }) {
                    Link(destination: link) { Label("Open in authenticator app", systemImage: "arrow.up.forward.app") }
                }
            } header: {
                Text("Scan or enter the secret")
            } footer: {
                Text("Scan the QR code with your authenticator app, then enter the 6-digit code below.").font(Theme.caption)
            }
            Section("Confirm") {
                TextField("6-digit code", text: Binding(
                    get: { passcode },
                    set: { value in passcode = TotpPasscode.sanitised(value) }
                ))
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                Button("Confirm and enable") { Task { await enable() } }
                    .criaProminent()
                    .frame(maxWidth: .infinity)
                    .disabled(!TotpPasscode.isComplete(passcode))
                    .listRowBackground(Color.clear)
            }
        }
    }

    private var enabledSections: some View {
        Group {
            Section("Two-factor authentication") {
                Label("Two-factor authentication is on", systemImage: "checkmark.shield")
                    .foregroundStyle(Color(.successText))
            }
            if disabling {
                Section {
                    SecureField("Current password", text: $disablePassword)
                    Button("Confirm turn off", role: .destructive) { Task { await disable() } }
                        .frame(maxWidth: .infinity)
                        .disabled(disablePassword.isEmpty)
                    Button("Cancel") { disabling = false; disablePassword = ""; errorMessage = nil }
                        .frame(maxWidth: .infinity)
                }
            } else {
                Section {
                    Button("Turn off two-factor", role: .destructive) { disabling = true }
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func load() async {
        do {
            let current = try await services.api.totpStatus()
            status = current
            phase = current?.enabled == true ? .enabled : .notEnrolled
        } catch {
            phase = .notEnrolled
        }
    }

    private func enrol() async {
        errorMessage = nil
        do {
            status = try await services.api.enrollTotp()
            phase = .enrolling
            if let data = try? await services.api.totpQRCode() { qrImage = UIImage(data: data) }
        } catch {
            errorMessage = String(describing: error)
        }
    }

    private func enable() async {
        errorMessage = nil
        do {
            try await services.api.enableTotp(passcode: passcode)
            phase = .enabled
            qrImage = nil
            passcode = ""
            needsSignIn = true
        } catch {
            errorMessage = String(describing: error)
        }
    }

    private func disable() async {
        errorMessage = nil
        do {
            try await services.api.disableTotp(password: disablePassword)
            phase = .notEnrolled
            status = nil
            disabling = false
            disablePassword = ""
        } catch {
            errorMessage = String(describing: error)
        }
    }

    private func copy(_ text: String) {
        UIPasteboard.general.string = text
        copied = true
    }
}
