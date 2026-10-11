import XCTest
@testable import CriaKit

final class AttachmentActionsTests: XCTestCase {
    private func makeBlobs() -> FileBlobStore {
        FileBlobStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("cria-\(UUID().uuidString)"))
    }

    func testQueueWritesBytesPendingRowAndUploadOp() throws {
        let store = try makeStore()
        let blobs = makeBlobs()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Attach", projectLocalId: project))
        let bytes = Data([1, 2, 3])

        let localId = try store.queueAttachment(
            taskLocalId: task.localId, fileName: "a.png", mime: "image/png", data: bytes, blobs: blobs
        )

        XCTAssertEqual(try blobs.read(localId), bytes)
        let rows = try store.attachments(forTask: task.localId)
        XCTAssertEqual(rows.map(\.fileName), ["a.png"])
        XCTAssertTrue(try XCTUnwrap(rows.first).pending)
        let entries = try outboxEntries(store, entity: "task_attachment")
        XCTAssertEqual(entries.map(\.operation), ["upload"])
        XCTAssertEqual(entries.map(\.localId), [localId])
    }

    func testDiscardRemovesRowOpAndBytes() throws {
        let store = try makeStore()
        let blobs = makeBlobs()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Attach", projectLocalId: project))
        let localId = try store.queueAttachment(
            taskLocalId: task.localId, fileName: "a.pdf", mime: "application/pdf", data: Data([9]), blobs: blobs
        )

        try store.discardQueuedAttachment(localId: localId, blobs: blobs)

        XCTAssertEqual(try store.attachments(forTask: task.localId).count, 0)
        XCTAssertEqual(try outboxEntries(store, entity: "task_attachment").count, 0)
        XCTAssertThrowsError(try blobs.read(localId))
    }
}
