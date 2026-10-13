import Foundation
import GRDB
import XCTest
@testable import CriaKit

/// A manual clock shared by the drainer and the circuit breaker. It starts at the real time because the store stamps
/// its own rows (the undo hold, `created_at`) with `Date()`.
final class ScenarioClock: @unchecked Sendable {
    private let lock = NSLock()
    private var date = Date()
    var now: Date { lock.withLock { date } }
    func advance(_ seconds: TimeInterval) { lock.withLock { date = date.addingTimeInterval(seconds) } }
}

/// A small stateful Vikunja: just enough of the task endpoints for end-to-end sync scenarios, with scriptable faults.
final class ScenarioServer: @unchecked Sendable {
    enum Fault: Sendable {
        case offline
        case timeout
        case status(Int, String)
    }

    struct Request: @unchecked Sendable {
        let method: String
        let path: String
        let token: String?
        let body: [String: Any]

        var title: String? { body["title"] as? String }
        var isTaskWrite: Bool {
            (method == "PUT" && path.hasSuffix("/tasks")) || (method == "POST" && path.hasPrefix("/tasks/")) ||
                (method == "DELETE" && path.hasPrefix("/tasks/"))
        }
    }

    enum RefreshMode: Sendable {
        case issue(String)
        case reject
    }

    private struct Rule {
        let match: @Sendable (Request) -> Bool
        var remaining: Int?
        let fault: Fault
    }

    private let lock = NSLock()
    private var tasks: [Int: [String: Any]] = [:]
    private var nextId = 100
    private var clockTick = 0
    private var rules: [Rule] = []
    private var appliedLog: [String] = []
    private var attemptLog: [String] = []
    private var validToken: String?
    private var refreshMode: RefreshMode = .reject
    private var refreshCount = 0
    private var readOnlyProjects: Set<Int> = []
    private var heldTitles: Set<String> = []

    private(set) var transport: StubTransport!

    init() {
        // Weak, not unowned: a bus-started drain or periodic tick can outlive the test that started it, and its
        // request must fail quietly rather than crash the test run.
        transport = StubTransport { [weak self] request, _ in
            guard let self else { throw URLError(.cancelled) }
            return try self.handle(request)
        }
    }

    // MARK: Scripting

    /// What the server has applied, in order: `create <title>`, `update <id> <title> done=<bool>`, `delete <id>`.
    var applied: [String] { lock.withLock { appliedLog } }
    /// Every task write that reached the server, whether it was answered or faulted (`create <title>`, `update <id>`).
    var attempts: [String] { lock.withLock { attemptLog } }
    var refreshCalls: Int { lock.withLock { refreshCount } }
    /// Requests that reached the transport (breaker-blocked calls never do).
    var transportAttempts: Int { transport.requests.count }
    var taskIds: [Int] { lock.withLock { tasks.keys.sorted() } }

    func task(_ id: Int) -> [String: Any]? { lock.withLock { tasks[id] } }
    func title(_ id: Int) -> String? { task(id)?["title"] as? String }

    func setNetworkDown(_ down: Bool) {
        lock.withLock {
            rules.removeAll { _ in true }
            if down { rules.append(Rule(match: { _ in true }, remaining: nil, fault: .offline)) }
        }
    }

    /// Faults every request the matcher accepts, `times` times (forever when nil).
    func fail(times: Int? = nil, with fault: Fault, when match: @escaping @Sendable (Request) -> Bool = { _ in true }) {
        lock.withLock { rules.append(Rule(match: match, remaining: times, fault: fault)) }
    }

    func clearFaults() { lock.withLock { rules = [] } }

    func requireToken(_ token: String?, refresh: RefreshMode) {
        lock.withLock {
            validToken = token
            refreshMode = refresh
        }
    }

    func markReadOnly(project: Int) { lock.withLock { _ = readOnlyProjects.insert(project) } }

    /// Seeds a task as if it already existed on the server (another client created it).
    @discardableResult
    func seed(id: Int, project: Int = 1, title: String, done: Bool = false) -> [String: Any] {
        lock.withLock {
            let task = makeTask(id: id, project: project, title: title, done: done, priority: 0)
            tasks[id] = task
            nextId = max(nextId, id + 1)
            return task
        }
    }

    /// Another client edits a task.
    func edit(_ id: Int, title: String? = nil, done: Bool? = nil) {
        lock.withLock {
            guard var task = tasks[id] else { return }
            if let title { task["title"] = title }
            if let done { task["done"] = done }
            task["updated"] = stamp()
            tasks[id] = task
        }
    }

