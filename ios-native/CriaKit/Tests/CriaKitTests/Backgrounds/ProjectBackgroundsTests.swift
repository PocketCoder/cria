import XCTest
@testable import CriaKit

private final class MemoryBlobs: BlobStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: Data] = [:]

    var ids: [String] { lock.withLock { items.keys.sorted() } }

    func write(_ id: String, _ data: Data) throws { lock.withLock { items[id] = data } }
    func read(_ id: String) throws -> Data {
        guard let data = lock.withLock({ items[id] }) else { throw BlobMissingError(id: id) }
        return data
    }
    func delete(_ id: String) throws { lock.withLock { _ = items.removeValue(forKey: id) } }
    func list() throws -> [BlobEntry] { lock.withLock { items.keys.map { BlobEntry(id: $0, modified: nil) } } }
}

private struct Unreachable: Error {}

final class ProjectBackgroundsTests: XCTestCase {
    private let imageBytes = Data([1, 2, 3])

    func testOnlineFetchReplacesCache() async throws {
        let blobs = MemoryBlobs()
        try blobs.write("project-bg-7", Data([9]))
        let result = await ProjectBackgroundCache(blobs: blobs).load(serverId: 7, online: true) { Data([1, 2, 3]) }
        XCTAssertEqual(result, imageBytes)
        XCTAssertEqual(try blobs.read("project-bg-7"), imageBytes)
    }

    func testOnlineNoBackgroundDeletesCache() async throws {
        let blobs = MemoryBlobs()
        try blobs.write("project-bg-7", Data([9]))
        let result = await ProjectBackgroundCache(blobs: blobs).load(serverId: 7, online: true) { nil }
        XCTAssertNil(result)
        XCTAssertEqual(blobs.ids, [])
    }

    func testUnreachableServerUsesCachedCopy() async throws {
        let blobs = MemoryBlobs()
        try blobs.write("project-bg-7", imageBytes)
        let result = await ProjectBackgroundCache(blobs: blobs).load(serverId: 7, online: true) { throw Unreachable() }
        XCTAssertEqual(result, imageBytes)
    }

    func testOfflineReadsCacheAndMissIsNil() async throws {
        let blobs = MemoryBlobs()
        let cache = ProjectBackgroundCache(blobs: blobs)
        let miss = await cache.load(serverId: 7, online: false) { Data([5]) }
        XCTAssertNil(miss)
        try blobs.write("project-bg-7", imageBytes)
        let hit = await cache.load(serverId: 7, online: false) { Data([5]) }
        XCTAssertEqual(hit, imageBytes)
    }

    func testClearRemovesOnlyBackgrounds() throws {
        let blobs = MemoryBlobs()
        try blobs.write("project-bg-1", imageBytes)
        try blobs.write("project-bg-2", imageBytes)
        try blobs.write("attachment-queued", imageBytes)
        let cache = ProjectBackgroundCache(blobs: blobs)
        XCTAssertEqual(cache.count(), 2)
        XCTAssertEqual(cache.clear(), 2)
        XCTAssertEqual(blobs.ids, ["attachment-queued"])
        XCTAssertEqual(cache.count(), 0)
    }

    func testFetchReturnsNilForJsonAnd404() async throws {
        let json = StubTransport { _, _ in (200, #"{"message": "none"}"#, ["Content-Type": "application/json"]) }
        let missing = StubTransport { _, _ in (404, "{}", [:]) }
        let image = StubTransport { _, _ in (200, "img", ["Content-Type": "image/png"]) }
        func client(_ transport: StubTransport) -> ApiClient {
            ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        }
        let fromJson = try await client(json).projectBackground(projectId: 1)
        let fromMissing = try await client(missing).projectBackground(projectId: 1)
        let fromImage = try await client(image).projectBackground(projectId: 1)
        XCTAssertNil(fromJson)
        XCTAssertNil(fromMissing)
        XCTAssertEqual(fromImage, Data("img".utf8))
    }

    func testServerErrorThrows() async {
        let failing = StubTransport { _, _ in (500, "{}", [:]) }
        let client = ApiClient(session: FakeSession(), core: HTTPCore(transport: failing))
        do {
            _ = try await client.projectBackground(projectId: 1)
            XCTFail("expected a throw")
        } catch {
            XCTAssertTrue(error is ApiError)
        }
    }
}
