import CriaKit
import SwiftUI

/// In-app notifications from the server, with mark-read. Tapping one marks it read and, when it refers to a task,
/// opens that task.
struct NotificationsView: View {
    let services: AppServices
    /// Closes the Settings sheet, so the task opened through its `cria://` link is not hidden behind it.
    let onClose: () -> Void
    @Environment(\.openURL) private var openURL
    @Environment(\.dateDisplay) private var dateDisplay
    /// The bell's count, kept in step with what this screen reads and changes. Nil in Settings on the Mac.
    @Environment(NotificationInbox.self) private var inbox: NotificationInbox?
    @State private var items: [AppNotification] = []
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Color(.destructive))
            }
            ForEach(items) { item in
                Button { Task { await open(item) } } label: { row(item) }
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
                    Text(SettingsDate.label(created, display: dateDisplay)).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
        }
    }

    private func load() async {
        do {
            items = try await services.api.notifications()
            inbox?.apply(items)
            errorMessage = nil
        } catch {
            errorMessage = String(describing: error)
        }
        loading = false
    }

    /// Marks the notification read, then opens its task. A failed mark-read is shown and nothing opens.
    private func open(_ item: AppNotification) async {
        if !item.isRead {
            do {
                try await services.api.markNotificationRead(id: item.id)
            } catch {
                errorMessage = "Couldn\u{2019}t mark it read: \(error)"
                return
            }
            await load()
        }
        guard let serverId = item.parsed.taskServerId else { return }
        guard let localId = try? services.store.resolveTaskId(String(serverId)),
              let url = DeepLink.taskURL(localId: localId) else {
            errorMessage = "That task is not on this device yet. Pull to sync, then try again."
            return
        }
        openURL(url)
        onClose()
    }

    private func markAllRead() async {
        do {
            try await services.api.markAllNotificationsRead()
            await load()
        } catch {
            errorMessage = "Couldn\u{2019}t mark all read: \(error)"
        }
    }
}
