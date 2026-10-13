import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

extension View {
    /// The error haptic, played when `failure` turns from nil to a message, i.e. as the failure alert appears.
    /// Complements the alert; the alert stays the real signal. Use on "Could not save" alerts only. Nothing on macOS.
    func errorHaptic(_ failure: String?) -> some View {
        #if os(iOS)
        sensoryFeedback(trigger: failure) { _, new in
            guard new != nil else { return nil }
            return SensoryFeedback.error
        }
        #else
        self
        #endif
    }
}

enum Haptics {
    /// The success notification haptic. Nothing on macOS.
    @MainActor
    static func success() {
        #if canImport(UIKit)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }
}
