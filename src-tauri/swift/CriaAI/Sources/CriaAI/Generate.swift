import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// One-shot prompt against Apple's on-device model.
///
/// C ABI so Rust can call it: UTF-8 C strings in, a malloc'd UTF-8 C string
/// out (JSON: `{"text": "..."}` or `{"error": "..."}`). Rust frees it with
/// `free`. Blocks until the model responds, so never call on the main thread.
///
/// `title` labels the work for the user: on iOS it's the system progress
/// Live Activity's title and the completion notification's title (see
/// Background.swift), so the call survives the user switching apps.
@_cdecl("cria_ai_generate")
public func criaAiGenerate(
    _ title: UnsafePointer<CChar>,
    _ instructions: UnsafePointer<CChar>,
    _ prompt: UnsafePointer<CChar>
) -> UnsafeMutablePointer<CChar> {
    let title = String(cString: title)
    let instructions = String(cString: instructions)
    let prompt = String(cString: prompt)
    // ponytail: blocking wrapper around async; add a callback when the UI wants streamed text
    let sem = DispatchSemaphore(value: 0)
    var result: [String: String] = ["error": "unsupportedOS"]
    Task {
        defer { sem.signal() }
        #if canImport(FoundationModels)
        guard #available(macOS 26, iOS 26, *) else { return }
        result = await withBackgroundProgress(title: title) { progress in
            await generate(instructions: instructions, prompt: prompt, progress: progress)
        }
        #endif
    }
    sem.wait()
    let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data(#"{"error":"encode"}"#.utf8)
    return strdup(String(decoding: data, as: UTF8.self))!
}

#if canImport(FoundationModels)
@available(macOS 26, iOS 26, *)
private func generate(
    instructions: String,
    prompt: String,
    progress: @Sendable () -> Void
) async -> [String: String] {
    guard case .available = SystemLanguageModel.default.availability else {
        if case .unavailable(let reason) = SystemLanguageModel.default.availability {
            return ["error": "unavailable: \(reason)"]
        }
        return ["error": "unavailable"]
    }
    do {
        let session = LanguageModelSession(instructions: instructions)
        var text = ""
        // Stream so each chunk can tick the progress UI (iOS kills continued
        // tasks that report no progress first under pressure).
        for try await snapshot in session.streamResponse(to: prompt) {
            text = snapshot.content
            progress()
        }
        return ["text": text]
    } catch is CancellationError {
        return ["error": "cancelled"]
    } catch {
        return ["error": String(describing: error)]
    }
}
#endif
