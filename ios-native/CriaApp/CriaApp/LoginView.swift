import CriaKit
import SwiftUI

struct LoginView: View {
    @State var model: LoginViewModel
    @FocusState private var focus: Field?
    /// The last server signed in to, to prefill next time. Only the URL: credentials stay in the Keychain.
    @AppStorage("cria.login.lastServerURL") private var lastServerURL = ""

    private enum Field: Hashable {
        case server, token, username, password, totp, shareLink, sharePassword
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
                    .submitLabel(.next)
                    .onSubmit { focus = firstField }
                    .accessibilityIdentifier("login.server")
                if !model.recentServers.isEmpty { recentServerChips }
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
                    Text("Share link").tag(LoginViewModel.Method.linkShare)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section { credentialFields }

            if let error = model.submitError {
                Section { Text(error).foregroundStyle(Color(.destructive)).accessibilityIdentifier("login.error") }
            }

            Section {
                Button(action: submit) {
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
        .onAppear {
            model.adoptRecentServers(RecentServers())
            if model.serverURL.isEmpty { model.serverURL = lastServerURL }
        }
    }

    /// Up to five servers signed in to before. A tap fills the server (and its remembered username); a long press
    /// offers to forget it.
    private var recentServerChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.recentServers, id: \.self) { server in
                    Button(Self.chipTitle(server)) { model.pickServer(server) }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .controlSize(.small)
                        .tint(server == model.serverURL ? Color(.primary) : Color(.mutedForeground))
                        .contextMenu {
                            Button("Forget this server", systemImage: "trash", role: .destructive) { model.forgetServer(server) }
                        }
                        .accessibilityLabel("Use \(server)")
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
    }

    /// The address without its scheme, which every recent server shares.
    private static func chipTitle(_ server: String) -> String {
        server.replacingOccurrences(of: "https://", with: "")
    }

    private var firstField: Field {
        switch model.method {
        case .token: .token
        case .password: .username
        case .linkShare: .shareLink
        }
    }

    @ViewBuilder
    private var credentialFields: some View {
        switch model.method {
        case .token:
            SecureField("API token", text: $model.token)
                .submitLabel(.go)
                .onSubmit(submit)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: .token)
                .accessibilityIdentifier("login.token")
            Text("Create one in Vikunja under Settings → API tokens.")
                .font(Theme.caption)
                .foregroundStyle(Color(.mutedForeground))
        case .password:
            passwordFields
        case .linkShare:
            shareFields
        }
    }

    @ViewBuilder
    private var passwordFields: some View {
        TextField("Username", text: $model.username)
            .textContentType(.username)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focus, equals: .username)
            .submitLabel(.next)
            .onSubmit { focus = .password }
            .accessibilityIdentifier("login.username")
        SecureField("Password", text: $model.password)
            .textContentType(.password)
            .submitLabel(.go)
            .onSubmit(submit)
            .focused($focus, equals: .password)
            .accessibilityIdentifier("login.password")
        Toggle("Remember me", isOn: $model.rememberMe)
            .accessibilityIdentifier("login.rememberMe")
        if model.totpRequired {
            TextField("Two-factor code", text: $model.totpCode)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .focused($focus, equals: .totp)
                .accessibilityIdentifier("login.totp")
        }
    }

    /// A pasted share URL fills the server field. The session only sees the shared project.
    @ViewBuilder
    private var shareFields: some View {
        TextField("https://vikunja.example.com/share/\u{2026}/auth", text: $model.shareLink)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focus, equals: .shareLink)
            .submitLabel(.go)
            .onSubmit(submit)
            .onChange(of: model.shareLink) { model.adoptServerFromShareLink() }
            .accessibilityIdentifier("login.shareLink")
        SecureField(model.sharePasswordRequired ? "Share password" : "Share password (if it has one)", text: $model.sharePassword)
            .submitLabel(.go)
            .onSubmit(submit)
            .focused($focus, equals: .sharePassword)
            .accessibilityIdentifier("login.sharePassword")
        Text("Paste a Vikunja share link. You will only see the shared project, and account settings are unavailable.")
            .font(Theme.caption)
            .foregroundStyle(Color(.mutedForeground))
    }

    private func submit() {
        guard !model.isSubmitting else { return }
        focus = nil
        Task {
            await model.submit()
            // Remember the server once it passed validation, whether or not the credentials did.
            if model.serverURLError == nil { lastServerURL = model.serverURL.trimmingCharacters(in: .whitespacesAndNewlines) }
        }
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
