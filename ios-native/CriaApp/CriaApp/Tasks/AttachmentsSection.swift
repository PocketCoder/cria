import CriaKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Attachments of a task. Picking a photo or file only queues it locally; the outbox uploads it when online. The
/// pickers, the preview and the delete confirmation are presented by TaskDetailView through `state`.
struct AttachmentsSection: View {
    let services: AppServices
    let taskLocalId: String
    let attachments: [AttachmentRecord]
    let state: TaskDetailPresentation

    private var actions: AttachmentActions {
        AttachmentActions(services: services, taskLocalId: taskLocalId, state: state)
    }

    var body: some View {
        Section("Attachments") {
            ForEach(attachments, id: \.localId) { attachment in
                row(attachment)
            }
            Button { state.choosingPhoto = true } label: {
                Label("Add photo", systemImage: "photo").foregroundStyle(Color(.primary))
            }
            Button { state.choosingFile = true } label: {
                Label("Add file", systemImage: "paperclip").foregroundStyle(Color(.primary))
            }
            if CameraPicker.isAvailable {
                Button("Take photo", systemImage: "camera") { state.takingPhoto = true }
            }
            PasteButton(supportedContentTypes: [.image]) { providers in actions.pasteImage(providers) }
            if let errorText = state.attachmentError {
                Text(errorText).font(Theme.caption).foregroundStyle(Color(.destructive))
            }
        }
    }

    private func row(_ attachment: AttachmentRecord) -> some View {
        Button {
            actions.open(attachment)
        } label: {
            HStack {
                Image(systemName: attachment.pending ? "arrow.up.circle" : "doc")
                Text(attachment.fileName)
                Spacer()
                if attachment.uploadFailed { Text("Failed").font(Theme.caption).foregroundStyle(Color(.destructive)) }
                if attachment.pending, !attachment.uploadFailed {
                    Text("Queued").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            // Not `.destructive`: that role animates the row away even when the confirmation is cancelled.
            Button("Delete", systemImage: "trash") { state.deletingAttachment = attachment }
                .tint(Color(.destructive))
        }
    }
}

/// Attachment work shared by the section rows and the pickers TaskDetailView presents. Errors land in
/// `state.attachmentError`, shown under the section.
@MainActor
struct AttachmentActions {
    let services: AppServices
    let taskLocalId: String
    let state: TaskDetailPresentation

    func open(_ attachment: AttachmentRecord) {
        guard !attachment.pending else { return }
        Task {
            do {
                state.preview = try await services.downloadAttachment(attachment)
            } catch {
                state.attachmentError = "Could not open \(attachment.fileName)"
            }
        }
    }

    func remove(_ attachment: AttachmentRecord) {
        Task {
            do {
                try await services.deleteAttachment(attachment, taskLocalId: taskLocalId)
            } catch {
                state.attachmentError = "Could not delete \(attachment.fileName)"
            }
        }
    }

    func attachPhoto(_ item: PhotosPickerItem) async {
        defer { state.photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            state.attachmentError = "Could not read the photo"
            return
        }
        let type = item.supportedContentTypes.first
        let name = "photo-\(Int(Date().timeIntervalSince1970)).\(type?.preferredFilenameExtension ?? "jpg")"
        queue(name: name, mime: type?.preferredMIMEType ?? "image/jpeg", data: data)
    }

    func pasteImage(_ providers: [NSItemProvider]) {
        guard let provider = providers.first else { return }
        Task {
            guard let data = await Self.loadImageData(from: provider),
                  let png = UIImage(data: data)?.pngData() else { return }
            queue(name: "pasted-\(Int(Date().timeIntervalSince1970)).png", mime: "image/png", data: png)
        }
    }

    private static func loadImageData(from provider: NSItemProvider) async -> Data? {
        await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                continuation.resume(returning: data)
            }
        }
    }

    func attachFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            state.attachmentError = "Could not read \(url.lastPathComponent)"
            return
        }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        queue(name: url.lastPathComponent, mime: mime, data: data)
    }

    func queue(name: String, mime: String, data: Data) {
        do {
            try services.attachFile(taskLocalId: taskLocalId, fileName: name, mime: mime, data: data)
            state.attachmentError = nil
        } catch {
            state.attachmentError = "Could not attach \(name)"
        }
    }
}
