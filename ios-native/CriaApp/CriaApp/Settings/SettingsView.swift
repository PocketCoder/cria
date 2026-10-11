import CriaKit
import SwiftUI

/// Settings sheet: account card, then General, Appearance, Notifications, Photo capture and Account sections, storage,
/// about, and sign out. The long sections live in their own files.
struct SettingsView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var model: SettingsModel
    @StateObject private var prefs = PreferencesModel()
    @State private var projects: [ProjectRecord] = []
    @Environment(\.dismiss) private var dismiss

    init(services: AppServices, onSignOut: @escaping (_ wipeLocalData: Bool) -> Void) {
        self.services = services
        self.onSignOut = onSignOut
        _model = State(initialValue: SettingsModel(services: services))
    }

    var body: some View {
        NavigationStack {
            Form {
                accountCard
                GeneralSettingsSection(model: model, prefs: prefs, projects: projects)
                AppearanceSettingsSection(prefs: prefs)
                NotificationSettingsSection(services: services, model: model, prefs: prefs)
                PhotoCaptureSettingsSection(prefs: prefs, projects: projects)
                accountSection
                storageSection
                aboutSection
                if let message = model.errorMessage {
                    Section { Text(message).foregroundStyle(Color(.destructive)) }
                }
                signOutSection
            }
            .criaSurface()
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }.modifier(CriaProminentToolbarButton())
                }
            }
            .task {
                projects = ProjectTree.visible((try? services.store.projects()) ?? [])
                await model.load()
            }
        }
    }

    private var displayName: String {
        model.general.name.isEmpty ? model.username : model.general.name
    }

    private var initials: String {
        let letters = displayName.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    private var accountCard: some View {
        Section {
            NavigationLink {
                AccountSettingsView(services: services)
            } label: {
                HStack(spacing: 14) {
                    Text(initials)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Color(.primary))
                        .frame(width: 48, height: 48)
                        .background(Color(.primarySoft), in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(displayName).font(Theme.rowTitle)
                        Text("@\(model.username)").font(Theme.rowSubtitle).foregroundStyle(Color(.mutedForeground))
                    }
                }
                .frame(minHeight: 72)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var accountSection: some View {
        Section("Account") {
            NavigationLink { ApiTokensView(services: services) } label: {
                SettingsLabel("API tokens", symbol: "key", token: .fleece500)
            }
            NavigationLink { TeamsView(services: services) } label: {
                SettingsLabel("Teams", symbol: "person.2", token: .sky700)
            }
            NavigationLink { SecuritySettingsView(services: services) } label: {
                SettingsLabel("Security", symbol: "lock.shield", token: .coral500)
            }
            NavigationLink { SessionsView(services: services) } label: {
                SettingsLabel("Sessions", symbol: "iphone.and.arrow.forward", token: .llama500)
            }
            NavigationLink { DataSettingsView(services: services, onSignOut: onSignOut) } label: {
                SettingsLabel("Data", symbol: "externaldrive", token: .fleece500)
            }
        }
    }

    private var storageSection: some View {
        Section("Storage") {
            LabeledContent("Cached backgrounds", value: "\(model.backgroundCount)")
            Button("Clear cached backgrounds") { model.clearBackgrounds() }
                .disabled(model.backgroundCount == 0)
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        guard let build = info?["CFBundleVersion"] as? String, build != short else { return short }
        return "\(short) (\(build))"
    }

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("Version", value: Self.version)
            if !model.server.isEmpty {
                LabeledContent("Server", value: model.server)
            }
        }
    }

    private var signOutSection: some View {
        Section {
            Button(role: .destructive) { onSignOut(false) } label: {
                Text("Sign out").frame(maxWidth: .infinity)
            }
        } footer: {
            Text("Cria \(Self.version) ").frame(maxWidth: .infinity)
        }
    }
}

/// Settings-app row label: 30pt rounded square in an accent colour with a white glyph.
struct SettingsLabel: View {
    let title: String
    let symbol: String
    let token: ThemeToken

    init(_ title: String, symbol: String, token: ThemeToken) {
        self.title = title
        self.symbol = symbol
        self.token = token
    }

    var body: some View {
        Label {
            Text(title)
        } icon: {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Color(token), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}

extension Notification.Name {
    /// Posted after the local preferences change so the root view re-reads them.
    static let criaPreferencesChanged = Notification.Name("cria.preferencesChanged")
}
