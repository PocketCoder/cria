import CriaKit
import SwiftUI

/// API tokens: list, create with chosen permissions (the secret is shown once), delete.
struct ApiTokensView: View {
    let services: AppServices
    @State private var tokens: [ApiToken] = []
    @State private var errorMessage: String?
    @State private var creating = false
    @State private var secret: String?

    var body: some View {
        List {
            if let secret {
                Section("New token (shown once)") {
                    Text(secret).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                }
            }
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Color(.destructive))
            }
            ForEach(tokens) { token in
                VStack(alignment: .leading) {
                    Text(token.title).font(Theme.rowTitle)
                    Text(token.expiresAt.map { "Expires \($0)" } ?? "No expiry")
                        .font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
                .swipeActions {
                    Button("Delete", role: .destructive) { Task { await delete(token) } }
                }
            }
        }
        .criaSurface()
        .navigationTitle("API tokens")
        .toolbar { Button("New", systemImage: "plus") { creating = true } }
        .sheet(isPresented: $creating) {
            NewApiTokenSheet(services: services) { created in
                secret = created?.token
                Task { await load() }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            tokens = try await services.api.apiTokens()
            errorMessage = nil
        } catch {
            errorMessage = String(describing: error)
        }
    }

    private func delete(_ token: ApiToken) async {
        do {
            try await services.api.deleteApiToken(id: token.id)
            await load()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}

private struct NewApiTokenSheet: View {
    let services: AppServices
    let onCreated: (ApiToken?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var expiry = Calendar.cria.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    @State private var groups: [PermissionGroup] = []
    @State private var selected = Set<String>()
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    DatePicker("Expires", selection: $expiry, displayedComponents: .date)
                }
                ForEach(groups, id: \.group) { group in
                    Section(group.group) {
                        ForEach(group.permissions, id: \.id) { option in
                            Toggle(option.label, isOn: binding(option.id))
                        }
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
                }
            }
            .navigationTitle("New token")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || selected.isEmpty)
                }
            }
            .task {
                if let routes = try? await services.api.apiRoutes() {
                    groups = ApiTokenPermissions.groups(fromRoutes: routes)
                }
            }
        }
    }

    private func binding(_ identifier: String) -> Binding<Bool> {
        Binding(
            get: { selected.contains(identifier) },
            set: { isOn in
                if isOn { selected.insert(identifier) } else { selected.remove(identifier) }
            }
        )
    }

    private func create() async {
        let permissions = ApiTokenPermissions.permissions(fromSelection: Array(selected))
        let stamp = expiry.formatted(.iso8601)
        do {
            let created = try await services.api.createApiToken(title: title, expiresAt: stamp, permissions: permissions)
            onCreated(created)
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
