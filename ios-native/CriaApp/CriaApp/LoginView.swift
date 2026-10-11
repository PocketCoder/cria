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
                header
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 48, leading: 0, bottom: 6, trailing: 0))
            }

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
                    Text(error).foregroundStyle(Color(.destructive))
                }
            }

            Section {
                Picker("Sign in with", selection: Binding(get: { model.method }, set: { model.switchMethod($0) })) {
                    Text("API token").tag(LoginViewModel.Method.token)
                    Text("Password").tag(LoginViewModel.Method.password)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section {
                switch model.method {
                case .token:
                    SecureField("API token", text: $model.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .token)
                        .accessibilityIdentifier("login.token")
                    Text("Create one in Vikunja under Settings → API tokens.")
                        .font(Theme.caption)
                        .foregroundStyle(Color(.mutedForeground))
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
                Section { Text(error).foregroundStyle(Color(.destructive)).accessibilityIdentifier("login.error") }
            }

            Section {
                Button {
                    focus = nil
                    Task { await model.submit() }
                } label: {
                    HStack(spacing: 8) {
                        Text(model.totpRequired ? "Verify and sign in" : "Sign in")
                        if model.isSubmitting { ProgressView() }
                    }
                    .frame(maxWidth: .infinity, minHeight: 54)
                }
                .criaProminent()
                .disabled(model.isSubmitting)
                .accessibilityIdentifier("login.submit")
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .criaSurface()
        .toolbar(.hidden, for: .navigationBar)
    }

    private var header: some View {
        VStack(spacing: 8) {
            Image("LoginIcon")
                .resizable()
                .frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: Color(red: 60 / 255, green: 30 / 255, blue: 110 / 255).opacity(0.35), radius: 15, y: 10)
                .accessibilityHidden(true)
            Text("Cria").font(Theme.wordmark)
            Text("Sign in to your Vikunja server")
                .font(.body)
                .foregroundStyle(Color(.mutedForeground))
        }
    }
}
