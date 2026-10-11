import CriaKit
import PhotosUI
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

/// Attachments of a task. Picking a photo or file only queues it locally; the outbox uploads it when online.
struct AttachmentsSection: View {
    let services: AppServices
    let taskLocalId: String
    @State private var live: LiveValue<[AttachmentRecord]>
    @State private var photo: PhotosPickerItem?
    @State private var showFiles = false
    @State private var showCamera = false
    @State private var preview: URL?
    @State private var errorText: String?

    init(services: AppServices, taskLocalId: String) {
        self.services = services
        self.taskLocalId = taskLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .outbox]) { reading in
                try reading.attachments(forTask: taskLocalId)
            }
        })
    }

    var body: some View {
        Section("Attachments") {
            ForEach(live.value, id: \.localId) { attachment in
                row(attachment)
            }
            PhotosPicker("Add photo", selection: $photo, matching: .images)
            Button("Add file", systemImage: "paperclip") { showFiles = true }
            if CameraPicker.isAvailable {
                Button("Take photo", systemImage: "camera") { showCamera = true }
            }
            PasteButton(supportedContentTypes: [.image]) { providers in pasteImage(providers) }
            if let errorText { Text(errorText).font(.caption).foregroundStyle(.red) }
        }
        .task { await live.run() }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task { await attachPhoto(item) }
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item]) { result in
            if case .success(let url) = result { attachFile(url) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { data in queue(name: "camera-\(Int(Date().timeIntervalSince1970)).jpg", mime: "image/jpeg", data: data) }
                .ignoresSafeArea()
        }
        .quickLookPreview($preview)
    }

    private func row(_ attachment: AttachmentRecord) -> some View {
        Button {
            open(attachment)
        } label: {
            HStack {
                Image(systemName: attachment.pending ? "arrow.up.circle" : "doc")
                Text(attachment.fileName)
                Spacer()
                if attachment.uploadFailed { Text("Failed").font(.caption).foregroundStyle(.red) }
                if attachment.pending, !attachment.uploadFailed { Text("Queued").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .swipeActions {
            Button("Delete", role: .destructive) { remove(attachment) }
        }
    }

    private func open(_ attachment: AttachmentRecord) {
        guard !attachment.pending else { return }
        Task {
            do {
                preview = try await services.downloadAttachment(attachment)
            } catch {
                errorText = "Could not open \(attachment.fileName)"
            }
        }
    }

    private func remove(_ attachment: AttachmentRecord) {
        Task {
            do {
                try await services.deleteAttachment(attachment, taskLocalId: taskLocalId)
            } catch {
                errorText = "Could not delete \(attachment.fileName)"
            }
        }
    }

    private func attachPhoto(_ item: PhotosPickerItem) async {
        defer { photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let type = item.supportedContentTypes.first
        let name = "photo-\(Int(Date().timeIntervalSince1970)).\(type?.preferredFilenameExtension ?? "jpg")"
        queue(name: name, mime: type?.preferredMIMEType ?? "image/jpeg", data: data)
    }

    private func pasteImage(_ providers: [NSItemProvider]) {
        guard let provider = providers.first else { return }
        Task {
            guard let data = try? await provider.loadDataRepresentation(for: .image),
                  let png = UIImage(data: data)?.pngData() else { return }
            queue(name: "pasted-\(Int(Date().timeIntervalSince1970)).png", mime: "image/png", data: png)
        }
    }

    private func attachFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        queue(name: url.lastPathComponent, mime: mime, data: data)
    }

    private func queue(name: String, mime: String, data: Data) {
        do {
            try services.attachFile(taskLocalId: taskLocalId, fileName: name, mime: mime, data: data)
            errorText = nil
        } catch {
            errorText = "Could not attach \(name)"
        }
    }
}
