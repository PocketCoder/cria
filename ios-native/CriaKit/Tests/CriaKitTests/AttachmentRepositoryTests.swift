import GRDB
import XCTest
@testable import CriaKit

final class AttachmentRepositoryTests: XCTestCase {
    // MARK: replaceTaskAttachmentsFromServer

    func testReplaceMirrorsTheServerSet() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try insertMirrorAttachment(store, "old", serverId: 99, name: "old.txt")
        let items = try serverAttachmentsFixture([
            AttachmentSpec(id: 1, name: "doc.pdf", created: "2026-06-01T00:00:00Z"),
            AttachmentSpec(id: 2, name: "img.png", created: "2026-06-02T00:00:00Z")
        ])
        try store.replaceTaskAttachmentsFromServer(taskLocalId: "task1", items)

        let rows = try store.attachments(forTask: "task1")
        XCTAssertEqual(rows.map(\.fileName), ["doc.pdf", "img.png"])
        XCTAssertEqual(rows.first?.fileId, 10)
        XCTAssertEqual(rows.first?.fileSize, 1024)
        XCTAssertEqual(rows.first?.mime, "application/pdf")
        XCTAssertTrue(rows.allSatisfy { !$0.pending })
    }

    func testReplaceKeepsTheLocalIdOfAnAttachmentStillOnTheServer() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try insertMirrorAttachment(store, "keep-me", serverId: 1, name: "old-name.txt")
        let items = try serverAttachmentsFixture([AttachmentSpec(id: 1, name: "new-name.txt", created: "2026-06-01T00:00:00Z")])
        try store.replaceTaskAttachmentsFromServer(taskLocalId: "task1", items)
        let rows = try store.attachments(forTask: "task1")
        XCTAssertEqual(rows.map(\.localId), ["keep-me"])
        XCTAssertEqual(rows.first?.serverId, 1)
        XCTAssertEqual(rows.first?.fileName, "new-name.txt")
    }

    func testReplaceLeavesPendingUploadsAloneEvenWhenTheServerSetIsEmpty() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try store.insertPendingAttachment(attachmentPayload())
        try insertMirrorAttachment(store, "gone", serverId: 5, name: "gone.txt")
        try store.replaceTaskAttachmentsFromServer(taskLocalId: "task1", [])

        let rows = try store.attachments(forTask: "task1")
        XCTAssertEqual(rows.map(\.localId), ["att1"])
        XCTAssertEqual(rows.first?.pending, true)
    }

    func testReplaceIsSilent() async throws {
        let store = try makeStore()
        let stream = store.bus.subscribe()
        var iterator = stream.makeAsyncIterator()
        try seedAttachmentTasks(store)
        try store.replaceTaskAttachmentsFromServer(
            taskLocalId: "task1", try serverAttachmentsFixture([AttachmentSpec(id: 1, name: "a.pdf", created: "2026-06-01T00:00:00Z")])
        )
        try store.insertPendingAttachment(attachmentPayload())
        let first = await iterator.next()
        XCTAssertEqual(first, .tasks)
        XCTAssertEqual(try outboxRows(store).count, 1)
    }

    // MARK: Reads

    func testListIsEmptyForATaskWithNoAttachments() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        XCTAssertEqual(try store.attachments(forTask: "task1").count, 0)
    }

    func testListOrdersByCreatedAtThenServerId() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try insertMirrorAttachment(store, "a", serverId: 1, name: "a.txt", created: "2026-01-02T00:00:00Z")
        try insertMirrorAttachment(store, "b", serverId: 2, name: "b.txt", created: "2026-01-01T00:00:00Z")
        XCTAssertEqual(try store.attachments(forTask: "task1").map(\.fileName), ["b.txt", "a.txt"])
    }

    func testPendingRowIsFlaggedFailedOnceItsUploadOpLeavesTheOutbox() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try store.insertPendingAttachment(attachmentPayload())
        var row = try XCTUnwrap(try store.attachments(forTask: "task1").first)
        XCTAssertTrue(row.pending)
        XCTAssertFalse(row.uploadFailed)

        try runSQL(store, "DELETE FROM outbox")
        row = try XCTUnwrap(try store.attachments(forTask: "task1").first)
        XCTAssertTrue(row.pending)
        XCTAssertTrue(row.uploadFailed)
    }

    func testLookupOfAnUnknownIdIsNil() throws {
        let store = try makeStore()
        XCTAssertNil(try store.attachment(localId: "missing"))
    }

    func testMissingAttachmentsReturnsIdsWithNoRow() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try store.insertPendingAttachment(attachmentPayload())
        try insertMirrorAttachment(store, "m1", serverId: 3, name: "kept.txt")
        XCTAssertEqual(try store.missingAttachments(localIds: ["att1", "m1", "gone"]), ["gone"])
        XCTAssertEqual(try store.missingAttachments(localIds: []), [])
    }

    func testDeleteAttachmentLocalRemovesOneRow() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try insertMirrorAttachment(store, "k", serverId: 1, name: "keep.txt")
        try insertMirrorAttachment(store, "r", serverId: 2, name: "remove.txt")
        try store.deleteAttachmentLocal(taskLocalId: "task1", attachmentServerId: 2)
        XCTAssertEqual(try store.attachments(forTask: "task1").map(\.fileName), ["keep.txt"])
    }

    func testTaskLocalIdsWithAttachmentsAreDeduplicatedAndCountPendingUploads() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        XCTAssertEqual(try store.taskLocalIdsWithAttachments(), [])
        try insertMirrorAttachment(store, "a", serverId: 1, name: "a.pdf")
        try insertMirrorAttachment(store, "b", serverId: 2, name: "b.pdf")
        XCTAssertEqual(try store.taskLocalIdsWithAttachments(), ["task1"])
        try store.insertPendingAttachment(attachmentPayload(task: "task2", id: "att2"))
        XCTAssertEqual(try store.taskLocalIdsWithAttachments().sorted(), ["task1", "task2"])
    }

    func testIsBlobReferencedChecksRowsOutboxAndDeadLetters() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        XCTAssertFalse(try store.isBlobReferenced(key: "att1"))
        try store.insertPendingAttachment(attachmentPayload())
        XCTAssertTrue(try store.isBlobReferenced(key: "att1"))

        try store.discardPendingAttachment(localId: "att1")
        XCTAssertFalse(try store.isBlobReferenced(key: "att1"))
        try runSQL(store, """
            INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, failed_at)
            VALUES ('task_attachment', 'other', 'upload', '{"bytesPath":"att1"}', 10, ?)
            """, [isoNow()])
        XCTAssertTrue(try store.isBlobReferenced(key: "att1"))
    }

    // MARK: insertPendingAttachment

    func testInsertPendingAddsRowAndUploadOpCarryingThePayload() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try store.insertPendingAttachment(attachmentPayload())

        let row = try XCTUnwrap(try store.attachments(forTask: "task1").first)
        XCTAssertEqual(row.localId, "att1")
        XCTAssertNil(row.serverId)
        XCTAssertEqual(row.fileName, "photo.png")
        XCTAssertEqual(row.fileSize, 3)
        XCTAssertEqual(row.mime, "image/png")
        XCTAssertTrue(row.pending)

        let entries = try outboxEntries(store, entity: "task_attachment")
        XCTAssertEqual(entries.map(\.localId), ["att1"])
        XCTAssertEqual(entries.map(\.operation), ["upload"])
        let body = try payloadObject(try XCTUnwrap(entries.first))
        XCTAssertEqual(body["taskLocalId"] as? String, "task1")
        XCTAssertEqual(body["attachmentLocalId"] as? String, "att1")
        XCTAssertEqual(body["fileName"] as? String, "photo.png")
        XCTAssertEqual(body["mime"] as? String, "image/png")
        XCTAssertEqual(body["size"] as? Int, 3)
        XCTAssertEqual(body["bytesPath"] as? String, "att1")

        let lookup = try XCTUnwrap(try store.attachment(localId: "att1"))
        XCTAssertEqual(lookup.taskLocalId, "task1")
        XCTAssertTrue(lookup.pending)
        XCTAssertEqual(lookup.bytesPath, "att1")
        XCTAssertNil(lookup.serverId)
    }
}
