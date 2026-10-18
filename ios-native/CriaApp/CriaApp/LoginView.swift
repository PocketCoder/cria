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
        content
            .onAppear {
                model.adoptRecentServers(RecentServers())
                if model.serverURL.isEmpty { model.serverURL = lastServerURL }
            }
    }

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
        macForm
        #else
        form
        #endif
    }

    private var form: some View {
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

#if os(macOS)
extension LoginView {
    /// The Mac sign-in (440×600): the 84pt icon, "Welcome to Cria", Server, Username or email and Password with SF 12
    /// labels over 32pt filled fields, a prominent Sign In capsule, then links to the API token and share link flows.
    /// No OpenID button: the app has no OpenID flow to offer. Same model as the iOS form.
    private var macForm: some View {
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 8) {
                    Image("LoginIcon")
                        .resizable()
                        .frame(width: 84, height: 84)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .shadow(color: Color(red: 60 / 255, green: 20 / 255, blue: 110 / 255).opacity(0.4), radius: 15, y: 10)
                        .accessibilityHidden(true)
                    Text("Welcome to Cria").font(.custom(Theme.brandFont, size: 26)).tracking(-0.52).padding(.top, 6)
                    Text("Sign in to your Vikunja server.").font(.system(size: 13)).foregroundStyle(MacTheme.label2)
                }
                VStack(alignment: .leading, spacing: 6) {
                    macLabel("Server")
                    TextField("https://vikunja.example.com", text: $model.serverURL)
                        .focused($focus, equals: .server)
                        .onSubmit { focus = firstField }
                        .accessibilityIdentifier("login.server")
                        .macLoginField()
                    if !model.recentServers.isEmpty { recentServerChips }
                    if let error = model.serverURLError {
                        Text(error).font(.system(size: 12)).foregroundStyle(Color(.destructive))
                    }
                    macCredentials.padding(.top, 6)
                    if let error = model.submitError {
                        Text(error).font(.system(size: 12)).foregroundStyle(Color(.destructive))
                            .accessibilityIdentifier("login.error")
                    }
                }
                .textFieldStyle(.plain)
                VStack(spacing: 10) {
                    Button(action: submit) {
                        HStack(spacing: 8) {
                            Text(model.totpRequired ? "Verify and Sign In" : "Sign In")
                            if model.isSubmitting { ProgressView().controlSize(.small) }
                        }
                        .frame(maxWidth: .infinity, minHeight: 26)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.isSubmitting)
                    .accessibilityIdentifier("login.submit")
                    macMethodLinks
                }
            }
            .frame(maxWidth: 360)
            .padding(.horizontal, 24)
            .padding(.vertical, 40)
            .frame(maxWidth: .infinity)
        }
        .background(MacTheme.window)
        .frame(minWidth: 440, minHeight: 600)
        // The design leads with username and password; the token form is one link away.
        .onAppear { if model.method == .token && model.token.isEmpty { model.switchMethod(.password) } }
    }

    @ViewBuilder private var macCredentials: some View {
        switch model.method {
        case .password:
            macLabel("Username or email")
            TextField("", text: $model.username)
                .textContentType(.username)
                .focused($focus, equals: .username)
                .onSubmit { focus = .password }
                .accessibilityIdentifier("login.username")
                .macLoginField()
            macLabel("Password").padding(.top, 6)
            SecureField("", text: $model.password)
                .textContentType(.password)
                .onSubmit(submit)
                .focused($focus, equals: .password)
                .accessibilityIdentifier("login.password")
                .macLoginField()
            Toggle("Remember me", isOn: $model.rememberMe)
                .font(.system(size: 12))
                .accessibilityIdentifier("login.rememberMe")
            if model.totpRequired {
                macLabel("Two-factor code").padding(.top, 6)
                TextField("", text: $model.totpCode)
                    .textContentType(.oneTimeCode)
                    .focused($focus, equals: .totp)
                    .accessibilityIdentifier("login.totp")
                    .macLoginField()
            }
        case .token:
            macLabel("API token")
            SecureField("", text: $model.token)
                .onSubmit(submit)
                .focused($focus, equals: .token)
                .accessibilityIdentifier("login.token")
                .macLoginField()
            Text("Create one in Vikunja under Settings → API tokens.")
                .font(.system(size: 11)).foregroundStyle(MacTheme.label2)
        case .linkShare:
            macLabel("Share link")
            shareFields
        }
    }

    /// "Use an API token instead" (or back to the password), and the share link flow.
    private var macMethodLinks: some View {
        HStack(spacing: 14) {
            if model.method == .password {
                Button("Use an API token instead") { model.switchMethod(.token) }
            } else {
                Button("Use a password instead") { model.switchMethod(.password) }
            }
            if model.method != .linkShare {
                Button("Use a share link") { model.switchMethod(.linkShare) }
            }
        }
        .buttonStyle(.link)
        .font(.system(size: 12))
    }

    private func macLabel(_ text: String) -> some View {
        Text(text).font(.system(size: 12, weight: .medium)).foregroundStyle(MacTheme.label2)
    }
}

private extension View {
    /// The sign-in field: 32pt high, radius 8, on `fill`.
    func macLoginField() -> some View {
        padding(.horizontal, 10)
            .frame(minHeight: 32)
            .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .focusEffectDisabled()
    }
}
#endif
