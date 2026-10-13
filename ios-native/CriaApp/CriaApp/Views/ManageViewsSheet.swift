import CriaKit
import SwiftUI

/// Create, rename, delete and reorder a project's views.
struct ManageViewsSheet: View {
    let services: AppServices
    let projectLocalId: String
    let views: [ViewRecord]
    let onDeleted: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var newTitle = ""
    @State private var newKind: ViewKind = .list
    @State private var renaming: ViewRecord?
    @State private var renameDraft = ""
    @State private var message: String?
    @State private var editing: ViewEditTarget?
    /// Counts finished drags, for the drop haptic.
    @State private var reorders = 0
    @State private var deletions = 0

    private var slots: [ViewSlot] { views.map(\.slot) }

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            List {
                Section("Views") {
                    ForEach(views, id: \.localId) { view in row(view) }
                        .onMove(perform: ViewManagement.canReorder(slots) ? { moveViews($0, $1) } : nil)
                }
                addSection
            }
                .criaSurface()
            .environment(\.editMode, .constant(ViewManagement.canReorder(slots) ? .active : .inactive))
            .sensoryFeedback(.impact(weight: .light), trigger: reorders)
            .sensoryFeedback(.warning, trigger: deletions)
            .navigationTitle("Manage views")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(item: $editing) { target in
                ViewSettingsSheet(services: services, view: target.view)
            }
            .alert("Rename view", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Title", text: $renameDraft)
                Button("Save") { commitRename() }
                Button("Cancel", role: .cancel) { renaming = nil }
            }
            .alert("Can't delete", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(message ?? "")
            }
        }
    }

    private func row(_ view: ViewRecord) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(ViewManagement.label(view.slot))
                if let hint = ViewManagement.kindHint(view.slot) {
                    Text(hint).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 8)
            // A button in the row, since a tap on the row itself does nothing while the list is in reorder mode.
            Button { editing = ViewEditTarget(view: view) } label: {
                Image(systemName: "slider.horizontal.3").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Edit \(ViewManagement.label(view.slot)) settings")
        }
        .accessibilityActions {
            Button("Edit filter and settings") { editing = ViewEditTarget(view: view) }
            Button("Rename") { beginRename(view) }
            Button("Delete") { delete(view) }
        }
        .swipeActions {
            Button("Delete", systemImage: "trash", role: .destructive) { delete(view) }
            Button("Rename", systemImage: "pencil") { beginRename(view) }
        }
        // Swipe actions are off while the list is in reorder mode, so the same actions are on a long press.
        .contextMenu {
            Button("Filter and settings", systemImage: "slider.horizontal.3") { editing = ViewEditTarget(view: view) }
            Button("Rename", systemImage: "pencil") { beginRename(view) }
            Button("Delete", systemImage: "trash", role: .destructive) { delete(view) }
        }
    }

    private func beginRename(_ view: ViewRecord) {
        renameDraft = view.title
        renaming = view
    }

    private var addSection: some View {
        Section("New view") {
            TextField("Title", text: $newTitle)
            Picker("Kind", selection: $newKind) {
                ForEach(ViewManagement.kinds, id: \.rawValue) { Text(ViewManagement.kindLabel($0)).tag($0) }
            }
            Button("Add view", systemImage: "plus") { add() }
        }
    }

    private func add() {
        let last = views.compactMap(\.position).max() ?? 0
        let input = ViewInput(
            title: ViewManagement.newViewTitle(draft: newTitle, kind: newKind),
            viewKind: newKind,
            position: last + Position.baseStep,
            bucketConfigurationMode: newKind == .kanban ? .manual : nil
        )
        _ = try? services.store.createView(projectLocalId: projectLocalId, input)
        newTitle = ""
    }

    private func commitRename() {
        let title = renameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if let view = renaming, !title.isEmpty {
            _ = try? services.store.updateView(localId: view.localId, ViewUpdate(title: title))
        }
        renaming = nil
    }

    private func delete(_ view: ViewRecord) {
        switch ViewManagement.deleteBlocker(slots, localId: view.localId) {
        case .lastView?: message = "A project needs at least one view."
        case .placeholder?: message = "This default view has not synced yet. Try again after the next sync."
        case nil:
            try? services.store.deleteView(localId: view.localId)
            deletions += 1
            onDeleted(view.localId)
        }
    }

    private func moveViews(_ source: IndexSet, _ destination: Int) {
        guard let from = source.first else { return }
        let target = destination > from ? destination - 1 : destination
        guard views.indices.contains(target), from != target else { return }
        let active = views[from].localId
        guard let reorder = ViewManagement.planReorder(slots, activeId: active, overId: views[target].localId) else { return }
        switch reorder.plan {
        case .midpoint(let position):
            _ = try? services.store.updateView(localId: active, ViewUpdate(position: position))
        case .reindex:
            try? services.store.reindexViews(reorder.orderedIds)
        }
        reorders += 1
    }
}
