import CriaKit
import SwiftUI

/// Settings > Account: the profile card, Security, and Sign Out….
struct MacAccountPane: View {
    let services: AppServices
    let model: SettingsModel
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var avatar: PlatformImage?
    @State private var totpOn: Bool?
    @State private var confirmingSignOut = false

    private var displayName: String { model.general.name.isEmpty ? model.username : model.general.name }

    var body: some View {
        Section { profileCard }
        Section("Security") {
            LabeledContent("Password") {
                MacSettingsSheetLink("Change…") { ChangePasswordView(services: services, onSignOut: onSignOut) }
            }
            LabeledContent("Two-factor authentication") {
                MacSettingsSheetLink { SecuritySettingsView(services: services, onSignOut: onSignOut) } label: {
                    CriaChip(text: totpOn == true ? "On" : (totpOn == false ? "Off" : "…"),
                             tint: totpOn == true ? Color(.meadow700) : MacTheme.label2)
                }
                .buttonStyle(.plain)
            }
            MacSettingsSheetLink("Sessions") { SessionsView(services: services, onSignOut: onSignOut) }
            MacSettingsSheetLink("API and CalDAV tokens") { MacTokensView(services: services, username: model.username) }
        }
        Section("Sharing") {
            MacSettingsSheetLink("Teams") { TeamsView(services: services) }
        }
        Section {
            Button("Sign Out…") { confirmingSignOut = true }
                .confirmationDialog("Sign out of Cria?", isPresented: $confirmingSignOut) {
                    Button("Sign Out", role: .destructive) { onSignOut(false) }
                }
        }
        .task(id: model.username) { await loadAvatar() }
        .task { totpOn = (try? await services.api.totpStatus())?.enabled ?? false }
    }

    private var profileCard: some View {
        HStack(spacing: 14) {
            avatarView
            VStack(alignment: .leading, spacing: 2) {
                Text(displayName).font(.system(size: 15, weight: .semibold))
                Text(model.server.isEmpty ? model.username : "\(model.username) · \(Self.host(model.server))")
                    .font(.system(size: 12))
                    .foregroundStyle(MacTheme.label2)
            }
            Spacer()
            MacSettingsSheetLink("Edit Profile…") { AccountSettingsView(services: services, model: model) }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder private var avatarView: some View {
        if let avatar {
            Image(platformImage: avatar).resizable().scaledToFill().frame(width: 48, height: 48).clipShape(Circle())
        } else {
            let letters = displayName.split(separator: " ").prefix(2).compactMap(\.first)
            Text(letters.isEmpty ? "?" : String(letters).uppercased())
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color(.primary))
                .frame(width: 48, height: 48)
                .background(Color(.primarySoft), in: Circle())
        }
    }

    private func loadAvatar() async {
        guard !model.username.isEmpty, let data = try? await services.api.avatarData(username: model.username) else { return }
        avatar = PlatformImage(data: data)
    }

    static func host(_ server: String) -> String {
        URL(string: server)?.host() ?? server
    }
}

/// API tokens and CalDAV tokens on one screen, switched by a segmented control.
struct MacTokensView: View {
    let services: AppServices
    let username: String
    @State private var caldav = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("Tokens", selection: $caldav) {
                Text("API").tag(false)
                Text("CalDAV").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 240)
            .padding(.vertical, 10)
            if caldav {
                CaldavTokensView(services: services, username: username)
            } else {
                ApiTokensView(services: services)
            }
        }
        .navigationTitle("API and CalDAV tokens")
    }
}

/// Settings > Data: Sync (server status, waiting changes, Sync Now) and Your data (export, reset this Mac).
struct MacDataPane: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var status = SyncStatus()
    @State private var waiting = 0
    @State private var resetPrompt: SignOutSettingsSection.WipePrompt?

    /// Built outside the view builder (see `MacGeneralPane`).
    private var resetPromptShown: Binding<Bool> {
        Binding(get: { resetPrompt != nil }, set: { if !$0 { resetPrompt = nil } })
    }

    var body: some View {
        Section("Sync") {
            LabeledContent("Server") {
                CriaChip(text: serverState.0, tint: serverState.1)
            }
            LabeledContent("Waiting to sync \(waiting)") {
                Button(status.isSyncing ? "Syncing…" : "Sync Now") { Task { await services.coordinator.forceSync() } }
                    .disabled(status.isSyncing)
            }
        }
        Section("Waiting changes") {
            MacSettingsSheetLink("Sync queue") { OutboxView(services: services) }
        }
        Section("Your data") {
            LabeledContent("Export everything") {
                MacSettingsSheetLink("Export…") { DataSettingsView(services: services) }
            }
            LabeledContent("Reset this Mac") {
                Button("Reset…") {
                    let store = services.store
                    resetPrompt = .init(pending: try? store.outboxCount(), failed: try? store.deadLetters().count)
                }
                .foregroundStyle(Color(.coral500))
            }
        }
        .alert(
            "Reset this Mac?",
            isPresented: resetPromptShown,
            presenting: resetPrompt
        ) { _ in
            // The sign-out-with-wipe path: signs out and deletes this Mac's copy of the database and queued uploads.
            Button("Sign Out and Reset", role: .destructive) { onSignOut(true) }
            Button("Cancel", role: .cancel) {}
        } message: { prompt in
            Text(SignOutSettingsSection.message(for: prompt).replacingOccurrences(of: "iPhone", with: "Mac"))
        }
        .task {
            for await next in services.coordinator.status.subscribe() { status = next }
        }
        .task {
            for await count in observeStore(services.store, kinds: [.outbox], read: { try $0.outboxCount() }) {
                waiting = count
            }
        }
    }

    private var serverState: (String, Color) {
        status.errors.isEmpty ? ("Connected", Color(.meadow700)) : ("Can\u{2019}t reach", Color(.coral500))
    }
}
