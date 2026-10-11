import XCTest
@testable import CriaKit

private actor TickCounter {
    private(set) var value = 0
    func increment() { value += 1 }
}

final class PeriodicSyncTests: XCTestCase {
    private func settle(_ milliseconds: UInt64) async {
        try? await Task.sleep(nanoseconds: milliseconds * 1_000_000)
    }

    func testTicksImmediatelyThenOnEveryInterval() async {
        let counter = TickCounter()
        let sync = PeriodicSync(interval: 0.05, reconcileInterval: 100, tick: { await counter.increment() })
        await sync.start()
        await settle(30)
        let first = await counter.value
        XCTAssertEqual(first, 1, "one tick straight away")
        // Poll up to 3 seconds: a loaded CI runner can delay timer ticks well past the nominal 50 ms.
        var later = await counter.value
        for _ in 0..<30 where later < 3 {
            await settle(100)
            later = await counter.value
        }
        XCTAssertGreaterThanOrEqual(later, 3)
        await sync.stop()
    }

    func testScenePhaseInactivePausesAndActiveResumesWithAnImmediatePull() async {
        let counter = TickCounter()
        // A long interval keeps timer ticks out of the way, so only the immediate pull on resume adds one.
        let sync = PeriodicSync(interval: 0.3, reconcileInterval: 100, tick: { await counter.increment() })
        await sync.start()
        await settle(100)
        await sync.setActive(false)
        let running = await sync.isRunning
        XCTAssertFalse(running)
        let paused = await counter.value
        XCTAssertEqual(paused, 1)
        await settle(500)
        let stillPaused = await counter.value
        XCTAssertEqual(stillPaused, paused, "no ticks while inactive")

        await sync.setActive(true)
        await settle(100)
        let resumed = await counter.value
        XCTAssertEqual(resumed, paused + 1, "foreground pulls straight away")
        await settle(500)
        let ticking = await counter.value
        XCTAssertGreaterThan(ticking, resumed)
        await sync.stop()
    }

    func testStartWhileInactiveWaitsForActive() async {
        let counter = TickCounter()
        let sync = PeriodicSync(interval: 0.05, reconcileInterval: 100, tick: { await counter.increment() })
        await sync.setActive(false)
        await sync.start()
        await settle(150)
        let idle = await counter.value
        XCTAssertEqual(idle, 0)
        await sync.setActive(true)
        await settle(30)
        let active = await counter.value
        XCTAssertEqual(active, 1)
        await sync.stop()
    }

    func testStopEndsBothLoops() async {
        let ticks = TickCounter()
        let reconciles = TickCounter()
        let sync = PeriodicSync(interval: 0.03, reconcileInterval: 0.03,
                                tick: { await ticks.increment() }, reconcile: { await reconciles.increment() })
        await sync.start()
        for _ in 0..<100 {
            let tickNow = await ticks.value
            let reconcileNow = await reconciles.value
            if tickNow > 1 && reconcileNow > 0 { break }
            await settle(20)
        }
        await sync.stop()
        await settle(50)
        let tickCount = await ticks.value
        let reconcileCount = await reconciles.value
        XCTAssertGreaterThan(reconcileCount, 0)
        await settle(200)
        let tickAfter = await ticks.value
        let reconcileAfter = await reconciles.value
        XCTAssertEqual(tickCount, tickAfter)
        XCTAssertEqual(reconcileCount, reconcileAfter)
    }

    func testSetActiveBeforeStartDoesNotStartTheLoop() async {
        let counter = TickCounter()
        let sync = PeriodicSync(interval: 0.05, tick: { await counter.increment() })
        await sync.setActive(false)
        await sync.setActive(true)
        await settle(100)
        let value = await counter.value
        XCTAssertEqual(value, 0)
    }
}

final class SyncCoordinatorTests: XCTestCase {
    private func makeCoordinator(_ server: StubServer) throws -> (SyncCoordinator, CriaStore) {
        let store = try makeStore()
        let api = server.api()
        let drainer = OutboxDrainer(api: api, store: store)
        return (SyncCoordinator(puller: Puller(api: api, store: store), drainer: drainer, store: store), store)
    }

    private func routes(_ server: StubServer) {
        server.json("GET /projects", #"[{"id": 1, "title": "Inbox"}]"#)
        server.json("GET /labels", "[]")
        server.json("GET /tasks", #"[{"id": 5, "project_id": 1, "title": "T"}]"#)
        server.json("GET /projects/1/views", "[]")
    }

    func testTickDrainsThenPullsEverythingAndAnnouncesPerTopic() async throws {
        let server = StubServer()
        routes(server)
        let (coordinator, store) = try makeCoordinator(server)
        var iterator = store.bus.subscribe().makeAsyncIterator()
        await coordinator.tick()
        XCTAssertEqual(try store.projects().map(\.title), ["Inbox"])
        XCTAssertEqual(try store.tasks(matching: TaskQuery()).map(\.title), ["T"])
        var kinds: [ChangeKind] = []
        while kinds.count < 5, let kind = await iterator.next() { kinds.append(kind) }
        XCTAssertEqual(kinds, [.projects, .savedFilters, .labels, .tasks, .views])
        XCTAssertNotNil(coordinator.status.current.lastSyncAt)
        XCTAssertNil(coordinator.status.current.step)
    }

    func testForceSyncContinuesPastAFailingStepAndReportsIt() async throws {
        let server = StubServer()
        routes(server)
        server.json("GET /labels", "boom", status: 500)
        let (coordinator, store) = try makeCoordinator(server)
        await coordinator.forceSync()
        let status = coordinator.status.current
        XCTAssertEqual(status.errors.map(\.step), ["Fetching labels…"])
        XCTAssertEqual(try store.tasks(matching: TaskQuery()).count, 1, "later steps still ran")
        XCTAssertFalse(status.isSyncing)
    }

    func testStatusStreamReportsProgressSteps() async throws {
        let server = StubServer()
        routes(server)
        let (coordinator, _) = try makeCoordinator(server)
        let stream = coordinator.status.subscribe()
        let collector = Task { () -> [String?] in
            var steps: [String?] = []
            for await value in stream {
                steps.append(value.step)
                if value.lastSyncAt != nil { break }
            }
            return steps
        }
        await coordinator.forceSync()
        let steps = await collector.value
        XCTAssertTrue(steps.last == .some(nil), "ends idle")
    }

    func testOutboxEventTriggersADrain() async throws {
        let server = StubServer()
        routes(server)
        server.json("PUT /projects/1/tasks", #"{"id": 77, "project_id": 1, "title": "Queued"}"#)
        let store = try makeStore()
        let api = server.api()
        let drainer = OutboxDrainer(api: api, store: store)
        await drainer.registerStandardExecutors()
        let coordinator = SyncCoordinator(puller: Puller(api: api, store: store), drainer: drainer, store: store)
        await coordinator.start(interval: 3600, reconcileInterval: 3600)
        defer { Task { await coordinator.stop() } }
        try await Task.sleep(nanoseconds: 300_000_000)  // the initial tick pulls project 1

        let project = try XCTUnwrap(try store.projects().first)
        let task = try store.createTask(TaskInput(title: "Queued", projectLocalId: project.localId))
        var serverId: Int?
        for _ in 0..<40 where serverId == nil {
            try await Task.sleep(nanoseconds: 50_000_000)
            serverId = try store.task(localId: task.localId)?.serverId
        }
        XCTAssertEqual(serverId, 77)
    }
}
