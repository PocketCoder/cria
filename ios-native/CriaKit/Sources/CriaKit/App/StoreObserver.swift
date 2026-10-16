import Foundation

/// Database observation for the UI. Emits the current value first, then a fresh read after every matching
/// change on the bus. Only user mutations publish on the bus; sync upserts are silent (AGENTS.md), so the
/// coordinator announces a pull's end separately (see `AppServices`).
///
/// A burst of notices (a sync cycle sends several kinds in a row, a write sends its kind and `.outbox`) becomes one
/// read: notices that arrive while a read is waiting or running fold into a single follow-up read, and each read
/// waits `settle` first so the rest of a burst lands before it.
public func observeStore<Value: Sendable>(
    _ store: CriaStore,
    kinds: Set<ChangeKind>,
    settle: Duration = .milliseconds(30),
    read: @escaping @Sendable (CriaStore) throws -> Value
) -> AsyncStream<Value> {
    AsyncStream { continuation in
        let changes = store.bus.subscribe()
        let (pulses, pulse) = AsyncStream.makeStream(of: Void.self, bufferingPolicy: .bufferingNewest(1))
        let forwarder = Task {
            for await kind in changes where kinds.contains(kind) { pulse.yield() }
            pulse.finish()
        }
        let worker = Task {
            if let first = try? read(store) { continuation.yield(first) }
            for await _ in pulses {
                try? await Task.sleep(for: settle)
                if Task.isCancelled { break }
                if let next = try? read(store) { continuation.yield(next) }
            }
            continuation.finish()
        }
        continuation.onTermination = { _ in
            forwarder.cancel()
            worker.cancel()
        }
    }
}
