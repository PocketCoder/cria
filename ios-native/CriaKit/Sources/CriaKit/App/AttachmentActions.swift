import Foundation

extension CriaStore {
    /// Queues a picked file: bytes go to the side-store first, then the pending row and its upload op in one write.
    /// Nothing touches the network, so attaching works offline and uploads when the outbox drains.
    @discardableResult
    public func queueAttachment(
        taskLocalId: String, fileName: String, mime: String, data: Data, blobs: any BlobStoring
    ) throws -> String {
        let localId = UUID().uuidString
        try blobs.write(localId, data)
        do {
            try insertPendingAttachment(AttachmentUploadPayload(
                taskLocalId: taskLocalId, attachmentLocalId: localId, fileName: fileName,
                mime: mime, size: data.count, bytesPath: localId
            ))
        } catch {
            try? blobs.delete(localId)
            throw error
        }
        return localId
    }

    /// Removes a still-pending attachment: drops the row and its queued op, then the bytes.
    public func discardQueuedAttachment(localId: String, blobs: any BlobStoring) throws {
        if let key = try discardPendingAttachment(localId: localId) {
            try blobs.delete(key)
        }
    }
}

extension AppServices {
    /// Queues a picked file and returns the attachment's local id (the editor uses it for `cria://pending/{id}`).
    @discardableResult
    public func attachFile(taskLocalId: String, fileName: String, mime: String, data: Data) throws -> String {
        try store.queueAttachment(taskLocalId: taskLocalId, fileName: fileName, mime: mime, data: data, blobs: blobs)
    }

    /// The queued bytes of a pending attachment, for showing an inline image before it uploads.
    public func pendingBlobData(_ localId: String) -> Data? {
        try? blobs.read(localId)
    }

    public func searchUsers(_ query: String) async -> [UserResponse] {
        (try? await api.searchUsers(query)) ?? []
    }

    /// As `searchUsers`, but a failed request throws, so the caller can tell "offline" from "nobody matches". Names
    /// found are remembered for showing assignees.
    public func searchUsersOrThrow(_ query: String) async throws -> [UserResponse] {
        let users = try await api.searchUsers(query)
        UserNameDirectory.shared.remember(users.map { ($0.id, $0.name) })
        return users
    }

    /// Pending attachments are discarded locally; uploaded ones are deleted on the server first, then locally.
    public func deleteAttachment(_ attachment: AttachmentRecord, taskLocalId: String) async throws {
        guard let serverId = attachment.serverId, !attachment.pending else {
            try store.discardQueuedAttachment(localId: attachment.localId, blobs: blobs)
            return
        }
        guard let lookup = try store.attachment(localId: attachment.localId), let taskServerId = lookup.taskServerId else { return }
        try await api.perform(.delete, "/tasks/\(taskServerId)/attachments/\(serverId)")
        try store.deleteAttachmentLocal(taskLocalId: taskLocalId, attachmentServerId: serverId)
    }

    /// Downloads an uploaded attachment into the temporary directory and returns the file, for QuickLook and sharing.
    public func downloadAttachment(_ attachment: AttachmentRecord) async throws -> URL {
        guard let serverId = attachment.serverId,
              let lookup = try store.attachment(localId: attachment.localId),
              let taskServerId = lookup.taskServerId else { throw ApiError.blocked("attachment is not uploaded yet") }
        let response = try await api.send(.get, "/tasks/\(taskServerId)/attachments/\(serverId)")
        try response.requireSuccess()
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(attachment.localId, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = folder.appendingPathComponent((attachment.fileName as NSString).lastPathComponent)
        try response.data.write(to: target, options: .atomic)
        return target
    }
}
