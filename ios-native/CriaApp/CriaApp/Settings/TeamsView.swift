import CriaKit
import SwiftUI

/// Teams: list, create, rename, delete, and manage members.
struct TeamsView: View {
    let services: AppServices
    @State private var teams: [Team] = []
    @State private var errorMessage: String?
    @State private var newName = ""
    @State private var creating = false

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Color(.destructive))
            }
            ForEach(teams) { team in
                NavigationLink(team.name) {
                    TeamDetailView(services: services, teamId: team.serverId, onChange: { Task { await load() } })
                }
            }
        }
        .criaSurface()
        .navigationTitle("Teams")
        .toolbar { Button("New", systemImage: "plus") { creating = true } }
        .alert("New team", isPresented: $creating) {
            CriaTextField("Name", text: $newName)
            Button("Create") { Task { await create() } }
            Button("Cancel", role: .cancel) { newName = "" }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        do {
            teams = try await services.api.teams()
            errorMessage = nil
        } catch {
            errorMessage = String(describing: error)
        }
    }

    private func create() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        newName = ""
        guard !name.isEmpty else { return }
        do {
            _ = try await services.api.createTeam(name: name)
            await load()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}

struct TeamDetailView: View {
    let services: AppServices
    let teamId: Int
    let onChange: () -> Void
    @State private var team: Team?
    @State private var name = ""
    @State private var username = ""
    @State private var errorMessage: String?
    @State private var confirmingDelete = false
    @State private var memberToRemove: TeamMember?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section("Name") {
                CriaTextField("Name", text: $name).onSubmit { Task { await rename() } }
            }
            Section("Members") {
                ForEach(team?.members ?? []) { member in
                    HStack {
                        Text(member.name ?? member.username)
                        Spacer()
                        if member.admin { CriaChip(text: "Admin", tint: Color(.primary)) }
                    }
                    .swipeActions(allowsFullSwipe: false) {
                        Button("Remove", role: .destructive) { memberToRemove = member }
                        Button(member.admin ? "Demote" : "Make admin") {
                            run { try await services.api.toggleTeamMemberAdmin(teamId: teamId, userId: member.serverId) }
                        }
                    }
                }
                HStack {
                    CriaTextField("Add by username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Add") { add() }.disabled(username.isEmpty)
                }
            }
            if let errorMessage { Section { Text(errorMessage).foregroundStyle(Color(.destructive)) } }
            Section { Button("Delete team", role: .destructive) { confirmingDelete = true } }
        }
        .criaSurface()
        .navigationTitle(team?.name ?? "Team")
        .confirmationDialog("Delete this team?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                run {
                    try await services.api.deleteTeam(id: teamId)
                    onChange()
                    dismiss()
                }
            }
        }
        .confirmationDialog(
            "Remove this member?",
            isPresented: Binding(get: { memberToRemove != nil }, set: { if !$0 { memberToRemove = nil } }),
            titleVisibility: .visible,
            presenting: memberToRemove
        ) { member in
            Button("Remove \(member.name ?? member.username)", role: .destructive) {
                run { try await services.api.removeTeamMember(teamId: teamId, username: member.username) }
            }
        }
        .task { await load() }
    }

    private func load() async {
        team = try? await services.api.team(id: teamId)
        name = team?.name ?? ""
    }

    private func rename() async {
        let newName = name.trimmingCharacters(in: .whitespaces)
        guard !newName.isEmpty else { return }
        let isPublic = team?.isPublic ?? false
        // Tell the list only once the server has the new name, or it reloads the old one.
        run {
            try await services.api.renameTeam(id: teamId, name: newName, isPublic: isPublic)
            onChange()
        }
    }

    private func add() {
        let target = username
        username = ""
        run { try await services.api.addTeamMember(teamId: teamId, username: target) }
    }

    /// Runs a server action, then reloads; shows the error on failure.
    private func run(_ action: @escaping @MainActor () async throws -> Void) {
        Task {
            do {
                try await action()
                errorMessage = nil
            } catch {
                errorMessage = String(describing: error)
            }
            await load()
        }
    }
}
