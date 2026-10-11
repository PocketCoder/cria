import CriaKit
import SwiftUI

struct LoginView: View {
    @State var model: LoginViewModel
    @FocusState private var focus: Field?

    private enum Field: Hashable {
        case server, token, username, password, totp
    }

    var body: some View {
        Form {
            Section {
                TextField("https://vikunja.example.com", text: $model.serverURL)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .server)
                    .accessibilityIdentifier("login.server")
            } header: {
                Text("Server")
            } footer: {
                if let error = model.serverURLError {
                    Text(error).foregroundStyle(.red)
                }
            }

            Section {
                Picker("Sign in with", selection: Binding(get: { model.method }, set: { model.switchMethod($0) })) {
                    Text("API token").tag(LoginViewModel.Method.token)
                    Text("Password").tag(LoginViewModel.Method.password)
                }
                .pickerStyle(.segmented)
            }

            Section {
                switch model.method {
                case .token:
                    SecureField("API token", text: $model.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .token)
                        .accessibilityIdentifier("login.token")
                case .password:
                    TextField("Username", text: $model.username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .username)
                        .accessibilityIdentifier("login.username")
                    SecureField("Password", text: $model.password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .accessibilityIdentifier("login.password")
                    if model.totpRequired {
                        TextField("Two-factor code", text: $model.totpCode)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .focused($focus, equals: .totp)
                            .accessibilityIdentifier("login.totp")
                    }
                }
            }

            if let error = model.submitError {
                Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("login.error") }
            }

            Section {
                Button {
                    focus = nil
                    Task { await model.submit() }
                } label: {
                    HStack {
                        Text(model.totpRequired ? "Verify and sign in" : "Sign in")
                        if model.isSubmitting { Spacer(); ProgressView() }
                    }
                }
                .disabled(model.isSubmitting)
                .accessibilityIdentifier("login.submit")
            }
        }
        .navigationTitle("Cria")
    }
}
