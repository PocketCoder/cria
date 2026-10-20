import CriaKit
import PhotosUI
import SwiftUI

/// The editor with its formatting bar (the text view's accessory) and the sheets it opens (mention picker, link prompt, photo picker).
struct EditorHost: View {
    let services: AppServices
    /// The task whose attachments pasted or picked images join. Nil for text that belongs to no task (a project's
    /// description): the Image button then does nothing.
    let taskLocalId: String?
    let initialHTML: String
    let controller: EditorController
    /// Inline editor only: see `RichTextEditor.inlineHeight` and `onHeightChange`.
    var inlineHeight: CGFloat?
    var onHeightChange: (@MainActor (CGFloat) -> Void)?
    @State private var barActions = EditorBarActions()
    @State private var imageLoader = EditorImageLoader()
    @State private var showMention = false
    @State private var pickedMention: String?
    /// Opened by typing "@" (as opposed to the toolbar button): cancelling must leave the "@" in the text.
    @State private var mentionFromTyping = false
    @State private var showLink = false
    @State private var linkText = ""
    @State private var pendingLink: String?
    @State private var photo: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var viewingImage: ImageViewerItem?

    var body: some View {
        editor
            // Presented from here, not from the formatting bar: that bar is torn down when the keyboard hides,
            // which would dismiss the picker with it. Each picker holds the editing session open (see
            // `EditorController.holdFocus`) and hands the keyboard back when it closes.
            .photosPicker(isPresented: $showPhotoPicker, selection: $photo, matching: .images)
            .onChange(of: showPhotoPicker) { _, showing in
                if !showing { controller.restoreFocus() }
            }
            .sheet(isPresented: $showMention, onDismiss: finishMention) {
                MentionPickerSheet(services: services) { pickedMention = $0 }
            }
            .alert("Add link", isPresented: $showLink) {
                TextField("https://", text: $linkText).textInputAutocapitalization(.never).keyboardType(.URL)
                Button("Add") {
                    pendingLink = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
                    linkText = ""
                }
                Button("Cancel", role: .cancel) {}
            }
            .onChange(of: showLink) { _, showing in
                if !showing { finishLink() }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await insertPhoto(item) }
            }
            .fullScreenCover(item: $viewingImage) { ImageViewer(item: $0, services: services) }
            .onAppear { configureController() }
    }

    @ViewBuilder private var editor: some View {
        let text = RichTextEditor(
            controller: controller, initialHTML: initialHTML, imageProvider: imageProvider, barActions: barActions,
            inlineHeight: inlineHeight, onHeightChange: onHeightChange
        )
        #if os(macOS)
        // No keyboard accessory on the Mac: the formatting bar sits above the text.
        VStack(spacing: 0) {
            MacEditorToolbar(controller: controller, actions: barActions)
            text
        }
        #else
        text
        #endif
    }

    /// Passed into the editor so it is in place before the first HTML load.
    private var imageProvider: EditorStyling.ImageProvider {
        let services = services
        let loader = imageLoader
        let controller = controller
        return { source in
            loader.image(for: source, services: services) { [weak controller] loaded in
                controller?.refreshImages(source: loaded)
            }
        }
    }

    private func configureController() {
        controller.onMentionTrigger = {
            controller.holdFocus()
            mentionFromTyping = true
            showMention = true
        }
        barActions.onLink = {
            controller.holdFocus()
            showLink = true
        }
        barActions.onPhoto = {
            guard taskLocalId != nil else { return }
            controller.holdFocus()
            showPhotoPicker = true
        }
        barActions.onOpenImage = { source in
            viewingImage = ImageViewerItem(source: source)
        }
        barActions.onMention = {
            controller.holdFocus()
            showMention = true
        }
        barActions.onImageData = { data, name, mime in
            Task { await insertImageData(data, name: name, mime: mime) }
        }
    }

    private func finishMention() {
        let picked = pickedMention
        let typedAt = mentionFromTyping && picked == nil
        pickedMention = nil
        mentionFromTyping = false
        let controller = controller
        controller.restoreFocus {
            if let picked {
                controller.insertMention(username: picked)
            } else if typedAt {
                controller.insertLiteral("@")
            }
        }
    }

    private func finishLink() {
        let link = pendingLink
        pendingLink = nil
        let controller = controller
        controller.restoreFocus {
            if let link { controller.insertLink(link) }
        }
    }

    private func insertPhoto(_ item: PhotosPickerItem) async {
        defer { photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let type = item.supportedContentTypes.first
        let name = "photo-\(Int(Date().timeIntervalSince1970)).\(type?.preferredFilenameExtension ?? "jpg")"
        await insertImageData(data, name: name, mime: type?.preferredMIMEType ?? "image/jpeg")
    }

    /// Queues the bytes as an attachment and puts the image in the text as `cria://pending/{id}` until it uploads.
    private func insertImageData(_ data: Data, name: String, mime: String) async {
        guard let taskLocalId,
              let localId = try? services.attachFile(taskLocalId: taskLocalId, fileName: name, mime: mime, data: data) else { return }
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
