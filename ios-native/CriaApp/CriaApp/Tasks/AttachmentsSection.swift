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
    @State private var clipboard = ClipboardPeek()

    private var actions: AttachmentActions {
        AttachmentActions(services: services, taskLocalId: taskLocalId, state: state)
    }

    var body: some View {
        #if os(macOS)
        // The inspector shows attachments only once there are some; files are added by dropping them on the task.
        if !attachments.isEmpty {
            MacAttachmentTiles(services: services, taskLocalId: taskLocalId, attachments: attachments, state: state)
        }
        #else
        list
        #endif
    }

    private var list: some View {
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
            pasteRow
            if let errorText = state.attachmentError {
                Text(errorText).font(Theme.caption).foregroundStyle(Color(.destructive))
            }
        }
        .onAppear { clipboard.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: Pasteboard.changedNotification)) { _ in clipboard.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: PlatformApp.didBecomeActive)) { _ in
            clipboard.refresh()
        }
    }

    /// The system Paste button (its label is fixed, and it pastes without the permission prompt), with what it would
    /// paste beside it. Hidden when the clipboard holds nothing to attach.
    @ViewBuilder
    private var pasteRow: some View {
        if let content = clipboard.content {
            HStack(spacing: 12) {
                PasteButton(supportedContentTypes: [content.type]) { providers in actions.paste(providers, as: content.type) }
                    .buttonBorderShape(.capsule)
                    .labelStyle(.titleAndIcon)
                Text(content.summary)
                    .font(Theme.caption)
                    .foregroundStyle(Color(.mutedForeground))
                    .lineLimit(2)
            }
        }
    }

    private func row(_ attachment: AttachmentRecord) -> some View {
        Button {
            actions.open(attachment)
        } label: {
            HStack {
                Image(systemName: attachment.pending ? "arrow.up.circle" : "doc")
                    .accessibilityHidden(true)
                Text(attachment.fileName)
                Spacer()
                if attachment.uploadFailed { Text("Failed").font(Theme.caption).foregroundStyle(Color(.destructive)) }
                if attachment.pending, !attachment.uploadFailed {
                    Text("Queued").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
        }
        .accessibilityHint(attachment.pending ? "" : "Opens a preview")
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            // Not `.destructive`: that role animates the row away even when the confirmation is cancelled.
            Button("Delete attachment", systemImage: "trash") { state.deletingAttachment = attachment }
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
                state.deletions += 1
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

    /// Attaches the first pasted item. An image is stored as PNG; any other file keeps its own bytes and type. The
    /// name is the one the source app offered, when there is one.
    func paste(_ providers: [NSItemProvider], as type: UTType) {
        guard let provider = providers.first else { return }
        let stamp = Int(Date().timeIntervalSince1970)
        let suggested = provider.suggestedName.flatMap { $0.isEmpty ? nil : ($0 as NSString).deletingPathExtension }
        Task {
            guard let data = await Self.loadData(from: provider, type: type.conforms(to: .image) ? .image : type) else {
                state.attachmentError = "Could not read the pasted item"
                return
            }
            if type.conforms(to: .image) {
                guard let png = PlatformImage(data: data)?.pngRepresentation() else {
                    state.attachmentError = "Could not read the pasted image"
                    return
                }
                queue(name: "\(suggested ?? "pasted-\(stamp)").png", mime: "image/png", data: png)
            } else {
                let base = suggested ?? "pasted-\(stamp)"
                let name = type.preferredFilenameExtension.map { "\(base).\($0)" } ?? base
                queue(name: name, mime: type.preferredMIMEType ?? "application/octet-stream", data: data)
            }
        }
    }

    private static func loadData(from provider: NSItemProvider, type: UTType) async -> Data? {
        await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
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
