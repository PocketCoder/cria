import CriaKit
import Observation
import SwiftUI

/// What the sidebar's menus, File > New Saved Filter, the palette and `g a` ask for: the iOS Browse sheets and
/// confirmations, held once per window. The store calls and wording are Browse's (`BrowseView`).
@MainActor @Observable
final class MacSidebarActions {
    var projectEditor: ProjectEditorTarget?
    var projectInfo: ProjectShareTarget?
    var sharing: ProjectShareTarget?
    var pendingProjectDelete: ProjectRecord?
    var filterEditor: FilterEditorTarget?
    var pendingFilterDelete: SavedFilterRecord?
    var labelEditor: LabelEditTarget?
    var pendingLabelDelete: LabelDeleteTarget?
    var showingLabels = false
    var showingTeams = false
    /// Title of the project being duplicated, while the server copies it.
    var duplicatingTitle: String?
    var failureTitle = "Could not delete"
    var failure: String?

    func newFilter() {
        filterEditor = FilterEditorTarget(record: nil)
    }

    func toggleFavourite(_ project: ProjectRecord, services: AppServices) {
        attempt("Could not save") { try services.store.setProjectFavorite(localId: project.localId, isFavorite: !project.isFavorite) }
    }

    func deleteProject(_ project: ProjectRecord, services: AppServices) {
        attempt("Could not delete") { try services.store.deleteProject(localId: project.localId) }
    }

    /// Online only. The server copies the project, then a pull brings the copy in.
    func duplicate(_ project: ProjectRecord, services: AppServices) async {
        duplicatingTitle = project.title
        defer { duplicatingTitle = nil }
        do {
            try await services.duplicateProject(localId: project.localId)
        } catch {
            failureTitle = "Could not duplicate"
            failure = ProjectDuplicate.failureMessage(error)
        }
    }

    /// Siblings only: `siblings` is the list the row was dragged in, in its old order.
    func move(_ siblings: [ProjectRecord], from source: IndexSet, to destination: Int, services: AppServices) {
        guard let from = source.first, siblings.indices.contains(from) else { return }
        var order = siblings.map(\.localId)
        order.move(fromOffsets: source, toOffset: destination)
        guard order != siblings.map(\.localId) else { return }
        attempt("Could not reorder project") { try services.store.reorderProjects(order, moved: siblings[from].localId) }
    }

    /// Labels have no undo, so the confirmation says how many tasks lose it (open and done).
    func askToDelete(_ label: LabelRecord, services: AppServices) {
        let count = (try? services.store.taskCount(forLabel: label.localId)) ?? 0
        pendingLabelDelete = LabelDeleteTarget(label: label, taskCount: count)
    }

    func deleteLabel(_ label: LabelRecord, services: AppServices) {
        attempt("Could not delete") { try services.store.deleteLabel(localId: label.localId) }
    }

    /// Saved filters live on the server only, so deleting one needs the network.
    func deleteFilter(_ filter: SavedFilterRecord, services: AppServices) async {
        do {
            try await services.deleteSavedFilter(serverId: filter.serverId)
        } catch {
            fail("Could not delete", error)
        }
    }

    private func attempt(_ title: String, _ work: () throws -> Void) {
        do { try work() } catch { fail(title, error) }
    }

    private func fail(_ title: String, _ error: any Error) {
        failureTitle = title
        failure = String(describing: error)
    }
}

/// The sheets and confirmations `MacSidebarActions` drives, attached once to the window.
struct MacSidebarSheets: ViewModifier {
    let services: AppServices
    @Bindable var sheets: MacSidebarActions

