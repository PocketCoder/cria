import CriaKit
import SwiftUI

/// Archived projects, which the tree hides. Each row opens the project (shown as archived, with a banner and an
/// Unarchive button) and carries an Unarchive action. On iOS it is pushed from Browse; on the Mac it sits in a sheet
/// and `onOpen` selects the project in the main window.
struct ArchivedProjectsView: View {
    let services: AppServices
    /// Set on the Mac, where a row selects the project instead of pushing a route.
    var onOpen: ((ProjectRecord) -> Void)?
    @State private var live: LiveValue<[ProjectRecord]>
    @State private var failure: String?

    init(services: AppServices, onOpen: ((ProjectRecord) -> Void)? = nil) {
        self.services = services
        self.onOpen = onOpen
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.projects]) { reading in ProjectTree.archived(try reading.projects()) }
        })
    }

    var body: some View {
        List {
            if live.value.isEmpty {
                Text("No archived projects.").foregroundStyle(Color(.mutedForeground))
            }
            ForEach(live.value, id: \.localId) { project in
                row(project)
                    .swipeActions(edge: .trailing) {
                        Button("Unarchive") { unarchive(project) }.tint(Color(.primary))
                    }
                    .contextMenu {
                        Button("Unarchive", systemImage: "tray.and.arrow.up") { unarchive(project) }
                    }
            }
        }
        .criaSurface()
        .navigationTitle("Archived projects")
        .task { await live.run() }
        .errorHaptic(failure)
        .alert("Could not unarchive", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    @ViewBuilder private func row(_ project: ProjectRecord) -> some View {
        if let onOpen {
            Button { onOpen(project) } label: { label(project) }
                .buttonStyle(.plain)
        } else {
            NavigationLink(value: Route.project(project.localId)) { label(project) }
        }
    }

    private func label(_ project: ProjectRecord) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color(hexString: project.hexColor) ?? Color(.mutedForeground))
                .frame(width: 12, height: 12)
            Text(project.title).font(Theme.rowTitle)
            Spacer(minLength: 0)
            Text("Archived").font(Theme.footnote).foregroundStyle(Color(.mutedForeground))
        }
        .contentShape(Rectangle())
    }

    private func unarchive(_ project: ProjectRecord) {
        do {
            try services.store.setProjectArchived(localId: project.localId, archived: false)
        } catch {
            failure = String(describing: error)
        }
    }
}

/// Shown under an archived project's screen: the server treats it as read-only, so say so and offer the way back.
struct ArchivedProjectBanner: View {
    let services: AppServices
    let project: ProjectRecord
    @State private var failure: String?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "archivebox").foregroundStyle(Color(.mutedForeground))
            Text("This project is archived. Unarchive it to make changes.")
                .font(Theme.footnote)
                .foregroundStyle(Color(.mutedForeground))
            Spacer(minLength: 8)
            Button("Unarchive") {
                do {
                    try services.store.setProjectArchived(localId: project.localId, archived: false)
                } catch {
                    failure = String(describing: error)
                }
            }
            .buttonStyle(.bordered)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
        .errorHaptic(failure)
        .alert("Could not unarchive", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }
}
