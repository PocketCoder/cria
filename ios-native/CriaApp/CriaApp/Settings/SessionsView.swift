import CriaKit
import SwiftUI

/// Devices signed in to this account. Swipe to revoke; revoking this device signs it out. Ported from
/// `SessionsSection.tsx`.
struct SessionsView: View {
    let services: AppServices
    @State private var sessions: [UserSession] = []
    @State private var currentId: String?
    @State private var loaded = false
    @State private var unsupported = false
    @State private var errorMessage: String?
    @State private var pending: UserSession?

    init(services: AppServices) {
        self.services = services
    }

    var body: some View {
        List {
            if unsupported {
                Section { Text("This server does not support session management.").foregroundStyle(Color(.mutedForeground)) }
            } else if loaded && sessions.isEmpty {
                Section { Text("No active sessions.").foregroundStyle(Color(.mutedForeground)) }
            }
            if !sessions.isEmpty {
                Section {
                    ForEach(sessions) { session in row(session) }
                } footer: {
                    Text("Swipe a device to revoke it. It will be signed out.").font(Theme.caption)
                }
            }
            if let errorMessage {
                Section { Text(errorMessage).font(Theme.caption).foregroundStyle(Color(.destructive)) }
            }
        }
        .criaSurface()
        .tint(Color(.primary))
        .navigationTitle("Sessions")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if !loaded && errorMessage == nil { ProgressView() } }
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog(
            pending?.id == currentId ? "Sign out of this device?" : "Revoke access?",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            titleVisibility: .visible,
            presenting: pending
        ) { session in
            Button(session.id == currentId ? "Sign out" : "Revoke access", role: .destructive) {
                Task { await revoke(session) }
            }
        } message: { session in
            Text(session.id == currentId
                 ? "You will need to sign in again."
                 : "\(session.deviceName) will be signed out.")
        }
    }

    private func row(_ session: UserSession) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol(for: session))
                .font(.system(size: 20))
                .foregroundStyle(Color(.primary))
                .frame(width: 36, height: 36)
                .background(Color(.primarySoft), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(session.deviceName).font(Theme.rowTitle).lineLimit(1)
                    if session.id == currentId { CriaChip(text: "This device", tint: Color(.primary)) }
                }
                Text(detail(session)).font(Theme.caption).foregroundStyle(Color(.mutedForeground)).lineLimit(1)
            }
        }
        .swipeActions(edge: .trailing) {
            Button(session.id == currentId ? "Sign out" : "Revoke", role: .destructive) { pending = session }
        }
        .accessibilityElement(children: .combine)
    }

    private func symbol(for session: UserSession) -> String {
        let name = session.deviceName
        if name.hasSuffix("iPhone") || name.hasSuffix("Android") { return "iphone" }
        if name.hasSuffix("iPad") { return "ipad" }
        return "laptopcomputer"
    }

    private func detail(_ session: UserSession) -> String {
        var parts: [String] = []
        if !session.ipAddress.isEmpty { parts.append(session.ipAddress) }
        if let active = session.lastActive, let date = SessionDates.parse(active) {
            parts.append("active \(date.formatted(date: .abbreviated, time: .shortened))")
        }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do {
            if let listing = try await services.api.sessions() {
                sessions = SessionRules.currentFirst(listing.sessions, currentId: listing.currentId)
                currentId = listing.currentId
                unsupported = false
            } else {
                unsupported = true
            }
            errorMessage = nil
        } catch {
            errorMessage = "Couldn\u{2019}t load sessions: \(error)"
        }
        loaded = true
    }

    private func revoke(_ session: UserSession) async {
        do {
            try await services.api.revokeSession(id: session.id)
            errorMessage = nil
            await load()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
