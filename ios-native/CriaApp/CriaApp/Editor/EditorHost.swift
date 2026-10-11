import CriaKit
import PhotosUI
import SwiftUI

/// The editor with its keyboard toolbar and the sheets it opens (mention picker, link prompt, photo picker).
struct EditorHost: View {
    let services: AppServices
    let taskLocalId: String
    let initialHTML: String
    let controller: EditorController
    @State private var showMention = false
    @State private var mentionPicked = false
    /// Opened by typing "@" (as opposed to the toolbar button): cancelling must leave the "@" in the text.
    @State private var mentionFromTyping = false
    @State private var showLink = false
    @State private var linkText = ""
    @State private var photo: PhotosPickerItem?
    @State private var showPhotoPicker = false

    var body: some View {
        RichTextEditor(controller: controller, initialHTML: initialHTML)
            .toolbar { ToolbarItemGroup(placement: .keyboard) { keyboardBar } }
            // Presented from here, not from the keyboard toolbar: that toolbar is torn down when the keyboard hides,
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

    private var keyboardBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                barButton("bold", "Bold") { controller.toggleStyle(.bold) }
                barButton("italic", "Italic") { controller.toggleStyle(.italic) }
                barButton("underline", "Underline") { controller.toggleStyle(.underline) }
                barButton("strikethrough", "Strikethrough") { controller.toggleStyle(.strike) }
                barButton("textformat.size", "Heading") { controller.setBlock(.heading(2)) }
                barButton("list.bullet", "Bulleted list") { controller.setBlock(.bullet) }
                barButton("list.number", "Numbered list") { controller.setBlock(.ordered) }
                barButton("checklist", "Task list") { controller.setBlock(.task(checked: false)) }
                barButton("increase.indent", "Indent") { controller.changeIndent(by: 1) }
                barButton("decrease.indent", "Outdent") { controller.changeIndent(by: -1) }
                barButton("text.quote", "Quote") { controller.setBlock(.quote) }
                barButton("chevron.left.forwardslash.chevron.right", "Code block") { controller.setBlock(.code) }
                barButton("link", "Link") { showLink = true }
                barButton("photo", "Image") { showPhotoPicker = true }
                barButton("at", "Mention") { showMention = true }
            }
            .padding(.horizontal, 4)
        }
    }

    private func barButton(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol) }
            .accessibilityLabel(label)
    }

    private func configureController() {
        let services = services
        controller.imageProvider = { source in
            let prefix = "cria://pending/"
            guard source.hasPrefix(prefix), let data = services.pendingBlobData(String(source.dropFirst(prefix.count))) else { return nil }
            return UIImage(data: data)
        }
        controller.onMentionTrigger = {
            mentionFromTyping = true
            showMention = true
        }
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

/// Full-screen description editor. Saves when the screen closes, and only if the content changed.
struct DescriptionEditorView: View {
    let services: AppServices
    let taskLocalId: String
    let initialHTML: String
    let onSave: (String) -> Void
    @State private var controller = EditorController()
    @State private var savedDocument: RichDocument?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        EditorHost(services: services, taskLocalId: taskLocalId, initialHTML: initialHTML, controller: controller)
            .navigationTitle("Description")
            .navigationBarTitleDisplayMode(.inline)
            .onDisappear(perform: save)
            // An app suspended mid-edit can be killed without ever calling onDisappear.
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { save() }
            }
    }

    private func save() {
        let document = controller.currentDocument()
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
        let changed = controller.currentDocument() != RichDocument(html: initialHTML)
        if changed { confirmingDiscard = true } else { dismiss() }
    }

    private func send() {
        let document = controller.currentDocument()
        if !document.blocks.isEmpty { onSend(document.html()) }
        dismiss()
    }
}
