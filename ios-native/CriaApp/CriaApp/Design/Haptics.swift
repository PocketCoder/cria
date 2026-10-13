import SwiftUI

extension View {
    /// The error haptic, played when `failure` turns from nil to a message, i.e. as the failure alert appears.
    /// Complements the alert; the alert stays the real signal. Use on "Could not save" alerts only.
    func errorHaptic(_ failure: String?) -> some View {
        sensoryFeedback(trigger: failure) { _, new in
            guard new != nil else { return nil }
            return SensoryFeedback.error
        }
    }
}
