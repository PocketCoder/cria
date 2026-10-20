import CriaKit
import Observation
import SwiftUI

/// The unread count behind the bell, kept fresh while the app is active. One per window, shared through the
/// environment, so the bells on several screens do not each poll.
@MainActor @Observable
final class NotificationInbox {
    private(set) var unread = 0

    /// Takes the count from a list the inbox screen has just read or changed.
    func apply(_ items: [AppNotification]) {
        unread = items.unreadCount
    }

    /// A failed read (offline, signed out) keeps the last count.
    func refresh(_ services: AppServices) async {
        guard let items = try? await services.api.notifications() else { return }
        apply(items)
    }

    /// Reads now, then every `NotificationPolling.interval`, until the calling task is cancelled.
    func poll(_ services: AppServices) async {
        while !Task.isCancelled {
            await refresh(services)
            try? await Task.sleep(for: NotificationPolling.interval)
        }
    }
}

/// A bell with the unread count on it. Opens the activity inbox in a sheet. A share link has no account, so no bell.
struct NotificationBell: View {
    let services: AppServices
    @Environment(NotificationInbox.self) private var inbox: NotificationInbox?
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false
    @State private var showing = false

    private var unread: Int { inbox?.unread ?? 0 }

    var body: some View {
        if !isLinkShare {
            Button { showing = true } label: {
                Image(systemName: unread > 0 ? "bell.badge.fill" : "bell")
                    .overlay(alignment: .topTrailing) { badge }
            }
            .help("Notifications")
            .accessibilityLabel(unread > 0 ? "Notifications, \(unread) unread" : "Notifications")
            .sheet(isPresented: $showing, onDismiss: { Task { await inbox?.refresh(services) } }) {
                NavigationStack {
                    NotificationsView(services: services, onClose: { showing = false })
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) { Button("Done") { showing = false } }
                        }
                }
                .macSheetFrame()
            }
        }
    }

    @ViewBuilder private var badge: some View {
        if unread > 0 {
            Text(unread > 99 ? "99+" : "\(unread)")
                .font(.system(size: 10, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .frame(minWidth: 14, minHeight: 14)
                .background(Color(.primary), in: Capsule())
                .offset(x: 8, y: -6)
                .accessibilityHidden(true)
        }
    }
}
