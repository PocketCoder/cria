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
            value = next
        }
    }
}
