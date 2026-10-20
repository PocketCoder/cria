import CriaKit
import Foundation
import UserNotifications
#if canImport(AppKit)
import AppKit
#endif

/// The count on the app icon (iOS) or Dock icon (Mac): open tasks overdue or due today, as the desktop app's badge
/// (`src/queries/badge.ts`). It follows task and project changes, re-reads when the day turns over so yesterday's
/// "today" is not left behind, and obeys Settings > "App icon badge" (Dock badge on the Mac).
enum AppIconBadge {
    static func run(store: CriaStore) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await follow(store) }
            group.addTask { await followDay(store) }
            group.addTask { await followPreferences(store) }
        }
    }

    /// Shows the count, or nothing when the badge is off. The preference is read here, so a change takes effect at the
    /// next recount (which a preference change triggers).
    @MainActor
    static func show(_ count: Int) {
        let visible = PreferencesStore().load().appIconBadge ? count : 0
        #if os(macOS)
        NSApp?.dockTile.badgeLabel = visible > 0 ? "\(visible)" : nil
        #else
        // Needs the badge permission the notification request includes; without it the call fails and nothing shows.
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(visible) }
        #endif
    }

    /// Takes the badge off, e.g. on sign-out.
    @MainActor
    static func clear() {
        #if os(macOS)
        NSApp?.dockTile.badgeLabel = nil
        #else
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(0) }
        #endif
    }

    private static func follow(_ store: CriaStore) async {
        for await open in observeStore(store, kinds: [.tasks, .projects], read: { try openToday($0) }) {
            await show(open)
        }
    }

    private static func followDay(_ store: CriaStore) async {
        var day = Calendar.cria.startOfDay(for: Date())
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            let today = Calendar.cria.startOfDay(for: Date())
            guard today != day else { continue }
            day = today
            if let open = try? openToday(store) { await show(open) }
        }
    }

    /// A preference change (the badge switch) or a return to the foreground, where sync pulls have not told the bus.
    private static func followPreferences(_ store: CriaStore) async {
        for await _ in PreferenceChanges.stream() {
            if let open = try? openToday(store) { await show(open) }
        }
    }

    private static func openToday(_ store: CriaStore) throws -> Int {
        try store.smartGroups(.today).reduce(0) { $0 + $1.items.count }
    }
}
