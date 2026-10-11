import CriaKit
import SwiftUI

/// Search users by name or username and pick one to mention.
struct MentionPickerSheet: View {
    let services: AppServices
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [UserResponse] = []

    var body: some View {
        NavigationStack {
            List(results, id: \.id) { user in
                Button {
                    onPick(user.username)
                    dismiss()
                } label: {
                    VStack(alignment: .leading) {
                        Text(user.name?.isEmpty == false ? (user.name ?? user.username) : user.username)
                        Text("@\(user.username)").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
            }
                .criaSurface()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Mention")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                results = await services.searchUsers(query)
            }
        }
        .presentationDetents([.medium, .large])
    }
}
