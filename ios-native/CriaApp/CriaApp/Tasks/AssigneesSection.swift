import CriaKit
import SwiftUI

/// The people assigned to a task. Remove (swipe or context menu) and assign write through the store, which queues the
/// server calls. The user search is presented by TaskDetailView through `state`.
struct AssigneesSection: View {
    let services: AppServices
    let taskLocalId: String
    let assignees: [AssigneeRecord]
    let state: TaskDetailPresentation

    var body: some View {
        Section("Assignees") {
            ForEach(assignees) { assignee in
                AssigneeRow(name: assignee.username ?? "User \(assignee.userId)")
                    .swipeActions {
                        Button("Remove", systemImage: "person.badge.minus", role: .destructive) { remove(assignee) }
                    }
                    .contextMenu {
                        Button("Remove", systemImage: "person.badge.minus", role: .destructive) { remove(assignee) }
                    }
            }
            Button("Assign…", systemImage: "person.badge.plus") { state.assigning = true }
        }
    }

    private func remove(_ assignee: AssigneeRecord) {
        state.attempt { try services.store.removeAssignee(taskLocalId: taskLocalId, userId: assignee.userId) }
    }
}

/// A name with its initials in a circle, as the comment thread shows authors.
struct AssigneeRow: View {
    let name: String
    var detail: String?

    var body: some View {
        HStack(spacing: 12) {
            Text(Self.initials(name))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(.heather600))
                .frame(width: 30, height: 30)
                .background(Color(.heather600).opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).foregroundStyle(Color(.foreground))
                if let detail {
                    Text(detail).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
        }
    }

    static func initials(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
}

/// Search the server's users and pick one to assign. The pick is handed back through `onPick`; TaskDetailView saves
/// it once the sheet has gone, so a failure shows in the screen's own alert.
struct AssigneePickerSheet: View {
    let services: AppServices
    /// Already assigned: shown ticked and not offered again.
    let assigned: Set<Int>
    let onPick: (UserResponse) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [UserResponse] = []
    /// The query the results belong to, so "no match" only shows once a search has come back.
    @State private var searched: String?

    var body: some View {
        NavigationStack {
            List(results, id: \.id) { user in
                Button {
                    onPick(user)
                    dismiss()
                } label: {
                    HStack {
                        AssigneeRow(name: Self.displayName(user), detail: "@\(user.username)")
                        Spacer()
                        if assigned.contains(user.id) {
                            Image(systemName: "checkmark").foregroundStyle(Color(.primary))
                        }
                    }
                }
                .disabled(assigned.contains(user.id))
            }
            .criaSurface()
            .overlay { emptyState }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name or username")
            .navigationTitle("Assign")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task(id: query) { await search() }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private var emptyState: some View {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            ContentUnavailableView("Find someone", systemImage: "person.crop.circle.badge.plus",
                                   description: Text("Type a name or username."))
        } else if results.isEmpty, searched == trimmed {
            // The search reports no error, so an empty answer may also mean the server could not be reached.
            ContentUnavailableView("No users found", systemImage: "person.slash",
                                   description: Text("Nobody matches, or the server could not be reached. Searching needs a connection."))
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            results = []
            searched = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        let found = await services.searchUsers(trimmed)
        guard !Task.isCancelled else { return }
        results = found
        searched = trimmed
    }

    private static func displayName(_ user: UserResponse) -> String {
        guard let name = user.name, !name.isEmpty else { return user.username }
        return name
    }
}
