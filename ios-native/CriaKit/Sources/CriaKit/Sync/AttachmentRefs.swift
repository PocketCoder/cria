import Foundation

extension CriaStore {
    /// Before a push, swaps `cria://pending/{id}` placeholders whose upload has landed for the real attachment URL,
    /// and strips images whose attachment row is gone. Placeholders still pending are left alone.
    /// Ported from `resolveUploadedPendingRefs` in `src/sync/attachments.ts`.
    func resolveUploadedPendingRefs(_ html: String?, serverBase: String) throws -> String? {
        let ids = PendingAttachmentRef.findRefs(in: html)
        guard var output = html, !ids.isEmpty else { return html }
        for uploaded in try uploadedAttachments(localIds: ids) {
            let url = "\(serverBase)/api/v1/tasks/\(uploaded.taskServerId)/attachments/\(uploaded.serverId)"
            output = PendingAttachmentRef.replace(in: output, attachmentLocalId: uploaded.localId, with: url)
        }
        for missing in try missingAttachments(localIds: ids) {
            output = PendingAttachmentRef.stripImages(in: output, attachmentLocalId: missing)
        }
        return output
    }
}
