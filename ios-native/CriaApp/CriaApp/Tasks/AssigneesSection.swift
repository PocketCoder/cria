import CriaKit
import SwiftUI

/// The people assigned to a task. Remove (swipe or context menu) and assign write through the store, which queues the
/// server calls. The user search is presented by TaskDetailView through `state`.
struct AssigneesSection: View {
    let services: AppServices
    let taskLocalId: String
    let assignees: [AssigneeRecord]
    let state: TaskDetailPresentation
    /// A share link cannot search for people, so it cannot add assignees.
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    var body: some View {
        Section("Assignees") {
            ForEach(assignees) { assignee in
                AssigneeRow(name: Self.name(assignee), detail: Self.handle(assignee))
                    .swipeActions {
                        Button("Remove", systemImage: "person.badge.minus", role: .destructive) { remove(assignee) }
                    }
                    .contextMenu {
                        Button("Remove", systemImage: "person.badge.minus", role: .destructive) { remove(assignee) }
                    }
                    .accessibilityAction(named: "Remove") { remove(assignee) }
            }
            if !isLinkShare {
                Button("Assign…", systemImage: "person.badge.plus") { state.assigning = true }
            }
        }
    }

    /// The display name when the server has sent one, else the username.
    static func name(_ assignee: AssigneeRecord) -> String {
        if let display = assignee.displayName, !display.isEmpty { return display }
        return assignee.username ?? "User \(assignee.userId)"
    }

    /// "@username" under a display name; nothing when the name already is the username.
    static func handle(_ assignee: AssigneeRecord) -> String? {
        guard let display = assignee.displayName, !display.isEmpty, let username = assignee.username,
              display != username else { return nil }
        return "@\(username)"
    }

    private func remove(_ assignee: AssigneeRecord) {
        state.attempt { try services.store.removeAssignee(taskLocalId: taskLocalId, userId: assignee.userId) }
    }
}

/// A name with its initials in a circle, as the comment thread shows authors.
struct AssigneeRow: View {
    let name: String
    var detail: String?
    @ScaledMetric(relativeTo: .caption) private var avatarSize: CGFloat = 30

    var body: some View {
        HStack(spacing: 12) {
            // Primary ink, not heather: heather on its own wash is too faint in dark mode.
            Text(Self.initials(name))
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color(.primary))
                .frame(width: avatarSize, height: avatarSize)
                .background(Color(.heather600).opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).foregroundStyle(Color(.foreground))
                if let detail {
                    Text(detail).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
        }
        .accessibilityElement(children: .combine)
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
    /// Why the last search failed, shown in place of the results.
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List(results, id: \.id) { user in
                Button {
                    onPick(user)
                    dismiss()
                } label: {
                    HStack {
                        AssigneeRow(name: Self.displayName(user), detail: Self.handle(user))
                        Spacer()
                        if assigned.contains(user.id) {
                            Image(systemName: "checkmark").foregroundStyle(Color(.primary))
                                .accessibilityHidden(true)
                        }
                    }
                }
                .disabled(assigned.contains(user.id))
                .accessibilityValue(assigned.contains(user.id) ? "Already assigned" : "")
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
        } else if let failure, searched == trimmed {
            ContentUnavailableView("Couldn’t search", systemImage: "exclamationmark.triangle", description: Text(failure))
        } else if results.isEmpty, searched == trimmed {
            ContentUnavailableView("Nobody matches ‘\(trimmed)’", systemImage: "person.slash")
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            results = []
            searched = nil
            failure = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        do {
            let found = try await services.searchUsersOrThrow(trimmed)
            guard !Task.isCancelled else { return }
            results = found
            failure = nil
        } catch {
            guard !Task.isCancelled else { return }
            results = []
            failure = isOfflineError(error)
                ? "You're offline. Searching for people needs a connection."
                : String(describing: error)
        }
        searched = trimmed
    }

    private static func displayName(_ user: UserResponse) -> String {
        guard let name = user.name, !name.isEmpty else { return user.username }
        return name
    }

    private static func handle(_ user: UserResponse) -> String? {
        guard let name = user.name, !name.isEmpty, name != user.username else { return nil }
        return "@\(user.username)"
    }
}
