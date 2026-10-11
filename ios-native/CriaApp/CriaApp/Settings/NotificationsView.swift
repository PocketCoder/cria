import CriaKit
import SwiftUI

/// In-app notifications from the server, with mark-read. Tapping one marks it read.
struct NotificationsView: View {
    let services: AppServices
    @State private var items: [AppNotification] = []
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Color(.destructive))
            }
            ForEach(items) { item in
                Button { Task { await markRead(item) } } label: { row(item) }
                    .buttonStyle(.plain)
            }
            if items.isEmpty && !loading && errorMessage == nil {
                Text("No notifications").foregroundStyle(Color(.mutedForeground))
            }
        }
        .criaSurface()
        .navigationTitle("Notifications")
        .toolbar {
            Button("Mark all read") { Task { await markAllRead() } }
                .disabled(items.allSatisfy(\.isRead))
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func row(_ item: AppNotification) -> some View {
        HStack {
            Circle().fill(item.isRead ? Color.clear : Color(.primary)).frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.parsed.text).font(Theme.rowTitle).foregroundStyle(Color(.foreground))
                if let created = item.created {
                    Text(created).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
        }
    }

    private func load() async {
        do {
            items = try await services.api.notifications()
            errorMessage = nil
        } catch {
            errorMessage = String(describing: error)
        }
        loading = false
    }

    private func markRead(_ item: AppNotification) async {
        guard !item.isRead else { return }
        try? await services.api.markNotificationRead(id: item.id)
        await load()
    }

    private func markAllRead() async {
        try? await services.api.markAllNotificationsRead()
        await load()
    }
}
