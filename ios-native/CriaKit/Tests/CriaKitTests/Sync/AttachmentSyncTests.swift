import GRDB
import XCTest
@testable import CriaKit

final class MemoryBlobStore: BlobStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: (data: Data, modified: Date?)] = [:]
    private(set) var deleted: [String] = []

    func put(_ id: String, _ data: Data = Data([1, 2, 3]), modified: Date? = Date()) {
        lock.withLock { items[id] = (data, modified) }
    }

    func write(_ id: String, _ data: Data) throws { put(id, data) }

    func read(_ id: String) throws -> Data {
        guard let item = lock.withLock({ items[id] }) else { throw BlobMissingError(id: id) }
        return item.data
    }

    func delete(_ id: String) throws {
        lock.withLock {
            items[id] = nil
            deleted.append(id)
        }
    }

    func list() throws -> [BlobEntry] {
        lock.withLock { items.map { BlobEntry(id: $0.key, modified: $0.value.modified) } }
    }

    func has(_ id: String) -> Bool { lock.withLock { items[id] != nil } }
}

final class FileBlobStoreTests: XCTestCase {
    private func makeStore() -> FileBlobStore {
        FileBlobStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("cria-blobs-\(UUID().uuidString)"))
    }

    func testRoundTripListAndDelete() throws {
        let store = makeStore()
        try store.write("a1", Data([9, 8, 7]))
        XCTAssertEqual(try store.read("a1"), Data([9, 8, 7]))
        let entries = try store.list()
        XCTAssertEqual(entries.map(\.id), ["a1"])
        XCTAssertNotNil(entries.first?.modified)
        try store.delete("a1")
        try store.delete("a1")
        XCTAssertThrowsError(try store.read("a1")) { XCTAssertEqual($0 as? BlobMissingError, BlobMissingError(id: "a1")) }
        XCTAssertTrue(try store.list().isEmpty)
    }

    func testRejectsIdsThatEscapeTheDirectory() {
        let store = makeStore()
        for id in ["../x", "a/b", "", "..", "a\\b"] {
            XCTAssertThrowsError(try store.write(id, Data()), id) { XCTAssertTrue($0 is BlobIdError) }
        }
    }

    func testListOnMissingDirectoryIsEmpty() throws {
        XCTAssertTrue(try makeStore().list().isEmpty)
    }
}

final class AttachmentUploadTests2: XCTestCase {
    private func drain(_ store: CriaStore, _ server: StubServer, blobs: MemoryBlobStore) async {
        let drainer = OutboxDrainer(api: server.api(), store: store)
        await drainer.registerAttachmentExecutor(blobs: blobs)
        await drainer.drain()
    }

    private func queue(_ store: CriaStore, _ blobs: MemoryBlobStore, taskServerId: Int? = 42) throws {
        try seedAttachmentTasks(store, taskServerId: taskServerId, description: pendingImageHTML)
        blobs.put("att1")
        try store.insertPendingAttachment(attachmentPayload())
    }

