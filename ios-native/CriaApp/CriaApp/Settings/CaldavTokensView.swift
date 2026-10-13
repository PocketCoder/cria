import CriaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// CalDAV: the address to add to a calendar app, plus the tokens (app passwords) to sign in with. A new token's text
/// is shown once, as the server never returns it again. The token list mirrors the CalDAV half of
/// `src/components/settings/TokensTab.tsx`; the address is the one Vikunja-web shows (`<server>/dav/principals/<user>/`).
/// Online only: failures are shown, nothing is queued.
struct CaldavTokensView: View {
    let services: AppServices
    /// The signed-in username from the settings model; empty until it loads, then `signedInUser()` fills it.
    let username: String
    @State private var tokens: [CaldavToken] = []
    @State private var loaded = false
    @State private var errorMessage: String?
    @State private var creating = false
    @State private var secret: String?
    @State private var copiedSecret = false
    @State private var copiedAddress = false
    @State private var address: String?
    @State private var pendingDelete: CaldavToken?
    @Environment(\.dateDisplay) private var dateDisplay

    var body: some View {
        List {
            addressSection
            if let secret {
                Section {
                    Text(secret).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                    Button(copiedSecret ? "Copied" : "Copy token", systemImage: "doc.on.doc") {
                        Pasteboard.copy(secret)
                        copiedSecret = true
                    }
                } header: {
                    Text("New token")
                } footer: {
                    Text("Copy it now. It won\u{2019}t be shown again.")
                }
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
            }
            tokensSection
        }
        .criaSurface()
        .tint(Color(.primary))
        .navigationTitle("CalDAV")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Create token", systemImage: "plus") { Task { await create() } }
                    .disabled(creating)
            }
        }
        .confirmationDialog(
            "Delete this token?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { token in
            Button("Delete token \(token.id)", role: .destructive) { Task { await delete(token) } }
        } message: { _ in
            Text("Calendar apps signed in with it will stop syncing.")
        }
        .task { await load() }
        .task { await loadAddress() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private var addressSection: some View {
        if let address {
            Section {
                Text(address).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                Button(copiedAddress ? "Copied" : "Copy address", systemImage: "doc.on.doc") {
                    Pasteboard.copy(address)
                    copiedAddress = true
                }
            } header: {
                Text("Server address")
            } footer: {
                Text("Add this address to a calendar app, then sign in with your username and a token below.")
            }
        }
    }

    private var tokensSection: some View {
        Section {
            if !loaded {
                ProgressView().frame(maxWidth: .infinity)
            } else if tokens.isEmpty && errorMessage == nil {
                Text("No CalDAV tokens yet.").foregroundStyle(Color(.mutedForeground))
            }
            ForEach(tokens) { token in
                VStack(alignment: .leading, spacing: 2) {
                    Text("Token \(token.id)").font(Theme.rowTitle)
                    Text(token.created.map { "Created \(SettingsDate.label($0, display: dateDisplay))" } ?? "Creation date unknown")
                        .font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
                .accessibilityElement(children: .combine)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", role: .destructive) { pendingDelete = token }
                }
            }
        } header: {
            Text("Tokens")
        } footer: {
            if !tokens.isEmpty { Text("Swipe a token to delete it.").font(Theme.caption) }
        }
    }

    private func load() async {
        do {
            tokens = try await services.api.caldavTokens()
            errorMessage = nil
        } catch {
            errorMessage = "Couldn\u{2019}t load CalDAV tokens: \(error)"
        }
        loaded = true
    }

    /// `<server>/dav/principals/<username>/`, as Vikunja-web's CalDAV settings show it.
    private func loadAddress() async {
        guard let base = await services.api.serverBase() else { return }
        var name = username
        if name.isEmpty { name = await services.signedInUser()?.username ?? "" }
        guard !name.isEmpty else { return }
        let origin = base.replacingOccurrences(of: #"/api/v1/?$"#, with: "", options: .regularExpression)
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove("/")
        let escaped = name.addingPercentEncoding(withAllowedCharacters: allowed) ?? name
        address = "\(origin)/dav/principals/\(escaped)/"
    }

    private func create() async {
        creating = true
        defer { creating = false }
        do {
            let created = try await services.api.createCaldavToken()
            copiedSecret = false
            guard let text = created.token, !text.isEmpty else {
                secret = nil
                await load()
                errorMessage = "The server created a token but did not return its text. Delete it and try again."
                return
            }
            secret = text
            errorMessage = nil
            await load()
        } catch {
            errorMessage = "Couldn\u{2019}t create a token: \(error)"
        }
    }

    private func delete(_ token: CaldavToken) async {
        do {
            try await services.api.deleteCaldavToken(id: token.id)
            errorMessage = nil
            await load()
        } catch {
            errorMessage = "Couldn\u{2019}t delete the token: \(error)"
        }
    }
}
