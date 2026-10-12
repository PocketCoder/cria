import CriaKit
import PhotosUI
import SwiftUI

/// The editor with its formatting bar (the text view's accessory) and the sheets it opens (mention picker, link prompt, photo picker).
struct EditorHost: View {
    let services: AppServices
    let taskLocalId: String
    let initialHTML: String
    let controller: EditorController
    @State private var barActions = EditorBarActions()
    @State private var showMention = false
    @State private var mentionPicked = false
    /// Opened by typing "@" (as opposed to the toolbar button): cancelling must leave the "@" in the text.
    @State private var mentionFromTyping = false
    @State private var showLink = false
    @State private var linkText = ""
    @State private var photo: PhotosPickerItem?
    @State private var showPhotoPicker = false

    var body: some View {
        RichTextEditor(controller: controller, initialHTML: initialHTML, imageProvider: imageProvider, barActions: barActions)
            // Presented from here, not from the formatting bar: that bar is torn down when the keyboard hides,
            // which would dismiss the picker with it.
            .photosPicker(isPresented: $showPhotoPicker, selection: $photo, matching: .images)
            .sheet(isPresented: $showMention, onDismiss: {
                if mentionFromTyping, !mentionPicked { controller.insertLiteral("@") }
                mentionPicked = false
                mentionFromTyping = false
            }, content: {
                MentionPickerSheet(services: services) {
                    mentionPicked = true
                    controller.insertMention(username: $0)
                }
            })
            .alert("Add link", isPresented: $showLink) {
                TextField("https://", text: $linkText).textInputAutocapitalization(.never).keyboardType(.URL)
                Button("Add") { addLink() }
                Button("Cancel", role: .cancel) {}
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await insertPhoto(item) }
            }
            .onAppear { configureController() }
    }

    /// Passed into the editor so it is in place before the first HTML load.
    private var imageProvider: EditorStyling.ImageProvider {
        let services = services
        return { source in
            let prefix = "cria://pending/"
            guard source.hasPrefix(prefix), let data = services.pendingBlobData(String(source.dropFirst(prefix.count))) else { return nil }
            return UIImage(data: data)
        }
    }

    private func configureController() {
        controller.onMentionTrigger = {
            mentionFromTyping = true
            showMention = true
        }
        barActions.onLink = { showLink = true }
        barActions.onPhoto = { showPhotoPicker = true }
        barActions.onMention = { showMention = true }
    }

    private func addLink() {
        controller.insertLink(linkText.trimmingCharacters(in: .whitespacesAndNewlines))
        linkText = ""
    }

    private func insertPhoto(_ item: PhotosPickerItem) async {
        defer { photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let type = item.supportedContentTypes.first
        let name = "photo-\(Int(Date().timeIntervalSince1970)).\(type?.preferredFilenameExtension ?? "jpg")"
        let mime = type?.preferredMIMEType ?? "image/jpeg"
        guard let localId = try? services.attachFile(taskLocalId: taskLocalId, fileName: name, mime: mime, data: data) else { return }
        controller.insertImage(RichImage(src: "cria://pending/\(localId)", alt: name))
    }
}

/// Full-screen description editor. Saves on Done, when the keyboard closes, when the screen closes and when the app
/// leaves the foreground, and only if the content changed.
struct DescriptionEditorView: View {
    let services: AppServices
    let taskLocalId: String
    let initialHTML: String
    let onSave: (String) -> Void
    @State private var controller = EditorController()
    @State private var savedDocument: RichDocument?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        EditorHost(services: services, taskLocalId: taskLocalId, initialHTML: initialHTML, controller: controller)
            .navigationTitle("Description")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        save()
                        dismiss()
                    }
                }
            }
            .onAppear { controller.onEndEditing = { save() } }
            .onDisappear(perform: save)
            // An app suspended mid-edit can be killed without ever calling onDisappear.
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { save() }
            }
    }

    private func save() {
        // No document means the text view is gone without a capture: leave the stored description alone.
        guard let document = controller.currentDocument() else { return }
        guard document != (savedDocument ?? RichDocument(html: initialHTML)) else { return }
        savedDocument = document
        onSave(document.blocks.isEmpty ? "" : document.html())
    }
}

/// Compose or edit a comment with the same editor, so comments get formatting and mentions.
struct CommentComposerSheet: View {
    let services: AppServices
    let taskLocalId: String
    let title: String
    let initialHTML: String
    let onSend: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var controller = EditorController()
    @State private var confirmingDiscard = false

    var body: some View {
        NavigationStack {
            EditorHost(services: services, taskLocalId: taskLocalId, initialHTML: initialHTML, controller: controller)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) }
                    ToolbarItem(placement: .confirmationAction) { Button("Send", action: send) }
                }
                .confirmationDialog("Discard this comment?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                    Button("Discard", role: .destructive) { dismiss() }
                }
        }
        // A swipe-down would throw the draft away without asking; Cancel asks.
        .interactiveDismissDisabled(true)
    }

    private func cancel() {
        let changed = controller.currentDocument().map { $0 != RichDocument(html: initialHTML) } ?? false
        if changed { confirmingDiscard = true } else { dismiss() }
    }

    private func send() {
        if let document = controller.currentDocument(), !document.blocks.isEmpty { onSend(document.html()) }
        dismiss()
    }
}
