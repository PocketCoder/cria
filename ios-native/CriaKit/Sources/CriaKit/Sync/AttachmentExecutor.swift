import Foundation
import GRDB

/// `task_attachment` `upload`: sends a queued file to the server. Ported from `src/sync/push/attachment.ts`.
///
/// Reads the bytes from the side-store, uploads them, turns the pending row into a mirror of the server attachment,
/// rewrites inline `cria://pending/{id}` references and deletes the bytes. A network error or 5xx backs off and
/// retries (the bytes stay put), a 4xx or missing bytes dead-letters, and an unsynced task is a dependency wait.
public struct AttachmentExecutor: OutboxExecutor {
    let blobs: any BlobStoring

    public init(blobs: any BlobStoring) {
        self.blobs = blobs
    }

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        guard op.op == OutboxOp.upload.rawValue else { return }
        let payload = try Self.parse(op.payloadObject)

        let pending = try store.pushInt(
            "SELECT pending FROM task_attachments WHERE local_id = ?", payload.attachmentLocalId
        )
        // Removed by the user, or finalised by an earlier run that stopped before the drain deleted this op.
        // Either way only the bytes are left to tidy.
        guard let pending, pending == 1 else {
            dropBytes(payload.bytesPath)
            return
        }
        guard let task = try store.pushRow(
            "SELECT server_id, deleted FROM tasks WHERE local_id = ?", payload.taskLocalId
        ) else {
            try store.discardPendingAttachment(localId: payload.attachmentLocalId)
            dropBytes(payload.bytesPath)
            return
        }
        // The task is about to be deleted: there is nothing to attach to.
        if task["deleted"] as Bool {
            try store.discardPendingAttachment(localId: payload.attachmentLocalId)
            dropBytes(payload.bytesPath)
            return
        }
        guard let taskServerId: Int = task["server_id"] else {
            throw ApiError.blocked("task_attachment: task not synced yet")
        }

        var uploadedJSON = payload.cachedUpload
        if uploadedJSON == nil {
            let bytes: Data
            do {
                bytes = try blobs.read(payload.bytesPath)
            } catch is BlobMissingError {
                throw ApiError(status: 0, code: nil,
                               message: "task_attachment: the bytes of \"\(payload.fileName)\" are missing from the local store",
                               retryable: false)
            } catch {
                throw ApiError(status: 0, code: nil, message: "task_attachment: could not read queued bytes: \(error)", retryable: true)
            }
            let created = try await api.uploadAttachment(taskId: taskServerId, fileName: payload.fileName, mime: payload.mime, bytes: bytes)
            uploadedJSON = created
            // Crash idempotency: if the app dies before the op is deleted, the retry finalises from this
            // instead of uploading the file a second time.
            try store.cacheUploadResult(opId: op.id, payload: op.payloadObject, uploaded: created)
        }
        guard let uploadedJSON, let uploaded = try? JSONDecoder().decode(TaskAttachmentResponse.self, from: uploadedJSON) else {
            throw ApiError(status: 0, code: nil, message: "task_attachment: unreadable upload response", retryable: false)
        }
        let base = await api.serverBase() ?? ""
        try store.finaliseAttachmentUpload(
            attachmentLocalId: payload.attachmentLocalId, taskLocalId: payload.taskLocalId, uploaded: uploaded,
            url: "\(base)/api/v1/tasks/\(taskServerId)/attachments/\(uploaded.id)"
        )
        dropBytes(payload.bytesPath)
    }

    struct Parsed {
        let attachmentLocalId: String
        let taskLocalId: String
        let fileName: String
        let mime: String
        let bytesPath: String
        let cachedUpload: Data?
    }

    static func parse(_ object: [String: Any]) throws -> Parsed {
        guard let attachmentLocalId = object.string("attachmentLocalId"), let taskLocalId = object.string("taskLocalId"),
              let bytesPath = object.string("bytesPath"), let fileName = object.string("fileName") else {
            throw ApiError(status: 0, code: nil, message: "task_attachment: malformed upload payload", retryable: false)
        }
        let cached = (object["_uploaded"]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let mime = object.string("mime").flatMap { $0.isEmpty ? nil : $0 } ?? "application/octet-stream"
        return Parsed(attachmentLocalId: attachmentLocalId, taskLocalId: taskLocalId, fileName: fileName, mime: mime,
                      bytesPath: bytesPath, cachedUpload: cached)
    }

    /// Best effort: a leftover blob wastes disk but breaks nothing.
    private func dropBytes(_ path: String) {
        try? blobs.delete(path)
    }
}

extension CriaStore {
    func cacheUploadResult(opId: Int, payload: [String: Any], uploaded: Data) throws {
        guard let object = try? JSONSerialization.jsonObject(with: uploaded) else { return }
        var stored = payload
        stored["_uploaded"] = object
        let data = try JSONSerialization.data(withJSONObject: stored, options: [.sortedKeys])
        try database.writer.write {
            try $0.execute(sql: "UPDATE outbox SET payload = ? WHERE id = ?", arguments: [String(bytes: data, encoding: .utf8) ?? "", opId])
        }
    }
}

public extension OutboxDrainer {
    func registerAttachmentExecutor(blobs: any BlobStoring) {
        register("task_attachment", AttachmentExecutor(blobs: blobs))
    }
}
