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
    @State private var showLink = false
    @State private var linkText = ""
    @State private var photo: PhotosPickerItem?

    var body: some View {
        RichTextEditor(controller: controller, initialHTML: initialHTML)
            .toolbar { ToolbarItemGroup(placement: .keyboard) { keyboardBar } }
            .sheet(isPresented: $showMention) {
                MentionPickerSheet(services: services) { controller.insertMention(username: $0) }
            }
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
                PhotosPicker(selection: $photo, matching: .images) { Image(systemName: "photo") }
                    .accessibilityLabel("Image")
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
        controller.onMentionTrigger = { showMention = true }
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

    var body: some View {
        EditorHost(services: services, taskLocalId: taskLocalId, initialHTML: initialHTML, controller: controller)
            .navigationTitle("Description")
            .navigationBarTitleDisplayMode(.inline)
            .onDisappear(perform: save)
    }

    private func save() {
        let document = controller.currentDocument()
        guard document != RichDocument(html: initialHTML) else { return }
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

    var body: some View {
        NavigationStack {
            EditorHost(services: services, taskLocalId: taskLocalId, initialHTML: initialHTML, controller: controller)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Send", action: send) }
                }
        }
    }

    private func send() {
        let document = controller.currentDocument()
        if !document.blocks.isEmpty { onSend(document.html()) }
        dismiss()
    }
}
