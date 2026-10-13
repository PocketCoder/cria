import CriaKit
import Foundation
import Observation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Apple's on-device model (Foundation Models, iOS 26 with Apple Intelligence). Older systems and devices report
/// `unsupportedOS`, and the app then shows no AI buttons.
struct SystemOnDeviceModel: OnDeviceModel {
    func availability() async -> String {
        #if canImport(FoundationModels)
        if #available(iOS 26, macOS 26, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return AIFeatures.available
            case .unavailable(let reason): return "unavailable: \(reason)"
            }
        }
        #endif
        return "unsupportedOS"
    }

    func generate(instructions: String, prompt: String) async throws -> String {
        #if canImport(FoundationModels)
        if #available(iOS 26, macOS 26, *) {
            do {
                let session = LanguageModelSession(instructions: instructions)
                return try await session.respond(to: prompt).content
            } catch is CancellationError {
                throw AIModelError(message: "cancelled")
            } catch {
                throw AIModelError(message: String(describing: error))
            }
        }
        #endif
        throw AIModelError(message: "unsupportedOS")
    }
}

struct AIModelError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

/// Whether the AI buttons show. Checked once per launch and again on demand; defaults to hidden until known.
@MainActor @Observable
final class AIStatus {
    static let shared = AIStatus()

    let features = AIFeatures(model: SystemOnDeviceModel())
    private(set) var isOfferable = false
    private(set) var reason: String?

    func refresh() async {
        reason = await features.unavailableReason()
        isOfferable = AIFeatures.isOfferable(reason: reason)
    }

    /// Text for the button's disabled state, nil when ready to run.
    var notReadyMessage: String? {
        reason.map { AIPrompts.errorMessage($0) }
    }
}
