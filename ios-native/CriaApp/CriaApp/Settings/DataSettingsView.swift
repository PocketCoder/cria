import CriaKit
import SwiftUI

/// Data export and account deletion. Ported from `DataTab.tsx`. Both need the account password.
struct DataSettingsView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var status: ExportStatus?
    @State private var exportPassword = ""
    @State private var exporting = false
    @State private var exportFile: URL?
    @State private var exportError: String?
    @State private var deletionScheduled: String?
    @State private var deletePassword = ""
    @State private var confirmingDelete = false
    @State private var deleteError: String?

    init(services: AppServices, onSignOut: @escaping (_ wipeLocalData: Bool) -> Void) {
        self.services = services
        self.onSignOut = onSignOut
    }

    var body: some View {
        Form {
            exportSection
            deletionSections
        }
        .criaSurface()
        .tint(Color(.primary))
        .navigationTitle("Data")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .confirmationDialog(
            "Delete your account?", isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button("Delete account", role: .destructive) { Task { await requestDeletion() } }
        } message: {
            Text("The server emails you to confirm. This device signs out and clears its local data.")
        }
    }

    private var exportSection: some View {
        Section {
            SecureField("Current password", text: $exportPassword)
            Button(exporting ? "Working\u{2026}" : "Request export") { Task { await requestExport() } }
                .disabled(exporting || exportPassword.isEmpty)
            Button("Download export") { Task { await download() } }
                .disabled(exporting || exportPassword.isEmpty)
            if let exportFile {
                ShareLink(item: exportFile) { Label("Share export", systemImage: "square.and.arrow.up") }
            }
            if let exportError { Text(exportError).font(Theme.caption).foregroundStyle(Color(.destructive)) }
        } header: {
            Text("Data export")
        } footer: {
            Text([status?.summary, "Export all your tasks, projects and settings as a ZIP file."]
                .compactMap { $0 }.joined(separator: "\n")).font(Theme.caption)
        }
    }

    @ViewBuilder
    private var deletionSections: some View {
        if let deletionScheduled {
            Section {
                Text("Deletion scheduled for \(display(deletionScheduled)). Check your email to confirm.")
                    .foregroundStyle(Color(.warningText))
                SecureField("Current password", text: $deletePassword)
                Button("Cancel deletion") { Task { await cancelDeletion() } }
                    .disabled(deletePassword.isEmpty)
                if let deleteError { Text(deleteError).font(Theme.caption).foregroundStyle(Color(.destructive)) }
            }
        } else {
            Section {
                SecureField("Current password", text: $deletePassword)
                if let deleteError { Text(deleteError).font(Theme.caption).foregroundStyle(Color(.destructive)) }
            } header: {
                Text("Delete account")
            } footer: {
                Text("Permanently deletes your account and all data. The server sends a confirmation email.")
                    .font(Theme.caption)
            }
            Section {
                Button("Request account deletion", role: .destructive) { confirmingDelete = true }
                    .frame(maxWidth: .infinity)
                    .disabled(deletePassword.isEmpty)
            }
        }
    }

    private func display(_ stamp: String) -> String {
        SessionDates.parse(stamp).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? stamp
    }

    private func load() async {
        status = try? await services.api.exportStatus()
        let user: JSONValue? = try? await services.api.get("/user")
        deletionScheduled = normaliseDate(user?["deletion_scheduled_at"]?.stringValue)
    }

    private func requestExport() async {
        exporting = true
        defer { exporting = false }
        do {
            try await services.api.requestExport(password: exportPassword)
            status = try? await services.api.exportStatus()
            exportError = nil
        } catch {
            exportError = String(describing: error)
        }
    }

    private func download() async {
        exporting = true
        defer { exporting = false }
        do {
            let data = try await services.api.downloadExport(password: exportPassword)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("vikunja-export.zip")
            try data.write(to: url, options: .atomic)
            exportFile = url
            exportError = nil
        } catch {
            exportError = String(describing: error)
        }
    }

    private func requestDeletion() async {
        do {
            try await services.api.requestDeletion(password: deletePassword)
            deleteError = nil
            deletePassword = ""
            onSignOut(true)
        } catch {
            deleteError = String(describing: error)
        }
    }

    private func cancelDeletion() async {
        do {
            try await services.api.cancelDeletion(password: deletePassword)
            deleteError = nil
            deletePassword = ""
            deletionScheduled = nil
        } catch {
            deleteError = String(describing: error)
        }
    }
}
