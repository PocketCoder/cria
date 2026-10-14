import SwiftUI

extension Binding where Value: Equatable {
    /// A binding that only writes when the value actually changes.
    ///
    /// `MenuBarExtra(isInserted:)` sets its status item's visibility on every update, and the status item reports each
    /// set back through key-value observing, which SwiftUI answers by writing the binding. Bound straight to an
    /// `@AppStorage`, that write posts a defaults notification, which redraws the app, which sets the visibility again:
    /// a loop that kept the main thread busy and the window blank (found in a `sample` of the hung app). Writing the
    /// same value is dropped here, so the loop ends after one round.
    static func distinct(get read: @escaping () -> Value, set write: @escaping (Value) -> Void) -> Binding<Value> {
        Binding(get: read, set: { newValue in
            if newValue != read() { write(newValue) }
        })
    }
}
