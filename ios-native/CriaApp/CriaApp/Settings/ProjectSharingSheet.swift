import CriaKit
import SwiftUI

/// Identifiable wrapper so a project can drive `.sheet(item:)`.
struct ProjectShareTarget: Identifiable {
    let project: ProjectRecord
    var id: String { project.localId }
}

/// Who a project is shared with: users, teams and link shares. Online only.
struct ProjectSharingSheet: View {
    let services: AppServices
    let project: ProjectRecord
    @Environment(\.dismiss) private var dismiss
    @State private var users: [UserShare] = []
    @State private var teamShares: [TeamShare] = []
    @State private var links: [LinkShare] = []
    @State private var allTeams: [Team] = []
    @State private var frontendURL: String?
    @State private var serverURL = ""
    @State private var username = ""
    @State private var errorMessage: String?

    private var projectId: Int { project.serverId ?? 0 }

    var body: some View {
        NavigationStack {
            List {
                if projectId == 0 {
                    Text("Sync this project before sharing it.").foregroundStyle(Color(.mutedForeground))
                }
                usersSection
                teamsSection
                linksSection
                if let errorMessage { Text(errorMessage).foregroundStyle(Color(.destructive)) }
            }
            .criaSurface()
            .navigationTitle("Share \(project.title)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
        }
    }

    private var usersSection: some View {
        Section("People") {
            ForEach(users) { share in
                permissionRow(share.name ?? share.username, share.permission) { level in
                    act { try await services.api.updateProjectUser(projectId: projectId, username: share.username, permission: level) }
                }
                .swipeActions {
                    Button("Remove", role: .destructive) {
                        act { try await services.api.removeProjectUser(projectId: projectId, username: share.username) }
                    }
                }
            }
            HStack {
                TextField("Add by username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Add") {
                    let target = username
                    username = ""
                    act { try await services.api.addProjectUser(projectId: projectId, username: target, permission: .read) }
                }
                .disabled(username.isEmpty)
            }
        }
    }

    private var teamsSection: some View {
        Section("Teams") {
            ForEach(teamShares) { share in
                permissionRow(share.name, share.permission) { level in
                    act { try await services.api.updateProjectTeam(projectId: projectId, teamId: share.serverId, permission: level) }
                }
                .swipeActions {
                    Button("Remove", role: .destructive) {
                        act { try await services.api.removeProjectTeam(projectId: projectId, teamId: share.serverId) }
                    }
                }
            }
            let unshared = allTeams.filter { team in !teamShares.contains { $0.serverId == team.serverId } }
            if !unshared.isEmpty {
                Menu("Add team") {
                    ForEach(unshared) { team in
                        Button(team.name) {
                            act { try await services.api.addProjectTeam(projectId: projectId, teamId: team.serverId, permission: .read) }
                        }
                    }
                }
            }
        }
    }

    private var linksSection: some View {
        Section("Links") {
            ForEach(links) { share in
                let url = ShareLinks.url(serverURL: serverURL, frontendURL: frontendURL, hash: share.hash)
                ShareLink(item: url) {
                    VStack(alignment: .leading) {
                        Text(share.name ?? share.hash).font(Theme.rowTitle)
                        Text("\(share.permission.label)\(share.hasPassword ? ", password" : "")")
                            .font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
                .swipeActions {
                    Button("Delete", role: .destructive) {
                        act { try await services.api.deleteLinkShare(projectId: projectId, shareId: share.id) }
                    }
                }
            }
            Button("New link (read only)") {
                act { try await services.api.createLinkShare(projectId: projectId, permission: .read, name: nil, password: nil) }
            }
        }
    }

    private func permissionRow(_ title: String, _ current: SharePermission, set: @escaping (SharePermission) -> Void) -> some View {
        Menu {
            ForEach(SharePermission.allCases, id: \.self) { level in
                Button(level.label) { set(level) }
            }
        } label: {
            HStack {
                Text(title).foregroundStyle(Color(.foreground))
                Spacer()
                Text(current.label).foregroundStyle(Color(.mutedForeground))
            }
        }
    }

    private func load() async {
        guard projectId != 0 else { return }
        do {
            users = try await services.api.projectUsers(projectId: projectId)
            teamShares = try await services.api.projectTeams(projectId: projectId)
            links = try await services.api.linkShares(projectId: projectId)
            allTeams = try await services.api.teams()
            frontendURL = try? await services.api.info().frontendURL
            serverURL = await services.api.serverBase() ?? ""
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// Runs a server action and reloads. The error is set after the reload, which would otherwise clear it.
    private func act(_ action: @escaping @MainActor () async throws -> Void) {
        Task {
            errorMessage = nil
            var failure: String?
            do {
                try await action()
            } catch {
                failure = String(describing: error)
            }
            await load()
            if let failure { errorMessage = failure }
        }
    }
}
