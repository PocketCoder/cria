import CriaKit
import Observation
import PhotosUI
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

/// What the task detail sections present, and the failures they report. TaskDetailView owns it and attaches every
/// sheet, dialog and alert outside the Form: a modifier on a lazily created Form row stops working once that row
/// scrolls off screen.
@MainActor @Observable
final class TaskDetailPresentation {
    var composingComment = false
    var editingComment: CommentRecord?
    var deletingComment: CommentRecord?
    var choosingPhoto = false
    var photo: PhotosPickerItem?
    var choosingFile = false
    var takingPhoto = false
    var preview: URL?
    var deletingAttachment: AttachmentRecord?
    var attachmentError: String?
    var addingRelation = false
    var deletingTask = false
    var failure: String?

    /// True while the optional at `keyPath` holds a value; setting false clears it.
    func isSet<Value>(_ keyPath: ReferenceWritableKeyPath<TaskDetailPresentation, Value?>) -> Binding<Bool> {
        Binding(get: { self[keyPath: keyPath] != nil }, set: { if !$0 { self[keyPath: keyPath] = nil } })
    }

    func attempt(_ work: () throws -> Void) {
        do {
            try work()
        } catch {
            failure = String(describing: error)
        }
    }
}

/// The live lists of the task detail sections. Observed from TaskDetailView itself, not from a row, so they keep
/// updating whichever rows are on screen.
@MainActor
final class TaskDetailFeeds {
    let comments: LiveValue<[CommentRecord]>
    let attachments: LiveValue<[AttachmentRecord]>
    let relations: LiveValue<[RelationRecord]>
    let reminders: LiveValue<[ReminderRecord]>

    init(store: CriaStore, taskLocalId: String) {
        comments = LiveValue(initial: []) {
            observeStore(store, kinds: [.comments]) { reading in try reading.comments(forTask: taskLocalId) }
        }
        attachments = LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .outbox]) { reading in try reading.attachments(forTask: taskLocalId) }
        }
        relations = LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks]) { reading in try reading.relations(forTask: taskLocalId) }
        }
        reminders = LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks]) { reading in try reading.reminders(forTask: taskLocalId) }
        }
    }
}

/// Sheets, pickers and covers of the task detail sections.
struct TaskDetailSheets: ViewModifier {
    let services: AppServices
    let taskLocalId: String
    @Bindable var state: TaskDetailPresentation

    private var actions: AttachmentActions {
        AttachmentActions(services: services, taskLocalId: taskLocalId, state: state)
    }

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $state.composingComment) {
                CommentComposerSheet(
                    services: services, taskLocalId: taskLocalId, title: "New comment", initialHTML: ""
                ) { html in
                    state.attempt { _ = try services.store.createComment(taskLocalId: taskLocalId, comment: html) }
                }
            }
            .sheet(item: $state.editingComment) { comment in
                CommentComposerSheet(
                    services: services, taskLocalId: taskLocalId, title: "Edit comment", initialHTML: comment.comment
                ) { html in
                    state.attempt { try services.store.updateComment(localId: comment.localId, comment: html) }
                }
            }
            .sheet(isPresented: $state.addingRelation) {
                RelationPickerSheet(services: services, taskLocalId: taskLocalId)
            }
            .photosPicker(isPresented: $state.choosingPhoto, selection: $state.photo, matching: .images)
            .onChange(of: state.photo) { _, item in
                guard let item else { return }
                let actions = actions
                Task { await actions.attachPhoto(item) }
            }
            .fileImporter(isPresented: $state.choosingFile, allowedContentTypes: [.item]) { result in
                if case .success(let url) = result { actions.attachFile(url) }
            }
            .fullScreenCover(isPresented: $state.takingPhoto) {
                CameraPicker { data in
                    actions.queue(name: "camera-\(Int(Date().timeIntervalSince1970)).jpg", mime: "image/jpeg", data: data)
                }
                .ignoresSafeArea()
            }
            .quickLookPreview($state.preview)
    }
}

/// Delete confirmations and the shared error alert of the task detail screen.
struct TaskDetailDialogs: ViewModifier {
    let services: AppServices
    let taskLocalId: String
    @Bindable var state: TaskDetailPresentation
    let onDeleteTask: () -> Void

    func body(content: Content) -> some View {
        content
            .confirmationDialog("Delete task?", isPresented: $state.deletingTask, titleVisibility: .visible) {
                Button("Delete", role: .destructive, action: onDeleteTask)
            }
            .confirmationDialog(
                "Delete this comment?", isPresented: state.isSet(\.deletingComment), titleVisibility: .visible,
                presenting: state.deletingComment
            ) { comment in
                Button("Delete", role: .destructive) {
                    state.attempt { try services.store.deleteComment(localId: comment.localId) }
                }
            }
            .confirmationDialog(
                "Delete this attachment?", isPresented: state.isSet(\.deletingAttachment), titleVisibility: .visible,
                presenting: state.deletingAttachment
            ) { attachment in
                Button("Delete", role: .destructive) {
                    AttachmentActions(services: services, taskLocalId: taskLocalId, state: state).remove(attachment)
                }
            } message: { attachment in
                Text(attachment.fileName)
            }
            .alert("Could not save", isPresented: state.isSet(\.failure)) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(state.failure ?? "")
            }
    }
}
