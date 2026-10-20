import CriaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import UserNotifications

/// Settings > Notifications: the master switch (asks the OS for permission), the morning summary and weekly round-up
/// (read by `SummaryScheduler`), the server's email reminders and overdue digest, and the in-app inbox.
struct NotificationSettingsSection: View {
    let services: AppServices
    let model: SettingsModel
    /// Closes the Settings sheet (used when a notification opens a task).
    let onClose: () -> Void
    @ObservedObject var prefs: PreferencesModel
    @State private var status = UNAuthorizationStatus.notDetermined
    @Environment(\.scenePhase) private var scenePhase
    /// A share link has no user of its own: no activity inbox or email settings, as on desktop.
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    private var denied: Bool { status == .denied }
    private var notificationsOn: Bool { prefs.value.notificationsEnabled && !denied }

    var body: some View {
        Group {
            localSection
            if !isLinkShare { emailSection }
        }
        .task(id: scenePhase) { await refreshStatus() }
    }

    private var localSection: some View {
        Section {
            Toggle(isOn: Binding(get: { notificationsOn }, set: { enabled in setNotifications(enabled) })) {
                SettingsLabel("Notifications", symbol: "bell.badge", token: .coral500)
            }
            summaryRows
            #if os(iOS)
            // The Mac's Notifications pane has its own Dock badge switch.
            Toggle(isOn: Binding(get: { prefs.value.appIconBadge }, set: { enabled in setBadge(enabled) })) {
                SettingsLabel("App icon badge", symbol: "app.badge", token: .coral500)
            }
            #endif
            if !isLinkShare {
                NavigationLink { NotificationsView(services: services, onClose: onClose) } label: {
                    SettingsLabel("Activity", symbol: "tray.full", token: .sky700)
                }
            }
        } header: {
            Text("Notifications")
        } footer: {
            footer
        }
    }

    @ViewBuilder
    private var summaryRows: some View {
        Toggle(isOn: $prefs.value.morningSummaryEnabled) {
            SettingsLabel("Morning summary", symbol: "sun.max", token: .marigold500)
        }
        .disabled(!notificationsOn)
        if prefs.value.morningSummaryEnabled && notificationsOn {
            DatePicker("Morning summary time", selection: timeBinding(\.morningSummaryTime), displayedComponents: .hourAndMinute)
        }
        Toggle(isOn: $prefs.value.weeklyRoundupEnabled) {
            SettingsLabel("Weekly round-up", symbol: "calendar.badge.checkmark", token: .meadow500)
        }
        .disabled(!notificationsOn)
        if prefs.value.weeklyRoundupEnabled && notificationsOn {
            DatePicker("Weekly round-up time", selection: timeBinding(\.weeklyRoundupTime), displayedComponents: .hourAndMinute)
        }
    }

    @ViewBuilder
    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if denied {
                Text("Notifications are turned off for Cria in iOS Settings.")
                Button("Open Settings") { openSystemSettings() }
            } else {
                Text("The weekly round-up arrives on \(Weekdays.name(model.general.weekStart)), the first day of your week.")
                #if os(iOS)
                Text("The badge counts open tasks that are overdue or due today.")
                #endif
            }
        }
    }

    private var emailSection: some View {
        Section("Email") {
            emailRows
        }
        .disabled(!model.loaded)
    }

    private var emailRows: some View {
        Group {
            Toggle(isOn: Binding(
                get: { model.general.emailRemindersEnabled },
                set: { value in
                    Task { await model.save(GeneralSettings.changeEmailReminders(value)) { $0.emailRemindersEnabled = value } }
                }
            )) {
                SettingsLabel("Email reminders", symbol: "envelope.badge", token: .coral500)
            }
            Toggle(isOn: Binding(
                get: { model.general.overdueRemindersEnabled },
                set: { value in
                    Task { await model.save(GeneralSettings.changeOverdueReminders(value)) { $0.overdueRemindersEnabled = value } }
                }
            )) {
                SettingsLabel("Overdue task digest", symbol: "exclamationmark.circle", token: .marigold500)
            }
            if model.general.overdueRemindersEnabled {
                DatePicker("Digest time", selection: Binding(
                    get: { ClockTime.date(model.general.overdueRemindersTime) },
                    set: { date in
                        let text = ClockTime.text(date)
                        Task { await model.save(GeneralSettings.changeOverdueTime(text)) { $0.overdueRemindersTime = text } }
                    }
                ), displayedComponents: .hourAndMinute)
            }
        }
    }

    private func timeBinding(_ path: WritableKeyPath<LocalPreferences, String>) -> Binding<Date> {
        Binding(
            get: { ClockTime.date(prefs.value[keyPath: path]) },
            set: { date in prefs.value[keyPath: path] = ClockTime.text(date) }
        )
    }

    private func setNotifications(_ enabled: Bool) {
        guard enabled else {
            prefs.value.notificationsEnabled = false
            return
        }
        Task {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            await refreshStatus()
            prefs.value.notificationsEnabled = granted
        }
    }

    /// The badge needs the OS permission (it is part of the notification request), so turning it on asks if nobody has.
    private func setBadge(_ enabled: Bool) {
        prefs.value.appIconBadge = enabled
        guard enabled else { return }
        Task {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            await refreshStatus()
        }
    }

    private func refreshStatus() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func openSystemSettings() {
        ExternalLink.openAppSettings()
    }
}
