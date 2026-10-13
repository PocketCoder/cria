import Foundation

/// Database observation for the UI. Emits the current value first, then a fresh read after every matching
/// change on the bus. Only user mutations publish on the bus; sync upserts are silent (AGENTS.md), so the
/// coordinator announces a pull's end separately (see `AppServices`).
public func observeStore<Value: Sendable>(
    _ store: CriaStore,
    kinds: Set<ChangeKind>,
    read: @escaping @Sendable (CriaStore) throws -> Value
) -> AsyncStream<Value> {
    AsyncStream { continuation in
        let changes = store.bus.subscribe()
        let worker = Task {
            if let first = try? read(store) { continuation.yield(first) }
            for await kind in changes where kinds.contains(kind) {
                if let next = try? read(store) { continuation.yield(next) }
            }
            continuation.finish()
        }
        continuation.onTermination = { _ in worker.cancel() }
    }
}
