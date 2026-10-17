import CriaKit
import SwiftUI

/// Rename a bucket, set its limit, or delete it.
struct BucketEditSheet: View {
    let services: AppServices
    let edit: BucketEdit
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var limitText = ""
    @State private var confirmingDelete = false
    @State private var deletions = 0
    @State private var failure: String?

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            Form {
                CriaTextField("Title", text: $title)
                CriaTextField("Limit (0 for none)", text: $limitText).keyboardType(.numberPad)
                Section {
                    Button("Delete column", role: .destructive) { confirmingDelete = true }
                        .disabled(!edit.canDelete)
                } footer: {
                    // The server refuses to delete the last bucket of a view.
                    if !edit.canDelete { Text("A board needs at least one column.") }
                }
            }
                .criaSurface()
            .navigationTitle("Edit column")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
            .confirmationDialog(
                "Delete \"\(edit.bucket.title)\"?", isPresented: $confirmingDelete, titleVisibility: .visible
            ) {
                Button("Delete column", role: .destructive) { delete() }
            }
            .sensoryFeedback(.warning, trigger: deletions)
            .errorHaptic(failure)
            .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            title = edit.bucket.title
            limitText = String(edit.bucket.limit)
        }
    }

    private func save() {
        let cleaned = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let update = BucketUpdate(title: cleaned.isEmpty ? nil : cleaned, limit: Kanban.parseLimit(limitText))
        do {
            _ = try services.store.updateBucket(localId: edit.bucket.localId, update)
            dismiss()
        } catch {
            failure = String(describing: error)
        }
    }

    private func delete() {
        guard edit.canDelete else { return }
        do {
            try services.store.deleteBucket(localId: edit.bucket.localId)
            deletions += 1
            dismiss()
        } catch {
            failure = String(describing: error)
        }
    }
}