    func body(content: Content) -> some View {
        content
            .sheet(item: $sheets.projectEditor) { target in
                let projects = ProjectTree.visible((try? services.store.projects()) ?? [])
                ProjectEditorSheet(services: services, target: target, projects: projects)
            }
            .sheet(item: $sheets.projectInfo) { target in
                ProjectInfoSheet(services: services, projectLocalId: target.project.localId).macSheetFrame()
            }
            .sheet(item: $sheets.sharing) { target in
                ProjectSharingSheet(services: services, project: target.project).macSheetFrame()
            }
            .sheet(item: $sheets.filterEditor) { target in
                FilterEditorSheet(services: services, existing: target.record)
            }
            .sheet(item: $sheets.labelEditor) { target in
                LabelEditorSheet(services: services, label: target.label)
            }
            .sheet(isPresented: $sheets.showingLabels) { MacLabelManager(services: services) }
            .sheet(isPresented: $sheets.showingTeams) { MacTeamsSheet(services: services) }
            .overlay {
                if let title = sheets.duplicatingTitle {
                    ProgressView("Duplicating \(title)…")
                        .padding(20)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .modifier(MacSidebarAlerts(services: services, sheets: sheets))
    }
}

private struct MacSidebarAlerts: ViewModifier {
    let services: AppServices
    let sheets: MacSidebarActions

    func body(content: Content) -> some View {
        content
            .alert(
                "Delete project and its tasks?",
                isPresented: Binding(get: { sheets.pendingProjectDelete != nil }, set: { if !$0 { sheets.pendingProjectDelete = nil } }),
                presenting: sheets.pendingProjectDelete
            ) { project in
                Button("Delete", role: .destructive) { sheets.deleteProject(project, services: services) }
                Button("Cancel", role: .cancel) {}
            } message: { project in
                Text(project.title)
            }
            .alert(
                "Delete filter?",
                isPresented: Binding(get: { sheets.pendingFilterDelete != nil }, set: { if !$0 { sheets.pendingFilterDelete = nil } }),
                presenting: sheets.pendingFilterDelete
            ) { filter in
                Button("Delete", role: .destructive) { Task { await sheets.deleteFilter(filter, services: services) } }
                Button("Cancel", role: .cancel) {}
            } message: { filter in
                Text(filter.title)
            }
            .alert(
                "Delete label?",
                isPresented: Binding(get: { sheets.pendingLabelDelete != nil }, set: { if !$0 { sheets.pendingLabelDelete = nil } }),
                presenting: sheets.pendingLabelDelete
            ) { target in
                Button("Delete", role: .destructive) { sheets.deleteLabel(target.label, services: services) }
                Button("Cancel", role: .cancel) {}
            } message: { target in
                Text(target.message)
            }
            .alert(
                sheets.failureTitle,
                isPresented: Binding(get: { sheets.failure != nil }, set: { if !$0 { sheets.failure = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(sheets.failure ?? "")
            }
    }
}

/// A project's right-click menu: Browse's long-press menu plus favourite and delete (swipes on iOS).
struct MacProjectMenu: View {
    let project: ProjectRecord
    let services: AppServices
    let sheets: MacSidebarActions
    /// A share link has no account: no sharing or duplicating, which the server would refuse.
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    var body: some View {
        Button("Info", systemImage: "info.circle") { sheets.projectInfo = ProjectShareTarget(project: project) }
        Button("Edit…", systemImage: "pencil") { sheets.projectEditor = .edit(project) }
        Button("New Sub-project…", systemImage: "folder.badge.plus") { sheets.projectEditor = .createChild(parent: project.localId) }
        Button(project.isFavorite ? "Unfavourite" : "Favourite", systemImage: "star") {
            sheets.toggleFavourite(project, services: services)
        }
        if !isLinkShare {
            Divider()
            Button("Share…", systemImage: "person.badge.plus") { sheets.sharing = ProjectShareTarget(project: project) }
            Button("Duplicate", systemImage: "plus.square.on.square") { Task { await sheets.duplicate(project, services: services) } }
        }
        Divider()
        Button("Delete…", systemImage: "trash", role: .destructive) { sheets.pendingProjectDelete = project }
    }
}

/// `g a`: every label, with edit and delete, as the desktop app's label manager. Its own edit and delete state: the
/// window's sheets cannot present over this one.
private struct MacLabelManager: View {
    let services: AppServices
    @Environment(\.dismiss) private var dismiss
    @State private var live: LiveValue<[LabelRecord]>
    @State private var editing: LabelEditTarget?
    @State private var pendingDelete: LabelDeleteTarget?
    @State private var failure: String?

    init(services: AppServices) {
        self.services = services
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.labels]) { try $0.labels() }
        })
    }

    var body: some View {
        NavigationStack {
            List(live.value, id: \.localId) { label in
                HStack {
                    Image(systemName: "tag.fill")
                        .foregroundStyle(Color(hexString: label.hexColor) ?? Color(.mutedForeground))
                    Text(label.title)
                    Spacer()
                    Button("Edit") { editing = LabelEditTarget(label: label) }
                    Button("Delete", role: .destructive) {
                        let count = (try? services.store.taskCount(forLabel: label.localId)) ?? 0
                        pendingDelete = LabelDeleteTarget(label: label, taskCount: count)
                    }
                }
            }
            .macRowButtons()
            .overlay {
                if live.value.isEmpty { ContentUnavailableView("No labels", systemImage: "tag") }
            }
            .navigationTitle("Labels")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .macSheetFrame()
        .sheet(item: $editing) { target in LabelEditorSheet(services: services, label: target.label) }
        .alert(
            "Delete label?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            presenting: pendingDelete
        ) { target in
            Button("Delete", role: .destructive) {
                do { try services.store.deleteLabel(localId: target.label.localId) } catch { failure = String(describing: error) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text(target.message)
        }
        .alert("Could not delete", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task { await live.run() }
    }
}

/// `g m`: the Teams screen from Settings > Account.
private struct MacTeamsSheet: View {
    let services: AppServices
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TeamsView(services: services)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
        .macSheetFrame()
    }
}
