import AVFoundation
import Foundation
import Observation
import Speech

/// The audio engine and recogniser. Deliberately not main-actor: the audio tap and the recognition callback run on
/// other queues, and closures made inside a main-actor method would assert there.
private final class SpeechEngine: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    /// Starts listening. `onUpdate` gets the transcript so far and whether the recogniser has finished.
    func start(recognizer: SFSpeechRecognizer, onUpdate: @escaping @Sendable (String?, Bool) -> Void) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        // Keep the audio on the device when the language supports it.
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        self.request = request
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        try engine.start()
        task = recognizer.recognitionTask(with: request) { result, error in
            onUpdate(result?.bestTranscription.formattedString, result?.isFinal == true || error != nil)
        }
    }

    func stop() {
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.finish()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// Live speech to text for Ramble, like Todoist's voice capture: tap the mic, talk, watch the words appear.
@MainActor @Observable
final class SpeechCapture {
    enum State: Equatable {
        case idle
        case listening
        /// Microphone or speech permission refused.
        case denied
        /// No recogniser for this language, or the audio session could not start.
        case unavailable
    }

    private(set) var state = State.idle
    /// Everything recognised since `start()`.
    private(set) var transcript = ""
    private let engine = SpeechEngine()
    /// After `stop()` the recogniser still delivers its last words; they are kept until it says it is final.
    private var awaitingFinal = false

    var isListening: Bool { state == .listening }
    /// Listening, or finishing the last words. The transcript may still change.
    var isCapturing: Bool { isListening || awaitingFinal }

    var problem: String? {
        switch state {
        case .denied: "Allow microphone and speech recognition for Cria in Settings to dictate."
        case .unavailable: "Speech recognition isn't available right now. You can still type."
        default: nil
        }
    }

    func toggle() async {
        if isListening { stop() } else { await start() }
    }

    func start() async {
        guard !isListening else { return }
        awaitingFinal = false
        transcript = ""
        guard await Self.authorised() else {
            state = .denied
            return
        }
        guard let recognizer = SFSpeechRecognizer(locale: .current) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
            state = .unavailable
            return
        }
        do {
            try engine.start(recognizer: recognizer) { [weak self] text, finished in
                Task { @MainActor in self?.receive(text, finished: finished) }
            }
            state = .listening
        } catch {
            engine.stop()
            state = .unavailable
        }
    }

    func stop() {
        guard state == .listening else { return }
        engine.stop()
        state = .idle
        awaitingFinal = true
    }

    private func receive(_ text: String?, finished: Bool) {
        guard isCapturing else { return }
        if let text { transcript = text }
        if finished {
            awaitingFinal = false
            stop()
        }
    }

    private static func authorised() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
}
