import CriaKit
import SwiftUI

/// Identifiable wrapper so a view can drive `.sheet(item:)`.
struct ViewEditTarget: Identifiable {
    let view: ViewRecord
    var id: String { view.localId }
}

/// A filter query field: the query coloured as it is typed, with the parser's error under it.
struct FilterQueryField: View {
    @Binding var text: String
    var placeholder = "done = false && priority >= 3"

    var body: some View {
        TextField(placeholder, text: $text, axis: .vertical)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        if !text.isEmpty { Text(FilterHighlightStyle.attributed(text)).font(.callout.monospaced()) }
        if let problem = ViewFilterParams.validate(text) {
            Text(problem).font(Theme.caption).foregroundStyle(Color(.destructive))
        }
    }
}

/// One column of a filter-mode board while it is edited.
private struct BucketRow: Identifiable, Equatable {
    let id = UUID()
    var draft: BucketFilterDraft
}

/// A view's title, filter and (for a board) how its columns are made. Saves as one view update, which pushes the
/// whole view, so nothing else on it is cleared. Ported from `ViewSettingsPanel.tsx` and `ViewFilterForm.tsx`.
struct ViewSettingsSheet: View {
    let services: AppServices
    let view: ViewRecord
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var query = ""
    @State private var includeNulls = false
    @State private var filterBuckets = false
    @State private var rows: [BucketRow] = []
    @State private var failure: String?
    @State private var didLoad = false

    private var isBoard: Bool { view.viewKind == .kanban }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && ViewFilterParams.validate(query) == nil
    }

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            Form {
                Section("Title") { TextField("Title", text: $title) }
                Section {
                    FilterQueryField(text: $query)
                    Toggle("Include tasks without a value", isOn: $includeNulls)
                } header: {
                    Text("Filter")
                } footer: {
                    Text(
                        "Leave empty to show every task. With the switch on, a task with no value for a field in the filter, "
                            + "such as no due date, still shows."
                    )
                }
                if isBoard { bucketSections }
            }
            .criaSurface()
            .navigationTitle(ViewManagement.kindLabel(view.viewKind))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.disabled(!canSave) }
            }
            .errorHaptic(failure)
            .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        .presentationDetents([.large])
        .onAppear(perform: load)
    }

    @ViewBuilder private var bucketSections: some View {
        Section {
            Picker("Columns", selection: $filterBuckets) {
                Text("Manual").tag(false)
                Text("By filter").tag(true)
            }
            .pickerStyle(.segmented)
        } header: {
            Text("Board columns")
        } footer: {
            Text(
                filterBuckets
                    ? "Each column is a filter, so cards cannot be dragged between columns. "
                        + "Your manual columns are kept and return if you switch back."
                    : "Drag cards between columns you create."
            )
        }
        if filterBuckets {
            ForEach($rows) { $row in
                Section {
                    TextField("Title", text: $row.draft.title)
                    FilterQueryField(text: $row.draft.filter, placeholder: "priority >= 3")
                    Toggle("Include tasks without a value", isOn: $row.draft.includeNulls)
                    Button("Remove column", role: .destructive) { rows.removeAll { $0.id == row.id } }
                } header: {
                    Text("Column \(columnNumber(row))")
                }
            }
            Section {
                Button("Add column", systemImage: "plus") { rows.append(BucketRow(draft: BucketFilterDraft())) }
            }
        }
    }

    private func columnNumber(_ row: BucketRow) -> Int {
        (rows.firstIndex { $0.id == row.id } ?? 0) + 1
    }

    private func load() {
        guard !didLoad else { return }
        didLoad = true
        title = view.title
        let current = ViewFilterParams.parse(view.filter)
        query = current?.query ?? ""
        includeNulls = current?.includeNulls ?? false
        filterBuckets = view.bucketConfigurationMode == .filter
        let stored = BucketConfiguration.parse(view.bucketConfiguration)
        rows = (stored.isEmpty ? [BucketFilterDraft()] : stored).map { BucketRow(draft: $0) }
    }

    /// Only what changed goes in the update, so an untouched field is never rewritten.
    private func update() -> ViewUpdate {
        var update = ViewUpdate()
        let cleaned = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned != view.title { update.title = cleaned }
        let edited = ViewFilterParams.serialize(query: query, includeNulls: includeNulls, previousRaw: view.filter)
        if ViewFilterParams.parse(edited) != ViewFilterParams.parse(view.filter) { update.filter = .some(edited) }
        guard isBoard else { return update }
        let mode: ViewResponse.BucketConfigMode = filterBuckets ? .filter : .manual
        if mode != view.bucketConfigurationMode { update.bucketConfigurationMode = mode }
        if filterBuckets {
            let drafts = rows.map(\.draft)
            if drafts != BucketConfiguration.parse(view.bucketConfiguration) {
                update.bucketConfiguration = .some(BucketConfiguration.serialize(drafts, previousRaw: view.bucketConfiguration))
            }
        }
        return update
    }

    private func save() {
        if isBoard && filterBuckets, let problem = BucketConfiguration.validate(rows.map(\.draft)) {
            failure = problem
            return
        }
        do {
            _ = try services.store.updateView(localId: view.localId, update())
            dismiss()
        } catch ViewError.placeholder {
            failure = "This default view has not synced yet. Try again after the next sync."
        } catch {
            failure = String(describing: error)
        }
    }
}
