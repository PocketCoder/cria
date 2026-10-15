import CriaKit
import Observation
import SwiftUI

/// A value kept in step with the database. Call `run()` from `.task` so observation starts when the view
/// appears and stops when it goes away.
@MainActor @Observable
final class LiveValue<Value: Sendable> {
    private(set) var value: Value
    @ObservationIgnored private let makeStream: @Sendable () -> AsyncStream<Value>

    init(initial: Value, makeStream: @escaping @Sendable () -> AsyncStream<Value>) {
        value = initial
        self.makeStream = makeStream
    }

    func run() async {
        for await next in makeStream() {
            // A change notification that read the same data again must not re-render the screen.
            if Self.unchanged(value, next) { continue }
            value = next
        }
    }

    private static func unchanged(_ old: Value, _ new: Value) -> Bool {
        guard let old = old as? any Equatable else { return false }
        return equal(old, new)
    }

    private static func equal<T: Equatable>(_ old: T, _ new: Any) -> Bool {
        (new as? T) == old
    }
}