    private let uploadReply = #"""
        {"success": [{"id": 7, "file": {"id": 70, "name": "photo.png", "size": 3, "mime": "image/png"},
          "created": "2026-07-01T00:00:00Z"}], "errors": null}
        """#

    func testUploadSendsMultipartFinalisesRewritesAndDeletesBytes() async throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        try queue(store, blobs)
        let server = StubServer()
        server.json("PUT /tasks/42/attachments", uploadReply)
        await drain(store, server, blobs: blobs)

        let request = try XCTUnwrap(server.requests.first)
        XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let form = String(bytes: try XCTUnwrap(request.httpBody), encoding: .utf8) ?? ""
        XCTAssertTrue(form.contains(#"name="files"; filename="photo.png""#))
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_attachments WHERE pending = 0 AND server_id = 7"), 1)
        XCTAssertFalse(blobs.has("att1"))
        XCTAssertEqual(try store.outboxRows().filter { $0.entityType == "task_attachment" }.count, 0)
        let description = try store.database.writer.read {
            try String.fetchOne($0, sql: "SELECT description FROM tasks WHERE local_id = 'task1'")
        }
        XCTAssertTrue(description?.contains("/api/v1/tasks/42/attachments/7") == true)
        XCTAssertFalse(description?.contains("cria://pending") == true)
    }

    func testUnsyncedTaskWaitsWithoutRequestOrAttempt() async throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        try queue(store, blobs, taskServerId: nil)
        let server = StubServer()
        await drain(store, server, blobs: blobs)
        XCTAssertTrue(server.requests.isEmpty)
        XCTAssertEqual(try store.outboxHead()?.attempts, 0)
        XCTAssertTrue(blobs.has("att1"))
    }

    func testMissingBytesDeadLetters() async throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        try queue(store, blobs)
        try blobs.delete("att1")
        let server = StubServer()
        await drain(store, server, blobs: blobs)
        XCTAssertEqual(try store.deadLetters().count, 1)
        XCTAssertTrue(server.requests.isEmpty)
    }

    func testRejectedFileIsPermanent() async throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        try queue(store, blobs)
        let server = StubServer()
        server.json("PUT /tasks/42/attachments", #"{"success": null, "errors": [{"code": 1, "message": "too large"}]}"#)
        await drain(store, server, blobs: blobs)
        XCTAssertEqual(try store.deadLetters().count, 1)
        XCTAssertTrue(try store.deadLetters()[0].lastError?.contains("too large") == true)
    }

    func testServerErrorRetriesAndKeepsBytes() async throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        try queue(store, blobs)
        let server = StubServer()
        server.json("PUT /tasks/42/attachments", "boom", status: 503)
        await drain(store, server, blobs: blobs)
        XCTAssertEqual(try store.outboxHead()?.attempts, 1)
        XCTAssertTrue(blobs.has("att1"))
    }

    func testRetryAfterCrashFinalisesFromCachedUploadWithoutUploadingTwice() async throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        try queue(store, blobs)
        let head = try XCTUnwrap(try store.outboxHead())
        let uploaded = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(uploadReply.utf8)) as? [String: Any])
        let first = try JSONSerialization.data(withJSONObject: try XCTUnwrap((uploaded["success"] as? [Any])?.first))
        try store.cacheUploadResult(opId: head.id, payload: head.payloadObject, uploaded: first)
        let server = StubServer()
        await drain(store, server, blobs: blobs)
        XCTAssertTrue(server.requests.isEmpty)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_attachments WHERE pending = 0 AND server_id = 7"), 1)
    }

    func testRemovedRowOnlyTidiesBytes() async throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        try queue(store, blobs)
        try runSQL(store, "DELETE FROM task_attachments")
        let server = StubServer()
        await drain(store, server, blobs: blobs)
        XCTAssertTrue(server.requests.isEmpty)
        XCTAssertFalse(blobs.has("att1"))
    }
}

final class BlobSweepTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testDeletesOldUnreferencedBlobsOnly() throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        blobs.put("old-orphan", modified: now.addingTimeInterval(-90_000))
        blobs.put("fresh-orphan", modified: now.addingTimeInterval(-60))
        blobs.put("future", modified: now.addingTimeInterval(3_600))
        blobs.put("no-date", modified: nil)
        blobs.put("old-referenced", modified: now.addingTimeInterval(-90_000))
        try seedAttachmentTasks(store, taskServerId: 42)
        try runSQL(store, """
            INSERT INTO task_attachments (local_id, task_local_id, file_name, created_at, pending, bytes_path)
            VALUES ('old-referenced', 'task1', 'a.png', '2026-01-01T00:00:00Z', 1, 'old-referenced')
            """)
        XCTAssertEqual(BlobSweep.sweep(store: store, blobs: blobs, now: now), 1)
        XCTAssertFalse(blobs.has("old-orphan"))
        for kept in ["fresh-orphan", "future", "no-date", "old-referenced"] {
            XCTAssertTrue(blobs.has(kept), kept)
        }
    }

    func testBlobReferencedByOutboxOrDeadLetterIsKept() throws {
        let store = try makeStore()
        let blobs = MemoryBlobStore()
        blobs.put("queued", modified: now.addingTimeInterval(-90_000))
        blobs.put("dead", modified: now.addingTimeInterval(-90_000))
        try runSQL(store, """
            INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
            VALUES ('task_attachment', 'x', 'upload', '{"bytesPath":"queued"}', '2026-01-01T00:00:00Z')
            """)
        try runSQL(store, """
            INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, failed_at)
            VALUES ('task_attachment', 'y', 'upload', '{"bytesPath":"dead"}', 1, '2026-01-01T00:00:00Z')
            """)
        XCTAssertEqual(BlobSweep.sweep(store: store, blobs: blobs, now: now), 0)
    }

    func testCacheBlobsFollowTheirProjectNotTheClock() throws {
        let store = try makeStore()
        try seedProject(store, serverId: 5)
        let blobs = MemoryBlobStore()
        blobs.put(BlobIds.projectBackground(serverId: 5), modified: now.addingTimeInterval(-9_000_000))
        blobs.put(BlobIds.projectBackground(serverId: 6), modified: now)
        blobs.put("project-bg-junk", modified: now)
        XCTAssertEqual(BlobSweep.sweep(store: store, blobs: blobs, now: now), 1)
        XCTAssertTrue(blobs.has("project-bg-5"))
        XCTAssertFalse(blobs.has("project-bg-6"))
        XCTAssertTrue(blobs.has("project-bg-junk"))
    }

    func testBlobIds() {
        XCTAssertEqual(BlobIds.projectServerId(ofBlob: "project-bg-12"), 12)
        XCTAssertNil(BlobIds.projectServerId(ofBlob: "project-bg-0"))
        XCTAssertNil(BlobIds.projectServerId(ofBlob: "abc"))
        XCTAssertFalse(BlobIds.isCache("abc"))
    }
}