    func remove(_ id: Int) { lock.withLock { _ = tasks.removeValue(forKey: id) } }

    // MARK: Handling

    private func handle(_ request: URLRequest) throws -> (Int, String, [String: String]) {
        let path = (request.url?.path ?? "").replacingOccurrences(of: #"^/api/v[12]"#, with: "", options: .regularExpression)
        let body = (request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
        let bearer = request.value(forHTTPHeaderField: "Authorization")?.replacingOccurrences(of: "Bearer ", with: "")
        let seen = Request(method: request.httpMethod ?? "GET", path: path, token: bearer, body: body)
        return try lock.withLock { try respond(seen) }
    }

    private func respond(_ request: Request) throws -> (Int, String, [String: String]) {
        if request.path == "/user/token/refresh" {
            refreshCount += 1
            switch refreshMode {
            case .issue(let token):
                validToken = token
                return (200, json(["token": token]), [:])
            case .reject:
                return (401, #"{"message":"refresh token invalid"}"#, [:])
            }
        }
        if let validToken, request.token != validToken { return (401, #"{"code":11,"message":"invalid token"}"#, [:]) }
        if request.isTaskWrite { attemptLog.append(describeAttempt(request)) }
        if let index = rules.firstIndex(where: { $0.match(request) && ($0.remaining ?? 1) > 0 }) {
            let rule = rules[index]
            if let remaining = rule.remaining { rules[index].remaining = remaining - 1 }
            switch rule.fault {
            case .offline: throw URLError(.notConnectedToInternet)
            case .timeout: throw URLError(.timedOut)
            case .status(let code, let message): return (code, json(["message": message]), [:])
            }
        }
        return route(request)
    }

    private func describeAttempt(_ request: Request) -> String {
        switch request.method {
        case "PUT": "create \(request.title ?? "")"
        case "POST": "update \(request.path.split(separator: "/").last ?? "")"
        default: "delete \(request.path.split(separator: "/").last ?? "")"
        }
    }

    private func route(_ request: Request) -> (Int, String, [String: String]) {
        let parts = request.path.split(separator: "/").map(String.init)
        switch (request.method, parts.count, parts.first ?? "") {
        case ("GET", 1, "projects"):
            return (200, json([["id": 1, "title": "Inbox"]]), ["x-pagination-total-pages": "1"])
        case ("GET", 1, "tasks"):
            return (200, json(tasks.keys.sorted().compactMap { tasks[$0] }), ["x-pagination-total-pages": "1"])
        case ("GET", 1, _), ("GET", 3, "projects"):
            return (200, "[]", ["x-pagination-total-pages": "1"])
        case ("PUT", 3, "projects") where parts[2] == "tasks":
            return create(project: Int(parts[1]) ?? 1, request)
        case ("GET", 2, "tasks"):
            guard let id = Int(parts[1]), let task = tasks[id] else { return notFound() }
            return (200, json(task), [:])
        case ("POST", 2, "tasks"):
            return update(id: Int(parts[1]) ?? 0, request)
        case ("DELETE", 2, "tasks"):
            guard let id = Int(parts[1]), tasks.removeValue(forKey: id) != nil else { return notFound() }
            appliedLog.append("delete \(id)")
            return (200, #"{"message":"ok"}"#, [:])
        default:
            return notFound()
        }
    }

    private func create(project: Int, _ request: Request) -> (Int, String, [String: String]) {
        if readOnlyProjects.contains(project) { return forbidden() }
        let id = nextId
        nextId += 1
        let task = makeTask(
            id: id, project: project, title: request.title ?? "", done: request.body["done"] as? Bool ?? false,
            priority: request.body["priority"] as? Int ?? 0
        )
        tasks[id] = task
        appliedLog.append("create \(request.title ?? "")")
        return (200, json(task), [:])
    }

    private func update(id: Int, _ request: Request) -> (Int, String, [String: String]) {
        guard var task = tasks[id] else { return notFound() }
        if readOnlyProjects.contains(task["project_id"] as? Int ?? 0) { return forbidden() }
        for key in ["title", "description", "done", "priority", "percent_done", "is_favorite"] {
            if let value = request.body[key] { task[key] = value }
        }
        task["updated"] = stamp()
        tasks[id] = task
        appliedLog.append("update \(id) \(task["title"] as? String ?? "") done=\(task["done"] as? Bool ?? false)")
        return (200, json(task), [:])
    }

    private func makeTask(id: Int, project: Int, title: String, done: Bool, priority: Int) -> [String: Any] {
        [
            "id": id, "project_id": project, "title": title, "description": "", "done": done, "priority": priority,
            "percent_done": 0, "position": 0, "due_date": "0001-01-01T00:00:00Z", "is_favorite": false,
            "repeat_after": 0, "repeat_mode": 0, "updated": stamp(), "created": "2026-10-12T00:00:00Z"
        ]
    }

    private func stamp() -> String {
        clockTick += 1
        return String(format: "2026-10-12T%02d:%02d:00Z", clockTick / 60, clockTick % 60)
    }

    private func notFound() -> (Int, String, [String: String]) { (404, #"{"message":"not found"}"#, [:]) }
    private func forbidden() -> (Int, String, [String: String]) {
        (403, #"{"code":3004,"message":"You don't have the permission to write to this project."}"#, [:])
    }

    private func json(_ value: Any) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data()
        return String(bytes: data, encoding: .utf8) ?? ""
    }
}

/// One signed-in app: a store, a scripted server and the real sync pieces wired to it.
struct Rig {
    let store: CriaStore
    let server: ScenarioServer
    let clock: ScenarioClock
    let api: ApiClient
    let drainer: OutboxDrainer
    let puller: Puller
    let coordinator: SyncCoordinator
    /// Local id of the project with server id 1 (seeded as already synced).
    let project: String

    init(session: (any SessionProviding)? = nil, server: ScenarioServer = ScenarioServer()) throws {
        let clock = ScenarioClock()
        let store = try makeStore()
        let core = HTTPCore(transport: server.transport, breaker: CircuitBreaker(now: { clock.now }))
        let api = ApiClient(session: session ?? FakeSession(), core: core)
        let drainer = OutboxDrainer(api: api, store: store, executors: ["task": TaskExecutor()], now: { clock.now })
        let puller = Puller(api: api, store: store)
        self.store = store
        self.server = server
        self.clock = clock
        self.api = api
        self.drainer = drainer
        self.puller = puller
        self.coordinator = SyncCoordinator(puller: puller, drainer: drainer, store: store)
        self.project = try seedProject(store)
    }

    /// One sync tick (drain, then pull), then time moves on past any backoff.
    func tick(advance seconds: TimeInterval = 65) async {
        await coordinator.tick()
        clock.advance(seconds)
    }

    /// The drain alone, then time moves on.
    func drain(advance seconds: TimeInterval = 65) async {
        await drainer.drain()
        clock.advance(seconds)
    }

    @discardableResult
    func create(_ title: String) throws -> String {
        try store.createTask(TaskInput(title: title, projectLocalId: project)).localId
    }

    /// A task the server already has and the app has pulled (clean, `last_synced` set).
    @discardableResult
    func seedServerTask(id: Int, title: String) throws -> String {
        let task = server.seed(id: id, title: title)
        let raw = String(bytes: try JSONSerialization.data(withJSONObject: task), encoding: .utf8) ?? ""
        let localId = try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, raw), rawJSON: raw)
        return try XCTUnwrap(localId)
    }

    func ops() throws -> [String] {
        try store.outboxRows().map { "\($0.op) \(title(of: $0))" }
    }

    /// The task's title even when it is soft-deleted (`task(localId:)` hides those).
    func title(of row: OutboxRow) -> String {
        let title = try? store.database.writer.read {
            try String.fetchOne($0, sql: "SELECT title FROM tasks WHERE local_id = ?", arguments: [row.entityLocalId])
        }
        return title ?? row.entityLocalId
    }

    func deadLetterKinds() throws -> [String] {
        try store.deadLetters().map { "\($0.op) \($0.attempts)" }
    }

    func row(_ localId: String) throws -> TaskRecord? { try store.task(localId: localId) }

    func dirtyCount() throws -> Int { try countRows(store, "SELECT COUNT(*) FROM tasks WHERE dirty = 1") }
    func unsyncedCount() throws -> Int { try countRows(store, "SELECT COUNT(*) FROM tasks WHERE server_id IS NULL") }
}

/// Polls until the condition holds (the bus-driven drain runs on its own task).
func waitUntil(timeout: TimeInterval = 5, _ condition: @Sendable () throws -> Bool) async rethrows -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if try condition() { return true }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    return try condition()
}
