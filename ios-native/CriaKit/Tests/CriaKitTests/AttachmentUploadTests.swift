import GRDB
import XCTest
@testable import CriaKit

final class AttachmentUploadTests: XCTestCase {
    // MARK: finaliseAttachmentUpload

    func testFinaliseTurnsThePendingRowIntoAServerMirror() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store, taskServerId: 42)
        try store.insertPendingAttachment(attachmentPayload())
        try finaliseFixtureUpload(store)

        let row = try XCTUnwrap(try store.attachments(forTask: "task1").first)
        XCTAssertEqual(row.localId, "att1")
        XCTAssertEqual(row.serverId, 7)
        XCTAssertEqual(row.fileId, 70)
        XCTAssertFalse(row.pending)
        XCTAssertFalse(row.uploadFailed)
        XCTAssertNil(try store.attachment(localId: "att1")?.bytesPath)
        let refs = try store.uploadedAttachments(localIds: ["att1", "nope"])
        XCTAssertEqual(refs, [UploadedAttachmentRef(localId: "att1", serverId: 7, taskServerId: 42)])
    }

    func testFinaliseDropsAMirrorAPullInsertedMeanwhile() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store, taskServerId: 42)
        try store.insertPendingAttachment(attachmentPayload())
        try store.replaceTaskAttachmentsFromServer(taskLocalId: "task1", [try uploadedFixture()])
        XCTAssertEqual(try store.attachments(forTask: "task1").count, 2)

        try finaliseFixtureUpload(store)
        XCTAssertEqual(try store.attachments(forTask: "task1").map(\.localId), ["att1"])
    }

    func testFinaliseRewritesADirtyDescriptionInPlaceLeavingTheQueuedOpToPushIt() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store, taskServerId: 42, description: pendingImageHTML, dirty: true)
        try store.insertPendingAttachment(attachmentPayload())
        try finaliseFixtureUpload(store)

        let state = try attachmentTaskState(store, "task1")
        XCTAssertEqual(state.description, ##"<p><img src="#" data-src="\##(attachmentURL7)"></p>"##)
        XCTAssertEqual(try outboxEntries(store, entity: "task").count, 0)
    }

    func testFinaliseQueuesATaskUpdateWhenThePlaceholderWasAlreadyPushed() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store, taskServerId: 42, description: pendingImageHTML, dirty: false)
        try store.insertPendingAttachment(attachmentPayload())
        try finaliseFixtureUpload(store)

        XCTAssertTrue(try attachmentTaskState(store, "task1").dirty)
        let entries = try outboxEntries(store, entity: "task")
        XCTAssertEqual(entries.map(\.operation), ["update"])
        let description = try payloadObject(try XCTUnwrap(entries.first))["description"] as? String
        XCTAssertTrue(try XCTUnwrap(description).contains(attachmentURL7))
    }

    func testFinaliseRewritesCommentsThatReferenceTheUpload() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store, taskServerId: 42)
        try insertTestComment(store, "c-new", serverId: 0, html: #"<img data-src="cria://pending/att1">"#, dirty: true)
        try insertTestComment(store, "c-old", serverId: 5, html: #"<img data-src="cria://pending/att1">"#)
        try insertTestComment(store, "c-other", serverId: 6, html: #"<img data-src="cria://pending/att10">"#)
        try store.insertPendingAttachment(attachmentPayload())
        try finaliseFixtureUpload(store)

        let expected = #"<img data-src="\#(attachmentURL7)">"#
        let newRow = try XCTUnwrap(try store.comment(localId: "c-new"))
        let oldRow = try XCTUnwrap(try store.comment(localId: "c-old"))
        let otherRow = try XCTUnwrap(try store.comment(localId: "c-other"))
        XCTAssertEqual(newRow.comment, expected)
        XCTAssertTrue(newRow.dirty)
        XCTAssertEqual(oldRow.comment, expected)
        XCTAssertTrue(oldRow.dirty)
        // `att10` merely starts with `att1`; it must not be touched.
        XCTAssertEqual(otherRow.comment, #"<img data-src="cria://pending/att10">"#)
        XCTAssertFalse(otherRow.dirty)
        let ops = try outboxEntries(store, entity: "task_comment")
        XCTAssertEqual(ops.map(\.localId), ["c-old"])
        XCTAssertEqual(ops.map(\.operation), ["update"])
    }

    // MARK: discardPendingAttachment

    func testDiscardRemovesRowOpAndDeadLetterReturningTheBytesKey() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try store.insertPendingAttachment(attachmentPayload())
        try runSQL(store, """
            INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, failed_at)
            VALUES ('task_attachment', 'att1', 'upload', '{}', 10, ?)
            """, [isoNow()])

        XCTAssertEqual(try store.discardPendingAttachment(localId: "att1"), "att1")
        XCTAssertEqual(try store.attachments(forTask: "task1").count, 0)
        XCTAssertEqual(try outboxRows(store).count, 0)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM outbox_dead_letter"), 0)
    }

    func testDiscardNeverRemovesAnUploadedAttachment() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store)
        try insertMirrorAttachment(store, "m1", serverId: 3, name: "kept.txt")
        XCTAssertNil(try store.discardPendingAttachment(localId: "m1"))
        XCTAssertEqual(try store.attachments(forTask: "task1").count, 1)
    }

    func testDiscardStripsThePlaceholderImageFromTheDescriptionAsAUserEdit() throws {
        let store = try makeStore()
        let html = ##"<p>Look:</p><p><img src="#" data-src="cria://pending/att1"></p>"##
        try seedAttachmentTasks(store, taskServerId: 42, description: html, dirty: false)
        try store.insertPendingAttachment(attachmentPayload())

        try store.discardPendingAttachment(localId: "att1")

        let state = try attachmentTaskState(store, "task1")
        XCTAssertEqual(state.description, "<p>Look:</p><p></p>")
        XCTAssertTrue(state.dirty)
        let entries = try outboxEntries(store, entity: "task")
        XCTAssertEqual(entries.map(\.localId), ["task1"])
        XCTAssertEqual(entries.map(\.operation), ["update"])
        XCTAssertEqual(try payloadObject(try XCTUnwrap(entries.first))["description"] as? String, "<p>Look:</p><p></p>")
    }

    func testDiscardStripsOtherTasksThatCopiedItButNotDeletedOnes() throws {
        let store = try makeStore()
        let html = ##"<img src="#" data-src="cria://pending/att1">"##
        try seedAttachmentTasks(store, taskServerId: 42, description: "<p>none</p>")
        let project = try XCTUnwrap(try store.task(localId: "task1")?.projectLocalId)
        try runSQL(store, "UPDATE tasks SET description = ? WHERE local_id = 'task2'", [html])
        try runSQL(store, """
            INSERT INTO tasks (local_id, project_local_id, title, description, updated_at, dirty, deleted)
            VALUES ('task3', ?, 'Gone', ?, ?, 1, 1)
            """, [project, html, isoNow()])
        try store.insertPendingAttachment(attachmentPayload())

        try store.discardPendingAttachment(localId: "att1")

        XCTAssertEqual(try attachmentTaskState(store, "task1").description, "<p>none</p>")
        XCTAssertEqual(try attachmentTaskState(store, "task2").description, "<p></p>")
        XCTAssertEqual(try attachmentTaskState(store, "task3").description, html)
        XCTAssertEqual(try outboxEntries(store, entity: "task").map(\.localId), ["task2"])
    }

    func testDiscardStripsCommentsQueueingAnUpdateOnlyForSyncedOnes() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store, taskServerId: 42)
        try insertTestComment(store, "c-new", serverId: 0, html: #"<p>hi</p><img data-src="cria://pending/att1">"#, dirty: true)
        try insertTestComment(store, "c-old", serverId: 5, html: #"<img data-src="cria://pending/att1">"#)
        try insertTestComment(store, "c-other", serverId: 6, html: #"<img data-src="cria://pending/att10">"#)
        try insertTestComment(store, "c-gone", serverId: 7, html: #"<img data-src="cria://pending/att1">"#, dirty: true, deleted: true)
        try store.insertPendingAttachment(attachmentPayload())

        try store.discardPendingAttachment(localId: "att1")

        XCTAssertEqual(try store.comment(localId: "c-gone")?.comment, #"<img data-src="cria://pending/att1">"#)
        XCTAssertEqual(try store.comment(localId: "c-new")?.comment, "<p>hi</p>")
        // Only the image was there: an empty paragraph, never an empty comment (Vikunja requires the field).
        XCTAssertEqual(try store.comment(localId: "c-old")?.comment, "<p></p>")
        XCTAssertEqual(try store.comment(localId: "c-old")?.dirty, true)
        XCTAssertEqual(try store.comment(localId: "c-other")?.comment, #"<img data-src="cria://pending/att10">"#)
        XCTAssertEqual(try store.comment(localId: "c-other")?.dirty, false)
        // c-new has not synced: its queued create carries the stripped text.
        XCTAssertEqual(try outboxEntries(store, entity: "task_comment").map(\.localId), ["c-old"])
    }

    func testDiscardLeavesCommentsOfATaskBeingDeletedAlone() throws {
        let store = try makeStore()
        try seedAttachmentTasks(store, taskServerId: 42)
        try runSQL(store, "UPDATE tasks SET deleted = 1, dirty = 1 WHERE local_id = 'task1'")
        try insertTestComment(store, "c1", serverId: 5, html: #"<img data-src="cria://pending/att1">"#)
        try store.insertPendingAttachment(attachmentPayload())

        try store.discardPendingAttachment(localId: "att1")

        XCTAssertEqual(try outboxRows(store).count, 0)
    }

    func testDiscardDoesNotStripReferencesToAnAttachmentThatHasUploaded() throws {
        let store = try makeStore()
        let html = #"<img data-src="cria://pending/m1">"#
        try seedAttachmentTasks(store, taskServerId: 42, description: html)
        try insertMirrorAttachment(store, "m1", serverId: 3, name: "kept.png")

        try store.discardPendingAttachment(localId: "m1")

        XCTAssertEqual(try attachmentTaskState(store, "task1").description, html)
        XCTAssertEqual(try outboxRows(store).count, 0)
    }
}
