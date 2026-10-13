import CriaKit
import SwiftUI

/// A plain sign-in form: server, method and credentials. Phase 4 brings the full iOS wording and recent servers.
struct MacLoginView: View {
    @State var model: LoginViewModel

    var body: some View {
        Form {
            Text("Sign in to your Vikunja server").font(.headline)
            TextField("Server", text: $model.serverURL, prompt: Text("https://vikunja.example.com"))
            if let error = model.serverURLError { Text(error).foregroundStyle(.red) }
            Picker("Sign in with", selection: Binding(get: { model.method }, set: { model.switchMethod($0) })) {
                Text("API token").tag(LoginViewModel.Method.token)
                Text("Password").tag(LoginViewModel.Method.password)
                Text("Share link").tag(LoginViewModel.Method.linkShare)
            }
            .pickerStyle(.segmented)
            credentialFields
            if let error = model.submitError { Text(error).foregroundStyle(.red) }
            Button(model.totpRequired ? "Verify and sign in" : "Sign in") { Task { await model.submit() } }
                .keyboardShortcut(.defaultAction)
                .disabled(model.isSubmitting)
        }
        .formStyle(.grouped)
        .frame(maxWidth: 440)
        .padding()
    }

    @ViewBuilder
    private var credentialFields: some View {
        switch model.method {
        case .token:
            SecureField("API token", text: $model.token)
        case .password:
            TextField("Username", text: $model.username)
            SecureField("Password", text: $model.password)
            Toggle("Remember me", isOn: $model.rememberMe)
            if model.totpRequired { TextField("Two-factor code", text: $model.totpCode) }
        case .linkShare:
            TextField("Share link", text: $model.shareLink)
                .onChange(of: model.shareLink) { model.adoptServerFromShareLink() }
            SecureField("Share password (if it has one)", text: $model.sharePassword)
        }
    }
}
