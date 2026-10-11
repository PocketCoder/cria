import Foundation
import XCTest
@testable import CriaKit

/// A routed stub server. Each route maps `"METHOD /path"` (query ignored) to a response; unknown routes 404.
final class StubServer: @unchecked Sendable {
    struct Reply {
        var status = 200
        var body = "[]"
        var headers: [String: String] = [:]
    }

    let transport: StubTransport
    private let box: RouteBox

    init() {
        let box = RouteBox()
        transport = StubTransport { request, _ in
            let path = request.url?.path.replacingOccurrences(of: "/api/v1", with: "") ?? ""
            let key = "\(request.httpMethod ?? "GET") \(path)"
            let reply = box.next(key) ?? Reply(status: 404, body: #"{"message":"not found"}"#)
            return (reply.status, reply.body, reply.headers)
        }
        self.box = box
    }

    /// Queues replies for a route; the last one repeats.
    func route(_ key: String, _ replies: Reply...) {
        box.set(key, replies)
    }

    func json(_ key: String, _ body: String, status: Int = 200, pages: Int = 1) {
        box.set(key, [Reply(status: status, body: body, headers: ["x-pagination-total-pages": "\(pages)"])])
    }

    var requests: [URLRequest] { transport.requests }

    func api() -> ApiClient {
        ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
    }
}

private final class RouteBox: @unchecked Sendable {
    private let lock = NSLock()
    private var routes: [String: [StubServer.Reply]] = [:]

    func set(_ key: String, _ replies: [StubServer.Reply]) {
        lock.withLock { routes[key] = replies }
    }

    func next(_ key: String) -> StubServer.Reply? {
        lock.withLock {
            guard var queue = routes[key], !queue.isEmpty else { return nil }
            let reply = queue.count > 1 ? queue.removeFirst() : queue[0]
            routes[key] = queue
            return reply
        }
    }
}

/// Asserts nothing was announced on the bus while `body` ran: a sentinel posted afterwards must be first.
func assertNoBusEvents(_ store: CriaStore, file: StaticString = #filePath, line: UInt = #line,
                       _ body: () async throws -> Void) async throws {
    var iterator = store.bus.subscribe().makeAsyncIterator()
    try await body()
    store.bus.notify(.savedFilters)
    let first = await iterator.next()
    XCTAssertEqual(first, .savedFilters, "sync wrote a bus event", file: file, line: line)
}

/// Synchronous wrappers: inside an async test, GRDB's `read` and `write` resolve to their async overloads.
func enqueueRaw(_ store: CriaStore, _ entity: OutboxEntity, localId: String, op: OutboxOp, payload: [String: Any] = [:]) throws {
    try store.database.writer.write { try $0.enqueue(entity, localId: localId, operation: op, payload: payload, at: isoNow()) }
}

func fetchStrings(_ store: CriaStore, _ sql: String) throws -> [String] {
    try store.database.writer.read { try String.fetchAll($0, sql: sql) }
}

func fetchInts(_ store: CriaStore, _ sql: String) throws -> [Int] {
    try store.database.writer.read { try Int.fetchAll($0, sql: sql) }
}
